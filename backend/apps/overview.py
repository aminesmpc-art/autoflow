"""The admin Overview: everyone, and what each one uses (2026-11-22).

The owner asked for a back end where it is "easy to see who uses the agents,
who doesn't", and everything else. One page answers per user: plan, when they
joined and were last seen, prompts Flow accepted, queue runs by mode, AI-agent
runs and which agents, characters, Studio, Motion, extractions, clipping,
downloads, and two flags:

  over limit — a free account whose accepted prompts passed the daily 50
  uncovered  — prompts Flow accepted that no queue charge paid for (marked by
               cover_submission since 2026-11-22; the bypass this page exists
               to make visible)

Every number comes from aggregate queries over a window (today, 7, 30 days),
off the (user, event_type, created_at) index; no per-user query loop.
"""
from collections import defaultdict
from datetime import timedelta

from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View

from apps.plans.models import Profile
from apps.plans.services import FREE_AGENT_DAILY_LIMIT, FREE_TEXT_DAILY_LIMIT
from apps.usage.models import ClippingUsage, DailyUsage, UsageEvent
from apps.users.models import CustomUser

E = UsageEvent.EventType
RUN_TYPES = {
    E.QUEUE_RUN_LITE: "lite", E.QUEUE_RUN_FLOW: "flow",
    E.QUEUE_RUN_FULL: "full", E.QUEUE_RUN_AGENT: "agent",
}
WINDOWS = {"today": 0, "7": 7, "30": 30}
FILTERS = {
    "all": "Everyone active",
    "agents": "Use AI agents",
    "no_agents": "Never used an agent",
    "characters": "Use characters",
    "studio": "Use Studio",
    "motion": "Use Motion",
    "over": "Over the free limit",
    "uncovered": "Uncharged prompts",
    "suspended": "Suspended",
    "new": "Joined in this window",
}


def _since(window: str):
    now = timezone.now()
    days = WINDOWS.get(window, 7)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start - timedelta(days=days) if days else start


def _optional(model_path):
    """Models from apps that may be absent on some deploys answer None."""
    try:
        module, name = model_path.rsplit(".", 1)
        return getattr(__import__(module, fromlist=[name]), name)
    except Exception:  # pragma: no cover - defensive
        return None


