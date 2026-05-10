"""Admin config for profiles and plans — with premium badges and quick actions."""
from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import Profile, PlanType


@admin.register(Profile)
class ProfileAdmin(ModelAdmin):
    list_display = (
        "user_display", "plan_badge", "pro_status_badge",
        "fair_use_flag", "whop_status", "last_seen_display", "created_display",
    )
    list_filter = ("plan_type", "is_pro_active", "fair_use_flag")
    search_fields = ("user__email", "display_name", "whop_user_id")
    readonly_fields = ("created_at", "updated_at")
    list_editable = ("fair_use_flag",)
    list_per_page = 25
    list_display_links = ("user_display",)
    actions = ["set_pro", "set_free", "clear_fair_use"]

    fieldsets = (
        ("User", {"fields": ("user", "display_name")}),
        ("Plan", {"fields": ("plan_type", "is_pro_active")}),
        ("Behavior", {"fields": ("fair_use_flag", "timezone", "last_seen_at")}),
        ("Whop Integration", {"fields": ("whop_user_id", "whop_membership_id")}),
        ("Dates", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Plan")
    def plan_badge(self, obj):
        if obj.plan_type == PlanType.PRO:
            return format_html(
                '<span style="background:linear-gradient(135deg,#065f46,#047857);'
                'color:#6ee7b7;padding:4px 10px;border-radius:6px;font-size:11px;'
                'font-weight:600;letter-spacing:0.02em;">⚡ PRO</span>'
            )
        return format_html(
            '<span style="background:#1f2937;color:#9ca3af;padding:4px 10px;'
            'border-radius:6px;font-size:11px;font-weight:500;">Free</span>'
        )

    @admin.display(description="Active")
    def pro_status_badge(self, obj):
        if obj.is_pro_active:
            return format_html(
                '<span style="display:inline-flex;align-items:center;gap:4px;'
                'color:#34d399;font-size:12px;font-weight:500;">'
                '<span style="width:7px;height:7px;border-radius:50%;'
                'background:#34d399;display:inline-block;"></span> Yes</span>'
            )
        return format_html(
            '<span style="display:inline-flex;align-items:center;gap:4px;'
            'color:#6b7280;font-size:12px;">'
            '<span style="width:7px;height:7px;border-radius:50%;'
            'background:#4b5563;display:inline-block;"></span> No</span>'
        )


    @admin.display(description="Whop")
    def whop_status(self, obj):
        if obj.whop_membership_id:
            return format_html(
                '<span style="background:#064e3b;color:#6ee7b7;padding:3px 8px;'
                'border-radius:6px;font-size:11px;font-weight:500;">🔗 Connected</span>'
            )
        return format_html(
            '<span style="color:#4b5563;font-size:12px;">—</span>'
        )

    @admin.display(description="Last Seen")
    def last_seen_display(self, obj):
        if not obj.last_seen_at:
            return format_html(
                '<span style="color:#4b5563;font-size:12px;font-style:italic;">Never</span>'
            )
        from django.utils.timesince import timesince
        from django.utils import timezone
        delta = timezone.now() - obj.last_seen_at
        hours = delta.total_seconds() / 3600
        if hours < 1:
            color = "#34d399"
        elif hours < 24:
            color = "#fbbf24"
        else:
            color = "#6b7280"
        return format_html(
            '<span style="color:{};font-size:12px;font-weight:500;">{} ago</span>',
            color, timesince(obj.last_seen_at),
        )

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.created_at.strftime("%b %d, %Y"),
        )

    @admin.action(description="⚡ Set selected profiles to Pro")
    def set_pro(self, request, queryset):
        count = queryset.update(plan_type=PlanType.PRO, is_pro_active=True)
        self.message_user(request, f"{count} profile(s) upgraded to Pro.")

    @admin.action(description="🔒 Set selected profiles to Free")
    def set_free(self, request, queryset):
        count = queryset.update(plan_type=PlanType.FREE, is_pro_active=False)
        self.message_user(request, f"{count} profile(s) set to Free.")

    @admin.action(description="🏳️ Clear fair-use flag")
    def clear_fair_use(self, request, queryset):
        count = queryset.update(fair_use_flag=False)
        self.message_user(request, f"Fair-use flag cleared for {count} profile(s).")
