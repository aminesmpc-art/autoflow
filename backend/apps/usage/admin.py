"""Admin config for usage tracking — with polished badges and readable stats."""
from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import DailyUsage, UsageEvent


@admin.register(DailyUsage)
class DailyUsageAdmin(ModelAdmin):
    list_display = (
        "user_display", "date_display", "text_count", "full_count",
        "download_count", "total_badge", "created_display",
    )
    list_filter = ("date",)
    search_fields = ("user__email",)
    readonly_fields = ("created_at", "updated_at")
    date_hierarchy = "date"
    list_per_page = 50
    list_display_links = ("user_display",)
    actions = ["reset_usage"]

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Date", ordering="date")
    def date_display(self, obj):
        return format_html(
            '<span style="color:#d1d5db;font-size:12px;font-weight:500;">{}</span>',
            obj.date.strftime("%b %d, %Y"),
        )

    @admin.display(description="Text Prompts")
    def text_count(self, obj):
        count = obj.text_prompts_used
        if count == 0:
            return format_html(
                '<span style="color:#4b5563;font-size:13px;">0</span>'
            )
        return format_html(
            '<span style="font-weight:600;font-size:13px;color:#d1d5db;'
            'font-variant-numeric:tabular-nums;">{}</span>',
            count,
        )

    @admin.display(description="Full Prompts")
    def full_count(self, obj):
        count = obj.full_prompts_used
        if count == 0:
            return format_html(
                '<span style="color:#4b5563;font-size:13px;">0</span>'
            )
        return format_html(
            '<span style="font-weight:600;font-size:13px;color:#d1d5db;'
            'font-variant-numeric:tabular-nums;">{}</span>',
            count,
        )

    @admin.display(description="Total Used")
    def total_badge(self, obj):
        total = obj.total_prompts_used
        if total >= 100:
            bg, label = "linear-gradient(135deg,#991b1b,#dc2626)", "Heavy"
        elif total >= 50:
            bg, label = "linear-gradient(135deg,#92400e,#f59e0b)", "Medium"
        elif total >= 10:
            bg, label = "linear-gradient(135deg,#065f46,#10b981)", "Active"
        elif total > 0:
            bg, label = "linear-gradient(135deg,#1e3a5f,#3b82f6)", "Light"
        else:
            return format_html(
                '<span style="color:#4b5563;font-size:12px;">0</span>'
            )
        return format_html(
            '<span style="background:{};color:#fff;padding:4px 10px;border-radius:6px;'
            'font-size:11px;font-weight:600;letter-spacing:0.02em;">'
            '{} — {}</span>',
            bg, total, label,
        )

    @admin.display(description="Downloads")
    def download_count(self, obj):
        count = obj.downloads_used
        if count == 0:
            return format_html(
                '<span style="color:#4b5563;font-size:13px;">0</span>'
            )
        return format_html(
            '<span style="font-weight:600;font-size:13px;color:#a78bfa;'
            'font-variant-numeric:tabular-nums;">⬇ {}</span>',
            count,
        )

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.created_at.strftime("%b %d, %H:%M"),
        )

    @admin.action(description="🔄 Reset all usage counters to 0")
    def reset_usage(self, request, queryset):
        count = queryset.update(
            free_prompts_used=0, reward_prompts_used=0, total_prompts_used=0,
            text_prompts_used=0, full_prompts_used=0, downloads_used=0,
        )
        self.message_user(request, f"✅ Reset usage for {count} record(s).")


@admin.register(UsageEvent)
class UsageEventAdmin(ModelAdmin):
    list_display = (
        "user_display", "event_badge", "prompt_count_display",
        "source_badge", "prompt_type_badge", "time_display",
    )
    list_filter = ("event_type", "created_at")
    search_fields = ("user__email",)
    readonly_fields = ("created_at", "metadata")
    date_hierarchy = "created_at"
    list_per_page = 50

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Event")
    def event_badge(self, obj):
        colors = {
            "consume_prompt": ("#2563eb", "📝", "Prompt Used"),
            "queue_started": ("#059669", "▶️", "Queue Started"),
            "queue_finished": ("#10b981", "✅", "Queue Finished"),
            "prompt_failed": ("#dc2626", "❌", "Prompt Failed"),
            "download_completed": ("#8b5cf6", "⬇️", "Download Done"),
            "run_aborted": ("#f59e0b", "⚠️", "Run Stopped"),
            "reward_granted": ("#eab308", "🎁", "Reward Given"),
        }
        color, icon, label = colors.get(obj.event_type, ("#6b7280", "•", obj.event_type))
        return format_html(
            '<span style="background:{};color:#fff;padding:4px 10px;border-radius:6px;'
            'font-size:11px;font-weight:600;letter-spacing:0.02em;">{} {}</span>',
            color, icon, label,
        )

    @admin.display(description="Count")
    def prompt_count_display(self, obj):
        if obj.prompt_count == 0:
            return format_html('<span style="color:#4b5563;">—</span>')
        return format_html(
            '<span style="font-weight:700;font-size:14px;color:#e5e7eb;'
            'font-variant-numeric:tabular-nums;">{}</span>',
            obj.prompt_count,
        )

    @admin.display(description="Source")
    def source_badge(self, obj):
        """Shows where the event came from (extension, web, API)."""
        if not obj.metadata:
            return format_html('<span style="color:#4b5563;">—</span>')
        source = obj.metadata.get("source", "—")
        colors = {
            "extension": ("#1e3a5f", "#60a5fa", "🧩 Extension"),
            "web": ("#064e3b", "#6ee7b7", "🌐 Website"),
            "api": ("#3b1f7a", "#c4b5fd", "⚙️ API"),
        }
        bg, fg, label = colors.get(source, ("#1f2937", "#9ca3af", source.title()))
        return format_html(
            '<span style="background:{};color:{};padding:3px 8px;border-radius:5px;'
            'font-size:11px;font-weight:500;">{}</span>',
            bg, fg, label,
        )

    @admin.display(description="Type")
    def prompt_type_badge(self, obj):
        """Shows the prompt type in a friendly way."""
        if not obj.metadata:
            return format_html('<span style="color:#4b5563;">—</span>')
        ptype = obj.metadata.get("prompt_type", "—")
        labels = {
            "text": ("📝", "Text Only", "#3b82f6"),
            "full": ("🖼️", "With Images", "#8b5cf6"),
            "frames": ("🎬", "With Frames", "#ec4899"),
        }
        icon, label, color = labels.get(ptype, ("•", ptype.title(), "#6b7280"))
        return format_html(
            '<span style="color:{};font-size:12px;font-weight:500;">{} {}</span>',
            color, icon, label,
        )

    @admin.display(description="When", ordering="created_at")
    def time_display(self, obj):
        from django.utils.timesince import timesince
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{} ago</span>',
            timesince(obj.created_at),
        )
