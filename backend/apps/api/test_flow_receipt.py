"""The three numbers the dashboard shows, and what separates them.

    Sent to Flow   billable — Flow received it, and Google charged for it
    Completed      of those, how many produced media.  An OUTCOME, not a
                   second charge: a clip Flow accepted and then failed stays
                   counted as sent.
    Never sent     charged at queue start and never received.  The number
                   nothing in the system could answer before, and the reason
                   the dashboard says 20 when the user got 14 videos.

The existing figure calls done+failed "actually sent to Flow".  That is the
best approximation that was available and it is wrong in the one direction
that matters — trackUsage reports `failed` for a prompt whether or not it ever
left the extension — so a queue that dies at prompt 1 puts all twenty in it.
The first test below is that exact run, and it is the reason for all of this.
"""
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.dashboard import _flow_receipt_counts
from apps.plans.models import PlanType, Profile
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class FlowReceiptCountsTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "receipt@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = reverse("usage-submitted")
        self.today = {"created_at__date": timezone.localdate()}

    # ── Helpers that mimic the two paths ─────────────────────────────────

    def _charge(self, n, status="pending"):
        """What consume_queue_run does at queue start: charge n, up front."""
        for _ in range(n):
            UsageEvent.objects.create(
                user=self.user,
                event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1,
                metadata={"status": status, "prompt_type": "text"},
            )

    def _submit(self, media_id, outcome=None):
        body = {"media_id": media_id, "queue_id": "q1",
                "prompt_index": 0, "prompt_type": "text"}
        if outcome:
            body["outcome"] = outcome
        return self.client.post(self.url, body, content_type="application/json")

    # ── The run this exists for ──────────────────────────────────────────

    def test_a_queue_that_died_at_prompt_one(self):
        """20 charged, 0 reached Flow.  Today that reads as 20 sent."""
        self._charge(20, status="failed")          # the extension reports failed
        sent, completed, never_sent = _flow_receipt_counts(self.today)

        self.assertEqual(sent, 0)                  # nothing was received
        self.assertEqual(completed, 0)
        self.assertEqual(never_sent, 20)           # and all of it was charged

    def test_a_run_stopped_after_three_of_twenty(self):
        self._charge(20)
        for i in range(3):
            self._submit(f"m{i}", outcome="done")

        sent, completed, never_sent = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 3)
        self.assertEqual(completed, 3)
        self.assertEqual(never_sent, 17)

    # ── Sent and completed are different questions ───────────────────────

    def test_a_clip_flow_accepted_and_then_failed_stays_sent(self):
        """Google charged for it, so it is billable — it just did not finish."""
        self._charge(2)
        self._submit("m-ok", outcome="done")
        self._submit("m-bad", outcome="failed")

        sent, completed, _ = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 2)
        self.assertEqual(completed, 1)

    def test_a_submission_with_no_outcome_yet_is_sent_but_not_completed(self):
        self._charge(1)
        self._submit("m-inflight")
        sent, completed, _ = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 1)
        self.assertEqual(completed, 0)

    def test_reporting_the_outcome_does_not_add_a_submission(self):
        """The outcome rides on the same row.  Two rows would make the
        billable number depend on how many times the extension reported."""
        self._submit("m1")
        self._submit("m1", outcome="done")
        self._submit("m1", outcome="done")

        sent, completed, _ = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 1)
        self.assertEqual(completed, 1)
        self.assertEqual(UsageEvent.objects.filter(media_id="m1").count(), 1)

    def test_an_outcome_can_be_corrected(self):
        """A generation can be seen failing and then recover."""
        self._submit("m1", outcome="failed")
        self._submit("m1", outcome="done")
        sent, completed, _ = _flow_receipt_counts(self.today)
        self.assertEqual((sent, completed), (1, 1))

    def test_a_junk_outcome_is_ignored_rather_than_stored(self):
        self._submit("m1", outcome="whatever")
        sent, completed, _ = _flow_receipt_counts(self.today)
        self.assertEqual((sent, completed), (1, 0))

    # ── Retries ──────────────────────────────────────────────────────────

    def test_a_retry_is_a_second_submission(self):
        """A tile Retry is a new generation with a new media id, and Google
        charged for it.  On a flaky day submissions exceed prompts — that is
        the honest number and the one matching the Google bill."""
        self._charge(1)
        self._submit("m-first", outcome="failed")
        self._submit("m-retry", outcome="done")

        sent, completed, never_sent = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 2)
        self.assertEqual(completed, 1)
        self.assertEqual(never_sent, 0)   # clamped, not negative

    # ── The dual-write period ────────────────────────────────────────────

    def test_an_old_extension_charges_without_submitting(self):
        """Until the new extension ships, everything looks 'never sent'.  That
        is the truth about what this backend can observe, not a bug."""
        self._charge(5)
        sent, _, never_sent = _flow_receipt_counts(self.today)
        self.assertEqual(sent, 0)
        self.assertEqual(never_sent, 5)

    def test_never_sent_is_clamped_at_zero(self):
        """Retries can push submissions above the charge.  A negative figure
        would read as a data bug rather than as the skew it is."""
        self._charge(1)
        for i in range(4):
            self._submit(f"m{i}")
        _, _, never_sent = _flow_receipt_counts(self.today)
        self.assertEqual(never_sent, 0)

    def test_an_empty_day_is_all_zeros(self):
        self.assertEqual(_flow_receipt_counts(self.today), (0, 0, 0))

    # ── It must not disturb the existing figures ─────────────────────────

    def test_submissions_do_not_leak_into_the_old_count(self):
        """_event_prompt_counts reads consume_prompt events.  A submission is
        a different event type and must never be picked up by it."""
        from apps.dashboard import _event_prompt_counts
        self._charge(2, status="done")
        self._submit("m1", outcome="done")

        total, _, _ = _event_prompt_counts(self.today)
        self.assertEqual(total, 2)   # the two charged, not the submission


