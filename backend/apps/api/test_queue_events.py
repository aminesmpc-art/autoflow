"""Each clip's result, as it happens (2026-11-15).

The owner: the backend should hear of every clip's done or failed while the
queue runs, carrying "only [what is needed] for counting and pro and free
limits", the best real data from every user. What these tests defend:

  · a re-sent batch is not a second row in a count (idempotent per event)
  · no prompt words and no failure reason are stored, whatever is sent
  · nothing is charged: the day's usage is untouched
  · the Studio run counts (queue_started with source "studio") never see them
"""
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.plans.models import PlanType, Profile
from apps.plans.services import get_or_create_daily_usage
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


def event(seq, kind="done", **over):
    body = {"event_id": f"b-1234:{seq}", "kind": kind, "queue_id": "queue-1", "prompt": 3,
            "media_id": f"media-{seq}", "prompt_type": "full", "mode": "flow", "at": "2026-11-15T10:00:00Z"}
    body.update(over)
    return body


class QueueEventsTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("clips@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = reverse("usage-queue-events")

    def _post(self, events):
        return self.client.post(self.url, {"events": events}, format="json")

    def test_each_result_becomes_a_row_with_what_counting_needs(self):
        res = self._post([
            event(1, "queue-started", prompt=None, tally={"total": 4, "done": 0, "failed": 0, "waiting": 4}),
            event(2, "done"),
            event(3, "failed", prompt=4, media_id="", retry=1),
            event(4, "retrying", prompt=4, retry=2),
            event(5, "queue-finished", prompt=None, tally={"total": 4, "done": 3, "failed": 1, "waiting": 0}),
        ])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"created": 5, "duplicate": 0, "skipped": 0})
        rows = {e.metadata["kind"]: e for e in UsageEvent.objects.filter(user=self.user)}
        done = rows["done"]
        self.assertEqual(done.event_type, UsageEvent.EventType.PROMPT_DONE)
        self.assertEqual((done.queue_id, done.prompt_index, done.prompt_count), ("queue-1", 2, 1))
        self.assertEqual(done.metadata["media_id"], "media-2")
        self.assertEqual(done.metadata["prompt_type"], "full")
        self.assertEqual(done.metadata["source"], "queue")
        self.assertIsNone(done.media_id, "the unique media_id column belongs to the prompt_submitted row")
        self.assertEqual(rows["failed"].event_type, UsageEvent.EventType.PROMPT_FAILED)
        self.assertEqual(rows["failed"].metadata["retry"], 1)
        self.assertNotIn("media_id", rows["failed"].metadata)
        self.assertEqual(rows["retrying"].event_type, UsageEvent.EventType.PROMPT_RETRIED)
        self.assertEqual(rows["queue-finished"].metadata["tally"], {"total": 4, "done": 3, "failed": 1, "waiting": 0})
        self.assertEqual(rows["queue-finished"].prompt_count, 4)
        self.assertIsNone(rows["queue-started"].prompt_index)

    def test_a_resent_batch_is_not_counted_twice(self):
        self._post([event(1), event(2, "failed")])
        res = self._post([event(1), event(2, "failed"), event(3)])
        self.assertEqual(res.json(), {"created": 1, "duplicate": 2, "skipped": 0})
        self.assertEqual(UsageEvent.objects.filter(user=self.user).count(), 3)

    def test_another_users_event_id_is_theirs(self):
        other = CustomUser.objects.create_user("other@example.com", "pass123", is_active=True)
        UsageEvent.objects.create(user=other, event_type="prompt_done", metadata={"event_id": "b-1234:1"})
        self.assertEqual(self._post([event(1)]).json()["created"], 1)

    def test_no_prompt_words_and_no_failure_reason_are_kept(self):
        self._post([event(1, "failed", text="a secret prompt", error="policy", failure={"reason": "x"}, say="FAILED")])
        row = UsageEvent.objects.get(user=self.user)
        flat = str(row.metadata)
        for word in ("secret", "policy", "reason", "FAILED"):
            self.assertNotIn(word, flat)

    def test_moments_that_are_not_results_and_broken_events_are_skipped(self):
        res = self._post([event(1, "started"), event(2, "sent"), event(3, "generating"), "junk",
                          event(4, queue_id=""), event(5, event_id="")])
        self.assertEqual(res.json(), {"created": 0, "duplicate": 0, "skipped": 6})

    def test_it_charges_nothing(self):
        before = get_or_create_daily_usage(self.user)
        snapshot = {f.name: getattr(before, f.name) for f in before._meta.fields}
        self._post([event(i) for i in range(1, 11)])
        after = get_or_create_daily_usage(self.user)
        self.assertEqual({f.name: getattr(after, f.name) for f in after._meta.fields}, snapshot)

    def test_studio_run_counts_never_see_queue_starts(self):
        self._post([event(1, "queue-started", prompt=None, tally={"total": 2})])
        self.assertEqual(UsageEvent.objects.filter(event_type="queue_started", metadata__source="studio").count(), 0)

    def test_limits_on_the_request(self):
        self.assertEqual(self._post([event(i) for i in range(51)]).status_code, 400)
        self.assertEqual(self.client.post(self.url, {"events": "x"}, format="json").status_code, 400)
        anon = APIClient()
        self.assertEqual(anon.post(self.url, {"events": []}, format="json").status_code, 401)
