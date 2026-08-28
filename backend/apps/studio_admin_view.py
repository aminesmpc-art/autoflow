"""Studio Users admin dashboard — active creators, quotas, live feed."""
import logging

from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.db.models import Max, Q, Sum
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

    # ── GET ──────────────────────────────────────────────────────
    def get(self, request):
        now = timezone.now()
        today = timezone.localdate()
        year, month = now.year, now.month

        # ── KPIs (lightweight aggregate queries) ──
        total_users = CustomUser.objects.count()
        pro_users = Profile.objects.filter(is_pro_active=True).count()
        free_users = max(0, total_users - pro_users)

        today_nodes_agg = DailyUsage.objects.filter(date=today).aggregate(
            n=Sum("total_prompts_used"),
        )
        today_nodes_executed = today_nodes_agg["n"] or 0

        monthly_runs_agg = MonthlyUsage.objects.filter(
            year=year, month=month,
        ).aggregate(
            studio=Sum("studio_runs_used"),
            full=Sum("full_runs_used"),
        )
        monthly_studio_runs = (monthly_runs_agg["studio"] or 0) + (monthly_runs_agg["full"] or 0)

        # ── Active user IDs (use DB-level distinct, no Python sets) ──
        active_user_ids = set()
        active_user_ids.update(
            UsageEvent.objects.values_list("user_id", flat=True).distinct()[:5000]
        )
        active_user_ids.update(
            DailyUsage.objects.filter(total_prompts_used__gt=0)
            .values_list("user_id", flat=True).distinct()[:5000]
        )
        active_user_ids.update(
            MonthlyUsage.objects.filter(
                Q(studio_runs_used__gt=0) | Q(full_runs_used__gt=0)
            ).values_list("user_id", flat=True).distinct()[:5000]
        )
        active_user_ids.update(
            Profile.objects.filter(is_pro_active=True)
            .values_list("user_id", flat=True)[:5000]
        )
        total_active_users = len(active_user_ids)

        # DAU
        dau_user_ids = set()
        dau_user_ids.update(
            DailyUsage.objects.filter(date=today, total_prompts_used__gt=0)
            .values_list("user_id", flat=True)
        )
        dau_user_ids.update(
            UsageEvent.objects.filter(created_at__date=today)
            .values_list("user_id", flat=True)
        )
        dau_count = len(dau_user_ids)

        # ── Live feed ──
        live_feed = self._build_live_feed(now)

        # JSON endpoint for AJAX polling
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

        # ── Filter & search ──
        search_query = request.GET.get("q", "").strip()
        plan_filter = request.GET.get("plan", "").strip().lower()
        activity_filter = request.GET.get("activity", "active").strip().lower()

        users_qs = CustomUser.objects.select_related("profile")

        if search_query:
            users_qs = users_qs.filter(email__icontains=search_query)
        elif activity_filter == "active":
            users_qs = users_qs.filter(id__in=active_user_ids)
        elif activity_filter == "active_today":
            users_qs = users_qs.filter(id__in=dau_user_ids)
        # "all" → no filter

        if plan_filter == "pro":
            users_qs = users_qs.filter(profile__is_pro_active=True)
        elif plan_filter == "free":
            users_qs = users_qs.filter(
                Q(profile__is_pro_active=False) | Q(profile__isnull=True)
            )

        users_list = list(users_qs.order_by("-created_at")[:200])
        user_ids = [u.id for u in users_list]

        # Batch-load usage data (2 queries, not N+1)
        monthly_map = {
            m.user_id: m
            for m in MonthlyUsage.objects.filter(
                user_id__in=user_ids, year=year, month=month,
            )
        }
        daily_map = {
            d.user_id: d
            for d in DailyUsage.objects.filter(user_id__in=user_ids, date=today)
        }

        # Latest event per user — single aggregation query instead of loading all rows
        latest_event_map = {}
        if user_ids:
            latest_qs = (
                UsageEvent.objects.filter(user_id__in=user_ids)
                .values("user_id")
                .annotate(last_at=Max("created_at"))
            )
            latest_event_map = {row["user_id"]: row["last_at"] for row in latest_qs}

        # Build user rows
        studio_users = []
        for u in users_list:
            prof = getattr(u, "profile", None)
            is_pro = bool(prof and prof.is_pro_active)
            monthly = monthly_map.get(u.id)
            daily = daily_map.get(u.id)

            runs_used = (
                (monthly.studio_runs_used if monthly else 0)
                + (monthly.full_runs_used if monthly else 0)
            )
            runs_limit = 999 if is_pro else FREE_STUDIO_MONTHLY_LIMIT
            runs_remaining = 999 if is_pro else max(0, runs_limit - runs_used)
            runs_pct = (
                min(100, round(runs_used / FREE_STUDIO_MONTHLY_LIMIT * 100))
                if not is_pro else 0
            )

            nodes_today = daily.total_prompts_used if daily else 0
            nodes_limit = 999 if is_pro else FREE_STUDIO_DAILY_NODE_LIMIT
            nodes_remaining = 999 if is_pro else max(0, nodes_limit - nodes_today)
            nodes_pct = (
                min(100, round(nodes_today / FREE_STUDIO_DAILY_NODE_LIMIT * 100))
                if not is_pro else 0
            )

            last_seen = latest_event_map.get(u.id) or u.created_at

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
                "last_seen": last_seen,
            })

        studio_users.sort(key=lambda x: x["last_seen"], reverse=True)

        return render(request, self.template_name, {
            "title": "Studio Users",
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
        })

    # ── POST ─────────────────────────────────────────────────────
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
            messages.success(request, f"Granted +{amount} runs to {user.email}.")

        elif action == "reset_daily_nodes":
            daily = get_or_create_daily_usage(user, today)
            daily.free_prompts_used = 0
            daily.total_prompts_used = 0
            daily.text_prompts_used = 0
            daily.save()
            messages.success(request, f"Reset daily nodes for {user.email}.")

        elif action == "toggle_pro":
            profile, _ = Profile.objects.get_or_create(user=user)
            profile.is_pro_active = not profile.is_pro_active
            profile.plan_type = PlanType.PRO if profile.is_pro_active else PlanType.FREE
            profile.save()
            state = "PRO" if profile.is_pro_active else "FREE"
            messages.success(request, f"{user.email} → {state}.")

        return redirect(request.path)

    # ── Helpers ──────────────────────────────────────────────────
    @staticmethod
    def _build_live_feed(now):
        """Build the latest 40 events for the live feed sidebar."""
        events = (
            UsageEvent.objects.select_related("user")
            .filter(
                Q(metadata__source="studio")
                | Q(event_type__in=["consume_prompt", "queue_started", "reward_granted"])
            )
            .order_by("-created_at")[:40]
        )
        feed = []
        for ev in events:
            meta = ev.metadata or {}
            seconds_ago = (now - ev.created_at).total_seconds()
            if seconds_ago < 60:
                time_ago = "just now"
            elif seconds_ago < 3600:
                time_ago = f"{int(seconds_ago // 60)}m ago"
            else:
                time_ago = f"{int(seconds_ago // 3600)}h ago"

            feed.append({
                "id": str(ev.id),
                "user_email": ev.user.email if ev.user else "Anonymous",
                "event_type": ev.event_type,
                "prompt_count": ev.prompt_count,
                "source": meta.get("source", "queue"),
                "status": meta.get("status", "done"),
                "prompt_type": meta.get("prompt_type", "workflow"),
                "node_count": meta.get("node_count", ev.prompt_count or 1),
                "time_ago": time_ago,
            })
        return feed
