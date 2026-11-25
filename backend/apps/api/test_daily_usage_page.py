"""The Daily usage page, remade (the owner, 2026-11-25: "please make it
understandable and remake it").

Seven plain columns instead of ten: the same figure no longer appears under
four names, and Runs counts Agent and Studio runs, which used to read
"No runs" beside a queue that ran.
"""
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory, TestCase
from django.utils import timezone

from apps.plans.models import PlanType, Profile
from apps.plans.services import FREE_TEXT_DAILY_LIMIT
from apps.usage.admin import AgentUseFilter, DailyUsageAdmin, NeedsLookFilter
from apps.usage.models import DailyUsage, UsageEvent
from apps.users.models import CustomUser


def make(email, used, pro=False, suspended="", **runs):
    u = CustomUser.objects.create_user(email, "pass12345", is_active=True)
    Profile.objects.create(user=u, plan_type=PlanType.PRO if pro else PlanType.FREE, is_pro_active=pro,
                           suspended_at=timezone.now() if suspended else None, suspended_reason=suspended)
    return u, DailyUsage.objects.create(user=u, date=timezone.now().date(), free_prompts_used=used,
                                        total_prompts_used=used, **runs)


def receipts(u, done, failed=0, unpaid=0):
    for i in range(done + failed):
        meta = {"outcome": "done" if i < done else "failed"}
        if i < unpaid:
            meta["uncovered"] = True
        UsageEvent.objects.create(user=u, event_type="prompt_submitted", media_id=f"{u.pk}-{i}", queue_id="q", metadata=meta)


class DailyUsagePage(TestCase):
    def setUp(self):
        self.page = DailyUsageAdmin(DailyUsage, AdminSite())

    def test_seven_plain_columns(self):
        self.assertEqual(self.page.list_display, (
            "user_cell", "date_display", "used_today", "on_flow", "runs_cell", "download_badge", "needs_look"))

    def test_used_today_against_the_free_limit_and_for_pro(self):
        _, over = make("over@example.com", FREE_TEXT_DAILY_LIMIT + 7)
        self.assertIn("over by 7", str(self.page.used_today(over)))
        _, pro = make("pro@example.com", 120, pro=True)
        self.assertIn("Pro, no limit", str(self.page.used_today(pro)))

    def test_on_flow_says_sent_done_failed(self):
        u, row = make("flow@example.com", 10)
        receipts(u, done=8, failed=2)
        html = str(self.page.on_flow(row))
        self.assertRegex(html, r">10</b> <span[^>]*>sent")
        self.assertRegex(html, r">8</b> <span[^>]*>done")
        self.assertRegex(html, r">2</b> <span[^>]*>failed")

    def test_runs_count_agent_and_studio(self):
        u, row = make("agent@example.com", 5, agent_runs_today=2)
        UsageEvent.objects.create(user=u, event_type="queue_started", metadata={"source": "studio"})
        html = str(self.page.runs_cell(row))
        self.assertIn(">3</b>", html)
        self.assertIn("Agent 2", html)
        self.assertIn("Studio 1", html)

    def test_needs_a_look_names_what_is_wrong_and_says_ok_otherwise(self):
        u, row = make("bad@example.com", FREE_TEXT_DAILY_LIMIT + 10, suspended="skipped the checks")
        receipts(u, done=5, unpaid=5)
        html = str(self.page.needs_look(row))
        for flag in ("Suspended", "5 not paid for", "Over limit"):
            self.assertIn(flag, html)
        _, fine = make("fine@example.com", 3)
        self.assertIn("OK", str(self.page.needs_look(fine)))

    def test_filters(self):
        u, _ = make("unpaid@example.com", 60)
        receipts(u, done=3, unpaid=3)
        make("calm@example.com", 3, agent_runs_today=1)
        request = RequestFactory().get("/")
        qs = DailyUsage.objects.all()

        def pick(filter_cls, value):
            f = filter_cls(request, {filter_cls.parameter_name: [value]}, DailyUsage, self.page)
            return set(f.queryset(request, qs).values_list("user__email", flat=True))

        self.assertEqual(pick(NeedsLookFilter, "unpaid"), {"unpaid@example.com"})
        self.assertEqual(pick(NeedsLookFilter, "over"), {"unpaid@example.com"})
        self.assertEqual(pick(AgentUseFilter, "yes"), {"calm@example.com"})
