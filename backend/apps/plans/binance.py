"""Pay for Pro with Binance Pay: USDT to the owner's Pay ID, checked by order ID (2026-11-22).

The owner chose it from a checkout he had seen: the buyer sends the price in
USDT to our Binance Pay ID, pastes the Order ID from their Binance receipt, and
the server checks it against the account's own Pay history and gives a month
of Pro. No merchant account: a READ-ONLY API key on the owner's account reads
the history (GET /sapi/v1/pay/transactions, signed). Read off Binance's docs
the same day:

  - each record has transactionId (the receipt's Order ID), transactionTime
    (ms), amount (string, positive = money in, negative = out), currency
    (the asset received), orderType (PAY, C2C, …) and payerInfo
  - the last 90 days come back when no time range is given; 100 at most

What is checked, and why:
  - the transactionId matches exactly, money came IN, in USDT, at least the
    price: the history is ours, so a match is a real payment to us
  - it is recent (CLAIM_WINDOW_HOURS): an old receipt is not a new month
  - one order, one month: BinancePayment.order_id is unique, so a receipt
    cannot be claimed twice, by anyone

Crypto does not renew by itself, so a payment is a prepaid month: it extends
Pro from today, or from the end of the month already paid. An account Pro by a
Whop subscription is not charged twice: the claim is refused before the order
is used, so support can sort it out.

Settings (Railway environment, never in code or chat):
  BINANCE_PAY_ID       the Pay ID buyers send to (shown on the checkout)
  BINANCE_RELAY_URL    https://www.auto-flow.studio/api/binance-history
  BINANCE_RELAY_TOKEN  the password the relay expects
  BINANCE_PRO_PRICE    4.99   BINANCE_PRO_DAYS  30

Why a relay: Binance answers Railway's servers (US, and its Dutch and
Singapore regions alike) "Service unavailable from a restricted location"
(HTTP 451, measured 2026-11-22). The website's /api/binance-history runs on
Vercel in Frankfurt, where Binance answers, holds the read-only key and does
only this one read. Direct calls (BINANCE_API_KEY / BINANCE_API_SECRET here)
are kept for a server Binance does not block.
"""
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.plans.models import BinancePayment, PlanType, Profile

logger = logging.getLogger(__name__)

API_URL = "https://api.binance.com/sapi/v1/pay/transactions"
CURRENCY = "USDT"
CLAIM_WINDOW_HOURS = 72
INCOMING_TYPES = {"PAY", "C2C"}


def price() -> Decimal:
    return Decimal(str(getattr(settings, "BINANCE_PRO_PRICE", "4.99") or "4.99"))


def days() -> int:
    return int(getattr(settings, "BINANCE_PRO_DAYS", 30) or 30)


def _relay() -> bool:
    return bool(getattr(settings, "BINANCE_RELAY_URL", "") and getattr(settings, "BINANCE_RELAY_TOKEN", ""))


def enabled() -> bool:
    direct = getattr(settings, "BINANCE_API_KEY", "") and getattr(settings, "BINANCE_API_SECRET", "")
    return bool(getattr(settings, "BINANCE_PAY_ID", "") and (_relay() or direct))


def checkout_info() -> dict:
    """What the checkout page shows. No secret ever leaves here."""
    return {
        "enabled": enabled(),
        "pay_id": getattr(settings, "BINANCE_PAY_ID", "") if enabled() else "",
        "amount": str(price()),
        "currency": CURRENCY,
        "days": days(),
        "window_hours": CLAIM_WINDOW_HOURS,
    }


def _answer(body: dict) -> list:
    if str(body.get("code")) not in ("000000", "0") and body.get("success") is not True:
        raise RuntimeError(f"Binance answered {body.get('code')}: {body.get('message') or body.get('msg')}")
    return body.get("data") or []


