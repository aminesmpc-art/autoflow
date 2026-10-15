"""
The extraction allowance, weighted by length.

An eight-second clip and a two-hour video used to cost one extraction each,
while the second costs the service dollars to read. Now every ten minutes
analysed is one extraction: a clip is 1, a 25-minute video is 3, a two-hour
video is 12. The "1 a day free / 20 a day Pro" shape of the allowance stays,
so the wording people already know still holds.

── Who counts ───────────────────────────────────────────────────────────────

The extractor reserves the extractions a job will cost before it does any
model work, and releases them if the job fails. That makes the reservation
the authority: before it, the allowance was counted when the website saved a
result, so anything calling the extractor directly and not saving was never
counted at all.

Rows saved by a client that predates reservations still count one each, so
the allowance holds while the deploy rolls out; a saved row that carries the
job id of a reservation is not counted a second time.
"""

from __future__ import annotations

import math

from django.db import IntegrityError, transaction
from django.db.models import Sum

# Ten analysed minutes is one extraction.
SECONDS_PER_UNIT = 600


def units_for(seconds: float) -> int:
    """What analysing this many seconds costs: at least one."""
    try:
        seconds = float(seconds)
    except (TypeError, ValueError):
        seconds = 0.0
    return max(1, math.ceil(max(0.0, seconds) / SECONDS_PER_UNIT - 1e-9))


def units_used(user, since) -> int:
    """Extractions used since a moment: reservations, plus legacy saves."""
    from apps.extractions.models import ExtractionCharge, SavedExtraction

    charges = ExtractionCharge.objects.filter(user=user, created_at__gte=since, refunded=False)
    charged = charges.aggregate(total=Sum("units"))["total"] or 0
    keys = list(charges.values_list("idempotency_key", flat=True))
    # A saved row counts unless a reservation already charged its job.
    legacy = SavedExtraction.objects.filter(user=user, created_at__gte=since)
    if keys:
        legacy = legacy.exclude(job_id__in=keys)
    return charged + legacy.count()


def reserve(user, *, key: str, seconds: float, kind: str, limit: int, since) -> dict:
    """
    Charge a job once. Idempotent on the job id: a retried reservation of the
    same job is answered from the first and never charged twice.

    Returns the allowance afterwards, with "allowed" and "charged".
    """
    from apps.extractions.models import ExtractionCharge
    from apps.plans.models import Profile

    units = units_for(seconds)
    with transaction.atomic():
        # One reservation at a time per user, so two jobs started together
        # cannot both fit into the last free extraction.
        Profile.objects.select_for_update().filter(user=user).first()
        existing = ExtractionCharge.objects.filter(user=user, idempotency_key=key).first()
        used = units_used(user, since)
        if existing and not existing.refunded:
            return _state(used, limit, units=existing.units, allowed=True, charged=False)
        if used + units > limit:
            return _state(used, limit, units=units, allowed=False, charged=False)
        try:
            if existing:
                existing.refunded = False
                existing.units = units
                existing.save(update_fields=["refunded", "units"])
            else:
                ExtractionCharge.objects.create(
                    user=user, idempotency_key=key, units=units, seconds=float(seconds or 0), kind=kind,
                )
        except IntegrityError:
            # The same job reserved concurrently; the other one charged it.
            return _state(units_used(user, since), limit, units=units, allowed=True, charged=False)
        return _state(used + units, limit, units=units, allowed=True, charged=True)


def release(user, *, key: str) -> bool:
    """Give a failed job's extractions back. True if there was one to give."""
    from apps.extractions.models import ExtractionCharge

    return bool(
        ExtractionCharge.objects.filter(user=user, idempotency_key=key, refunded=False).update(refunded=True)
    )


def _state(used: int, limit: int, *, units: int, allowed: bool, charged: bool) -> dict:
    return {
        "allowed": allowed,
        "charged": charged,
        "units": units,
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
    }
