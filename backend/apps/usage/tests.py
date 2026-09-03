from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.plans.models import PlanType, Profile
from apps.users.models import CustomUser


class ClippingQuotaApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = CustomUser.objects.create_user("clip@example.com", "pass123")
        Profile.objects.get_or_create(user=self.user)
        self.client.force_authenticate(self.user)

    def reserve(self, key: str):
        return self.client.post(
            reverse("usage-clipping-reserve"),
            {"idempotency_key": key},
            format="json",
        )

    def test_free_user_gets_one_clipping_job_per_day(self):
        first = self.reserve("job-1")
        blocked = self.reserve("job-2")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["used"], 1)
        self.assertEqual(first.data["limit"], 1)
        self.assertEqual(first.data["remaining"], 0)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.data["used"], 1)
        self.assertEqual(blocked.data["limit"], 1)

    def test_retrying_the_same_job_does_not_charge_twice(self):
        first = self.reserve("same-job")
        retry = self.reserve("same-job")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertFalse(retry.data["charged"])
        self.assertEqual(retry.data["used"], 1)

    def test_pro_user_gets_ten_clipping_jobs_per_day(self):
        profile = self.user.profile
        profile.plan_type = PlanType.PRO
        profile.is_pro_active = True
        profile.save(update_fields=["plan_type", "is_pro_active", "updated_at"])

        for index in range(10):
            response = self.reserve(f"pro-job-{index}")
            self.assertEqual(response.status_code, 201)
        blocked = self.reserve("pro-job-10")

        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.data["used"], 10)
        self.assertEqual(blocked.data["limit"], 10)
        self.assertTrue(blocked.data["is_pro"])

    def test_idempotency_key_is_required_and_bounded(self):
        self.assertEqual(
            self.client.post(reverse("usage-clipping-reserve"), {}, format="json").status_code,
            400,
        )
        self.assertEqual(self.reserve("x" * 129).status_code, 400)

    def test_anonymous_call_is_rejected(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            reverse("usage-clipping-reserve"),
            {"idempotency_key": "job-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
