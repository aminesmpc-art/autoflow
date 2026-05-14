"""Admin config for users — premium interface with badges, tabs, and quick actions."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html
from unfold.admin import ModelAdmin, StackedInline, TabularInline

from apps.plans.models import Profile
from .models import CustomUser, EmailVerificationToken


class ProfileInline(StackedInline):
    """Show profile directly on the user edit page."""
    model = Profile
    can_delete = False
    verbose_name = "Profile & Plan"
    verbose_name_plural = "Profile & Plan"
    readonly_fields = ("created_at", "updated_at")
    tab = True
    fieldsets = (
        ("Plan", {"fields": ("plan_type", "is_pro_active", "display_name")}),
        ("Behavior", {"fields": ("fair_use_flag", "timezone", "last_seen_at")}),
        ("Whop", {"fields": ("whop_user_id", "whop_membership_id")}),
        ("Dates", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )


from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from unfold.forms import AdminPasswordChangeForm

class CustomUserChangeForm(UserChangeForm):
    class Meta:
        model = CustomUser
        fields = "__all__"

class CustomUserCreationForm(UserCreationForm):
    class Meta:
        model = CustomUser
        fields = ("email",)

@admin.register(CustomUser)
class CustomUserAdmin(BaseUserAdmin, ModelAdmin):
    form = CustomUserChangeForm
    add_form = CustomUserCreationForm
    change_password_form = AdminPasswordChangeForm
    list_display = (
        "email_display", "plan_badge", "active_badge",
        "staff_badge", "last_seen_display", "created_display",
    )
    list_filter = (
        "is_active", "is_staff", "is_superuser",
        "profile__plan_type", "profile__is_pro_active",
    )
    search_fields = ("email",)
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at")
    list_per_page = 25
    list_display_links = ("email_display",)
    inlines = [ProfileInline]
    actions = ["activate_users", "deactivate_users", "grant_pro", "revoke_pro"]

    fieldsets = (
        (None, {
            "fields": ("email", "password"),
            "tab": True,
        }),
        ("Status", {
            "fields": ("is_active", "is_staff", "is_superuser"),
            "tab": True,
        }),
        ("Dates", {
            "fields": ("created_at", "updated_at", "last_login"),
            "tab": True,
        }),
        ("Permissions", {
            "fields": ("groups", "user_permissions"),
            "classes": ("collapse",),
            "tab": True,
        }),
    )

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "is_active", "is_staff"),
        }),
    )

    @admin.display(description="Email", ordering="email")
    def email_display(self, obj):
        initial = obj.email[0].upper() if obj.email else "?"
        return format_html(
            '<div style="display:flex;align-items:center;gap:10px;">'
            '<div style="width:32px;height:32px;border-radius:8px;'
            'background:linear-gradient(135deg,#064e3b,#059669);'
            'display:flex;align-items:center;justify-content:center;'
            'font-weight:700;font-size:13px;color:#d1fae5;flex-shrink:0;">{}</div>'
            '<span style="font-weight:500;color:#e5e7eb;">{}</span>'
            '</div>',
            initial, obj.email,
        )

    @admin.display(description="Plan", ordering="profile__plan_type")
    def plan_badge(self, obj):
        try:
            profile = obj.profile
            if profile.is_pro_active:
                return format_html(
                    '<span style="background:linear-gradient(135deg,#065f46,#047857);'
                    'color:#6ee7b7;padding:4px 10px;border-radius:6px;font-size:11px;'
                    'font-weight:600;letter-spacing:0.02em;">⚡ PRO</span>'
                )
            return format_html(
                '<span style="background:#1f2937;color:#9ca3af;padding:4px 10px;'
                'border-radius:6px;font-size:11px;font-weight:500;">Free</span>'
            )
        except Profile.DoesNotExist:
            return format_html(
                '<span style="background:#7f1d1d;color:#fca5a5;padding:4px 10px;'
                'border-radius:6px;font-size:11px;">No Profile</span>'
            )

    @admin.display(description="Active", ordering="is_active")
    def active_badge(self, obj):
        if obj.is_active:
            return format_html(
                '<span style="display:inline-flex;align-items:center;gap:4px;'
                'color:#34d399;font-size:12px;font-weight:500;">'
                '<span style="width:7px;height:7px;border-radius:50%;'
                'background:#34d399;display:inline-block;"></span> Active</span>'
            )
        return format_html(
            '<span style="display:inline-flex;align-items:center;gap:4px;'
            'color:#f87171;font-size:12px;font-weight:500;">'
            '<span style="width:7px;height:7px;border-radius:50%;'
            'background:#f87171;display:inline-block;"></span> Inactive</span>'
        )

    @admin.display(description="Staff", boolean=True)
    def staff_badge(self, obj):
        return obj.is_staff

    @admin.display(description="Last Seen")
    def last_seen_display(self, obj):
        try:
            seen = obj.profile.last_seen_at
            if not seen:
                return format_html(
                    '<span style="color:#4b5563;font-size:12px;font-style:italic;">Never</span>'
                )
            from django.utils.timesince import timesince
            from django.utils import timezone
            delta = timezone.now() - seen
            hours = delta.total_seconds() / 3600
            if hours < 1:
                color = "#34d399"  # green — just now
            elif hours < 24:
                color = "#fbbf24"  # yellow — today
            else:
                color = "#6b7280"  # gray — stale
            return format_html(
                '<span style="color:{};font-size:12px;font-weight:500;">{} ago</span>',
                color, timesince(seen),
            )
        except Profile.DoesNotExist:
            return format_html('<span style="color:#4b5563;">—</span>')

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.created_at.strftime("%b %d, %Y %H:%M"),
        )

    @admin.action(description="✅ Activate selected users")
    def activate_users(self, request, queryset):
        count = queryset.update(is_active=True)
        self.message_user(request, f"{count} user(s) activated.")

    @admin.action(description="❌ Deactivate selected users")
    def deactivate_users(self, request, queryset):
        count = queryset.update(is_active=False)
        self.message_user(request, f"{count} user(s) deactivated.")

    @admin.action(description="⚡ Grant Pro to selected users")
    def grant_pro(self, request, queryset):
        count = 0
        for user in queryset:
            Profile.objects.filter(user=user).update(plan_type="pro", is_pro_active=True)
            count += 1
        self.message_user(request, f"Pro granted to {count} user(s).")

    @admin.action(description="🔒 Revoke Pro from selected users")
    def revoke_pro(self, request, queryset):
        count = 0
        for user in queryset:
            Profile.objects.filter(user=user).update(plan_type="free", is_pro_active=False)
            count += 1
        self.message_user(request, f"Pro revoked from {count} user(s).")


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(ModelAdmin):
    list_display = (
        "user_display", "token_short", "expires_display",
        "used_display", "validity_badge", "created_display",
    )
    list_filter = ("used_at",)
    search_fields = ("user__email", "token")
    readonly_fields = ("created_at",)
    list_per_page = 25

    @admin.display(description="User", ordering="user__email")
    def user_display(self, obj):
        return format_html(
            '<span style="color:#34d399;font-weight:500;">{}</span>',
            obj.user.email,
        )

    @admin.display(description="Token")
    def token_short(self, obj):
        return format_html(
            '<code style="font-size:11px;background:#1e293b;color:#94a3b8;'
            'padding:3px 8px;border-radius:4px;">{}\u2026</code>',
            obj.token[:12],
        )

    @admin.display(description="Expires", ordering="expires_at")
    def expires_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.expires_at.strftime("%b %d, %H:%M"),
        )

    @admin.display(description="Used At")
    def used_display(self, obj):
        if obj.used_at:
            return format_html(
                '<span style="color:#34d399;font-size:12px;">{}</span>',
                obj.used_at.strftime("%b %d, %H:%M"),
            )
        return format_html('<span style="color:#4b5563;font-size:12px;">—</span>')

    @admin.display(description="Valid?")
    def validity_badge(self, obj):
        if obj.is_valid:
            return format_html(
                '<span style="background:#064e3b;color:#6ee7b7;padding:3px 8px;'
                'border-radius:6px;font-size:11px;font-weight:600;">✓ Valid</span>'
            )
        if obj.is_used:
            return format_html(
                '<span style="background:#1e293b;color:#6b7280;padding:3px 8px;'
                'border-radius:6px;font-size:11px;">Used</span>'
            )
        return format_html(
            '<span style="background:#7f1d1d;color:#fca5a5;padding:3px 8px;'
            'border-radius:6px;font-size:11px;">Expired</span>'
        )

    @admin.display(description="Created", ordering="created_at")
    def created_display(self, obj):
        return format_html(
            '<span style="color:#6b7280;font-size:12px;">{}</span>',
            obj.created_at.strftime("%b %d, %Y %H:%M"),
        )
