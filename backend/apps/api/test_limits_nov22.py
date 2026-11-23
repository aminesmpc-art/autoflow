"""The owner's limits of 2026-11-22.

"The agent needs to work only 3 times on free mode. And the counting has a
problem. Some users get used above 50 prompts a day."

Production showed both leaks: a free account ran 71 prompts on a 50 allowance
(the queue-run charge capped what it billed and answered "allowed"), one ran
615 in one queue, and one started 12 queues whose 339 accepted prompts never
asked the server to charge anything. And an AI agent could start a Lite or
Flow run, or a Studio run, none of which counted as an agent run.
"""
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.plans.models import PlanType, Profile
from apps.plans.services import FREE_AGENT_DAILY_LIMIT, FREE_TEXT_DAILY_LIMIT, get_or_create_daily_usage
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


def make_user(email, pro=False):
    user = CustomUser.objects.create_user(email, "pass123", is_active=True)
    Profile.objects.create(user=user, plan_type=PlanType.PRO if pro else PlanType.FREE, is_pro_active=pro)
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


class QueueRunRefusesWhatIsNotLeft(TestCase):
    def setUp(self):
        self.user, self.client = make_user("free@example.com")

    def run_queue(self, n, **extra):
        return self.client.post(reverse("usage-queue-run"), {"mode": "flow", "prompt_count": n, **extra}, format="json")

    def test_a_queue_bigger_than_what_is_left_is_refused_and_charges_nothing(self):
        usage = get_or_create_daily_usage(self.user)
        usage.free_prompts_used = 30
        usage.save()
        res = self.run_queue(25)
        self.assertEqual(res.status_code, 403)
        self.assertFalse(res.json()["allowed"])
        self.assertEqual(res.json()["remaining"], 20)
        usage.refresh_from_db()
        self.assertEqual(usage.free_prompts_used, 30)
        self.assertEqual(usage.flow_runs_today, 0)

    def test_a_queue_that_fits_is_charged_in_full_with_its_id(self):
        res = self.run_queue(20, queue_id="q-1")
        self.assertEqual(res.status_code, 200)
        usage = get_or_create_daily_usage(self.user)
        self.assertEqual(usage.free_prompts_used, 20)
        self.assertEqual(UsageEvent.objects.get(event_type="queue_run_flow").queue_id, "q-1")


