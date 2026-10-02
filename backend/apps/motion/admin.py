from django.contrib import admin

from .models import MotionMembership, MotionRun, MotionWebhookReceipt


class BillingAuditAdmin(admin.ModelAdmin):
    """Billing state changes only through verified events, not manual admin toggles."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(MotionMembership)
class MotionMembershipAdmin(BillingAuditAdmin):
    list_display = ("membership_id", "email", "active", "state_at")
    list_filter = ("active",)
    search_fields = ("membership_id", "email")


@admin.register(MotionRun)
class MotionRunAdmin(BillingAuditAdmin):
    list_display = ("id", "user", "job_id", "date", "created_at")
    list_select_related = ("user",)
    search_fields = ("user__email", "job_id")


@admin.register(MotionWebhookReceipt)
class MotionWebhookReceiptAdmin(BillingAuditAdmin):
    list_display = (
        "event_id",
        "event_type",
        "disposition",
        "membership_id",
        "created_at",
    )
    list_filter = ("disposition", "event_type")
    search_fields = ("event_id", "membership_id")
