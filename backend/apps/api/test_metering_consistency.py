"""Where the billing counters and the event log are allowed to disagree.

`DailyUsage.free_prompts_used` is what gates a user. `UsageEvent` rows are
what the dashboard reads. Nothing reconciles them afterwards, so any path
that moves one without the other drifts silently and forever — which is how a
five-prompt gap sat in production unnoticed on 2026-09-13.

Three findings, and they are not the same kind of thing:

  1. The receipt-coverage cohort was RETROACTIVE — "has ever reported"
     re-labels past days as observable when an account updates today.
  2. consume_queue_run billed `prompt_count` but recorded
     `text_count + full_count` — latent, since no caller disagrees today.
  3. Studio bills `node_count` and records `generate_count`, on purpose.
     That one is a pricing decision and is asserted here as intended
     behaviour, so that changing it is a deliberate act rather than an
     accident.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.dashboard import _flow_receipt_coverage
from apps.plans.models import PlanType, Profile
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class CoverageIsNotRetroactiveTests(TestCase):
    """Yesterday's coverage must not change because of what happened today."""

    def setUp(self):
        self.today = timezone.localdate()
        self.yesterday = self.today - timedelta(days=1)
        self.late = self._user("late@example.com")

    def _user(self, email):
        u = CustomUser.objects.create_user(email, "pass123", is_active=True)
        Profile.objects.create(user=u, plan_type=PlanType.FREE)
        return u

    def _charge(self, user, n, when):
        for _ in range(n):
            e = UsageEvent.objects.create(
                user=user, event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1, metadata={"prompt_type": "text"})
            UsageEvent.objects.filter(pk=e.pk).update(created_at=when)

    def _receipt(self, user, media_id, when):
        e = UsageEvent.objects.create(
            user=user, event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1, media_id=media_id, queue_id="q", prompt_index=0,
            metadata={"prompt_type": "text"})
        UsageEvent.objects.filter(pk=e.pk).update(created_at=when)

    def test_an_account_that_updates_today_does_not_backfill_yesterday(self):
        """The exact regression: 2026-09-11 read 17% on the day and 80% two
        days later, although nothing about that day had changed."""
        now = timezone.now()
        # Yesterday this account was on a silent build: charged, no receipts.
        self._charge(self.late, 20, now - timedelta(days=1))
        # Today it updates and starts reporting.
        self._charge(self.late, 5, now)
        self._receipt(self.late, "todays-first", now)

        yday = _flow_receipt_coverage({"created_at__date": self.yesterday})
        self.assertEqual(yday["tracked_charged"], 0)
        self.assertEqual(yday["coverage_pct"], 0)
        self.assertEqual(yday["untracked_charged"], 20)
        # And crucially, yesterday is not blamed for 20 lost prompts.
        self.assertEqual(yday["never_sent_tracked"], 0)

    def test_today_still_counts_an_account_that_reports_today(self):
        now = timezone.now()
        self._charge(self.late, 5, now)
        self._receipt(self.late, "m1", now)
        cov = _flow_receipt_coverage({"created_at__date": self.today})
        self.assertEqual(cov["tracked_charged"], 5)
        self.assertEqual(cov["coverage_pct"], 100)
        self.assertEqual(cov["never_sent_tracked"], 4)

    def test_a_day_after_the_account_started_reporting_still_counts(self):
        """Bounded by when reporting STARTED, not by reporting that day."""
        now = timezone.now()
        self._receipt(self.late, "long-ago", now - timedelta(days=3))
        self._charge(self.late, 8, now)          # reported nothing today
        cov = _flow_receipt_coverage({"created_at__date": self.today})
        self.assertEqual(cov["tracked_charged"], 8)
        self.assertEqual(cov["never_sent_tracked"], 8)


class QueueRunBillsWhatItRecordsTests(TestCase):
    """One number must drive the counters and the events."""

    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "queue@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def _run(self, **kw):
        from apps.plans.services import consume_queue_run
        return consume_queue_run(self.user, mode="flow", **kw)

    def _counts(self):
        from apps.usage.models import DailyUsage
        du = DailyUsage.objects.get(user=self.user, date=timezone.localdate())
        events = UsageEvent.objects.filter(
            user=self.user, event_type=UsageEvent.EventType.CONSUME_PROMPT).count()
        return du.free_prompts_used, events

    def test_a_single_type_run_bills_what_it_records(self):
        self._run(prompt_count=6, prompt_type="text")
        charged, events = self._counts()
        self.assertEqual(charged, events)

    def test_a_mixed_run_bills_what_it_records(self):
        self._run(prompt_count=10, text_count=7, full_count=3)
        charged, events = self._counts()
        self.assertEqual(charged, events)
        self.assertEqual(events, 10)

    def test_a_split_that_disagrees_with_its_total_bills_the_split(self):
        """The latent bug. prompt_count said 10, the split says 6; the events
        have always followed the split, so the billing must too rather than
        charging four prompts nothing will ever account for."""
        self._run(prompt_count=10, text_count=4, full_count=2)
        charged, events = self._counts()
        self.assertEqual(events, 6)
        self.assertEqual(charged, 6)


class StudioChargesPerNodeOnPurposeTests(TestCase):
    """Asserted so that changing it has to be deliberate.

    Studio bills a free account for every node but records only the generate
    nodes, because only a generate node can produce a Flow media id — counting
    a Gemini ask as "charged but never received" would blame the Flow pipeline
    for work that was never going there. The consequence is a real drift
    between the counter and the events, and it is intended until someone
    decides otherwise.
    """

    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "studio@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def test_a_free_account_is_billed_per_node_but_records_generates(self):
        from apps.plans.services import consume_studio_run
        from apps.usage.models import DailyUsage

        consume_studio_run(self.user, node_count=5, generate_count=2)

        du = DailyUsage.objects.get(user=self.user, date=timezone.localdate())
        events = UsageEvent.objects.filter(
            user=self.user, event_type=UsageEvent.EventType.CONSUME_PROMPT)

        self.assertEqual(du.free_prompts_used, 5)   # billed every node
        self.assertEqual(events.count(), 2)         # recorded the generates
        # The drift is real, intended, and this is its size.
        self.assertEqual(du.free_prompts_used - events.count(), 3)

    def test_the_event_states_what_was_actually_billed(self):
        """So the drift above is explicable from the data rather than only
        from the source. Without this the counter simply runs ahead and the
        gap looks like corruption."""
        from apps.plans.services import consume_studio_run

        consume_studio_run(self.user, node_count=5, generate_count=2)
        ev = UsageEvent.objects.filter(
            user=self.user, event_type=UsageEvent.EventType.CONSUME_PROMPT).first()
        self.assertEqual(ev.metadata.get("nodes_charged"), 5)
        self.assertEqual(ev.metadata.get("generate_count"), 2)