class DashboardRendersReceiptTests(TestCase):
    """The context the admin page reads, built end to end."""

    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "dash@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def _ctx(self):
        from apps.dashboard import dashboard_callback

        class R:
            pass
        return dashboard_callback(R(), {})

    def test_it_exposes_the_three_numbers(self):
        ctx = self._ctx()
        self.assertIn("flow_receipt", ctx)
        for key in ("sent", "completed", "never_sent"):
            self.assertIn(key, ctx["flow_receipt"])

    def test_it_shows_the_old_number_beside_the_new_one(self):
        """The dual-write period is the whole point: while the gap is large the
        old number is still what is billed, and when it settles the switch is
        safe to make."""
        ctx = self._ctx()["flow_receipt"]
        self.assertIn("reported", ctx)
        self.assertIn("gap", ctx)

    def test_it_says_the_new_number_charges_nothing(self):
        self.assertFalse(self._ctx()["flow_receipt"]["charged"])

    def test_it_does_not_crash_on_an_empty_install(self):
        ctx = self._ctx()["flow_receipt"]
        self.assertEqual((ctx["sent"], ctx["completed"], ctx["never_sent"]), (0, 0, 0))

    def test_the_template_actually_renders_them(self):
        """Context without markup is a number nobody can see.

        The pre-existing `submitted` block has been in the context all along
        and appears in no template — which is how this was nearly shipped
        again.
        """
        from django.conf import settings as dj_settings
        from pathlib import Path

        tpl = Path(dj_settings.BASE_DIR) / "templates" / "admin" / "index.html"
        markup = tpl.read_text(encoding="utf-8")
        for field in ("flow_receipt.sent", "flow_receipt.completed",
                      "flow_receipt.never_sent", "flow_receipt.reported"):
            self.assertIn(field, markup, f"{field} is computed but never displayed")

    def test_the_template_says_whether_it_is_billing(self):
        """Somebody reading the card must be able to tell whether the number
        in front of them is the one being charged."""
        from django.conf import settings as dj_settings
        from pathlib import Path

        markup = (Path(dj_settings.BASE_DIR) / "templates" / "admin" / "index.html").read_text(encoding="utf-8")
        self.assertIn("flow_receipt.charged", markup)

    def test_the_old_submitted_block_is_untouched(self):
        """Nothing that exists today may move until the switch is deliberate."""
        ctx = self._ctx()
        self.assertIn("submitted", ctx)
        for key in ("sent", "done", "failed", "pending", "total_charged", "rate"):
            self.assertIn(key, ctx["submitted"])


