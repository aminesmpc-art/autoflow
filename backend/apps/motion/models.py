"""Motion billing is deliberately independent of Studio's Profile and counters."""

import uuid
from typing import ClassVar

from django.conf import settings
from django.db import models


class MotionMembership(models.Model):
    membership_id = models.CharField(max_length=128, primary_key=True)
    product_id = models.CharField(max_length=128)
    plan_id = models.CharField(max_length=128)
    email = models.EmailField(db_index=True)
    active = models.BooleanField(default=False)
    # Whop membership.updated_at, not delivery time: retries can arrive out of order.
    state_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class MotionWebhookReceipt(models.Model):
    event_id = models.CharField(max_length=256, primary_key=True)
    event_type = models.CharField(max_length=100)
    payload_hash = models.CharField(max_length=64)
    disposition = models.CharField(max_length=40)
    membership_id = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class MotionRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    job_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints: ClassVar[list] = [
            models.UniqueConstraint(
                fields=["user", "job_id"], name="motion_unique_user_job"
            ),
        ]
        indexes: ClassVar[list] = [
            models.Index(fields=["user", "date"], name="motion_user_date")
        ]
