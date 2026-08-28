"""Tests for Studio Users & Daily Users Admin Dashboard View."""
from django.test import TestCase, RequestFactory, Client
from apps.users.models import CustomUser
from apps.plans.models import Profile, PlanType
from apps.usage.models import DailyUsage, MonthlyUsage
from apps.studio_admin_view import StudioUsersDashboardView
from django.utils import timezone


class StudioUsersAdminViewTest(TestCase):
    def setUp(self):
        self.rf = RequestFactory()
        self.admin_user = CustomUser.objects.create_superuser(
            "admin@example.com", "pass123", is_staff=True, is_active=True
        )
        self.normal_user = CustomUser.objects.create_user(
            "user@example.com", "pass123", is_active=True
        )
        self.profile = Profile.objects.create(user=self.normal_user, plan_type=PlanType.FREE)
        self.client = Client()

    def test_anonymous_redirect(self):
        resp = self.client.get("/admin/studio-users/")
        self.assertEqual(resp.status_code, 302)

    def test_admin_get_dashboard_view(self):
        req = self.rf.get("/admin/studio-users/")
        req.user = self.admin_user
        view = StudioUsersDashboardView.as_view()
        resp = view(req)
        self.assertEqual(resp.status_code, 200)

    def test_grant_runs_action(self):
        self.client.force_login(self.admin_user)
        now = timezone.now()
        monthly = MonthlyUsage.objects.create(
            user=self.normal_user, year=now.year, month=now.month, studio_runs_used=8
        )
        resp = self.client.post("/admin/studio-users/", {
            "action": "grant_runs",
            "user_id": str(self.normal_user.id),
            "amount": 5,
        })
        self.assertEqual(resp.status_code, 302)
        monthly.refresh_from_db()
        self.assertEqual(monthly.studio_runs_used, 3)

    def test_reset_daily_nodes_action(self):
        self.client.force_login(self.admin_user)
        today = timezone.localdate()
        daily = DailyUsage.objects.create(
            user=self.normal_user, date=today, free_prompts_used=45, text_prompts_used=45
        )
        resp = self.client.post("/admin/studio-users/", {
            "action": "reset_daily_nodes",
            "user_id": str(self.normal_user.id),
        })
        self.assertEqual(resp.status_code, 302)
        daily.refresh_from_db()
        self.assertEqual(daily.free_prompts_used, 0)

    def test_toggle_pro_action(self):
        self.client.force_login(self.admin_user)
        self.assertFalse(self.profile.is_pro_active)
        resp = self.client.post("/admin/studio-users/", {
            "action": "toggle_pro",
            "user_id": str(self.normal_user.id),
        })
        self.assertEqual(resp.status_code, 302)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_pro_active)
        self.assertEqual(self.profile.plan_type, PlanType.PRO)
