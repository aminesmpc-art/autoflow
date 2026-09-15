"""Charging on submission instead of at queue start.

Today the whole queue is charged before anything is sent, so the meter counts
prompts QUEUED.  Charging at submission counts prompts Flow RECEIVED — but on
its own it removes the gate: nothing is spent when the limit is checked, so a
free user with five left could start a hundred-prompt queue and overshoot.

So the run still claims N up front and HOLDS them.  Each submission commits
one, the run hands back the rest when it ends, and anything never handed back
expires.  Limit checks count used + held, so the gate stays exactly as strict
while the billing becomes truthful.

The switch is METER_ON_SUBMISSION, and it ships OFF.  Half these tests are
about the off state, because the thing most worth proving is that this changes
nothing at all until somebody decides it should.
"""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.plans.models import PlanType, Profile
from apps.plans.services import get_or_create_daily_usage
from apps.usage.models import PromptReservation, UsageEvent
from apps.users.models import CustomUser


def _reload_flag(value):
    """The flag is read at import time, so tests patch the module attribute."""
    from apps.plans import services
    from apps.api import views
    services.METER_ON_SUBMISSION = value
    views.METER_ON_SUBMISSION = value


class ReservationBase(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "hold@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.today = timezone.localdate()

    def tearDown(self):
        _reload_flag(False)

    def _used(self):
        u = get_or_create_daily_usage(self.user, self.today)
        return (u.total_prompts_used, u.free_prompts_used,
                u.text_prompts_used, u.full_prompts_used)

    def _start(self, n=20, mode="flow", queue_id="q1", **kw):
        from apps.plans.services import consume_queue_run
        return consume_queue_run(self.user, mode=mode, prompt_count=n,
                                 queue_id=queue_id, **kw)

    def _submit(self, media_id, queue_id="q1", prompt_type="text"):
        return self.client.post(
            reverse("usage-submitted"),
            {"media_id": media_id, "queue_id": queue_id,
             "prompt_index": 0, "prompt_type": prompt_type},
            content_type="application/json")


class SwitchOffTests(ReservationBase):
    """How it ships.  Nothing may move."""

    def test_the_queue_is_still_charged_up_front(self):
        _reload_flag(False)
        self._start(20)
        total, free, text, _ = self._used()
        self.assertEqual((total, free, text), (20, 20, 20))

    def test_nothing_is_held(self):
        _reload_flag(False)
        self._start(20)
        self.assertEqual(PromptReservation.objects.count(), 0)

    def test_a_submission_charges_nothing(self):
        _reload_flag(False)
        self._start(3)
        before = self._used()
        self._submit("m1")
        self.assertEqual(self._used(), before)

    def test_and_says_so(self):
        _reload_flag(False)
        self._start(3)
        self.assertFalse(self._submit("m1").json()["charged"])


class SwitchOnTests(ReservationBase):
    """The run this whole change exists for."""

    def setUp(self):
        super().setUp()
        _reload_flag(True)

    def test_starting_a_queue_holds_rather_than_spends(self):
        self._start(20)
        self.assertEqual(self._used(), (0, 0, 0, 0))
        held = PromptReservation.objects.get(queue_id="q1")
        self.assertEqual(held.held, 20)

    def test_a_run_stopped_after_three_charges_three(self):
        """Twenty queued, three reached Flow.  Today this bills twenty."""
        self._start(20)
        for i in range(3):
            self._submit(f"m{i}")

        total, free, text, _ = self._used()
        self.assertEqual((total, free, text), (3, 3, 3))
        self.assertEqual(PromptReservation.objects.get(queue_id="q1").held, 17)

    def test_a_queue_that_dies_at_prompt_one_charges_nothing(self):
        self._start(20)
        self.assertEqual(self._used(), (0, 0, 0, 0))

    def test_the_run_hands_back_what_it_never_sent(self):
        self._start(20)
        self._submit("m1")
        res = self.client.post(reverse("usage-release"), {"queue_id": "q1"},
                               content_type="application/json")
        self.assertEqual(res.json()["freed"], 19)
        self.assertEqual(PromptReservation.objects.get(queue_id="q1").held, 0)

    def test_releasing_twice_does_not_hand_back_twice(self):
        self._start(20)
        body = {"queue_id": "q1"}
        first = self.client.post(reverse("usage-release"), body, content_type="application/json")
        second = self.client.post(reverse("usage-release"), body, content_type="application/json")
        self.assertEqual(first.json()["freed"], 20)
        self.assertEqual(second.json()["freed"], 0)

    def test_releasing_an_unknown_queue_is_harmless(self):
        res = self.client.post(reverse("usage-release"), {"queue_id": "never-existed"},
                               content_type="application/json")
        self.assertEqual(res.json()["freed"], 0)

    # ── Charged exactly once ─────────────────────────────────────────────

    def test_a_replayed_submission_charges_once(self):
        """The unique index decides, not the view."""
        self._start(5)
        self._submit("m1")
        self._submit("m1")
        self._submit("m1")
        total, _, _, _ = self._used()
        self.assertEqual(total, 1)

    def test_reporting_an_outcome_does_not_charge_again(self):
        self._start(5)
        self._submit("m1")
        self.client.post(
            reverse("usage-submitted"),
            {"media_id": "m1", "queue_id": "q1", "outcome": "done"},
            content_type="application/json")
        self.assertEqual(self._used()[0], 1)

    def test_a_retry_is_a_second_charge(self):
        """New generation, new media id — and Google charged for it."""
        self._start(5)
        self._submit("m-first")
        self._submit("m-retry")
        self.assertEqual(self._used()[0], 2)

    def test_a_submission_with_no_hold_still_charges(self):
        """An expired hold, or a queue started before the switch, does not make
        the generation free."""
        self._submit("m1", queue_id="never-reserved")
        self.assertEqual(self._used()[0], 1)

    def test_a_full_prompt_charges_the_full_bucket(self):
        self._start(5)
        self._submit("m1", prompt_type="full")
        _, _, text, full = self._used()
        self.assertEqual((text, full), (0, 1))

    # ── The gate stays shut ──────────────────────────────────────────────

    def test_held_prompts_count_against_the_limit(self):
        """The reason a hold exists at all.  Two big queues must not both be
        allowed just because neither has spent anything yet."""
        from apps.plans.services import FREE_TEXT_DAILY_LIMIT
        first = self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q1")
        self.assertTrue(first["allowed"])

        second = self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q2")
        self.assertFalse(second["allowed"])

    def test_releasing_gives_the_quota_back(self):
        from apps.plans.services import FREE_TEXT_DAILY_LIMIT
        self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q1")
        self.client.post(reverse("usage-release"), {"queue_id": "q1"},
                         content_type="application/json")
        again = self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q3")
        self.assertTrue(again["allowed"])

    def test_a_pro_user_is_not_gated(self):
        Profile.objects.filter(user=self.user).update(
            plan_type=PlanType.PRO, is_pro_active=True)
        self.assertTrue(self._start(500, queue_id="q-pro")["allowed"])

    # ── Holds nobody closed ──────────────────────────────────────────────

    def test_a_stale_hold_expires(self):
        """A stopped run, a closed tab, a recycled worker.  An unreleased hold
        would silently shrink the user's quota for the rest of the day."""
        from apps.plans.services import held_prompt_count
        self._start(20)
        PromptReservation.objects.filter(queue_id="q1").update(
            expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(held_prompt_count(self.user), 0)

    def test_an_expired_hold_frees_the_gate(self):
        from apps.plans.services import FREE_TEXT_DAILY_LIMIT
        self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q1")
        PromptReservation.objects.filter(queue_id="q1").update(
            expires_at=timezone.now() - timedelta(minutes=1))
        self.assertTrue(self._start(FREE_TEXT_DAILY_LIMIT, queue_id="q4")["allowed"])

    def test_restarting_the_same_queue_does_not_double_hold(self):
        self._start(20, queue_id="q1")
        self._start(20, queue_id="q1")
        self.assertEqual(PromptReservation.objects.filter(queue_id="q1").count(), 1)
        self.assertEqual(PromptReservation.objects.get(queue_id="q1").held, 20)

    # ── Both numbers still written ───────────────────────────────────────

    def test_the_submission_event_is_still_recorded(self):
        """Switching the meter must not stop the evidence being written — the
        dashboard's three numbers are read off it."""
        self._start(5)
        self._submit("m1")
        self.assertEqual(
            UsageEvent.objects.filter(
                event_type=UsageEvent.EventType.PROMPT_SUBMITTED).count(), 1)
