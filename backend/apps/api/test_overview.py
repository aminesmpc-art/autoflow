"""Users & what they use, on the admin home (apps/overview.py).

The owner, 2026-11-22: improve the existing dashboard, not a new page. So the
block is part of /admin/, staff only, and the old /admin/overview/ address
sends people to it.
"""
import uuid

from django.test import TestCase
from django.urls import reverse

from apps.plans.models import PlanType, Profile
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser

E = UsageEvent.EventType


class OverviewOnTheHomeTests(TestCase):
    def setUp(self):
        self.admin = CustomUser.objects.create_superuser("boss@example.com", "pass12345")
        self.agent_user = CustomUser.objects.create_user("agent@example.com", "x", is_active=True)
        self.plain_user = CustomUser.objects.create_user("plain@example.com", "x", is_active=True)
        for u in (self.agent_user, self.plain_user):
            Profile.objects.create(user=u, plan_type=PlanType.FREE)
        UsageEvent.objects.create(user=self.agent_user, event_type=E.QUEUE_RUN_LITE, prompt_count=3, metadata={"by_agent": True})
        UsageEvent.objects.create(user=self.agent_user, event_type=E.AGENT_CONNECTED, metadata={"agent": "claude-code"})
        UsageEvent.objects.create(user=self.agent_user, event_type=E.CHARACTER_MADE, metadata={"count": 2})
        for i in range(55):
            UsageEvent.objects.create(user=self.plain_user, event_type=E.PROMPT_SUBMITTED, media_id=uuid.uuid4().hex,
                                      metadata={"uncovered": True} if i >= 50 else {})

    def home(self, **params):
        self.client.force_login(self.admin)
        return self.client.get("/admin/", params)

    def test_staff_only(self):
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_the_home_shows_who_uses_agents_and_who_goes_over(self):
        res = self.home()
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'id="who-uses-what"')
        self.assertContains(res, "claude-code")
        self.assertNotContains(res, "{#")
        s = res.context["s"]
        self.assertEqual(s["agent_users"], 1)
        self.assertEqual(s["over_users"], 1)
        self.assertEqual(s["uncovered"], 5)

    def test_filters(self):
        self.assertEqual([r["email"] for r in self.home(filter="agents").context["rows"]], ["agent@example.com"])
        self.assertIn("plain@example.com", [r["email"] for r in self.home(filter="no_agents").context["rows"]])
        self.assertEqual([r["email"] for r in self.home(filter="over", window="today").context["rows"]], ["plain@example.com"])
        self.assertEqual(self.home(filter="characters").context["rows"][0]["chars_now"], 2)

    def test_the_old_page_sends_people_to_the_home(self):
        self.client.force_login(self.admin)
        res = self.client.get(reverse("admin-overview"), {"filter": "over"})
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res["Location"], "/admin/?filter=over#who-uses-what")

    def test_one_account(self):
        self.client.force_login(self.admin)
        res = self.client.get(reverse("admin-overview-user", args=[self.plain_user.pk]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.context["row"]["sent"], 55)
        self.assertContains(res, 'href="/admin/#who-uses-what"')
