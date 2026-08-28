"""Admin config for extractions — premium interface with badges and stats."""
from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import SavedExtraction


@admin.register(SavedExtraction)
class SavedExtractionAdmin(ModelAdmin):
    list_display = (
        "video_display", "user_display", "visibility_display", "content_badges",
        "shot_count", "char_count", "time_display",
    )
    # is_public drives the public gallery and the sitemap, so it needs to be
    # filterable at a glance; the bulk actions below handle changing it.
    list_filter = ("is_public", "created_at")
    search_fields = ("video_name", "user__email")
    readonly_fields = ("created_at", "updated_at")
    date_hierarchy = "created_at"
    list_per_page = 25
    list_display_links = ("video_display",)
    actions = ("make_private", "make_public")

    @admin.display(description="Visibility", ordering="is_public")
    def visibility_display(self, obj):
        if obj.is_public:
            return format_html(
                '<span style="color:#fbbf24;font-weight:500;">🌐 Public</span>'
            )
        return format_html('<span style="color:#9ca3af;">🔒 Private</span>')

    @admin.action(description="Make private (remove from public gallery)")
    def make_private(self, request, queryset):
        n = queryset.update(is_public=False)
        self.message_user(request, f"{n} extraction(s) are now private.")

    @admin.action(description="Publish to public gallery")
    def make_public(self, request, queryset):
        n = queryset.update(is_public=True)
        self.message_user(request, f"{n} extraction(s) are now public.")

    @admin.display(description="Video", ordering="video_name")
    def video_display(self, obj):
        name = obj.video_name
        if len(name) > 40:
            name = name[:37] + "…"
        return format_html(
            '<div style="display:flex;align-items:center;gap:8px;">'
            '<span style="font-size:1.1rem;">🎬</span>'
            '<span style="font-weight:500;color:#e5e7eb;">{}</span>'
            '</div>',
            name,
        )

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Content")
    def content_badges(self, obj):
        badges = []
        if obj.voiceover_text:
            badges.append(
                '<span style="background:#1e3a5f;color:#60a5fa;padding:2px 8px;'
                'border-radius:5px;font-size:10px;font-weight:600;">🎙️ Voice</span>'
            )
        if obj.video_concept:
            badges.append(
                '<span style="background:#064e3b;color:#6ee7b7;padding:2px 8px;'
                'border-radius:5px;font-size:10px;font-weight:600;">💡 Concept</span>'
            )
        if obj.character_sheets:
            badges.append(
                '<span style="background:#3b1f7a;color:#c4b5fd;padding:2px 8px;'
                'border-radius:5px;font-size:10px;font-weight:600;">👤 Chars</span>'
            )
        if not badges:
            return format_html('<span style="color:#4b5563;font-size:12px;">—</span>')
        return format_html(' '.join(badges))

    @admin.display(description="Shots")
    def shot_count(self, obj):
        count = len(obj.shots) if obj.shots else 0
        if count == 0:
            return format_html('<span style="color:#4b5563;">0</span>')
        return format_html(
            '<span style="font-weight:600;color:#d1d5db;">{}</span>',
            count,
        )

    @admin.display(description="Characters")
    def char_count(self, obj):
        count = len(obj.character_sheets) if obj.character_sheets else 0
        if count == 0:
            return format_html('<span style="color:#4b5563;">0</span>')
        return format_html(
            '<span style="font-weight:600;color:#c4b5fd;">{}</span>',
            count,
        )

    @admin.display(description="When", ordering="created_at")
    def time_display(self, obj):
        from django.utils.timesince import timesince
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{} ago</span>',
            timesince(obj.created_at),
        )
