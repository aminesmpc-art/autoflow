"""Profile model — plan type, entitlement flags, Whop integration fields."""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class PlanType(models.TextChoices):
    FREE = "free", "Free"
    PRO = "pro", "Pro"


class Profile(models.Model):
    """One-to-one extension of User for plan and preference data."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    display_name = models.CharField(max_length=100, blank=True, default="")
    plan_type = models.CharField(
        max_length=10, choices=PlanType.choices, default=PlanType.FREE
    )
    is_pro_active = models.BooleanField(default=False)
    fair_use_flag = models.BooleanField(default=False)
    timezone = models.CharField(max_length=64, blank=True, default="UTC")
    last_seen_at = models.DateTimeField(null=True, blank=True)
    pro_expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text="If set, Pro access expires at this time (e.g. review reward)",
    )

    # Whop integration (nullable until connected)
    whop_user_id = models.CharField(max_length=128, null=True, blank=True)
    whop_membership_id = models.CharField(max_length=128, null=True, blank=True)

    # Suspended for running queues that skipped the free plan's checks
    # (apps/plans/bypass.py). Every API call and sign-in refuses it.
    suspended_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Set: the account is suspended (API and sign-in refused). Clear it to lift.",
    )
    suspended_reason = models.CharField(max_length=255, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "profile"
        verbose_name_plural = "profiles"

    def __str__(self):
        return f"{self.user.email} ({self.plan_type})"

    @property
    def is_pro(self) -> bool:
        if self.plan_type != PlanType.PRO or not self.is_pro_active:
            return False
        # Auto-expire time-limited Pro (e.g. review reward)
        if self.pro_expires_at and timezone.now() > self.pro_expires_at:
            # Auto-clean: reset DB fields so the stale Pro status is removed
            self.plan_type = PlanType.FREE
            self.is_pro_active = False
            self.save(update_fields=["plan_type", "is_pro_active", "updated_at"])
            return False
        return True


class BinancePayment(models.Model):
    """A month of Pro paid in USDT through Binance Pay (apps/plans/binance.py).

    order_id is the Order ID on the buyer's Binance receipt (the Pay history's
    transactionId). Unique: one receipt, one month, whoever sends it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="binance_payments")
    order_id = models.CharField(max_length=64, unique=True)
    amount = models.DecimalField(max_digits=12, decimal_places=8)
    currency = models.CharField(max_length=12, default="USDT")
    paid_at = models.DateTimeField()
    order_type = models.CharField(max_length=16, blank=True, default="")
    payer_binance_id = models.CharField(max_length=32, blank=True, default="")
    pro_until = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Binance payment"
        verbose_name_plural = "Binance payments"

    def __str__(self):
        return f"{self.user.email} — {self.amount} {self.currency} ({self.order_id})"

