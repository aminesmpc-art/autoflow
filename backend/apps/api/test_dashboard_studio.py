"""Exercise dashboard_callback end-to-end with real Studio data.

A dashboard bug (bad ORM lookup, missing context key) only shows at request
time, so this builds actual rows and renders the admin index.
"""
from django.test import TestCase, Client
from django.utils import timezone

from apps.plans.models import PlanType, Profile
from apps.plans.services import consume_studio_run, FREE_STUDIO_MONTHLY_LIMIT
from apps.users.models import CustomUser
from apps.dashboard import dashboard_callback


class DashboardStudioTests(TestCase):
    def setUp(self):
        self.free = CustomUser.objects.create_user("dashfree@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.free, plan_type=PlanType.FREE)
        self.pro = CustomUser.objects.create_user("dashpro@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.pro, plan_type=PlanType.PRO, is_pro_active=True)

    def _ctx(self):
        class R:
            pass
        return dashboard_callback(R(), {})

    def test_callback_with_no_studio_data(self):
        """Must not crash / divide-by-zero on an empty install."""
        ctx = self._ctx()
        self.assertIn("studio", ctx)
        self.assertEqual(ctx["studio"]["runs_today"], 0)
        self.assertEqual(ctx["studio"]["avg_nodes"], 0)
        self.assertEqual(ctx["studio"]["capped_users"], 0)

    def test_counts_runs_nodes_and_users(self):
        consume_studio_run(self.free, node_count=3, generate_count=1)
        consume_studio_run(self.free, node_count=5, generate_count=2)
        consume_studio_run(self.pro, node_count=4, generate_count=2)

        s = self._ctx()["studio"]
        # Runs must count the per-run event only — consume_studio_run also
        # emits one consume_prompt event per generation tagged source=studio.
        self.assertEqual(s["runs_today"], 3)
        self.assertEqual(s["nodes_today"], 12)          # 3 + 5 + 4
        self.assertEqual(s["users_today"], 2)
        self.assertEqual(s["runs_month"], 3)
        self.assertEqual(s["users_month"], 2)
        self.assertEqual(s["avg_nodes"], 4.0)           # 12 / 3

    def test_studio_generations_reach_prompts_today(self):
        """The reported bug: Studio prompts were missing from Prompts Today."""
        from apps.usage.models import UsageEvent
        consume_studio_run(self.free, node_count=4, generate_count=3)
        # Settle them the way the runner does when each node finishes
        UsageEvent.objects.filter(
            user=self.free, event_type="consume_prompt"
        ).update(metadata={"source": "studio", "status": "done", "prompt_type": "text"})

        ctx = self._ctx()
        prompts_today = [k for k in ctx["kpi"] if k["title"] == "Prompts Today"][0]
        self.assertEqual(prompts_today["metric"], 3)

    def test_capped_counts_free_users_only(self):
        """Pro users blow past the cap; they must not show as upgrade candidates."""
        for _ in range(FREE_STUDIO_MONTHLY_LIMIT):
            consume_studio_run(self.free, node_count=2)
        for _ in range(FREE_STUDIO_MONTHLY_LIMIT + 3):
            consume_studio_run(self.pro, node_count=2)

        s = self._ctx()["studio"]
        self.assertEqual(s["capped_users"], 1, "only the free user should count as capped")

    def test_admin_index_renders(self):
        """The template itself must render with Studio data present."""
        consume_studio_run(self.free, node_count=4)
        admin = CustomUser.objects.create_superuser("dashadmin@example.com", "pass123")
        c = Client()
        c.force_login(admin)
        resp = c.get("/admin/")
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn("AutoFlow Studio", body)
        self.assertIn("Nodes Executed", body)
        self.assertIn("Hit Free Limit", body)
