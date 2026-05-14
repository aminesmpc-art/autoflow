"""Marketing admin — Unfold-compatible, user-friendly configuration.

This admin page lets you:
- See all email subscribers and their sequence status
- Import all existing users with one click
- Send blast emails to selected subscribers
- Manually trigger follow-up emails
"""
import logging
import threading

from django.contrib import admin, messages
from django.conf import settings

from unfold.admin import ModelAdmin
from unfold.decorators import action

from .models import EmailSequenceSubscriber
from .services import send_marketing_email, subscribe_to_sequence

logger = logging.getLogger(__name__)


@admin.register(EmailSequenceSubscriber)
class EmailSequenceSubscriberAdmin(ModelAdmin):
    # ── What shows in the list ──
    list_display = [
        "email",
        "sequence_progress",
        "action_status",
        "source",
        "created_at",
    ]
    list_filter = [
        "action_taken",
        "sequence_completed",
        "source",
        "emails_sent",
    ]
    search_fields = ["email"]
    list_per_page = 25

    # ── Edit form layout ──
    readonly_fields = [
        "id",
        "tracking_token",
        "created_at",
        "updated_at",
        "last_email_at",
    ]

    fieldsets = (
        ("📧 Subscriber Info", {
            "fields": ("id", "email", "source"),
            "description": "The subscriber's email and how they signed up.",
        }),
        ("📊 Sequence Progress", {
            "fields": ("emails_sent", "last_email_at", "action_taken", "sequence_completed"),
            "description": (
                "Track which emails have been sent. The sequence is: "
                "Email 1 (Welcome) → Email 2 (3-day reminder) → Email 3 (7-day final)."
            ),
        }),
        ("🔗 Click Tracking", {
            "fields": ("tracking_token",),
            "description": "This unique token is embedded in CTA links. When clicked, it marks the user as 'action taken'.",
            "classes": ("collapse",),
        }),
        ("🕐 Timestamps", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    # ── Pretty columns ──
    @admin.display(description="Sequence")
    def sequence_progress(self, obj):
        """Show a visual progress indicator like '📧 2/3 sent'."""
        if obj.action_taken:
            return "✅ Acted (sequence stopped)"
        if obj.sequence_completed:
            return "📬 All 3 sent"
        return f"📧 {obj.emails_sent}/3 sent"

    @admin.display(description="Status", boolean=True)
    def action_status(self, obj):
        """Green check if acted, red X if not."""
        return obj.action_taken

    # ── Header Buttons (Standalone) ──
    actions_list = ["import_all_users_button"]

    @action(description="📥 Import ALL Existing Users", url_path="import-all-users")
    def import_all_users_button(self, request):
        """One-click import: adds all registered users as subscribers."""
        from django.shortcuts import redirect
        from django.urls import reverse
        from apps.users.models import CustomUser

        existing_emails = set(
            EmailSequenceSubscriber.objects.values_list("email", flat=True)
        )
        users = CustomUser.objects.filter(is_active=True).exclude(email__in=existing_emails)

        created = 0
        for user in users:
            try:
                EmailSequenceSubscriber.objects.create(email=user.email, source="manual")
                created += 1
            except Exception:
                pass

        if created > 0:
            messages.success(
                request,
                f"📥 Imported {created} new user(s)! They're now ready. "
                f"Select them and use '📧 Send Email 1' to start their sequence."
            )
        else:
            messages.info(request, "All users are already imported. Nothing to do! 👍")
            
        return redirect(request.META.get('HTTP_REFERER', reverse('admin:marketing_emailsequencesubscriber_changelist')))

    # ── Bulk Actions (Checkbox Dropdown) ──
    actions = [
        "send_welcome_email",
        "send_reminder_email",
        "send_final_email",
        "mark_as_acted",
        "reset_sequence",
    ]

    @admin.action(description="📧 Send Email 1 (Welcome) to selected")
    def send_welcome_email(self, request, queryset):
        """Send the welcome email to all selected subscribers."""
        sent = 0
        for sub in queryset.filter(emails_sent__lt=1, action_taken=False):
            threading.Thread(target=send_marketing_email, args=(sub, 1), daemon=True).start()
            sent += 1
        messages.success(request, f"✅ Sending Email 1 to {sent} subscriber(s) in the background.")

    @admin.action(description="📧 Send Email 2 (Reminder) to selected")
    def send_reminder_email(self, request, queryset):
        """Send the 3-day reminder to all selected subscribers."""
        sent = 0
        for sub in queryset.filter(emails_sent__lt=2, action_taken=False):
            threading.Thread(target=send_marketing_email, args=(sub, 2), daemon=True).start()
            sent += 1
        messages.success(request, f"✅ Sending Email 2 to {sent} subscriber(s) in the background.")

    @admin.action(description="📧 Send Email 3 (Final) to selected")
    def send_final_email(self, request, queryset):
        """Send the final reminder to all selected subscribers."""
        sent = 0
        for sub in queryset.filter(emails_sent__lt=3, action_taken=False):
            threading.Thread(target=send_marketing_email, args=(sub, 3), daemon=True).start()
            sent += 1
        messages.success(request, f"✅ Sending Email 3 to {sent} subscriber(s) in the background.")

    @admin.action(description="✅ Mark selected as 'Action Taken' (stop emails)")
    def mark_as_acted(self, request, queryset):
        """Mark subscribers as having taken action — stops their email sequence."""
        updated = queryset.update(action_taken=True, sequence_completed=True)
        messages.success(request, f"✅ Marked {updated} subscriber(s) as acted.")

    @admin.action(description="🔄 Reset sequence for selected (start over)")
    def reset_sequence(self, request, queryset):
        """Reset the email sequence — useful for re-sending the full sequence."""
        updated = queryset.update(
            emails_sent=0,
            action_taken=False,
            sequence_completed=False,
            last_email_at=None,
        )
        messages.success(request, f"🔄 Reset {updated} subscriber(s). You can now resend emails.")
