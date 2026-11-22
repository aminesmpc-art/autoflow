"""Admin config for profiles and plans — with premium badges and quick actions."""
from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin

from .models import BinancePayment, Profile, PlanType


@admin.register(BinancePayment)
class BinancePaymentAdmin(ModelAdmin):
    """The Binance Pay manager (the owner, 2026-11-22: "add here the manager of it").

    Every month of Pro paid in USDT (apps/plans/binance.py): who, how much, the
    receipt's Order ID, and until when. Actions extend or end a month; "Add"
    records a payment by hand (a buyer whose claim failed writes to support
    with the Order ID) and gives its Pro.
    """
    list_display = ("buyer", "amount_display", "order_id", "paid_display", "until_badge", "created_display")
    list_filter = ("currency", "created_at")
    search_fields = ("user__email", "order_id", "payer_binance_id")
    date_hierarchy = "created_at"
    list_per_page = 50
    autocomplete_fields = ("user",)
    actions = ["extend_month", "end_now"]
    fieldsets = (
        ("Buyer", {"fields": ("user", "payer_binance_id")}),
        ("Payment", {"fields": ("order_id", "amount", "currency", "order_type", "paid_at")}),
        ("Pro", {"fields": ("pro_until", "created_at")}),
    )

    def get_readonly_fields(self, request, obj=None):
        # A recorded payment is a receipt: only "Pro until" may change.
        if obj:
            return ("user", "order_id", "amount", "currency", "order_type", "paid_at", "payer_binance_id", "created_at")
        return ("created_at",)

    def get_changeform_initial_data(self, request):
        from datetime import timedelta
        from django.utils import timezone as tz
        from apps.plans import binance
        now = tz.now()
        return {"amount": binance.price(), "currency": "USDT", "order_type": "C2C", "paid_at": now,
                "pro_until": now + timedelta(days=binance.days())}

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        self._give_pro(obj)

    @staticmethod
    def _give_pro(payment):
        """The account is Pro until the latest month it paid for."""
        latest = BinancePayment.objects.filter(user=payment.user).order_by("-pro_until").first()
        if not latest:
            return
        Profile.objects.filter(user=payment.user).update(
            plan_type=PlanType.PRO, is_pro_active=True, pro_expires_at=latest.pro_until)

    @admin.display(description="Buyer", ordering="user__email")
    def buyer(self, obj):
        return format_html('<a href="/admin/overview/user/{}/" style="font-weight:600">{}</a>', obj.user_id, obj.user.email)

    @admin.display(description="Amount", ordering="amount")
    def amount_display(self, obj):
        return f"{obj.amount.normalize()} {obj.currency}"

    @admin.display(description="Paid", ordering="paid_at")
    def paid_display(self, obj):
        return obj.paid_at.strftime("%b %d, %H:%M")

    @admin.display(description="Pro until", ordering="pro_until")
    def until_badge(self, obj):
        from django.utils import timezone as tz
        active = obj.pro_until > tz.now()
        colour = ("#065f46", "#d1fae5") if active else ("#6b7280", "#f3f4f6")
        label = obj.pro_until.strftime("%b %d, %Y") + (" · active" if active else " · ended")
        return format_html('<span style="padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;color:{};background:{}">{}</span>',
                           colour[0], colour[1], label)

    @admin.display(description="Recorded", ordering="created_at")
    def created_display(self, obj):
        return obj.created_at.strftime("%b %d, %H:%M")

    @admin.action(description="➕ Extend by 30 days")
    def extend_month(self, request, queryset):
        from datetime import timedelta
        from django.utils import timezone as tz
        for p in queryset:
            p.pro_until = max(p.pro_until, tz.now()) + timedelta(days=30)
            p.save(update_fields=["pro_until"])
            self._give_pro(p)
        self.message_user(request, f"{queryset.count()} payment(s) extended by 30 days.")

    @admin.action(description="⛔ End now (refunded or disputed)")
    def end_now(self, request, queryset):
        from django.utils import timezone as tz
        now = tz.now()
        users = set()
        for p in queryset:
            p.pro_until = now
            p.save(update_fields=["pro_until"])
            users.add(p.user_id)
        for uid in users:
            still = BinancePayment.objects.filter(user_id=uid, pro_until__gt=now).order_by("-pro_until").first()
            prof = Profile.objects.filter(user_id=uid)
            if still:
                prof.update(pro_expires_at=still.pro_until)
            else:
                # Only a Binance month made them Pro (it had an end date): back to Free.
                prof.filter(pro_expires_at__isnull=False).update(plan_type=PlanType.FREE, is_pro_active=False, pro_expires_at=now)
        self.message_user(request, f"{queryset.count()} payment(s) ended.")


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
