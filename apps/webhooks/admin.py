"""Admin config for webhooks — with clear status indicators and actions."""
import json

from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import WebhookEvent


@admin.register(WebhookEvent)
class WebhookEventAdmin(ModelAdmin):
    list_display = (
        "event_badge", "provider_display", "user_display",
        "processed_badge", "event_id_short", "time_display",
    )
    list_filter = ("provider", "event_type", "processed")
    search_fields = ("external_event_id", "linked_user__email")
    readonly_fields = ("created_at", "payload_pretty")
    date_hierarchy = "created_at"
    list_per_page = 50
    actions = ["mark_processed", "reprocess"]

    fieldsets = (
        ("Event Info", {"fields": ("provider", "event_type", "external_event_id")}),
        ("User", {"fields": ("linked_user",)}),
        ("Processing", {"fields": ("processed", "processed_at")}),
        ("Payload", {"fields": ("payload_pretty",), "classes": ("collapse",)}),
        ("Dates", {"fields": ("created_at",)}),
    )

    @admin.display(description="Payload")
    def payload_pretty(self, obj):
        """Pretty-print JSON payload for easy reading."""
        try:
            formatted = json.dumps(obj.raw_payload, indent=2, ensure_ascii=False)
        except (TypeError, ValueError):
            formatted = str(obj.raw_payload)
        return format_html(
            '<pre style="background:#0f172a;color:#94a3b8;padding:16px;'
            'border-radius:8px;font-size:12px;max-height:400px;overflow:auto;'
            'border:1px solid rgba(255,255,255,0.06);font-family:\'JetBrains Mono\','
            'monospace;line-height:1.5;white-space:pre-wrap;">{}</pre>',
            formatted,
        )

    @admin.display(description="Event Type")
    def event_badge(self, obj):
        if "activated" in obj.event_type or "valid" in obj.event_type:
            color, icon = "#10b981", "⚡"
        elif "cancelled" in obj.event_type or "deactivated" in obj.event_type or "invalid" in obj.event_type:
            color, icon = "#dc2626", "🔒"
        elif "payment" in obj.event_type:
            color, icon = "#8b5cf6", "💳"
        else:
            color, icon = "#6b7280", "•"
        label = obj.event_type.replace("_", " ").replace(".", " → ").title()
        return format_html(
            '<span style="background:{};color:#fff;padding:4px 10px;border-radius:6px;'
            'font-size:11px;font-weight:600;letter-spacing:0.02em;">{} {}</span>',
            color, icon, label,
        )

    @admin.display(description="Provider")
    def provider_display(self, obj):
        icons = {
            "whop": ("💳", "Whop", "#8b5cf6"),
            "stripe": ("💰", "Stripe", "#6366f1"),
        }
        icon, name, color = icons.get(obj.provider, ("•", obj.provider.title(), "#6b7280"))
        return format_html(
            '<span style="color:{};font-weight:500;font-size:12px;">{} {}</span>',
            color, icon, name,
        )

    @admin.display(description="User")
    def user_display(self, obj):
        if obj.linked_user:
            return format_html(
                '<span style="color:#34d399;font-weight:500;">{}</span>',
                obj.linked_user.email,
            )
        return format_html(
            '<span style="color:#4b5563;font-size:12px;font-style:italic;">No user linked</span>'
        )

    @admin.display(description="Processed")
    def processed_badge(self, obj):
        if obj.processed:
            return format_html(
                '<span style="display:inline-flex;align-items:center;gap:4px;'
                'color:#34d399;font-size:12px;font-weight:500;">'
                '<span style="width:7px;height:7px;border-radius:50%;'
                'background:#34d399;display:inline-block;"></span> Done</span>'
            )
        return format_html(
            '<span style="display:inline-flex;align-items:center;gap:4px;'
            'color:#fbbf24;font-size:12px;font-weight:500;">'
            '<span style="width:7px;height:7px;border-radius:50%;'
            'background:#fbbf24;display:inline-block;animation:pulse 2s infinite;"></span> Pending</span>'
        )

    @admin.display(description="Event ID")
    def event_id_short(self, obj):
        if obj.external_event_id:
            short = obj.external_event_id[:16] + "…" if len(obj.external_event_id) > 16 else obj.external_event_id
            return format_html(
                '<code style="font-size:11px;background:#1e293b;color:#94a3b8;'
                'padding:3px 8px;border-radius:4px;">{}</code>',
                short,
            )
        return format_html('<span style="color:#4b5563;">—</span>')

    @admin.display(description="When", ordering="created_at")
    def time_display(self, obj):
        from django.utils.timesince import timesince
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{} ago</span>',
            timesince(obj.created_at),
        )

    @admin.action(description="✅ Mark selected as processed")
    def mark_processed(self, request, queryset):
        from django.utils import timezone
        count = queryset.update(processed=True, processed_at=timezone.now())
        self.message_user(request, f"✅ {count} event(s) marked as processed.")

    @admin.action(description="🔄 Reprocess selected events")
    def reprocess(self, request, queryset):
        from apps.webhooks.services import process_whop_webhook
        count = 0
        for event in queryset:
            event.processed = False
            event.save(update_fields=["processed"])
            process_whop_webhook(event)
            count += 1
        self.message_user(request, f"🔄 Reprocessed {count} event(s).")