def user_rows(since, plan="all", filt="all", q="", limit=600):
    """One dict per user with any activity since `since` (or joined since)."""
    ev = UsageEvent.objects.filter(created_at__gte=since)
    rows = defaultdict(lambda: defaultdict(int))

    for r in ev.values("user_id", "event_type").annotate(n=Count("id"), p=Sum("prompt_count")):
        u, t = r["user_id"], r["event_type"]
        row = rows[u]
        if t == E.PROMPT_SUBMITTED:
            row["sent"] += r["n"]
        elif t == E.PROMPT_DONE:
            row["done"] += r["n"]
        elif t == E.PROMPT_FAILED:
            row["failed"] += r["n"]
        elif t in RUN_TYPES:
            row["runs"] += r["n"]
            row["runs_" + RUN_TYPES[t]] += r["n"]
        elif t == E.DOWNLOAD_COMPLETED:
            row["downloads"] += r["p"] or 0
        elif t == E.CHARACTER_MADE:
            row["chars_made"] += r["n"]
        elif t == E.CHARACTER_DELETED:
            row["chars_deleted"] += r["n"]
        elif t == E.AGENT_CONNECTED:
            row["agent_connects"] += r["n"]
        row["events"] += r["n"]

    # Studio runs are queue_started rows written by consume_studio_run.
    for r in ev.filter(event_type=E.QUEUE_STARTED, metadata__source="studio").values("user_id").annotate(n=Count("id")):
        rows[r["user_id"]]["studio"] += r["n"]
    # Runs an AI agent started, in any mode, Queue and Studio.
    for r in ev.filter(Q(event_type=E.QUEUE_RUN_AGENT) | Q(metadata__by_agent=True)).values("user_id").annotate(n=Count("id")):
        rows[r["user_id"]]["agent_runs"] += r["n"]
    for r in ev.filter(event_type=E.PROMPT_SUBMITTED, metadata__uncovered=True).values("user_id").annotate(n=Count("id")):
        rows[r["user_id"]]["uncovered"] += r["n"]
    agent_names = defaultdict(set)
    for r in ev.filter(event_type=E.AGENT_CONNECTED).values("user_id", "metadata__agent").distinct():
        if r["metadata__agent"]:
            agent_names[r["user_id"]].add(r["metadata__agent"])
    # The latest character count each account reported.
    latest_chars = {}
    for e in (UsageEvent.objects.filter(event_type__in=[E.CHARACTER_MADE, E.CHARACTER_DELETED])
              .order_by("user_id", "-created_at").values("user_id", "metadata")):
        latest_chars.setdefault(e["user_id"], (e["metadata"] or {}).get("count"))
    # The busiest day's accepted prompts, for "over the free limit".
    for r in (ev.filter(event_type=E.PROMPT_SUBMITTED).annotate(d=TruncDate("created_at"))
              .values("user_id", "d").annotate(n=Count("id"))):
        row = rows[r["user_id"]]
        row["max_day"] = max(row["max_day"], r["n"])
    last_event = dict(ev.values("user_id").annotate(m=Max("created_at")).values_list("user_id", "m"))

    MotionRun = _optional("apps.motion.models.MotionRun")
    if MotionRun is not None:
        for r in MotionRun.objects.filter(created_at__gte=since).values("user_id").annotate(n=Count("id")):
            rows[r["user_id"]]["motion"] += r["n"]
    ExtractionCharge = _optional("apps.extractions.models.ExtractionCharge")
    if ExtractionCharge is not None:
        for r in ExtractionCharge.objects.filter(created_at__gte=since, refunded=False).values("user_id").annotate(n=Count("id")):
            rows[r["user_id"]]["extractions"] += r["n"]
    for r in ClippingUsage.objects.filter(created_at__gte=since).values("user_id").annotate(n=Count("id")):
        rows[r["user_id"]]["clipping"] += r["n"]

    for uid in CustomUser.objects.filter(created_at__gte=since).values_list("id", flat=True):
        rows[uid]["joined_in_window"] = 1

    users = {u["id"]: u for u in CustomUser.objects.filter(id__in=list(rows)).values("id", "email", "created_at", "is_staff")}
    profiles = {p["user_id"]: p for p in Profile.objects.filter(user_id__in=list(rows)).values(
        "user_id", "plan_type", "is_pro_active", "pro_expires_at", "last_seen_at", "suspended_at", "suspended_reason")}

    out = []
    for uid, row in rows.items():
        user = users.get(uid)
        if not user:
            continue
        prof = profiles.get(uid, {})
        pro = bool(prof.get("is_pro_active")) and prof.get("plan_type") == "pro"
        item = dict(row)
        item.update({
            "id": uid,
            "email": user["email"],
            "joined": user["created_at"],
            "last_seen": prof.get("last_seen_at") or last_event.get(uid),
            "pro": pro,
            "agents": sorted(agent_names.get(uid, ())),
            "chars_now": latest_chars.get(uid),
            "suspended": bool(prof.get("suspended_at")),
            "suspended_reason": prof.get("suspended_reason") or "",
        })
        item["uses_agent"] = bool(item.get("agent_runs") or item.get("agent_connects") or item["agents"])
        item["over"] = (not pro) and item.get("max_day", 0) > FREE_TEXT_DAILY_LIMIT
        out.append(item)

    if plan == "pro":
        out = [r for r in out if r["pro"]]
    elif plan == "free":
        out = [r for r in out if not r["pro"]]
    pick = {
        "agents": lambda r: r["uses_agent"],
        "no_agents": lambda r: not r["uses_agent"],
        "characters": lambda r: r.get("chars_made") or r.get("chars_now"),
        "studio": lambda r: r.get("studio"),
        "motion": lambda r: r.get("motion"),
        "over": lambda r: r["over"],
        "uncovered": lambda r: r.get("uncovered"),
        "suspended": lambda r: r.get("suspended"),
        "new": lambda r: r.get("joined_in_window"),
    }.get(filt)
    if pick:
        out = [r for r in out if pick(r)]
    if q:
        ql = q.lower()
        out = [r for r in out if ql in r["email"].lower()]
    out.sort(key=lambda r: (r.get("sent", 0), r.get("runs", 0), r.get("events", 0)), reverse=True)
    return out[:limit], len(out)


