"""Admin dashboard — rich visual stats with charts, progress bars, and tables."""
import json
from datetime import timedelta

from django.conf import settings
from django.utils import timezone


def dashboard_callback(request, context):
    """Provide chart data, KPI metrics, and top-user tables for the dashboard."""
    from apps.plans.models import Profile
    from apps.usage.models import DailyUsage, UsageEvent
    from apps.users.models import CustomUser
    from apps.webhooks.models import WebhookEvent
    from django.db.models import Sum

    today = timezone.localdate()

    # ── Users ──
    total_users = CustomUser.objects.count()
    active_users = CustomUser.objects.filter(is_active=True).count()
    inactive_users = total_users - active_users
    today_signups = CustomUser.objects.filter(created_at__date=today).count()

    # ── Plans ──
    pro_users = Profile.objects.filter(is_pro_active=True).count()
    free_users = total_users - pro_users
    pro_pct = round((pro_users / total_users * 100) if total_users else 0)
    free_pct = 100 - pro_pct

    # ── Usage today ──
    today_agg = DailyUsage.objects.filter(date=today).aggregate(
        total=Sum("total_prompts_used"),
        text=Sum("text_prompts_used"),
        full=Sum("full_prompts_used"),
        downloads=Sum("downloads_used"),
    )
    today_total = today_agg["total"] or 0
    today_text = today_agg["text"] or 0
    today_full = today_agg["full"] or 0
    today_downloads = today_agg["downloads"] or 0
    active_today = DailyUsage.objects.filter(date=today).count()
    total_events = UsageEvent.objects.filter(created_at__date=today).count()

    # ── Webhooks ──
    pending_webhooks = WebhookEvent.objects.filter(processed=False).count()

    # ── 7-day usage chart data ──
    chart_labels = []
    chart_text = []
    chart_full = []
    chart_total = []
    chart_downloads = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        chart_labels.append(d.strftime("%b %d"))
        agg = DailyUsage.objects.filter(date=d).aggregate(
            t=Sum("text_prompts_used"),
            f=Sum("full_prompts_used"),
            tot=Sum("total_prompts_used"),
            dl=Sum("downloads_used"),
        )
        chart_text.append(agg["t"] or 0)
        chart_full.append(agg["f"] or 0)
        chart_total.append(agg["tot"] or 0)
        chart_downloads.append(agg["dl"] or 0)

    # ── 7-day signup chart data ──
    signup_labels = []
    signup_data = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        signup_labels.append(d.strftime("%b %d"))
        signup_data.append(
            CustomUser.objects.filter(created_at__date=d).count()
        )

    # ── Top 5 users today ──
    top_users_qs = (
        DailyUsage.objects.filter(date=today)
        .select_related("user")
        .order_by("-total_prompts_used")[:5]
    )
    top_users = []
    for du in top_users_qs:
        top_users.append({
            "email": du.user.email,
            "text": du.text_prompts_used,
            "full": du.full_prompts_used,
            "downloads": du.downloads_used,
            "total": du.total_prompts_used,
        })

    # ── Recent signups ──
    recent_users = []
    for u in CustomUser.objects.order_by("-created_at")[:5]:
        try:
            plan = u.profile.get_plan_type_display()
        except Exception:
            plan = "—"
        recent_users.append({
            "email": u.email,
            "plan": plan,
            "active": u.is_active,
            "date": u.created_at.strftime("%b %d, %H:%M"),
        })

    context.update({
        # KPI cards
        "kpi": [
            {
                "title": "Total Users",
                "metric": total_users,
                "footer": f"{today_signups} new today" if today_signups else "No signups today",
                "icon": "group",
            },
            {
                "title": "Active Users",
                "metric": active_users,
                "footer": f"{inactive_users} pending verification",
                "icon": "verified_user",
            },
            {
                "title": "Pro Subscribers",
                "metric": pro_users,
                "footer": f"{free_users} on free plan",
                "icon": "workspace_premium",
            },
            {
                "title": "Prompts Today",
                "metric": today_total,
                "footer": f"{today_text} text · {today_full} with images",
                "icon": "edit_note",
            },
            {
                "title": "Downloads Today",
                "metric": today_downloads,
                "footer": "Media files downloaded",
                "icon": "download",
            },
            {
                "title": "Active Today",
                "metric": active_today,
                "footer": f"{total_events} events logged",
                "icon": "monitoring",
            },
            {
                "title": "Pending Webhooks",
                "metric": pending_webhooks,
                "footer": "Needs attention!" if pending_webhooks else "All processed",
                "icon": "webhook",
            },
        ],
        # Chart data
        "usage_chart": json.dumps({
            "labels": chart_labels,
            "datasets": [
                {
                    "label": "Text Prompts",
                    "data": chart_text,
                    "backgroundColor": "#10b981",
                },
                {
                    "label": "Image Prompts",
                    "data": chart_full,
                    "backgroundColor": "#6ee7b7",
                },
                {
                    "label": "Downloads",
                    "data": chart_downloads,
                    "backgroundColor": "#a78bfa",
                },
            ],
        }),
        "signup_chart": json.dumps({
            "labels": signup_labels,
            "datasets": [
                {
                    "label": "Signups",
                    "data": signup_data,
                    "borderColor": "#34d399",
                    "backgroundColor": "rgba(52, 211, 153, 0.1)",
                    "fill": True,
                    "tension": 0.4,
                    "type": "line",
                },
            ],
        }),
        # Plan distribution
        "plan_distribution": {
            "pro_count": pro_users,
            "free_count": free_users,
            "pro_pct": pro_pct,
            "free_pct": free_pct,
        },
        # Tables
        "top_users": top_users,
        "recent_users": recent_users,
    })

    return context


def environment_callback(request):
    """Show environment label in the sidebar."""
    if settings.DEBUG:
        return ["LOCAL", "info"]
    return ["PRODUCTION", "warning"]


def badge_callback_users(request):
    """Sidebar badge: total user count."""
    from apps.users.models import CustomUser
    return CustomUser.objects.count()


def badge_callback_pro(request):
    """Sidebar badge: active Pro subscriber count."""
    from apps.plans.models import Profile
    return Profile.objects.filter(is_pro_active=True).count()


def badge_callback_today_usage(request):
    """Sidebar badge: users who were active today."""
    from apps.usage.models import DailyUsage
    from django.utils import timezone
    return DailyUsage.objects.filter(date=timezone.localdate()).count()


def badge_callback_pending_webhooks(request):
    """Sidebar badge: unprocessed webhooks (only shown if > 0)."""
    from apps.webhooks.models import WebhookEvent
    count = WebhookEvent.objects.filter(processed=False).count()
    return count if count > 0 else None
