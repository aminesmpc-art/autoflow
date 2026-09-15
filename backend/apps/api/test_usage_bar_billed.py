"""The usage bar must show the number the daily limit is enforced on.

── The row that prompted this ───────────────────────────────────────────

    keving2549@gmail.com   FREE   Sep 14, 2026
    bar:                   5/50
    queue bar:             10 done · 6 pending · 2 failed
    Submitted:             5 / 18 charged, 13 unsent

Twelve generations had settled and eighteen had been billed, while the bar
said five. Reading that row, an admin concludes the account has 45 prompts
left. It has 32.

The bar was showing `sent` — receipts, what Flow acknowledged — while
charging is still taken UP FRONT. check_prompt_quota answers the same
question with `FREE_TEXT_DAILY_LIMIT - free_prompts_used`, so the account was
being stopped at a line the admin panel could not see.

Receipts and charges are two honest ledgers. The column is headed "Prompts
(Sent to Flow)", so receipts are the right number to LEAD with — what was
wrong is what they were shown against. Rendering them over the daily limit,
with a progress bar filling toward it, reads as "this much allowance is gone".

So the headline stays the receipt count, and the "/50" moves to the figure it
actually describes: free_prompts_used, which is what check_prompt_quota stops
the user at. When METER_ON_SUBMISSION is thrown the two collapse into one
number, and the extra chip disappears on its own.
"""
from django.test import TestCase
from django.utils import timezone

from apps.plans.models import PlanType, Profile
from apps.usage.models import DailyUsage, UsageEvent
from apps.users.models import CustomUser


def _bar(obj):
    """Render the bar the way the changelist does."""
    from apps.usage.admin import DailyUsageAdmin
    from django.contrib import admin as dj_admin
    return str(DailyUsageAdmin(DailyUsage, dj_admin.site).prompt_usage_bar(obj))


class UsageBarShowsWhatIsBilledTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.user = CustomUser.objects.create_user(
            "keving@example.com", "pass123", is_active=True)
        Profile.objects.create(user=self.user, plan_type=PlanType.FREE)

    def _row(self, billed):
        return DailyUsage.objects.create(
            user=self.user, date=self.today,
            free_prompts_used=billed,
            total_prompts_used=billed,
            text_prompts_used=billed,
        )

    def _charge(self, n, status="pending"):
        for _ in range(n):
            UsageEvent.objects.create(
                user=self.user,
                event_type=UsageEvent.EventType.CONSUME_PROMPT,
                prompt_count=1,
                metadata={"status": status, "prompt_type": "text"},
            )

    def _receipt(self, media_id):
        UsageEvent.objects.create(
            user=self.user,
            event_type=UsageEvent.EventType.PROMPT_SUBMITTED,
            prompt_count=1,
            media_id=media_id,
            queue_id="q1",
            prompt_index=0,
            metadata={"prompt_type": "text"},
        )

    # ── The production row ───────────────────────────────────────────────

    def test_the_reported_row_shows_what_was_billed(self):
        """18 charged, 12 settled, 5 receipts — the bar must not say 5/50."""
        row = self._row(billed=18)
        self._charge(10, status="done")
        self._charge(6, status="pending")
        self._charge(2, status="failed")
        for i in range(5):
            self._receipt(f"m{i}")

        html = _bar(row)
        self.assertIn("18/50 billed", html)
        self.assertIn('color:#f8fafc;">5</span>', html)

    def test_receipts_are_still_shown_beside_it(self):
        """The receipt count does not disappear — it stops being the headline."""
        row = self._row(billed=18)
        self._charge(18, status="pending")
        for i in range(5):
            self._receipt(f"m{i}")

        html = _bar(row)
        # 13 charged-and-never-received, unchanged.
        self.assertIn("13 unsent", html)
        # And the allowance is stated rather than left to be inferred.
        self.assertIn("18/50 billed", html)

    def test_no_note_when_the_two_ledgers_agree(self):
        """Nothing to warn about when everything charged was received."""
        row = self._row(billed=5)
        self._charge(5, status="done")
        for i in range(5):
            self._receipt(f"m{i}")

        self.assertNotIn("billed", _bar(row))

    # ── The switch ───────────────────────────────────────────────────────

    def test_follows_meter_on_submission_when_it_is_thrown(self):
        """Once receipts ARE the charge, the bar shows receipts again."""
        from apps.plans import services

        row = self._row(billed=18)
        self._charge(18, status="pending")
        for i in range(5):
            self._receipt(f"m{i}")

        original = services.METER_ON_SUBMISSION
        services.METER_ON_SUBMISSION = True
        try:
            html = _bar(row)
        finally:
            services.METER_ON_SUBMISSION = original

        self.assertIn('color:#f8fafc;">5</span>', html)
        self.assertNotIn("18/50 billed", html)

    # ── Edges ────────────────────────────────────────────────────────────

    def test_a_row_billed_with_no_events_still_renders(self):
        """free_prompts_used is authoritative even when the event log is empty.

        The counter and the event log coming apart is exactly what went wrong
        in consume_studio_run, so the bar must not go blank when it happens.
        """
        row = self._row(billed=7)
        self.assertIn("7/50 billed", _bar(row))

    def test_a_genuinely_empty_day_says_so(self):
        self.assertIn("No prompts", _bar(self._row(billed=0)))
