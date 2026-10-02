"""Verified, product-scoped membership events. Never updates Studio Pro."""

import hashlib
import json

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_aware

from .models import MotionMembership, MotionWebhookReceipt


def resource_id(value) -> str:
    if isinstance(value, dict):
        value = value.get("id")
    return value if isinstance(value, str) else ""


def product_ids(payload: dict) -> tuple[str, str]:
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return "", ""
    membership = data.get("membership") or {}
    if not isinstance(membership, dict):
        membership = {}
    product = resource_id(data.get("product") or data.get("product_id"))
    plan = resource_id(data.get("plan") or data.get("plan_id"))
    return (
        product
        or resource_id(membership.get("product") or membership.get("product_id")),
        plan or resource_id(membership.get("plan") or membership.get("plan_id")),
    )


def configured() -> bool:
    return bool(
        settings.WHOP_MOTION_PRODUCT_ID
        and settings.WHOP_MOTION_PLAN_ID
        and settings.WHOP_MOTION_WEBHOOK_SECRET
        and settings.WHOP_STUDIO_PRODUCT_IDS
        and settings.WHOP_MOTION_PRODUCT_ID not in settings.WHOP_STUDIO_PRODUCT_IDS
    )


def studio_event_allowed(payload: dict) -> bool:
    """Once Motion is configured, ambiguous company-wide events must fail closed."""
    product, plan = product_ids(payload)
    if (product and product == settings.WHOP_MOTION_PRODUCT_ID) or (
        plan and plan == settings.WHOP_MOTION_PLAN_ID
    ):
        return False
    studio_products = settings.WHOP_STUDIO_PRODUCT_IDS
    if studio_products:
        return product in studio_products
    # Preserve legacy Studio behavior only before Motion setup begins.
    # Motion now uses existing Pro. Enabling its job allowance must not block
    # the existing Pro webhook when no separate-plan configuration is used.
    return not settings.WHOP_MOTION_WEBHOOK_SECRET


@transaction.atomic
def process_event(payload: dict, event_id: str) -> str:
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    receipt, created = MotionWebhookReceipt.objects.get_or_create(
        event_id=event_id,
        defaults={
            "event_type": payload["type"],
            "payload_hash": digest,
            "disposition": "pending",
        },
    )
    receipt = MotionWebhookReceipt.objects.select_for_update().get(pk=receipt.pk)
    if not created:
        if receipt.payload_hash != digest:
            raise ValueError("Event ID was reused with a different payload")
        return "duplicate"

    product, plan = product_ids(payload)
    disposition = "ignored_product"
    if (
        product == settings.WHOP_MOTION_PRODUCT_ID
        and plan == settings.WHOP_MOTION_PLAN_ID
    ):
        event_type = payload["type"]
        disposition = "recorded"
        # Payments and scheduled cancellations are NOT authoritative access changes.
        if event_type in ("membership.activated", "membership.deactivated"):
            data = payload["data"]
            membership_id = resource_id(data.get("id"))
            user = data.get("user") or {}
            email = user.get("email", "") if isinstance(user, dict) else ""
            if not isinstance(email, str):
                raise ValueError("Membership email is invalid")
            email = email.strip().lower()
            try:
                validate_email(email)
                state_at = parse_datetime(
                    data.get("updated_at") or payload["timestamp"]
                )
            except (ValidationError, ValueError, TypeError):
                raise ValueError(
                    "Membership email or state timestamp is invalid"
                ) from None
            if (
                not membership_id.startswith("mem_")
                or len(membership_id) > 128
                or len(email) > 254
            ):
                raise ValueError("Membership identity is invalid")
            if state_at is None or not is_aware(state_at):
                raise ValueError("Membership timestamp must include a timezone")
            membership, _ = MotionMembership.objects.get_or_create(
                membership_id=membership_id,
                defaults={"product_id": product, "plan_id": plan, "email": email},
            )
            membership = MotionMembership.objects.select_for_update().get(
                pk=membership.pk
            )
            activate = event_type == "membership.activated"
            # A deactivation wins equal timestamps; an old activation cannot resurrect access.
            if (
                membership.state_at is None
                or state_at > membership.state_at
                or (state_at == membership.state_at and not activate)
            ):
                membership.email = email
                membership.product_id = product
                membership.plan_id = plan
                membership.active = activate
                membership.state_at = state_at
                membership.save()
                disposition = "activated" if activate else "deactivated"
            else:
                disposition = "stale"
            receipt.membership_id = membership_id
    receipt.disposition = disposition
    receipt.save(update_fields=["disposition", "membership_id"])
    return disposition