def summary(since, rows_all):
    """The cards at the top, from the same rows plus a few totals."""
    total_users = CustomUser.objects.count()
    pro_users = Profile.objects.filter(is_pro_active=True, plan_type="pro").count()
    active = [r for r in rows_all if r.get("events") or r.get("motion") or r.get("extractions") or r.get("clipping")]

    def users_with(key):
        return sum(1 for r in active if r.get(key))

    revenue = 0.0
    payments = 0
    WebhookEvent = _optional("apps.webhooks.models.WebhookEvent")
    if WebhookEvent is not None:
        for raw in WebhookEvent.objects.filter(created_at__gte=since, event_type="payment.succeeded").values_list("raw_payload", flat=True)[:2000]:
            data = (raw or {}).get("data") or {}
            amount = data.get("total") or data.get("final_amount") or data.get("subtotal")
            try:
                revenue += float(amount)
                payments += 1
            except (TypeError, ValueError):
                pass

    # Months of Pro paid in USDT with Binance Pay (apps/plans/binance.py).
    BinancePayment = _optional("apps.plans.models.BinancePayment")
    binance_total, binance_count = 0.0, 0
    if BinancePayment is not None:
        agg = BinancePayment.objects.filter(created_at__gte=since).aggregate(n=Count("id"), total=Sum("amount"))
        binance_count = agg["n"] or 0
        binance_total = float(agg["total"] or 0)
    revenue += binance_total
    payments += binance_count

    return {
        "binance_payments": binance_count,
        "total_users": total_users,
        "pro_users": pro_users,
        "free_users": max(0, total_users - pro_users),
        "active": len(active),
        "new_users": sum(1 for r in rows_all if r.get("joined_in_window")),
        "sent": sum(r.get("sent", 0) for r in rows_all),
        "done": sum(r.get("done", 0) for r in rows_all),
        "runs": sum(r.get("runs", 0) for r in rows_all),
        "agent_users": sum(1 for r in active if r["uses_agent"]),
        "agent_runs": sum(r.get("agent_runs", 0) for r in rows_all),
        "no_agent_users": sum(1 for r in active if not r["uses_agent"]),
        "char_users": sum(1 for r in active if r.get("chars_made") or r.get("chars_now")),
        "chars_made": sum(r.get("chars_made", 0) for r in rows_all),
        "studio_users": users_with("studio"),
        "motion_users": users_with("motion"),
        "extract_users": users_with("extractions"),
        "clip_users": users_with("clipping"),
        "over_users": sum(1 for r in rows_all if r["over"]),
        "uncovered": sum(r.get("uncovered", 0) for r in rows_all),
        "uncovered_users": sum(1 for r in rows_all if r.get("uncovered")),
        "suspended_users": sum(1 for r in rows_all if r.get("suspended")),
        "revenue": round(revenue, 2),
        "payments": payments,
    }


