"""Accounts that run AutoFlow without asking the server (apps/plans/bypass.py).

The owner, 2026-11-22, over a free account at 186/50: "how the fuck they do
this". It ran 12 queues, one of 200 prompts, and claimed none of them; only
Flow's receipts reached the server. These protect: the count of prompts from
queues no run was claimed for (and that Studio, a claimed queue and a queue
claimed yesterday never count), the suspension past the day, that a suspended
account can neither call the API nor sign in, that an admin lifts it, and
that the receipts have their own allowance.
"""
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory, TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.api.throttles import SubmissionRateThrottle
from apps.api.views import PromptSubmittedView
from apps.api.queue_events import QueueEventsView
from apps.plans.bypass import SUSPEND_AT, is_suspended, lift, suspend, unclaimed_submissions
from apps.plans.models import PlanType, Profile
from apps.plans.services import FREE_TEXT_DAILY_LIMIT
from apps.usage.models import UsageEvent
from apps.users.models import CustomUser

E = UsageEvent.EventType


def make_user(email, pro=False, password="pass12345"):
    user = CustomUser.objects.create_user(email, password, is_active=True)
    Profile.objects.create(user=user, plan_type=PlanType.PRO if pro else PlanType.FREE, is_pro_active=pro)
    return user


def jwt_client(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


class Receipts:
    n = 0

    @classmethod
    def send(cls, client, queue_id, count=1):
        last = None
        for _ in range(count):
            cls.n += 1
            last = client.post(reverse("usage-submitted"),
                               {"media_id": f"m-{cls.n}", "queue_id": queue_id, "mode": "flow"}, format="json")
        return last


class CountsOnlyQueuesThatNeverClaimed(TestCase):
    def setUp(self):
        self.user = make_user("count@example.com")

    def sub(self, queue_id, n=1):
        for _ in range(n):
            Receipts.n += 1
            UsageEvent.objects.create(user=self.user, event_type=E.PROMPT_SUBMITTED, prompt_count=1,
                                      media_id=f"c-{Receipts.n}", queue_id=queue_id)

    def claim(self, queue_id, hours_ago=0):
        e = UsageEvent.objects.create(user=self.user, event_type=E.QUEUE_RUN_FLOW, prompt_count=10, queue_id=queue_id)
        if hours_ago:
            UsageEvent.objects.filter(pk=e.pk).update(created_at=timezone.now() - timedelta(hours=hours_ago))

    def test_a_queue_that_never_claimed_counts(self):
        self.sub("q-ghost", 7)
        self.assertEqual(unclaimed_submissions(self.user), 7)

    def test_a_claimed_queue_studio_and_unmatched_receipts_never_count(self):
        self.claim("q-paid")
        self.claim("q-yesterday", hours_ago=20)
        self.sub("q-paid", 5)
        self.sub("q-yesterday", 5)
        self.sub("studio:background", 5)
        self.sub("studio-n1-123", 5)
        self.sub("", 5)
        self.assertEqual(unclaimed_submissions(self.user), 0)

    def test_a_claim_older_than_two_days_no_longer_covers(self):
        self.claim("q-old", hours_ago=60)
        self.sub("q-old", 3)
        self.assertEqual(unclaimed_submissions(self.user), 3)


class SuspendsPastTheDay(TestCase):
    def setUp(self):
        self.user = make_user("ghost@example.com")
        self.client = jwt_client(self.user)

    def test_receipts_from_an_unclaimed_queue_suspend_past_the_day(self):
        Receipts.send(self.client, "q-ghost", FREE_TEXT_DAILY_LIMIT)
        self.assertFalse(is_suspended(self.user), "within the day's allowance nothing happens")
        Receipts.send(self.client, "q-ghost", SUSPEND_AT - FREE_TEXT_DAILY_LIMIT - 1)
        self.assertFalse(is_suspended(self.user), "past the day, but fewer than SUSPEND_AT unclaimed")
        res = Receipts.send(self.client, "q-ghost", 1)
        self.assertTrue(res.json()["limit_reached"])
        self.assertTrue(is_suspended(self.user))
        ev = UsageEvent.objects.get(user=self.user, event_type=E.ACCOUNT_SUSPENDED)
        self.assertIn("never asked the server", ev.metadata["reason"])
        # From now on every call is refused, and says why.
        res = self.client.get(reverse("auth-me"))
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["code"], "account_suspended")

    def test_a_claimed_queue_past_the_day_is_billed_but_never_suspended(self):
        UsageEvent.objects.create(user=self.user, event_type=E.QUEUE_RUN_FLOW, prompt_count=50, queue_id="q-paid")
        Receipts.send(self.client, "q-paid", FREE_TEXT_DAILY_LIMIT + 20)
        self.assertFalse(is_suspended(self.user))

    def test_pro_and_staff_are_never_suspended(self):
        pro = make_user("pro@example.com", pro=True)
        Receipts.send(jwt_client(pro), "q-x", FREE_TEXT_DAILY_LIMIT + SUSPEND_AT)
        self.assertFalse(is_suspended(pro))
        staff = make_user("staff@example.com")
        staff.is_staff = True
        staff.save()
        Receipts.send(jwt_client(staff), "q-y", FREE_TEXT_DAILY_LIMIT + SUSPEND_AT)
        self.assertFalse(is_suspended(staff))


