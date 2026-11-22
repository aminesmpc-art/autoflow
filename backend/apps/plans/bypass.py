"""Accounts that run AutoFlow without asking the server (the owner, 2026-11-22:
"how the fuck they do this").

Every genuine Queue Manager asks /api/usage/queue-run before a queue starts
(sidepanel runQueue since May 2026, the agent too), and since 2026-11-22 the
claim carries the queue's id. A free account seen on 2026-11-22 started 12
queues, one of 200 prompts, and asked for none of them: no claim, no refusal,
no error in the logs. Flow accepted 186 of its prompts on a 50-prompt day. The
extension it ran was modified (or drove START_QUEUE by hand); the server
cannot stop Flow, which runs on the user's own Google account.

What the server CAN see is every prompt Flow accepted (prompt_submitted, with
the queue id). A free account whose accepted prompts come from queues that
never claimed a run, far past the day's allowance, is not using AutoFlow the
way the free plan offers it. It is suspended: every API call and every sign-in
answers that it is (apps/api/authentication.py, views.LoginView,
GoogleLoginView, RefreshTokenView). An admin lifts it from the user's page.

Measured before switching it on: since claims carried queue ids, the one
account this rule names is that one. Studio's submissions ("studio:…",
"studio-…") are paid by consume_studio_run, which has no queue id, so they are
never counted here.
"""
from datetime import timedelta

from django.utils import timezone

# Unclaimed prompts in one day, past the free allowance, that suspend.
SUSPEND_AT = 60

SUSPENDED_MESSAGE = (
    "This account is suspended: it ran AutoFlow queues that skipped the free plan's checks. "
    "If you think this is a mistake, write to support@auto-flow.studio."
)
SUSPENDED_CODE = "account_suspended"


def _types():
    from apps.usage.models import UsageEvent
    E = UsageEvent.EventType
    return UsageEvent, E, (E.QUEUE_RUN_LITE, E.QUEUE_RUN_FLOW, E.QUEUE_RUN_FULL, E.QUEUE_RUN_AGENT)


def unclaimed_submissions(user, day=None) -> int:
    """Prompts Flow accepted today from queues no run was claimed for.

    A claim made in the 48 hours before covers its queue (a run resumed after
    a reload, or past midnight, keeps its id). Submissions with no queue id,
    and Studio's, are left out: they cannot be matched, so they never count
    against anyone.
    """
    UsageEvent, E, run_types = _types()
    now = timezone.now()
    day = day or now.date()
    claimed = set(
        UsageEvent.objects.filter(user=user, event_type__in=run_types, created_at__gte=now - timedelta(hours=48))
        .exclude(queue_id="").values_list("queue_id", flat=True)
    )
    queues = (
        UsageEvent.objects.filter(user=user, event_type=E.PROMPT_SUBMITTED, created_at__date=day)
        .exclude(queue_id="").exclude(queue_id__startswith="studio").values_list("queue_id", flat=True)
    )
    return sum(1 for q in queues if q not in claimed)


def is_suspended(user) -> bool:
    from apps.plans.models import Profile
    return Profile.objects.filter(user=user, suspended_at__isnull=False).exists()


def suspend(user, reason: str, by: str = "auto") -> bool:
    """Suspend the account. Answers whether it was not suspended already."""
    from apps.plans.models import Profile
    UsageEvent, E, _ = _types()
    changed = Profile.objects.filter(user=user, suspended_at__isnull=True).update(
        suspended_at=timezone.now(), suspended_reason=reason[:255])
    if changed:
        UsageEvent.objects.create(user=user, event_type=E.ACCOUNT_SUSPENDED, metadata={"reason": reason[:255], "by": by})
    return bool(changed)


def lift(user, by: str = "admin") -> bool:
    from apps.plans.models import Profile
    UsageEvent, E, _ = _types()
    changed = Profile.objects.filter(user=user, suspended_at__isnull=False).update(suspended_at=None, suspended_reason="")
    if changed:
        UsageEvent.objects.create(user=user, event_type=E.ACCOUNT_RESTORED, metadata={"by": by})
    return bool(changed)


def check_bypass(user, sent_today: int) -> bool:
    """Called for a free account's prompt nothing paid for (cover_submission).
    Suspends when the day is past the allowance and at least SUSPEND_AT of its
    accepted prompts came from queues that never claimed a run."""
    from apps.plans.services import FREE_TEXT_DAILY_LIMIT
    if sent_today <= FREE_TEXT_DAILY_LIMIT or getattr(user, "is_staff", False):
        return False
    n = unclaimed_submissions(user)
    if n < SUSPEND_AT:
        return False
    return suspend(user, f"{n} prompts accepted today from queues that never asked the server "
                         f"({sent_today} on a {FREE_TEXT_DAILY_LIMIT}-prompt free day)")