def daily_series(days=14):
    """Per day: active users, accepted prompts, agent runs, new users."""
    start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    ev = UsageEvent.objects.filter(created_at__gte=start)
    by_day = defaultdict(lambda: {"active": 0, "sent": 0, "agent": 0, "new": 0})
    for r in ev.annotate(d=TruncDate("created_at")).values("d").annotate(u=Count("user_id", distinct=True)):
        by_day[r["d"]]["active"] = r["u"]
    for r in ev.filter(event_type=E.PROMPT_SUBMITTED).annotate(d=TruncDate("created_at")).values("d").annotate(n=Count("id")):
        by_day[r["d"]]["sent"] = r["n"]
    for r in (ev.filter(Q(event_type=E.QUEUE_RUN_AGENT) | Q(metadata__by_agent=True))
              .annotate(d=TruncDate("created_at")).values("d").annotate(n=Count("id"))):
        by_day[r["d"]]["agent"] = r["n"]
    for r in (CustomUser.objects.filter(created_at__gte=start).annotate(d=TruncDate("created_at"))
              .values("d").annotate(n=Count("id"))):
        by_day[r["d"]]["new"] = r["n"]
    out = []
    for i in range(days):
        d = (start + timedelta(days=i)).date()
        out.append({"day": d, **by_day[d]})
    peak = {k: max([x[k] for x in out] + [1]) for k in ("active", "sent", "agent", "new")}
    for x in out:
        for k in ("active", "sent", "agent", "new"):
            x[k + "_pct"] = round(100 * x[k] / peak[k])
    return out, peak


def overview_context(request):
    """What the admin home's "Users & what they use" block shows."""
    params = getattr(request, "GET", None) or {}
    window = params.get("window", "7")
    if window not in WINDOWS:
        window = "7"
    plan = params.get("plan", "all")
    filt = params.get("filter", "all")
    if filt not in FILTERS:
        filt = "all"
    q = (params.get("q") or "").strip()[:80]
    since = _since(window)

    everyone, _ = user_rows(since, limit=100_000)
    # The home shows the top 50 so the rest of the dashboard stays in reach;
    # "Show all" (rows=all) lists everyone who matches.
    show_all = params.get("rows") == "all"
    rows, matched = user_rows(since, plan=plan, filt=filt, q=q, limit=600 if show_all else 50)
    series, peak = daily_series(14)
    return {
        "window": window,
        "windows": [("today", "Today"), ("7", "7 days"), ("30", "30 days")],
        "plan": plan,
        "filter": filt,
        "filters": FILTERS.items(),
        "q": q,
        "since": since,
        "s": summary(since, everyone),
        "rows": rows,
        "matched": matched,
        "show_all": show_all,
        "series": series,
        "peak": peak,
        "free_limit": FREE_TEXT_DAILY_LIMIT,
        "agent_limit": FREE_AGENT_DAILY_LIMIT,
    }


@method_decorator(staff_member_required, name="dispatch")
class OverviewView(View):
    """The page this used to be: now a section of the admin home."""

    def get(self, request):
        query = request.GET.urlencode()
        return redirect(f"/admin/{'?' + query if query else ''}#who-uses-what")


@method_decorator(staff_member_required, name="dispatch")
class OverviewUserView(View):
    """One account: its last 30 days, day by day, and its latest events."""
    template_name = "admin/overview_user.html"

    def get(self, request, user_id):
        user = get_object_or_404(CustomUser, pk=user_id)
        profile = Profile.objects.filter(user=user).first()
        since = _since("30")
        rows, _ = user_rows(since, q=user.email, limit=5)
        row = next((r for r in rows if r["id"] == user.pk), None)
        days = list(DailyUsage.objects.filter(user=user, date__gte=since.date()).order_by("-date")[:31])
        sent_by_day = dict(UsageEvent.objects.filter(user=user, event_type=E.PROMPT_SUBMITTED, created_at__gte=since)
                           .annotate(d=TruncDate("created_at")).values("d").annotate(n=Count("id")).values_list("d", "n"))
        for d in days:
            d.sent = sent_by_day.get(d.date, 0)
            d.over = d.sent > FREE_TEXT_DAILY_LIMIT and not (profile and profile.is_pro)
        events = list(UsageEvent.objects.filter(user=user).order_by("-created_at")[:150])
        return render(request, self.template_name, {
            "title": user.email,
            "u": user,
            "profile": profile,
            "row": row,
            "days": days,
            "events": events,
            "free_limit": FREE_TEXT_DAILY_LIMIT,
        })
