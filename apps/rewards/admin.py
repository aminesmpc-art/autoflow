"""Admin config for reward credits — with premium status badges."""
from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import RewardCreditLedger


@admin.register(RewardCreditLedger)
class RewardCreditLedgerAdmin(ModelAdmin):
    list_display = (
        "user_display", "amount_badge", "source_display",
        "status_badge", "reference_display", "created_display",
    )
    list_filter = ("source", "status")
    search_fields = ("user__email", "reference_id")
    readonly_fields = ("created_at",)
    date_hierarchy = "created_at"
    list_per_page = 50

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Amount")
    def amount_badge(self, obj):
        if obj.amount > 0:
            return format_html(
                '<span style="background:#064e3b;color:#6ee7b7;padding:3px 10px;'
                'border-radius:6px;font-size:12px;font-weight:700;'
                'font-variant-numeric:tabular-nums;">+{}</span>',
                obj.amount,
            )
        return format_html(
            '<span style="background:#7f1d1d;color:#fca5a5;padding:3px 10px;'
            'border-radius:6px;font-size:12px;font-weight:700;'
            'font-variant-numeric:tabular-nums;">{}</span>',
            obj.amount,
        )

    @admin.display(description="Source")
    def source_display(self, obj):
        icons = {
            "rewarded_ad": ("🎬", "#f59e0b"),
            "manual_grant": ("🎁", "#10b981"),
            "prompt_consumption": ("📝", "#3b82f6"),
            "referral": ("🔗", "#8b5cf6"),
        }
        icon, color = icons.get(obj.source, ("•", "#6b7280"))
        label = obj.source.replace("_", " ").title()
        return format_html(
            '<span style="color:{};font-size:12px;font-weight:500;">{} {}</span>',
            color, icon, label,
        )

    @admin.display(description="Status")
    def status_badge(self, obj):
        styles = {
            "completed": ("#064e3b", "#6ee7b7", "✓ Completed"),
            "pending": ("#422006", "#fbbf24", "⏳ Pending"),
            "reversed": ("#7f1d1d", "#fca5a5", "↩ Reversed"),
        }
        bg, fg, label = styles.get(obj.status, ("#1f2937", "#9ca3af", obj.status.title()))
        return format_html(
            '<span style="background:{};color:{};padding:3px 8px;border-radius:6px;'
            'font-size:11px;font-weight:600;">{}</span>',
            bg, fg, label,
        )

    @admin.display(description="Reference")
    def reference_display(self, obj):
        if obj.reference_id:
            short = obj.reference_id[:16] + "…" if len(obj.reference_id) > 16 else obj.reference_id
            return format_html(
                '<code style="font-size:11px;background:#1e293b;color:#94a3b8;'
                'padding:3px 8px;border-radius:4px;">{}</code>',
                short,
            )
        return format_html('<span style="color:#4b5563;">—</span>')

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.created_at.strftime("%b %d, %Y %H:%M"),
        )