def _has(name):
    try:
        reverse(name)
        return True
    except Exception:
        return False


class SuspendedCannotSignIn(TestCase):
    def setUp(self):
        self.user = make_user("banned@example.com", password="pass12345")
        suspend(self.user, "test")

    def test_login_is_refused_with_the_reason(self):
        res = APIClient().post(reverse("auth-login"),
                               {"email": "banned@example.com", "password": "pass12345"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "account_suspended")
        self.assertNotIn("access", res.json())

    def test_a_refresh_token_from_before_is_refused(self):
        refresh = str(RefreshToken.for_user(self.user))
        res = APIClient().post(reverse("auth-refresh"), {"refresh": refresh}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "account_suspended")

    def test_google_sign_in_is_refused(self):
        with mock.patch("google.oauth2.id_token.verify_oauth2_token", return_value={"email": "banned@example.com"}):
            res = APIClient().post(reverse("auth-google"), {"id_token": "x"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "account_suspended")

    def test_lifting_restores_everything(self):
        self.assertTrue(lift(self.user, by="admin@example.com"))
        res = APIClient().post(reverse("auth-login"), {"email": "banned@example.com", "password": "pass12345"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(UsageEvent.objects.filter(user=self.user, event_type=E.ACCOUNT_RESTORED).exists())


class AdminActions(TestCase):
    def test_suspend_and_lift_from_the_user_list(self):
        from apps.users.admin import CustomUserAdmin
        admin_user = make_user("boss@example.com")
        admin_user.is_staff = admin_user.is_superuser = True
        admin_user.save()
        target = make_user("t@example.com")
        ma = CustomUserAdmin(CustomUser, AdminSite())
        request = RequestFactory().post("/")
        request.user = admin_user
        ma.message_user = lambda *a, **k: None
        ma.suspend_users(request, CustomUser.objects.filter(pk=target.pk))
        self.assertTrue(is_suspended(target))
        ma.lift_suspension(request, CustomUser.objects.filter(pk=target.pk))
        self.assertFalse(is_suspended(target))


class ReceiptsHaveTheirOwnAllowance(TestCase):
    def test_receipts_and_clip_results_are_not_under_the_shared_120(self):
        self.assertEqual(PromptSubmittedView.throttle_classes, [SubmissionRateThrottle])
        self.assertEqual(QueueEventsView.throttle_classes, [SubmissionRateThrottle])
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["submissions"], "600/minute")

    def test_every_api_call_goes_through_the_suspension_check(self):
        self.assertEqual(settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"][0],
                         "apps.api.authentication.AutoFlowJWTAuthentication")
