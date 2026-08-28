"""Studio Users & Daily Users Admin View."""
import logging
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View

from apps.plans.models import PlanType, Profile
from apps.plans.services import (
    FREE_STUDIO_DAILY_NODE_LIMIT,
    FREE_STUDIO_MONTHLY_LIMIT,
    get_or_create_daily_usage,
    get_or_create_monthly_usage,
)
from apps.usage.models import DailyUsage, MonthlyUsage, UsageEvent
from apps.users.models import CustomUser

logger = logging.getLogger(__name__)


@method_decorator(staff_member_required, name="dispatch")
class StudioUsersDashboardView(View):
    template_name = "admin/studio_users.html"

    def get(self, request):
        now = timezone.now()
        today = timezone.localdate()
        year = now.year
        month = now.month

        total_users = CustomUser.objects.count()
        pro_users = Profile.objects.filter(is_pro_active=True).count()
        free_users = max(0, total_users - pro_users)

        dau_user_ids = set(
            DailyUsage.objects.filter(date=today, total_prompts_used__gt=0).values_list("user_id", flat=True)
        ) | set(
            UsageEvent.objects.filter(created_at__date=today).values_list("user_id", flat=True)
        )
        dau_count = len(dau_user_ids)

        today_nodes_agg = DailyUsage.objects.filter(date=today).aggregate(
            total_nodes=Sum("free_prompts_used")
        )
        today_nodes_executed = today_nodes_agg["total_nodes"] or 0

        monthly_runs_agg = MonthlyUsage.objects.filter(year=year, month=month).aggregate(
            total_runs=Sum("studio_runs_used")
        )
        monthly_studio_runs = monthly_runs_agg["total_runs"] or 0

        today_events_qs = UsageEvent.objects.filter(created_at__date=today)
        today_generations_done = today_events_qs.filter(
            event_type="consume_prompt", metadata__status="done"
        ).aggregate(s=Sum("prompt_count"))["s"] or 0

        today_generations_failed = today_events_qs.filter(
            event_type="consume_prompt", metadata__status="failed"
        ).aggregate(s=Sum("prompt_count"))["s"] or 0

        search_query = request.GET.get("q", "").strip().lower()
        plan_filter = request.GET.get("plan", "").strip().lower()
        activity_filter = request.GET.get("activity", "").strip().lower()

        users_qs = CustomUser.objects.select_related("profile").order_by("-created_at")

        if search_query:
            users_qs = users_qs.filter(email__icontains=search_query)

        if plan_filter == "pro":
            users_qs = users_qs.filter(profile__is_pro_active=True)
        elif plan_filter == "free":
            users_qs = users_qs.filter(Q(profile__is_pro_active=False) | Q(profile__isnull=True))

        users_list = list(users_qs[:150])
        user_ids = [u.id for u in users_list]

        monthly_usage_map = {
            m.user_id: m for m in MonthlyUsage.objects.filter(user_id__in=user_ids, year=year, month=month)
        }
        daily_usage_map = {
            d.user_id: d for d in DailyUsage.objects.filter(user_id__in=user_ids, date=today)
        }

        # Latest event per user (portable across SQLite and Postgres)
        latest_events = {}
        for ev in UsageEvent.objects.filter(user_id__in=user_ids).order_by("created_at"):
            latest_events[ev.user_id] = ev

        studio_users = []
        for u in users_list:
            prof = getattr(u, "profile", None)
            is_pro = bool(prof and prof.is_pro_active)
            monthly = monthly_usage_map.get(u.id)
            daily = daily_usage_map.get(u.id)

            runs_used = monthly.studio_runs_used if monthly else 0
            runs_limit = 999 if is_pro else FREE_STUDIO_MONTHLY_LIMIT
            runs_remaining = 999 if is_pro else max(0, FREE_STUDIO_MONTHLY_LIMIT - runs_used)
            runs_pct = min(100, round((runs_used / FREE_STUDIO_MONTHLY_LIMIT * 100))) if not is_pro else 0

            nodes_today = daily.free_prompts_used if daily else 0
            nodes_limit = 999 if is_pro else FREE_STUDIO_DAILY_NODE_LIMIT
            nodes_remaining = 999 if is_pro else max(0, FREE_STUDIO_DAILY_NODE_LIMIT - nodes_today)
            nodes_pct = min(100, round((nodes_today / FREE_STUDIO_DAILY_NODE_LIMIT * 100))) if not is_pro else 0

            last_ev = latest_events.get(u.id)

            if activity_filter == "active_today" and u.id not in dau_user_ids:
                continue
            if activity_filter == "active_month" and runs_used == 0:
                continue

            studio_users.append({
                "user": u,
                "email": u.email,
                "is_pro": is_pro,
                "plan_name": "PRO 💎" if is_pro else "FREE 🟢",
                "runs_used": runs_used,
                "runs_limit": runs_limit,
                "runs_remaining": runs_remaining,
                "runs_pct": runs_pct,
                "nodes_today": nodes_today,
                "nodes_limit": nodes_limit,
                "nodes_remaining": nodes_remaining,
                "nodes_pct": nodes_pct,
                "last_seen": last_ev.created_at if last_ev else u.created_at,
                "last_event_type": last_ev.event_type if last_ev else "signup",
            })

        live_events_qs = (
            UsageEvent.objects.select_related("user")
            .filter(Q(metadata__source="studio") | Q(event_type__in=["consume_prompt", "queue_started"]))
            .order_by("-created_at")[:35]
        )

        live_feed = []
        for ev in live_events_qs:
            meta = ev.metadata or {}
            live_feed.append({
                "id": ev.id,
                "user_email": ev.user.email if ev.user else "Anonymous",
                "event_type": ev.event_type,
                "prompt_count": ev.prompt_count,
                "source": meta.get("source", "extension"),
                "status": meta.get("status", "done"),
                "prompt_type": meta.get("prompt_type", "text"),
                "node_count": meta.get("node_count", ev.prompt_count),
                "created_at": ev.created_at,
            })

        context = {
            "title": "Studio & Daily Users Analytics",
            "kpis": {
                "total_users": total_users,
                "dau_count": dau_count,
                "pro_users": pro_users,
                "free_users": free_users,
                "today_nodes_executed": today_nodes_executed,
                "monthly_studio_runs": monthly_studio_runs,
                "today_generations_done": today_generations_done,
                "today_generations_failed": today_generations_failed,
                "monthly_limit": FREE_STUDIO_MONTHLY_LIMIT,
                "daily_node_limit": FREE_STUDIO_DAILY_NODE_LIMIT,
            },
            "studio_users": studio_users,
            "live_feed": live_feed,
            "search_query": search_query,
            "plan_filter": plan_filter,
            "activity_filter": activity_filter,
        }
        return render(request, self.template_name, context)

    def post(self, request):
        action = request.POST.get("action")
        user_id = request.POST.get("user_id")

        if not user_id:
            messages.error(request, "User ID missing.")
            return redirect(request.path)

        user = get_object_or_404(CustomUser, id=user_id)
        now = timezone.now()
        today = timezone.localdate()

        if action == "grant_runs":
            amount = int(request.POST.get("amount", 5))
            monthly = get_or_create_monthly_usage(user, now.year, now.month)
            monthly.studio_runs_used = max(0, monthly.studio_runs_used - amount)
            monthly.save()
            messages.success(request, f"Granted +{amount} monthly runs to {user.email}.")

        elif action == "reset_daily_nodes":
            daily = get_or_create_daily_usage(user, today)
            daily.free_prompts_used = 0
            daily.text_prompts_used = 0
            daily.save()
            messages.success(request, f"Reset daily node budget to 50 for {user.email}.")

        elif action == "toggle_pro":
            profile, _ = Profile.objects.get_or_create(user=user)
            profile.is_pro_active = not profile.is_pro_active
            profile.plan_type = PlanType.PRO if profile.is_pro_active else PlanType.FREE
            profile.save()
            state = "PRO" if profile.is_pro_active else "FREE"
            messages.success(request, f"Changed plan for {user.email} to {state}.")

        return redirect(request.path)
