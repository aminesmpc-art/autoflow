"""Recording that a prompt actually reached Flow.

Today's billable number is taken at queue start, before anything is sent, so
it means "prompts queued" and can never mean "prompts Flow received".  A run
stopped after 3 of 20 still charges 20; a queue that dies at prompt 1 still
charges 20.

The extension now has the signal that answers it: the interceptor reads a
media id out of Flow's own response to the request carrying this prompt's
text.  That is proof for one specific prompt, and it cannot exist for a prompt
that never left the extension.

Two properties are worth defending with tests, because both are the kind that
look fine until real traffic arrives:

  · the write is IDEMPOTENT, and by the database rather than by application
    code — a replay, a worker restart or a double-send must not double-count
  · it does NOT charge yet.  consume_queue_run keeps charging exactly as it
    does today so the two numbers can be compared on the same runs; a test
    that pins this is what stops the switch happening by accident.
"""
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.plans.models import PlanType, Profile
from apps.plans.services import get_or_create_daily_usage
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class PromptSubmittedTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "submit@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        # JWT is the only authentication class configured, so a session login
        # leaves DRF unauthenticated — force_authenticate is what the rest of
        # apps/api/tests.py uses.
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = reverse("usage-submitted")

    def _post(self, **over):
        body = {
            "media_id": "media-abc",
            "queue_id": "queue-1",
            "prompt_index": 0,
            "prompt_type": "text",
            "mode": "flow",
        }
        body.update(over)
        return self.client.post(self.url, body, content_type="application/json")

    # ── The event ────────────────────────────────────────────────────────

    def test_records_one_submission(self):
        res = self._post()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["created"])

        event = UsageEvent.objects.get(media_id="media-abc")
        self.assertEqual(event.event_type, UsageEvent.EventType.PROMPT_SUBMITTED)
        self.assertEqual(event.user, self.user)
        self.assertEqual(event.queue_id, "queue-1")
        self.assertEqual(event.prompt_index, 0)
        self.assertEqual(event.prompt_count, 1)
        self.assertEqual(event.metadata["source"], "generation_bound")

    def test_prompt_index_zero_is_kept(self):
        """0 is a real index and a falsy value — the classic place to lose it."""
        self._post(prompt_index=0)
        self.assertEqual(UsageEvent.objects.get(media_id="media-abc").prompt_index, 0)

    # ── Idempotency ──────────────────────────────────────────────────────

    def test_the_same_media_id_twice_records_once(self):
        first = self._post()
        second = self._post()
        self.assertTrue(first.json()["created"])
        self.assertFalse(second.json()["created"])
        self.assertEqual(second.status_code, 200)
        self.assertEqual(UsageEvent.objects.filter(media_id="media-abc").count(), 1)

    def test_a_replay_with_different_context_still_records_once(self):
        """A retry may carry a different queue or index; the media id decides."""
        self._post()
        self._post(queue_id="queue-2", prompt_index=7)
        self.assertEqual(UsageEvent.objects.filter(media_id="media-abc").count(), 1)
        kept = UsageEvent.objects.get(media_id="media-abc")
        self.assertEqual(kept.queue_id, "queue-1")   # the first write stands

    def test_different_media_ids_are_different_submissions(self):
        """A tile Retry is a new generation with a new id — and Google charged
        for it, so it is a second submission, not a duplicate."""
        self._post(media_id="media-abc")
        self._post(media_id="media-def")
        self.assertEqual(
            UsageEvent.objects.filter(
                event_type=UsageEvent.EventType.PROMPT_SUBMITTED).count(), 2)

    def test_the_database_enforces_it_not_just_the_view(self):
        """The guarantee has to survive a race the view never sees."""
        from django.db import IntegrityError, transaction
        self._post()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UsageEvent.objects.create(
                    user=self.user,
                    event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
                    media_id="media-abc",
                )

    def test_rows_without_a_media_id_do_not_collide(self):
        """Every event that already exists has none, and unique+NULL must
        allow any number of them — otherwise the migration cannot apply."""
        for _ in range(3):
            UsageEvent.objects.create(
                user=self.user,
                event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1,
            )
        self.assertEqual(UsageEvent.objects.filter(media_id__isnull=True).count(), 3)

    # ── What it must NOT do ──────────────────────────────────────────────

    def test_it_does_not_charge(self):
        """The whole point of the dual-write period.  If this ever starts
        moving counters while consume_queue_run still charges up front, every
        user is billed twice."""
        today = timezone.now().date()
        before = get_or_create_daily_usage(self.user, today)
        used_before = (before.total_prompts_used, before.free_prompts_used,
                       before.text_prompts_used, before.full_prompts_used)

        self._post(media_id="m1")
        self._post(media_id="m2")
        self._post(media_id="m3")

        after = get_or_create_daily_usage(self.user, today)
        self.assertEqual(
            (after.total_prompts_used, after.free_prompts_used,
             after.text_prompts_used, after.full_prompts_used),
            used_before,
        )

    def test_it_says_so_in_the_response(self):
        """So nobody reads this as the billing path before the switch."""
        self.assertFalse(self._post().json()["charged"])

    def test_it_does_not_touch_the_old_pending_events(self):
        """ConsumePromptView's reconciliation must be unaffected while both
        paths run side by side."""
        UsageEvent.objects.create(
            user=self.user,
            event_type=UsageEvent.EventType.CONSUME_PROMPT,
            prompt_count=1,
            metadata={"status": "pending", "prompt_type": "text"},
        )
        self._post()
        still_pending = UsageEvent.objects.filter(
            event_type=UsageEvent.EventType.CONSUME_PROMPT,
            metadata__status="pending",
        ).count()
        self.assertEqual(still_pending, 1)

    # ── Refusals ─────────────────────────────────────────────────────────

    def test_no_media_id_is_refused(self):
        """Without one there is nothing to be idempotent on, and an event that
        can be written twice is worse than no event."""
        res = self._post(media_id="")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_a_missing_media_id_is_refused(self):
        res = self.client.post(self.url, {"queue_id": "q"}, content_type="application/json")
        self.assertEqual(res.status_code, 400)

    def test_it_needs_a_login(self):
        self.client.force_authenticate(user=None)
        res = self._post()
        self.assertIn(res.status_code, (401, 403))
        self.assertEqual(UsageEvent.objects.count(), 0)

    def test_a_junk_prompt_index_does_not_500(self):
        res = self._post(prompt_index="not a number")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(UsageEvent.objects.get(media_id="media-abc").prompt_index)
