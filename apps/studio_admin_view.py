"""Studio Users & Daily Users Executive Admin View."""
import json
import logging
from datetime import timedelta

from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Count, Q, Sum
from django.http import JsonResponse
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

        # ── Find All Active Users (Prompt Gen, Node Executions, Workflow Runs, Pro) ──
        event_user_ids = set(UsageEvent.objects.values_list("user_id", flat=True).distinct())
        daily_user_ids = set(
            DailyUsage.objects.filter(
                Q(free_prompts_used__gt=0) | Q(total_prompts_used__gt=0) | Q(text_prompts_used__gt=0)
            ).values_list("user_id", flat=True).distinct()
        )
        monthly_user_ids = set(
            MonthlyUsage.objects.filter(
                Q(studio_runs_used__gt=0) | Q(full_runs_used__gt=0)
            ).values_list("user_id", flat=True).distinct()
        )
        pro_user_ids = set(Profile.objects.filter(is_pro_active=True).values_list("user_id", flat=True).distinct())

        active_user_ids = event_user_ids | daily_user_ids | monthly_user_ids | pro_user_ids
        total_active_users = len(active_user_ids)

        # Daily Active Users (active today)
        dau_user_ids = set(
            DailyUsage.objects.filter(
                Q(free_prompts_used__gt=0) | Q(total_prompts_used__gt=0) | Q(text_prompts_used__gt=0),
                date=today,
            ).values_list("user_id", flat=True)
        ) | set(
            UsageEvent.objects.filter(created_at__date=today).values_list("user_id", flat=True)
        )
        dau_count = len(dau_user_ids)

        # Daily Node Executions Today
        today_nodes_agg = DailyUsage.objects.filter(date=today).aggregate(
            free_nodes=Sum("free_prompts_used"),
            total_nodes=Sum("total_prompts_used"),
        )
        today_nodes_executed = max(
            today_nodes_agg.get("free_nodes") or 0,
            today_nodes_agg.get("total_nodes") or 0
        )

        # Total Studio Workflow Runs This Month
        monthly_runs_agg = MonthlyUsage.objects.filter(year=year, month=month).aggregate(
            studio_runs=Sum("studio_runs_used"),
            full_runs=Sum("full_runs_used"),
        )
        monthly_studio_runs = max(
            monthly_runs_agg.get("studio_runs") or 0,
            monthly_runs_agg.get("full_runs") or 0
        )

        # ── Live Activity Feed (Latest 40 events) ──
        live_events_qs = (
            UsageEvent.objects.select_related("user")
            .filter(Q(metadata__source="studio") | Q(event_type__in=["consume_prompt", "queue_started", "reward_granted"]))
            .order_by("-created_at")[:40]
        )

        live_feed = []
        for ev in live_events_qs:
            meta = ev.metadata or {}
            live_feed.append({
                "id": str(ev.id),
                "user_email": ev.user.email if ev.user else "Anonymous",
                "event_type": ev.event_type,
                "prompt_count": ev.prompt_count,
                "source": meta.get("source", "studio" if "studio" in ev.event_type else "queue"),
                "status": meta.get("status", "done"),
                "prompt_type": meta.get("prompt_type", "workflow"),
                "node_count": meta.get("node_count", ev.prompt_count or 1),
                "created_at_formatted": ev.created_at.strftime("%H:%M:%S"),
                "time_ago": f"{int((now - ev.created_at).total_seconds() // 60)}m ago" if (now - ev.created_at).total_seconds() >= 60 else "just now",
            })

        # Return JSON for AJAX Live Polling
        if request.GET.get("format") == "json" or request.headers.get("x-requested-with") == "XMLHttpRequest":
            return JsonResponse({
                "kpis": {
                    "total_users": total_users,
                    "total_active_users": total_active_users,
                    "dau_count": dau_count,
                    "pro_users": pro_users,
                    "free_users": free_users,
                    "today_nodes_executed": today_nodes_executed,
                    "monthly_studio_runs": monthly_studio_runs,
                },
                "live_feed": live_feed,
            })

        # ── Search & Filter ──
        search_query = request.GET.get("q", "").strip().lower()
        plan_filter = request.GET.get("plan", "").strip().lower()
        activity_filter = request.GET.get("activity", "active").strip().lower()

        users_qs = CustomUser.objects.select_related("profile")

        if search_query:
            # When searching an email, search across all users matching that email
            users_qs = users_qs.filter(email__icontains=search_query)
        else:
            if activity_filter == "active":
                users_qs = users_qs.filter(id__in=active_user_ids)
            elif activity_filter == "active_today":
                users_qs = users_qs.filter(id__in=dau_user_ids)
            elif activity_filter == "all":
                pass

        if plan_filter == "pro":
            users_qs = users_qs.filter(profile__is_pro_active=True)
        elif plan_filter == "free":
            users_qs = users_qs.filter(Q(profile__is_pro_active=False) | Q(profile__isnull=True))

        users_qs = users_qs.order_by("-created_at")
        users_list = list(users_qs[:200])
        user_ids = [u.id for u in users_list]

        monthly_usage_map = {
            m.user_id: m for m in MonthlyUsage.objects.filter(user_id__in=user_ids, year=year, month=month)
        }
        daily_usage_map = {
            d.user_id: d for d in DailyUsage.objects.filter(user_id__in=user_ids, date=today)
        }

        latest_events = {}
        lifetime_counts = {}
        for ev in UsageEvent.objects.filter(user_id__in=user_ids).order_by("created_at"):
            latest_events[ev.user_id] = ev
            lifetime_counts[ev.user_id] = lifetime_counts.get(ev.user_id, 0) + ev.prompt_count

        studio_users = []
        for u in users_list:
            prof = getattr(u, "profile", None)
            is_pro = bool(prof and prof.is_pro_active)
            monthly = monthly_usage_map.get(u.id)
            daily = daily_usage_map.get(u.id)

            runs_used = max(
                (monthly.studio_runs_used if monthly else 0),
                (monthly.full_runs_used if monthly else 0)
            )
            runs_limit = 999 if is_pro else FREE_STUDIO_MONTHLY_LIMIT
            runs_remaining = 999 if is_pro else max(0, FREE_STUDIO_MONTHLY_LIMIT - runs_used)
            runs_pct = min(100, round((runs_used / FREE_STUDIO_MONTHLY_LIMIT * 100))) if not is_pro else 0

            nodes_today = max(
                (daily.free_prompts_used if daily else 0),
                (daily.total_prompts_used if daily else 0),
                (daily.text_prompts_used if daily else 0)
            )
            nodes_limit = 999 if is_pro else FREE_STUDIO_DAILY_NODE_LIMIT
            nodes_remaining = 999 if is_pro else max(0, FREE_STUDIO_DAILY_NODE_LIMIT - nodes_today)
            nodes_pct = min(100, round((nodes_today / FREE_STUDIO_DAILY_NODE_LIMIT * 100))) if not is_pro else 0

            last_ev = latest_events.get(u.id)
            last_seen = last_ev.created_at if last_ev else u.created_at
            total_activity = lifetime_counts.get(u.id, 0) + (daily.total_prompts_used if daily else 0)

            studio_users.append({
                "user": u,
                "email": u.email,
                "is_pro": is_pro,
                "plan_name": "PRO" if is_pro else "FREE",
                "runs_used": runs_used,
                "runs_limit": runs_limit,
                "runs_remaining": runs_remaining,
                "runs_pct": runs_pct,
                "nodes_today": nodes_today,
                "nodes_limit": nodes_limit,
                "nodes_remaining": nodes_remaining,
                "nodes_pct": nodes_pct,
                "total_activity": total_activity,
                "last_seen": last_seen,
                "last_event_type": last_ev.event_type if last_ev else "signup",
            })

        studio_users.sort(key=lambda x: x["last_seen"], reverse=True)

        context = {
            "title": "Studio & Daily Users Analytics",
            "kpis": {
                "total_users": total_users,
                "total_active_users": total_active_users,
                "dau_count": dau_count,
                "pro_users": pro_users,
                "free_users": free_users,
                "today_nodes_executed": today_nodes_executed,
                "monthly_studio_runs": monthly_studio_runs,
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
            monthly.full_runs_used = max(0, monthly.full_runs_used - amount)
            monthly.save()
            messages.success(request, f"Granted +{amount} monthly runs to {user.email}.")

        elif action == "reset_daily_nodes":
            daily = get_or_create_daily_usage(user, today)
            daily.free_prompts_used = 0
            daily.total_prompts_used = 0
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
