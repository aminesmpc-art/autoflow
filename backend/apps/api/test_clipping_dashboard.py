"""What the Clipping section can honestly say, and what it must not.

`ClippingUsage` is the charge ledger: one row per job that was actually
billed, unique on (user, idempotency_key). The dashboard counts THAT rather
than `DailyUsage.clipping_jobs_used`, because the row is the thing that was
paid for — if the counter beside it ever drifts, the row is still right.

The important property is a negative one. `reserve_clipping_job` writes
nothing at all when it declines to charge: a retry with a job id already seen
returns `charged=False`, and so does an attempt over the daily cap. No row, no
event, no counter change. So "how many retries were there" and "how many
people hit the cap" are not answerable from stored data, and a card showing 0
for either would be stating something the database never recorded. The tests
below pin the counting AND pin that a retry stays invisible, so a later change
that starts writing on the retry path has to come past them.
"""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.dashboard import _clipping_counts
from apps.plans.models import PlanType, Profile
from apps.usage.models import ClippingUsage, UsageEvent
from apps.usage.services import reserve_clipping_job
from apps.users.models import CustomUser


class ClippingCountsTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.user = CustomUser.objects.create_user(
            "clipper@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def _row(self, user=None, days_ago=0, key=None):
        """A charged job, written the way reserve_clipping_job writes one."""
        d = self.today - timedelta(days=days_ago)
        return ClippingUsage.objects.create(
            user=user or self.user,
            idempotency_key=key or f"job-{ClippingUsage.objects.count()}",
            date=d,
        )

    # ── Volume ───────────────────────────────────────────────────────────

    def test_counts_nothing_before_anyone_clips(self):
        c = _clipping_counts(self.today)
        self.assertEqual((c["today"], c["week"], c["total"]), (0, 0, 0))
        self.assertEqual(c["users_total"], 0)
        self.assertEqual(c["top_email"], "")

    def test_separates_today_from_the_week_from_all_time(self):
        self._row(days_ago=0)
        self._row(days_ago=3)
        self._row(days_ago=30)          # outside the 7-day window
        c = _clipping_counts(self.today)
        self.assertEqual(c["today"], 1)
        self.assertEqual(c["week"], 2)   # today + 3 days ago
        self.assertEqual(c["total"], 3)

    def test_the_week_window_includes_its_sixth_day_back(self):
        """Seven days INCLUDING today, so day 6 is in and day 7 is out."""
        self._row(days_ago=6)
        self._row(days_ago=7)
        c = _clipping_counts(self.today)
        self.assertEqual(c["week"], 1)
        self.assertEqual(c["total"], 2)

    # ── Who ──────────────────────────────────────────────────────────────

    def test_counts_people_not_jobs(self):
        other = CustomUser.objects.create_user(
            "second@example.com", "pass123", is_active=True)
        self._row()
        self._row()                      # same person, second job
        self._row(user=other)
        c = _clipping_counts(self.today)
        self.assertEqual(c["total"], 3)
        self.assertEqual(c["users_total"], 2)

    def test_names_the_heaviest_user(self):
        other = CustomUser.objects.create_user(
            "heavy@example.com", "pass123", is_active=True)
        self._row()
        for _ in range(3):
            self._row(user=other)
        c = _clipping_counts(self.today)
        self.assertEqual(c["top_email"], "heavy@example.com")
        self.assertEqual(c["top_count"], 3)

    # ── The negative property: a retry is invisible ──────────────────────

    def test_a_retry_is_not_a_second_job(self):
        """Same job id twice: charged once, and the second leaves no trace."""
        first = reserve_clipping_job(self.user, "same-job")
        self.assertTrue(first["charged"])
        again = reserve_clipping_job(self.user, "same-job")
        self.assertFalse(again["charged"])
        self.assertTrue(again["allowed"])

        c = _clipping_counts(self.today)
        self.assertEqual(c["total"], 1)
        self.assertEqual(c["today"], 1)

    def test_a_declined_attempt_writes_nothing(self):
        """Free cap is 1/day. The second job is refused and recorded nowhere."""
        reserve_clipping_job(self.user, "job-a")
        blocked = reserve_clipping_job(self.user, "job-b")
        self.assertFalse(blocked["allowed"])
        self.assertFalse(blocked["charged"])

        self.assertEqual(ClippingUsage.objects.count(), 1)
        self.assertEqual(
            UsageEvent.objects.filter(
                event_type=UsageEvent.EventType.CLIPPING_JOB_STARTED).count(), 1)

    # ── Integrity, not a second metric ───────────────────────────────────

    def test_a_real_charge_writes_both_the_row_and_the_event(self):
        reserve_clipping_job(self.user, "job-1")
        c = _clipping_counts(self.today)
        self.assertEqual(c["total"], 1)
        self.assertEqual(c["events"], 1)
        self.assertTrue(c["ledger_matches_events"])

    def test_says_so_when_the_two_disagree(self):
        """A ledger row with no event means a write path skipped one."""
        self._row()
        c = _clipping_counts(self.today)
        self.assertEqual(c["total"], 1)
        self.assertEqual(c["events"], 0)
        self.assertFalse(c["ledger_matches_events"])

    def test_carries_the_caps_it_is_measured_against(self):
        c = _clipping_counts(self.today)
        self.assertGreater(c["pro_limit"], c["free_limit"])


class ClippingTemplateContractTests(TestCase):
    """The template and the context have to agree on every name.

    The admin index is rendered by Django, which resolves an unknown variable
    to the empty string rather than raising. A typo in a card therefore shows
    a blank where a number belongs and nothing anywhere reports it — and the
    one test that renders this template cannot currently run on Python 3.14
    (Django's template Context.__copy__ raises), so it would not be caught
    there either. This compares the two sides directly instead.
    """

    SECTION_START = "<!-- ── CLIPPING ──"
    SECTION_END = "<!-- ── QUEUE RUNS BY MODE ── -->"

    def _section(self):
        from pathlib import Path

        from django.conf import settings

        for base in settings.TEMPLATES[0]["DIRS"]:
            path = Path(base) / "admin" / "index.html"
            if path.exists():
                src = path.read_text(encoding="utf-8")
                return src[src.index(self.SECTION_START):src.index(self.SECTION_END)]
        self.fail("admin/index.html not found in any template dir")

    def test_every_name_the_cards_use_is_in_the_context(self):
        import re

        used = set(re.findall(r"clipping\.(\w+)", self._section()))
        provided = set(_clipping_counts(timezone.localdate()).keys())
        self.assertTrue(used, "the section reads no clipping values at all")
        self.assertEqual(used - provided, set(), "template reads names the context never sets")

    def test_the_template_compiles(self):
        from django.template.loader import get_template

        get_template("admin/index.html")