class AgentRunsAreCountedInEveryMode(TestCase):
    def setUp(self):
        self.user, self.client = make_user("agent@example.com")

    def test_five_a_day(self):
        """The owner, 2026-11-23: 5 a day on Free (it was 3)."""
        self.assertEqual(FREE_AGENT_DAILY_LIMIT, 5)

    def test_an_agent_runs_queues_in_agent_mode_only(self):
        """The owner, 2026-11-23: "I want the agent only work on agent mode".
        Refused for every plan, and nothing is counted or charged."""
        _, pro = make_user("pro-agent@example.com", pro=True)
        for client in (self.client, pro):
            for mode in ("lite", "flow", "full"):
                res = client.post(reverse("usage-queue-run"), {"mode": mode, "prompt_count": 1, "agent": True}, format="json")
                self.assertEqual(res.status_code, 403, mode)
                self.assertTrue(res.json()["agent_mode_only"])
        usage = get_or_create_daily_usage(self.user)
        self.assertEqual((usage.agent_runs_today, usage.free_prompts_used), (0, 0))
        self.assertFalse(UsageEvent.objects.filter(user=self.user).exists())

    def test_an_agents_queue_and_studio_runs_spend_the_agent_allowance(self):
        for _ in range(FREE_AGENT_DAILY_LIMIT - 1):
            res = self.client.post(reverse("usage-queue-run"), {"mode": "agent", "prompt_count": 1, "agent": True}, format="json")
            self.assertEqual(res.status_code, 200)
        res = self.client.post(reverse("usage-studio-run"), {"node_count": 1, "generate_count": 1, "agent": True}, format="json")
        self.assertEqual(res.status_code, 200, res.json())
        self.assertEqual(get_or_create_daily_usage(self.user).agent_runs_today, FREE_AGENT_DAILY_LIMIT)

        refused = self.client.post(reverse("usage-queue-run"), {"mode": "agent", "prompt_count": 1, "agent": True}, format="json")
        self.assertEqual(refused.status_code, 403)
        self.assertTrue(refused.json()["agent_limit_reached"])
        studio = self.client.post(reverse("usage-studio-run"), {"node_count": 1, "generate_count": 1, "agent": True}, format="json")
        self.assertEqual(studio.status_code, 403)

    def test_agent_mode_runs_count_once(self):
        res = self.client.post(reverse("usage-queue-run"), {"mode": "agent", "prompt_count": 1, "agent": True}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(get_or_create_daily_usage(self.user).agent_runs_today, 1)

    def test_runs_the_user_starts_do_not_spend_it(self):
        self.client.post(reverse("usage-queue-run"), {"mode": "lite", "prompt_count": 1}, format="json")
        self.assertEqual(get_or_create_daily_usage(self.user).agent_runs_today, 0)

    def test_pro_agents_are_unlimited(self):
        _, client = make_user("pro@example.com", pro=True)
        for _ in range(FREE_AGENT_DAILY_LIMIT + 2):
            res = client.post(reverse("usage-queue-run"), {"mode": "agent", "prompt_count": 1, "agent": True}, format="json")
            self.assertEqual(res.status_code, 200)


class EveryAcceptedPromptIsCounted(TestCase):
    def setUp(self):
        self.user, self.client = make_user("sent@example.com")

    def submit(self, media, outcome=""):
        return self.client.post(reverse("usage-submitted"), {
            "media_id": media, "queue_id": "q", "prompt_index": 0, "prompt_type": "text", "mode": "flow", "outcome": outcome,
        }, format="json")

    def test_prompts_no_queue_paid_for_are_charged_and_marked(self):
        for i in range(3):
            res = self.submit(f"m{i}")
        self.assertTrue(res.json()["charged"])
        self.assertEqual(get_or_create_daily_usage(self.user).free_prompts_used, 3)
        self.assertTrue(UsageEvent.objects.get(media_id="m2").metadata.get("uncovered"))

    def test_a_queue_charged_up_front_is_not_charged_again(self):
        self.client.post(reverse("usage-queue-run"), {"mode": "flow", "prompt_count": 5}, format="json")
        for i in range(5):
            res = self.submit(f"m{i}")
            self.assertFalse(res.json()["charged"])
        self.assertEqual(get_or_create_daily_usage(self.user).free_prompts_used, 5)

    def test_a_retry_after_a_failure_stays_free(self):
        self.client.post(reverse("usage-queue-run"), {"mode": "flow", "prompt_count": 2}, format="json")
        self.submit("a")
        self.submit("b")
        self.submit("b", outcome="failed")
        res = self.submit("b2")  # sent again after Flow failed it
        self.assertFalse(res.json()["charged"])
        self.assertEqual(get_or_create_daily_usage(self.user).free_prompts_used, 2)

    def test_past_the_allowance_the_answer_says_stop(self):
        usage = get_or_create_daily_usage(self.user)
        usage.free_prompts_used = FREE_TEXT_DAILY_LIMIT
        usage.save()
        for i in range(FREE_TEXT_DAILY_LIMIT):
            res = self.submit(f"m{i}")
        self.assertFalse(res.json()["limit_reached"])
        res = self.submit("one-too-many")
        self.assertTrue(res.json()["limit_reached"])
        self.assertEqual(res.json()["remaining"], 0)
        # The next queue is refused: the counter holds what Flow accepted.
        self.assertEqual(get_or_create_daily_usage(self.user).free_prompts_used, FREE_TEXT_DAILY_LIMIT + 1)
        refused = self.client.post(reverse("usage-queue-run"), {"mode": "lite", "prompt_count": 1}, format="json")
        self.assertEqual(refused.status_code, 403)

    def test_a_replay_charges_nothing(self):
        self.submit("x")
        res = self.submit("x")
        self.assertFalse(res.json()["created"])
        self.assertFalse(res.json()["charged"])
        self.assertEqual(get_or_create_daily_usage(self.user).free_prompts_used, 1)

    def test_pro_is_never_charged(self):
        user, client = make_user("pro2@example.com", pro=True)
        res = client.post(reverse("usage-submitted"), {"media_id": "p1", "queue_id": "q"}, format="json")
        self.assertFalse(res.json()["charged"])
        self.assertFalse(res.json()["limit_reached"])
        self.assertEqual(get_or_create_daily_usage(user).free_prompts_used, 0)


class CharacterAndAgentEvents(TestCase):
    def setUp(self):
        self.user, self.client = make_user("side@example.com")

    def test_they_are_recorded_for_the_dashboard(self):
        res = self.client.post(reverse("usage-queue-events"), {"events": [
            {"event_id": "b:1", "kind": "character-made", "queue_id": "characters", "count": 2},
            {"event_id": "b:2", "kind": "character-deleted", "queue_id": "characters", "count": 1},
            {"event_id": "b:3", "kind": "agent-connected", "queue_id": "agent", "agent": "claude-code"},
        ]}, format="json")
        self.assertEqual(res.json(), {"created": 3, "duplicate": 0, "skipped": 0})
        made = UsageEvent.objects.get(event_type="character_made")
        self.assertEqual(made.metadata["count"], 2)
        self.assertEqual(UsageEvent.objects.get(event_type="agent_connected").metadata["agent"], "claude-code")
