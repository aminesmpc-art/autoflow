"""Why "never received" has to be qualified while the build rolls out.

`never_sent` is `charged - sent`, and those are counted over two different
populations. `charged` is every account. `sent` is only accounts whose
extension carries the reporting code.

Measured on production 2026-09-11: 577 prompts charged that day, of which
481 — 83% — came from accounts with no reporting build at all. The card read
"Charged, never received: 518". Almost all of that was not Flow failing to
receive anything. It was the dashboard not being able to hear.

That is the same species of wrong number this whole feature was built to
retire, so the card now leads with the figure that is actually measurable and
says plainly how much of the day it can speak for.

The tests below pin the distinction, because the tempting "simplification" is
to cohort-filter `never_sent` itself — which would silently delete the case
the feature exists for: a run that dies at prompt one, charged twenty, reports
nothing, and SHOULD read as twenty never sent.
"""
from django.test import TestCase
from django.utils import timezone

from apps.dashboard import _flow_receipt_counts, _flow_receipt_coverage
from apps.plans.models import PlanType, Profile
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser


class ReceiptCoverageTests(TestCase):
    def setUp(self):
        self.today = {"created_at__date": timezone.localdate()}
        self.reporter = self._user("reporter@example.com")
        self.stale = self._user("stale@example.com")

    def _user(self, email):
        u = CustomUser.objects.create_user(email, "pass123", is_active=True)
        Profile.objects.create(user=u, plan_type=PlanType.FREE)
        return u

    def _charge(self, user, n):
        for _ in range(n):
            UsageEvent.objects.create(
                user=user,
                event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1,
                metadata={"prompt_type": "text"},
            )

    def _receipt(self, user, media_id, outcome=None):
        UsageEvent.objects.create(
            user=user,
            event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1,
            media_id=media_id,
            queue_id="q1",
            prompt_index=0,
            metadata={"prompt_type": "text", **({"outcome": outcome} if outcome else {})},
        )

    # ── The production shape that prompted this ──────────────────────────

    def test_a_stale_fleet_does_not_read_as_lost_prompts(self):
        """The 2026-09-11 shape: most charging comes from silent builds."""
        self._charge(self.reporter, 10)
        for i in range(6):
            self._receipt(self.reporter, f"m{i}")
        self._charge(self.stale, 90)          # cannot report, never could

        cov = _flow_receipt_coverage(self.today)
        self.assertEqual(cov["tracked_charged"], 10)
        self.assertEqual(cov["untracked_charged"], 90)
        self.assertEqual(cov["coverage_pct"], 10)
        # Only the reporter's own shortfall counts.
        self.assertEqual(cov["never_sent_tracked"], 4)

        # The unqualified figure is the one that would have alarmed you.
        _, _, never_sent = _flow_receipt_counts(self.today)
        self.assertEqual(never_sent, 94)
        self.assertGreater(never_sent, cov["never_sent_tracked"])

    def test_full_coverage_when_everyone_reports(self):
        self._charge(self.reporter, 5)
        for i in range(5):
            self._receipt(self.reporter, f"m{i}")
        cov = _flow_receipt_coverage(self.today)
        self.assertEqual(cov["coverage_pct"], 100)
        self.assertEqual(cov["untracked_charged"], 0)
        self.assertEqual(cov["never_sent_tracked"], 0)

    # ── What must NOT be cohort-filtered away ────────────────────────────

    def test_a_reporting_account_whose_run_died_still_counts_as_never_sent(self):
        """The case the whole feature exists for, and the one a cohort
        filter would erase: this account CAN report — it has receipts from
        another day — it just sent nothing for the run that died."""
        self._receipt(self.reporter, "from-an-earlier-run")
        UsageEvent.objects.filter(media_id="from-an-earlier-run").update(
            created_at=timezone.now() - timezone.timedelta(days=3))

        self._charge(self.reporter, 20)       # charged today, reported nothing
        cov = _flow_receipt_coverage(self.today)
        self.assertEqual(cov["tracked_charged"], 20)
        self.assertEqual(cov["coverage_pct"], 100)
        self.assertEqual(cov["never_sent_tracked"], 20)

    # ── Arithmetic guards ────────────────────────────────────────────────

    def test_a_retry_heavy_day_does_not_go_negative(self):
        """A retry is a second generation with its own id and its own charge
        from Google, so receipts can outrun the up-front count."""
        self._charge(self.reporter, 2)
        for i in range(5):
            self._receipt(self.reporter, f"m{i}")
        self.assertEqual(_flow_receipt_coverage(self.today)["never_sent_tracked"], 0)

    def test_a_quiet_day_reports_zero_not_a_crash(self):
        cov = _flow_receipt_coverage(self.today)
        self.assertEqual(cov["coverage_pct"], 0)
        self.assertEqual(cov["tracked_charged"], 0)
        self.assertEqual(cov["never_sent_tracked"], 0)
