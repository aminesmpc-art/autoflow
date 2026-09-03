"""Atomic usage operations owned by the usage app."""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.plans.models import Profile

from .models import ClippingUsage, DailyUsage, UsageEvent


FREE_CLIPPING_DAILY_LIMIT = 1
PRO_CLIPPING_DAILY_LIMIT = 10


def _daily_usage(user, today):
    try:
        usage, _ = DailyUsage.objects.get_or_create(user=user, date=today)
        return usage
    except IntegrityError:
        return DailyUsage.objects.get(user=user, date=today)


def reserve_clipping_job(user, idempotency_key: str) -> dict:
    """Charge one daily clipping job, once for each caller-generated job id."""
    today = timezone.localdate()
    _daily_usage(user, today)

    with transaction.atomic():
        usage = DailyUsage.objects.select_for_update().get(user=user, date=today)
        existing = ClippingUsage.objects.filter(
            user=user,
            idempotency_key=idempotency_key,
        ).first()
        profile = Profile.objects.select_for_update().filter(user=user).first()
        is_pro = bool(profile and profile.is_pro)
        limit = PRO_CLIPPING_DAILY_LIMIT if is_pro else FREE_CLIPPING_DAILY_LIMIT

        if existing:
            return _quota_state(usage, limit, is_pro, charged=False, allowed=True)

        if usage.clipping_jobs_used >= limit:
            return _quota_state(usage, limit, is_pro, charged=False, allowed=False)

        ClippingUsage.objects.create(
            user=user,
            idempotency_key=idempotency_key,
            date=today,
        )
        usage.clipping_jobs_used += 1
        usage.save(update_fields=["clipping_jobs_used", "updated_at"])
        UsageEvent.objects.create(
            user=user,
            event_type=UsageEvent.EventType.CLIPPING_JOB_STARTED,
            prompt_count=0,
            metadata={
                "idempotency_key": idempotency_key,
                "plan": "pro" if is_pro else "free",
            },
        )
        return _quota_state(usage, limit, is_pro, charged=True, allowed=True)


def _quota_state(
    usage,
    limit: int,
    is_pro: bool,
    *,
    charged: bool,
    allowed: bool,
) -> dict:
    used = usage.clipping_jobs_used
    return {
        "allowed": allowed,
        "charged": charged,
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "period": "day",
        "is_pro": is_pro,
    }