def fetch_history(start_ms: int, end_ms: int) -> list:
    """Our account's Binance Pay records between two times: through the relay when set."""
    if _relay():
        req = urllib.request.Request(
            settings.BINANCE_RELAY_URL, method="POST",
            data=json.dumps({"startTime": start_ms, "endTime": end_ms}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.BINANCE_RELAY_TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=20) as res:
            return _answer(json.loads(res.read().decode()))
    params = {"startTime": start_ms, "endTime": end_ms, "limit": 100, "recvWindow": 10000,
              "timestamp": int(time.time() * 1000)}
    query = urllib.parse.urlencode(params)
    signature = hmac.new(settings.BINANCE_API_SECRET.encode(), query.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(f"{API_URL}?{query}&signature={signature}",
                                 headers={"X-MBX-APIKEY": settings.BINANCE_API_KEY})
    with urllib.request.urlopen(req, timeout=15) as res:
        return _answer(json.loads(res.read().decode()))


def _amount(value) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def _matches(record: dict, order_id: str) -> bool:
    tid = str(record.get("transactionId") or "").strip()
    return bool(tid) and (tid == order_id or tid.endswith("_" + order_id))


def find_payment(order_id: str, history: list) -> tuple[dict | None, str | None]:
    """The record for this order, or why it does not count."""
    record = next((r for r in history if _matches(r, order_id)), None)
    if not record:
        return None, ("No payment with this Order ID reached us in the last "
                      f"{CLAIM_WINDOW_HOURS} hours. Check the ID on your Binance receipt, or wait a minute and try again.")
    amount = _amount(record.get("amount"))
    if amount <= 0:
        return None, "That order is a payment out of our account, not one to it."
    if str(record.get("currency") or "").upper() != CURRENCY:
        return None, f"That payment was in {record.get('currency')}; Pro is paid in {CURRENCY}."
    if amount < price():
        return None, f"That payment was {amount} {CURRENCY}; Pro is {price()} {CURRENCY}."
    if record.get("orderType") and str(record["orderType"]).upper() not in INCOMING_TYPES:
        return None, "That order is not a Binance Pay transfer."
    return record, None


class ClaimError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def claim(user, order_id: str, history_fetcher=fetch_history) -> dict:
    """Check one Binance order and give its month of Pro. Raises ClaimError."""
    order_id = "".join(str(order_id or "").split())[:64]
    if not order_id or not order_id.replace("_", "").isalnum():
        raise ClaimError("Paste the Order ID from your Binance receipt.")
    if not enabled():
        raise ClaimError("Paying with Binance is not open yet.", 503)
    if BinancePayment.objects.filter(order_id=order_id).exists():
        raise ClaimError("This Order ID was already used.", 409)

    profile = Profile.objects.filter(user=user).first()
    if profile and profile.is_pro and not profile.pro_expires_at:
        raise ClaimError("Your account is already Pro with a subscription, so this payment was not used. "
                         "Write to support with the Order ID.", 409)

    now = timezone.now()
    try:
        history = history_fetcher(int((now - timedelta(hours=CLAIM_WINDOW_HOURS)).timestamp() * 1000),
                                  int(now.timestamp() * 1000) + 60_000)
    except Exception as e:  # network, keys, Binance
        logger.exception("Binance history failed")
        raise ClaimError("Binance could not be reached to check the payment. Try again in a minute.", 502) from e
    record, why = find_payment(order_id, history)
    if not record:
        raise ClaimError(why, 404)

    with transaction.atomic():
        profile = Profile.objects.select_for_update().get(user=user)
        start = profile.pro_expires_at if (profile.is_pro and profile.pro_expires_at and profile.pro_expires_at > now) else now
        until = start + timedelta(days=days())
        try:
            BinancePayment.objects.create(
                user=user, order_id=order_id,
                amount=_amount(record.get("amount")), currency=CURRENCY,
                paid_at=datetime.fromtimestamp(int(record.get("transactionTime") or 0) / 1000, tz=dt_timezone.utc)
                if record.get("transactionTime") else now,
                order_type=str(record.get("orderType") or "")[:16],
                payer_binance_id=str((record.get("payerInfo") or {}).get("binanceId") or "")[:32],
                pro_until=until,
            )
        except IntegrityError:
            raise ClaimError("This Order ID was already used.", 409)
        profile.plan_type = PlanType.PRO
        profile.is_pro_active = True
        profile.pro_expires_at = until
        profile.save(update_fields=["plan_type", "is_pro_active", "pro_expires_at", "updated_at"])
    logger.info("Binance Pro for %s until %s (order %s)", user.email, until, order_id)
    return {"ok": True, "pro_until": until.isoformat(), "days": days()}
