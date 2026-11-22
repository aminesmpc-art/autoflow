"""Agent mode's own daily allowance (docs/agent-mode.md, 2026-11-15).

The owner chose "its own allowance": a run an AI agent starts in Agent mode is
counted apart, so an agent never uses up the Full runs a person makes, and when
it is used up the run is refused — it never falls back to Lite, which would
run without checking or downloading.
"""
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.plans import services
from apps.plans.models import PlanType, Profile
from apps.plans.services import (
    can_start_queue, consume_queue_run, get_entitlement_snapshot, get_or_create_daily_usage,
)
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class AgentModeAllowanceTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("agent@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_an_agent_run_counts_apart_from_full(self):
        res = consume_queue_run(self.user, "agent", prompt_count=1)
        self.assertTrue(res["allowed"], res)
        usage = get_or_create_daily_usage(self.user)
        self.assertEqual(usage.agent_runs_today, 1)
        self.assertEqual(usage.full_runs_today, 0)
        self.assertTrue(UsageEvent.objects.filter(user=self.user, event_type="queue_run_agent").exists())
        # A person's Full run is still there.
        self.assertTrue(can_start_queue(self.user, "full")["allowed"])

    def test_used_up_is_refused_with_why_and_never_lite(self):
        for _ in range(services.FREE_AGENT_DAILY_LIMIT):
            self.assertTrue(consume_queue_run(self.user, "agent", prompt_count=1)["allowed"])
        res = consume_queue_run(self.user, "agent", prompt_count=1)
        self.assertFalse(res["allowed"])
        self.assertIn("Agent mode's runs are used up", res["message"])
        self.assertIn("Lite would run without checking", res["message"])
        self.assertFalse(can_start_queue(self.user, "agent")["allowed"])
        self.assertEqual(get_or_create_daily_usage(self.user).agent_runs_today, services.FREE_AGENT_DAILY_LIMIT)

    def test_the_snapshot_carries_the_agent_allowance(self):
        consume_queue_run(self.user, "agent", prompt_count=1)
        snap = get_entitlement_snapshot(self.user)
        self.assertEqual(snap["agent_runs_today"], 1)
        self.assertEqual(snap["agent_daily_limit"], services.FREE_AGENT_DAILY_LIMIT)
        self.assertEqual(snap["agent_remaining_today"], services.FREE_AGENT_DAILY_LIMIT - 1)

    def test_pro_is_unlimited(self):
        Profile.objects.filter(user=self.user).update(plan_type=PlanType.PRO, is_pro_active=True)
        for _ in range(services.FREE_AGENT_DAILY_LIMIT + 2):
            self.assertTrue(consume_queue_run(self.user, "agent", prompt_count=1)["allowed"])

    def test_the_endpoint_takes_agent_and_still_refuses_nonsense(self):
        url = reverse("usage-queue-run")
        ok = self.client.post(url, {"mode": "agent", "prompt_count": 1}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertTrue(ok.json()["allowed"])
        bad = self.client.post(url, {"mode": "turbo", "prompt_count": 1}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("agent", bad.json()["detail"])
