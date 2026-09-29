"""The daily-usage list must give one answer to "how many went through".

On 2026-09-12 a single row read:

    Prompts (Sent to Flow):  761        (761 receipts, 2,683 unsent)
    Submitted:               0          (0 / 3,444 charged, None sent)

Same account, same day, two columns, opposite answers. The bar had been
taught to read receipts. The Submitted column had not — it still counted
consume events whose metadata.status was "done" or "failed", which is the
heuristic receipts exist to replace.

That row is also the clearest possible demonstration of why it is wrong. All
3,444 charged prompts were still "pending" because the run had not finished
reporting outcomes, so done+failed came to zero, and the column announced
that none of 3,444 had been sent — while 761 media ids sat in the table
saying Flow had received them.

The cause was duplication: two implementations of one question. Both now read
`_sent_to_flow`, and the first test below is that production row.
"""
from django.test import TestCase
from django.utils import timezone

from apps.plans.models import PlanType, Profile
from apps.usage.admin import _sent_to_flow
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class SentToFlowTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.user = CustomUser.objects.create_user(
            "heavy@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.PRO)

    def _charge(self, n, status="pending", prompt_type="text"):
        for _ in range(n):
            UsageEvent.objects.create(
                user=self.user,
                event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1,
                metadata={"status": status, "prompt_type": prompt_type},
            )

    def _receipt(self, media_id, prompt_type="text"):
        UsageEvent.objects.create(
            user=self.user,
            event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1,
            media_id=media_id,
            queue_id="q1",
            prompt_index=0,
            metadata={"prompt_type": prompt_type},
        )

    # ── The row that prompted this ───────────────────────────────────────

    def test_receipts_win_over_a_pile_of_pending_charges(self):
        """The 2026-09-12 shape, scaled down: everything charged is still
        'pending', so done+failed is zero — but the media ids exist."""
        self._charge(3444, status="pending")
        for i in range(761):
            self._receipt(f"m{i}")

        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 761)          # not 0
        self.assertTrue(stats["by_receipt"])
        self.assertEqual(stats["total_charged"], 3444)
        self.assertEqual(stats["unsent"], 2683)

    def test_a_failed_prompt_that_never_left_is_not_counted_as_sent(self):
        """The direction the old measure was wrong in. The extension marks a
        prompt failed whether or not it ever reached Flow; a receipt cannot
        exist unless Flow answered."""
        self._charge(20, status="failed")
        self._receipt("only-one-actually-landed")

        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 1)
        self.assertEqual(stats["unsent"], 19)

    # ── Historic rows must not read as zero ──────────────────────────────

    def test_a_day_before_tracking_falls_back_instead_of_reading_zero(self):
        """No receipt has ever been recorded, so absence means "old
        extension", not "nothing sent"."""
        self._charge(10, status="done")
        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 10)
        self.assertFalse(stats["by_receipt"])

    def test_once_tracking_is_live_zero_means_zero(self):
        """A receipt exists from an earlier day, so this account's extension
        reports. Silence today is real silence."""
        self._receipt("from-an-earlier-day")
        UsageEvent.objects.filter(media_id="from-an-earlier-day").update(
            created_at=timezone.now() - timezone.timedelta(days=2))

        self._charge(12, status="done")
        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 0)
        self.assertTrue(stats["by_receipt"])
        self.assertEqual(stats["unsent"], 12)

    def test_an_account_on_an_old_build_falls_back_even_once_others_report(self):
        """Caught on production before shipping.

        Settling "is tracking live" fleet-wide reads every account still on an
        old extension as having sent nothing: someone else reported, therefore
        this silence must be real. It is not — this account cannot report at
        all. Doing that turned a real row from 7 to 0, which is the same
        mistake, in the same direction, as the one being fixed.
        """
        other = CustomUser.objects.create_user(
            "reporter@example.com", "pass123", is_active=True)
        Profile.objects.create(user=other, plan_type=PlanType.FREE)
        UsageEvent.objects.create(
            user=other, event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1, media_id="someone-elses", queue_id="q",
            prompt_index=0, metadata={"prompt_type": "text"})

        # This account has never reported, and its own events are all settled.
        self._charge(7, status="done")
        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 7)      # not 0
        self.assertFalse(stats["by_receipt"])

    # ── Arithmetic ───────────────────────────────────────────────────────

    def test_a_retry_heavy_day_never_reports_negative_unsent(self):
        self._charge(2)
        for i in range(5):
            self._receipt(f"m{i}")
        self.assertEqual(_sent_to_flow(self.user, self.today)["unsent"], 0)

    def test_splits_full_from_text_off_the_receipts(self):
        self._charge(5)
        self._receipt("a", prompt_type="full")
        self._receipt("b", prompt_type="full")
        self._receipt("c", prompt_type="text")
        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["sent"], 3)
        self.assertEqual(stats["sent_full"], 2)
        self.assertEqual(stats["sent_text"], 1)

    def test_an_empty_day_is_zeros_not_an_error(self):
        stats = _sent_to_flow(self.user, self.today)
        self.assertEqual(stats["total_charged"], 0)
        self.assertEqual(stats["sent"], 0)
        self.assertEqual(stats["unsent"], 0)


class ColumnsAgreeTests(TestCase):
    """Whatever the shape, the two columns must not contradict each other.

    This is the guard the original bug needed. Both columns render from the
    same helper now, so the only way they diverge again is if someone
    reintroduces a second implementation — which is exactly what this catches.
    """

    def setUp(self):
        self.user = CustomUser.objects.create_user(
            "agree@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def _render_both(self):
        from django.contrib.admin.sites import AdminSite

        from apps.usage.admin import DailyUsageAdmin
        from apps.usage.models import DailyUsage

        admin = DailyUsageAdmin(DailyUsage, AdminSite())
        row = DailyUsage.objects.get(user=self.user)
        return str(admin.prompt_usage_bar(row)), str(admin.submitted_count(row))

    def test_both_columns_report_the_same_sent_figure(self):
        from apps.usage.models import DailyUsage

        DailyUsage.objects.create(user=self.user, date=timezone.localdate())
        for i in range(30):
            UsageEvent.objects.create(
                user=self.user, event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1, metadata={"status": "pending", "prompt_type": "text"})
        for i in range(7):
            UsageEvent.objects.create(
                user=self.user, event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
                prompt_count=1, media_id=f"x{i}", queue_id="q", prompt_index=i,
                metadata={"prompt_type": "text"})

        bar, submitted = self._render_both()
        # 7 sent, 23 unsent — and neither column may say "None sent".
        self.assertIn("7", submitted)
        self.assertIn("23 unsent", submitted)
        self.assertNotIn("None sent", submitted)
        self.assertIn("7", bar)
