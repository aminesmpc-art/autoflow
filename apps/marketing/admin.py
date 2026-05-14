"""Marketing admin — Unfold-compatible configuration."""
from django.contrib import admin

from unfold.admin import ModelAdmin

from .models import EmailSequenceSubscriber


@admin.register(EmailSequenceSubscriber)
class EmailSequenceSubscriberAdmin(ModelAdmin):
    list_display = [
        "email",
        "emails_sent",
        "action_taken",
        "sequence_completed",
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
    readonly_fields = [
        "id",
        "tracking_token",
        "created_at",
        "updated_at",
        "last_email_at",
    ]
    list_per_page = 25

    fieldsets = (
        ("Subscriber", {
            "fields": ("id", "email", "source"),
        }),
        ("Sequence Status", {
            "fields": ("emails_sent", "last_email_at", "action_taken", "sequence_completed"),
        }),
        ("Tracking", {
            "fields": ("tracking_token",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )
