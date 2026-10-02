"""Motion access through existing Pro, with a separate atomic job allowance."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.plans.models import Profile
from apps.users.models import CustomUser

from .models import MotionRun

DAILY_LIMIT = 3
MONTHLY_LIMIT = 12


def entitlement(user, now=None) -> dict:
    now = (now or timezone.now()).astimezone(dt_timezone.utc)
    today = now.date()
    month_start = today.replace(day=1)
    next_month = (month_start + timedelta(days=32)).replace(day=1)
    runs = MotionRun.objects.filter(user=user)
    daily = runs.filter(date=today).count()
    monthly = runs.filter(date__gte=month_start, date__lt=next_month).count()
    enabled = settings.MOTION_BILLING_ENABLED
    profile = Profile.objects.filter(user=user).first() if enabled and user.is_active else None
    active = bool(
        enabled
        and user.is_active
        and profile
        and profile.is_pro
    )
    reason = (
        "motion_unavailable"
        if not enabled
        else "pro_subscription_required"
        if not active
        else "motion_monthly_limit"
        if monthly >= MONTHLY_LIMIT
        else "motion_daily_limit"
        if daily >= DAILY_LIMIT
        else None
    )
    return {
        "product": "motion",
        "accessPlan": "pro",
        "active": active,
        "allowed": reason is None,
        "reason": reason,
        "timezone": "UTC",
        "resetPolicy": "calendar_month",
        "daily": {
            "limit": DAILY_LIMIT,
            "used": daily,
            "remaining": max(0, DAILY_LIMIT - daily),
            "resetsAt": datetime.combine(
                today + timedelta(days=1), datetime.min.time(), dt_timezone.utc
            ).isoformat(),
        },
        "monthly": {
            "limit": MONTHLY_LIMIT,
            "used": monthly,
            "remaining": max(0, MONTHLY_LIMIT - monthly),
            "resetsAt": datetime.combine(
                next_month, datetime.min.time(), dt_timezone.utc
            ).isoformat(),
        },
    }


@transaction.atomic
def reserve_run(user, job_id, fingerprint: str) -> tuple[dict, int]:
    # Lock an existing row, including on a user's very first run. PostgreSQL
    # serializes concurrent requests across all workers, not just this process.
    user = CustomUser.objects.select_for_update().get(pk=user.pk)
    now = timezone.now()
    snapshot = entitlement(user, now)
    if not snapshot["active"]:
        return snapshot, 503 if snapshot["reason"] == "motion_unavailable" else 403
    existing = MotionRun.objects.filter(user=user, job_id=job_id).first()
    if existing:
        if existing.fingerprint != fingerprint:
            return {**snapshot, "allowed": False, "reason": "motion_job_conflict"}, 409
        return {
            **snapshot,
            "allowed": True,
            "reason": None,
            "duplicate": True,
            "runId": str(existing.id),
        }, 200
    if not snapshot["allowed"]:
        return snapshot, 429
    run = MotionRun.objects.create(
        user=user,
        job_id=job_id,
        fingerprint=fingerprint,
        date=now.astimezone(dt_timezone.utc).date(),
    )
    return {
        **entitlement(user, now),
        "allowed": True,
        "reason": None,
        "duplicate": False,
        "runId": str(run.id),
    }, 201
