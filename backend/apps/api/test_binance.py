"""Pro paid in USDT with Binance Pay (apps/plans/binance.py, 2026-11-22)."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.plans import binance
from apps.plans.models import BinancePayment, PlanType, Profile
from apps.users.models import CustomUser

KEYS = dict(BINANCE_PAY_ID="123456789", BINANCE_API_KEY="k", BINANCE_API_SECRET="s", BINANCE_PRO_PRICE="4.99", BINANCE_PRO_DAYS=30)


def record(order="4410000000000001", amount="4.99", currency="USDT", order_type="C2C", minutes_ago=2):
    return {"orderType": order_type, "transactionId": order, "currency": currency, "amount": amount,
            "transactionTime": int((timezone.now() - timedelta(minutes=minutes_ago)).timestamp() * 1000),
            "payerInfo": {"name": "Buyer", "type": "USER", "binanceId": "777"}}


@override_settings(**KEYS)
class BinanceClaimTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("buyer@example.com", "x", is_active=True)
        self.profile = Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.history = [record()]
        self.calls = []

    def fetch(self, start, end):
        self.calls.append((start, end))
        return self.history

    def test_a_matching_usdt_payment_gives_a_month_of_pro(self):
        res = binance.claim(self.user, " 4410000000000001 ", history_fetcher=self.fetch)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_pro)
        self.assertAlmostEqual((self.profile.pro_expires_at - timezone.now()).days, 29, delta=1)
        self.assertEqual(res["days"], 30)
        pay = BinancePayment.objects.get()
        self.assertEqual((pay.order_id, str(pay.amount), pay.payer_binance_id), ("4410000000000001", "4.99000000", "777"))

    def test_a_second_month_adds_to_the_first(self):
        self.history = [record("A1"), record("A2")]
        binance.claim(self.user, "A1", history_fetcher=self.fetch)
        first = Profile.objects.get(user=self.user).pro_expires_at
        binance.claim(self.user, "A2", history_fetcher=self.fetch)
        self.assertAlmostEqual((Profile.objects.get(user=self.user).pro_expires_at - first).days, 30, delta=1)

    def test_one_receipt_one_month(self):
        binance.claim(self.user, "4410000000000001", history_fetcher=self.fetch)
        other = CustomUser.objects.create_user("thief@example.com", "x", is_active=True)
        Profile.objects.create(user=other, plan_type=PlanType.FREE)
        with self.assertRaises(binance.ClaimError) as e:
            binance.claim(other, "4410000000000001", history_fetcher=self.fetch)
        self.assertEqual(e.exception.status, 409)
        self.assertFalse(Profile.objects.get(user=other).is_pro)

    def test_what_does_not_count(self):
        cases = [
            ([record(amount="-4.99")], "out of our account"),
            ([record(currency="BNB")], "in BNB"),
            ([record(amount="4.98")], "4.98"),
            ([record(order_type="PAYOUT")], "not a Binance Pay transfer"),
            ([record(order="999")], "No payment with this Order ID"),
        ]
        for history, why in cases:
            self.history = history
            with self.assertRaises(binance.ClaimError) as e:
                binance.claim(self.user, "4410000000000001", history_fetcher=self.fetch)
            self.assertIn(why, e.exception.message)
        self.assertFalse(BinancePayment.objects.exists())
        self.assertFalse(Profile.objects.get(user=self.user).is_pro)

    def test_more_than_the_price_is_fine(self):
        self.history = [record(amount="5.5")]
        binance.claim(self.user, "4410000000000001", history_fetcher=self.fetch)
        self.assertTrue(Profile.objects.get(user=self.user).is_pro)

    def test_only_recent_payments_are_looked_up(self):
        binance.claim(self.user, "4410000000000001", history_fetcher=self.fetch)
        start, end = self.calls[0]
        self.assertAlmostEqual((end - start) / 3_600_000, binance.CLAIM_WINDOW_HOURS, delta=0.1)

    def test_a_whop_subscriber_is_not_charged_twice(self):
        self.profile.plan_type, self.profile.is_pro_active = PlanType.PRO, True
        self.profile.save()
        with self.assertRaises(binance.ClaimError) as e:
            binance.claim(self.user, "4410000000000001", history_fetcher=self.fetch)
        self.assertEqual(e.exception.status, 409)
        self.assertFalse(BinancePayment.objects.exists())

    def test_binance_down_says_so_and_keeps_the_order(self):
        def broken(*_):
            raise OSError("timeout")
        with self.assertRaises(binance.ClaimError) as e:
            binance.claim(self.user, "4410000000000001", history_fetcher=broken)
        self.assertEqual(e.exception.status, 502)
        self.assertFalse(BinancePayment.objects.exists())


class BinanceEndpointTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("api@example.com", "x", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client = APIClient()

    def test_closed_until_the_keys_are_set(self):
        info = self.client.get(reverse("billing-binance")).json()
        self.assertEqual((info["enabled"], info["pay_id"], info["amount"], info["currency"]), (False, "", "4.99", "USDT"))
        self.client.force_authenticate(self.user)
        res = self.client.post(reverse("billing-binance-claim"), {"order_id": "1"}, format="json")
        self.assertEqual(res.status_code, 503)

    @override_settings(**KEYS)
    def test_open_shows_the_pay_id_never_the_keys(self):
        info = self.client.get(reverse("billing-binance")).json()
        self.assertEqual((info["enabled"], info["pay_id"]), (True, "123456789"))
        self.assertNotIn("k", [v for v in info.values() if isinstance(v, str) and v == "k"])
        self.assertNotIn("secret", str(info).lower())

    @override_settings(**KEYS)
    def test_claim_needs_an_account(self):
        res = self.client.post(reverse("billing-binance-claim"), {"order_id": "1"}, format="json")
        self.assertEqual(res.status_code, 401)


class RelayTests(TestCase):
    @override_settings(BINANCE_PAY_ID="1", BINANCE_API_KEY="", BINANCE_API_SECRET="",
                       BINANCE_RELAY_URL="https://relay.example/api/binance-history", BINANCE_RELAY_TOKEN="t0k")
    def test_the_relay_alone_opens_it_and_carries_the_token(self):
        from unittest import mock
        import io, json as _json
        self.assertTrue(binance.enabled())
        seen = {}

        def fake(req, timeout=0):
            seen["url"], seen["auth"], seen["body"] = req.full_url, req.headers.get("Authorization"), _json.loads(req.data)
            return io.BytesIO(_json.dumps({"code": "000000", "success": True, "data": [record()]}).encode())
        with mock.patch("urllib.request.urlopen", fake):
            rows = binance.fetch_history(1, 2)
        self.assertEqual(seen["url"], "https://relay.example/api/binance-history")
        self.assertEqual(seen["auth"], "Bearer t0k")
        self.assertEqual(seen["body"], {"startTime": 1, "endTime": 2})
        self.assertEqual(rows[0]["transactionId"], "4410000000000001")

    @override_settings(BINANCE_PAY_ID="1", BINANCE_RELAY_URL="https://r", BINANCE_RELAY_TOKEN="t")
    def test_a_binance_refusal_through_the_relay_is_an_error(self):
        from unittest import mock
        import io, json as _json
        with mock.patch("urllib.request.urlopen", lambda req, timeout=0: io.BytesIO(_json.dumps({"code": "-2015", "message": "Invalid API-key"}).encode())):
            with self.assertRaises(RuntimeError):
                binance.fetch_history(1, 2)


class WhopEndingKeepsBinanceMonths(TestCase):
    def test_paid_months_survive_a_whop_cancellation(self):
        from apps.webhooks.services import _paid_in_binance
        user = CustomUser.objects.create_user("both@example.com", "x", is_active=True)
        Profile.objects.create(user=user, plan_type=PlanType.PRO, is_pro_active=True)
        self.assertFalse(_paid_in_binance(user))
        BinancePayment.objects.create(user=user, order_id="X1", amount="4.99", paid_at=timezone.now(),
                                      pro_until=timezone.now() + timedelta(days=10))
        self.assertTrue(_paid_in_binance(user))


class BinanceManagerTests(TestCase):
    """The admin's Binance Payments manager (sidebar: Payments & Rewards)."""

    def setUp(self):
        self.admin = CustomUser.objects.create_superuser("boss@example.com", "pass12345")
        self.user = CustomUser.objects.create_user("paid@example.com", "x", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client.force_login(self.admin)

    def test_list_and_sidebar(self):
        BinancePayment.objects.create(user=self.user, order_id="L1", amount="4.99", paid_at=timezone.now(),
                                      pro_until=timezone.now() + timedelta(days=30))
        res = self.client.get("/admin/plans/binancepayment/")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "paid@example.com")
        self.assertContains(res, "active")
        self.assertContains(self.client.get("/admin/"), "/admin/plans/binancepayment/")

    def test_adding_one_by_hand_gives_pro(self):
        until = timezone.now() + timedelta(days=30)
        res = self.client.post("/admin/plans/binancepayment/add/", {
            "user": str(self.user.pk), "payer_binance_id": "", "order_id": "HAND1", "amount": "4.99", "currency": "USDT",
            "order_type": "C2C", "paid_at_0": timezone.now().strftime("%Y-%m-%d"), "paid_at_1": "10:00:00",
            "pro_until_0": until.strftime("%Y-%m-%d"), "pro_until_1": until.strftime("%H:%M:%S"),
        })
        self.assertEqual(res.status_code, 302, res.content[:500])
        self.assertTrue(Profile.objects.get(user=self.user).is_pro)

    def test_extend_and_end(self):
        p = BinancePayment.objects.create(user=self.user, order_id="E1", amount="4.99", paid_at=timezone.now(),
                                          pro_until=timezone.now() + timedelta(days=5))
        Profile.objects.filter(user=self.user).update(plan_type=PlanType.PRO, is_pro_active=True, pro_expires_at=p.pro_until)
        self.client.post("/admin/plans/binancepayment/", {"action": "extend_month", "_selected_action": [str(p.pk)]})
        p.refresh_from_db()
        self.assertAlmostEqual((p.pro_until - timezone.now()).days, 34, delta=1)
        self.assertEqual(Profile.objects.get(user=self.user).pro_expires_at, p.pro_until)
        self.client.post("/admin/plans/binancepayment/", {"action": "end_now", "_selected_action": [str(p.pk)]})
        self.assertFalse(Profile.objects.get(user=self.user).is_pro)