class DailyUsageColumnTests(TestCase):
    """The Daily usages list — the page this is actually read on.

    Its "Prompts (Sent to Flow)" column was already the best guess available:
    done+failed, with pending treated as unsent.  That catches a queue that
    never reported.  What it cannot catch is a prompt the extension marked
    FAILED because it gave up before submitting — Flow never saw that one, and
    it counted as sent.
    """

    def setUp(self):
        from apps.usage.admin import DailyUsageAdmin
        from apps.usage.models import DailyUsage
        from django.contrib.admin.sites import AdminSite

        self.user = CustomUser.objects.create_user(
            "col@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)
        self.today = timezone.localdate()
        self.row = DailyUsage.objects.create(user=self.user, date=self.today)
        self.admin = DailyUsageAdmin(DailyUsage, AdminSite())

    def _charge(self, n, status):
        for _ in range(n):
            UsageEvent.objects.create(
                user=self.user, event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1, metadata={"status": status, "prompt_type": "text"})

    def _receipt(self, media_id):
        UsageEvent.objects.create(
            user=self.user, event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1, media_id=media_id, metadata={"prompt_type": "text"})

    def test_the_blind_spot_it_closes(self):
        """Eight charged, all reported failed, none ever submitted.

        The old measure calls that eight sent, because `failed` is reported
        whether or not the prompt left the extension.  Once tracking is live,
        zero receipts means zero — Flow never saw any of them.

        Tracking being live is established by a receipt existing at all: here,
        one from another queue on the same day.
        """
        self._charge(8, "failed")
        self._receipt("other-queue")      # proves the extension is reporting
        html = str(self.admin.prompt_usage_bar(self.row))
        self.assertIn("unsent", html)
        # The one real receipt, not eight. Pinned on the headline element
        # rather than on "1/": the "/50" now belongs to the BILLED figure
        # beside it, because receipts over the allowance denominator is what
        # made a row read "5/50" while 18 had been charged.
        self.assertIn('color:#f8fafc;">1</span>', html)
        self.assertNotIn('color:#f8fafc;">8</span>', html)

    def test_zero_receipts_before_tracking_is_not_read_as_zero_sent(self):
        """The ambiguity this resolves: on a row from before the endpoint
        existed, no receipt means no information, not "nothing was sent".
        Reading it as zero would blank every historic row the day it ships."""
        self._charge(5, "done")
        html = str(self.admin.prompt_usage_bar(self.row))
        self.assertIn('color:#f8fafc;">5</span>', html)

    def test_receipts_win_when_they_exist(self):
        self._charge(7, "done")
        for i in range(3):
            self._receipt(f"m{i}")
        html = str(self.admin.prompt_usage_bar(self.row))
        self.assertIn('color:#f8fafc;">3</span>', html)
        self.assertNotIn('color:#f8fafc;">7</span>', html)   # not the charged count
        self.assertIn("4 unsent", html)

    def test_a_retry_does_not_produce_a_negative_unsent(self):
        self._charge(1, "done")
        self._receipt("m1")
        self._receipt("m2")
        html = str(self.admin.prompt_usage_bar(self.row))
        self.assertNotIn("-1", html)

    def test_an_empty_day_still_says_no_prompts(self):
        self.assertIn("No prompts", str(self.admin.prompt_usage_bar(self.row)))
