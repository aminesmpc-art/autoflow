import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.plans.models import Profile
from apps.users.models import CustomUser
from apps.webhooks.models import WebhookEvent
from apps.webhooks.services import link_pending_webhooks_for_user, process_whop_webhook

from .billing import process_event
from .models import MotionMembership, MotionRun, MotionWebhookReceipt
from .services import entitlement, reserve_run
from .signatures import verify_signature

CONFIG = {
    "MOTION_BILLING_ENABLED": True,
    "WHOP_MOTION_PRODUCT_ID": "prod_motion",
    "WHOP_MOTION_PLAN_ID": "plan_motion",
    "WHOP_MOTION_WEBHOOK_SECRET": "ws_motion_test_secret",
    "WHOP_STUDIO_PRODUCT_IDS": ["prod_studio"],
}
NOW = datetime(2026, 9, 15, 12, tzinfo=dt_timezone.utc)
FINGERPRINT = "a" * 64


def event(kind="membership.activated", **changes):
    payload = {
        "api_version": "v1",
        "id": "msg_" + uuid.uuid4().hex,
        "type": kind,
        "timestamp": NOW.isoformat(),
        "data": {
            "id": "mem_motion",
            "updated_at": NOW.isoformat(),
            "product": {"id": "prod_motion"},
            "plan": {"id": "plan_motion"},
            "user": {"email": "buyer@example.com"},
        },
    }
    payload["data"].update(changes)
    return payload


def process(payload):
    return process_event(payload, payload["id"])


@override_settings(**CONFIG)
class MotionBillingTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("buyer@example.com", is_active=True)
        self.profile = Profile.objects.create(user=self.user)
        self.client = APIClient()

    def post_event(
        self,
        payload=None,
        secret=CONFIG["WHOP_MOTION_WEBHOOK_SECRET"],
        timestamp=None,
        raw=None,
    ):
        payload = payload or event()
        raw = raw if raw is not None else json.dumps(payload).encode()
        timestamp = str(timestamp if timestamp is not None else int(time.time()))
        message = f"{payload['id']}.{timestamp}.".encode() + raw
        signature = base64.b64encode(
            hmac.digest(secret.encode(), message, "sha256")
        ).decode()
        return self.client.generic(
            "POST",
            "/api/webhooks/whop-motion",
            raw,
            content_type="application/json",
            HTTP_WEBHOOK_ID=payload["id"],
            HTTP_WEBHOOK_TIMESTAMP=timestamp,
            HTTP_WEBHOOK_SIGNATURE=f"v1,{signature}",
        )

    def test_legacy_motion_purchase_does_not_unlock_pro_included_motion(self):
        self.assertEqual(self.post_event().status_code, 200)
        self.assertTrue(MotionMembership.objects.get(pk="mem_motion").active)
        # Every account may use Motion now; what a legacy Motion event must
        # never do is make it unlimited.
        self.assertEqual(entitlement(self.user)["accessPlan"], "free")
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_pro_active)
        self.assertEqual(self.profile.plan_type, "free")

    def test_repeated_event_is_idempotent(self):
        payload = event()
        self.post_event(payload)
        response = self.post_event(payload)
        self.assertEqual(response.data["disposition"], "duplicate")
        self.assertEqual(MotionWebhookReceipt.objects.count(), 1)

    def test_same_event_id_different_payload_rejected(self):
        payload = event()
        self.post_event(payload)
        payload["type"] = "membership.deactivated"
        self.assertEqual(self.post_event(payload).status_code, 400)
        self.assertTrue(MotionMembership.objects.get(pk="mem_motion").active)

    def test_invalid_signature_and_old_or_future_timestamp(self):
        for kwargs in (
            {"secret": "wrong"},
            {"timestamp": int(time.time()) - 600},
            {"timestamp": int(time.time()) + 600},
        ):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.post_event(**kwargs).status_code, 403)
        self.assertFalse(MotionWebhookReceipt.objects.exists())

    def test_signed_invalid_json_or_shape(self):
        for raw in (b"{broken", b"[]", b"null", b'{"data":[]}'):
            self.assertEqual(self.post_event(raw=raw).status_code, 400)
        self.assertFalse(MotionWebhookReceipt.objects.exists())

    def test_wrong_product_or_plan_ignored(self):
        for change in (
            {"product": {"id": "prod_other"}},
            {"plan": {"id": "plan_other"}},
        ):
            self.assertEqual(
                self.post_event(event(**change)).data["disposition"], "ignored_product"
            )
        self.assertFalse(MotionMembership.objects.exists())

    def test_missing_email_rolls_back_and_can_retry(self):
        payload = event(user={})
        self.assertEqual(self.post_event(payload).status_code, 400)
        self.assertFalse(MotionWebhookReceipt.objects.exists())
        payload["data"]["user"] = {"email": self.user.email}
        self.assertEqual(self.post_event(payload).status_code, 200)

    def test_processing_failure_is_not_acknowledged(self):
        with patch(
            "apps.motion.views.process_event", side_effect=RuntimeError("test failure")
        ):
            self.assertEqual(self.post_event().status_code, 500)

    def test_unknown_user_can_register_later_without_provisioning_pro(self):
        process(event(user={"email": "new@example.com"}))
        self.assertFalse(CustomUser.objects.filter(email="new@example.com").exists())
        user = CustomUser.objects.create_user("new@example.com", is_active=False)
        self.assertFalse(entitlement(user)["active"])
        user.is_active = True
        user.save()
        # Active, so on the free allowance — and not provisioned Pro.
        self.assertEqual(entitlement(user)["accessPlan"], "free")

    def test_older_activation_cannot_undo_deactivation(self):
        process(
            event(
                "membership.deactivated",
                updated_at=(NOW + timedelta(hours=1)).isoformat(),
            )
        )
        self.assertEqual(process(event()), "stale")
        self.assertFalse(MotionMembership.objects.get(pk="mem_motion").active)

    def test_deactivation_wins_equal_timestamp(self):
        process(event())
        process(event("membership.deactivated"))
        process(event())
        self.assertFalse(MotionMembership.objects.get(pk="mem_motion").active)

    def test_later_reactivation_restores_legacy_record_only(self):
        process(event("membership.deactivated"))
        process(event(updated_at=(NOW + timedelta(days=1)).isoformat()))
        self.assertTrue(MotionMembership.objects.get(pk="mem_motion").active)
        # Every account may use Motion now; what a legacy Motion event must
        # never do is make it unlimited.
        self.assertEqual(entitlement(self.user)["accessPlan"], "free")

    def test_old_membership_cancellation_does_not_cancel_new_membership(self):
        process(event())
        process(event(id="mem_new"))
        process(event("membership.deactivated"))
        self.assertTrue(MotionMembership.objects.get(pk="mem_new").active)

    def test_payment_events_never_grant_access(self):
        for kind in ("payment.succeeded", "payment.failed"):
            process(event(kind))
        # Every account may use Motion now; what a legacy Motion event must
        # never do is make it unlimited.
        self.assertEqual(entitlement(self.user)["accessPlan"], "free")

    def test_payment_failure_and_scheduled_cancellation_preserve_access(self):
        process(event())
        for kind in ("payment.failed", "membership.cancel_at_period_end_changed"):
            process(event(kind))
        self.assertTrue(MotionMembership.objects.get(pk="mem_motion").active)

    def test_legacy_handler_and_pending_linker_ignore_motion(self):
        receipt = WebhookEvent.objects.create(
            provider="whop",
            event_type="membership.activated",
            raw_payload=event(),
        )
        process_whop_webhook(receipt)
        self.assertEqual(link_pending_webhooks_for_user(self.user), 0)
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_pro_active)

    def test_legacy_studio_activation_still_works(self):
        receipt = WebhookEvent.objects.create(
            provider="whop",
            event_type="membership.activated",
            raw_payload=event(
                product={"id": "prod_studio"}, plan={"id": "plan_studio"}
            ),
        )
        process_whop_webhook(receipt)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_pro_active)

    def test_motion_cancellation_preserves_studio_pro(self):
        self.profile.plan_type = "pro"
        self.profile.is_pro_active = True
        self.profile.save()
        process(event("membership.deactivated"))
        receipt = WebhookEvent.objects.create(
            provider="whop",
            event_type="membership.deactivated",
            raw_payload=event("membership.deactivated"),
        )
        process_whop_webhook(receipt)
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_pro_active)

    def test_configuration_failure_is_closed(self):
        for config in (
            {"WHOP_MOTION_PLAN_ID": ""},
            {"WHOP_STUDIO_PRODUCT_IDS": []},
            {"WHOP_STUDIO_PRODUCT_IDS": ["prod_motion"]},
        ):
            with self.subTest(config=config), override_settings(**config):
                self.assertEqual(self.post_event().status_code, 503)
                self.assertEqual(entitlement(self.user)["accessPlan"], "free")

    def test_webhook_can_receive_before_launch_flag_enabled(self):
        with override_settings(MOTION_BILLING_ENABLED=False):
            self.assertEqual(self.post_event().status_code, 200)
            self.assertFalse(entitlement(self.user)["allowed"])


@override_settings(**CONFIG)
class MotionUsageTests(TestCase):
    """Free: 3 jobs a UTC day. Pro: unlimited. A retry is never counted again."""

    def setUp(self):
        self.user = CustomUser.objects.create_user("buyer@example.com", is_active=True)
        self.profile = Profile.objects.create(user=self.user, plan_type="free")
        self.client = APIClient()

    def make_pro(self):
        self.profile.plan_type = "pro"
        self.profile.is_pro_active = True
        self.profile.save()

    def reserve(self, job=None, fingerprint=FINGERPRINT):
        return reserve_run(self.user, job or uuid.uuid4(), fingerprint)

    def test_free_three_daily_then_reject_fourth(self):
        for _ in range(3):
            self.assertEqual(self.reserve()[1], 201)
        result, status = self.reserve()
        self.assertEqual((status, result["reason"]), (429, "motion_daily_limit"))
        self.assertEqual(result["accessPlan"], "free")
        self.assertEqual(result["daily"]["remaining"], 0)
        self.assertEqual(MotionRun.objects.count(), 3)

    def test_free_has_no_monthly_limit(self):
        for day in range(5):
            with patch(
                "apps.motion.services.timezone.now",
                return_value=NOW + timedelta(days=day),
            ):
                for _ in range(3):
                    self.assertEqual(self.reserve()[1], 201)
        with patch(
            "apps.motion.services.timezone.now", return_value=NOW + timedelta(days=5)
        ):
            self.assertEqual(self.reserve()[1], 201)
            snapshot = entitlement(self.user)
        self.assertIsNone(snapshot["monthly"]["limit"])
        self.assertEqual(snapshot["monthly"]["used"], 16)

    def test_pro_is_unlimited(self):
        self.make_pro()
        for _ in range(10):
            self.assertEqual(self.reserve()[1], 201)
        snapshot = entitlement(self.user)
        self.assertEqual(snapshot["accessPlan"], "pro")
        self.assertTrue(snapshot["allowed"])
        self.assertIsNone(snapshot["daily"]["limit"])
        self.assertIsNone(snapshot["daily"]["remaining"])
        self.assertEqual(snapshot["daily"]["used"], 10)

    def test_retry_after_limit_is_free_and_changed_job_conflicts(self):
        job = uuid.uuid4()
        original, _ = self.reserve(job)
        self.reserve()
        self.reserve()
        result, status = self.reserve(job)
        self.assertEqual(status, 200)
        self.assertEqual(result["runId"], original["runId"])
        self.assertTrue(result["duplicate"])
        self.assertEqual(self.reserve(job, "b" * 64)[1], 409)
        self.assertEqual(MotionRun.objects.count(), 3)

    def test_cancelled_pro_falls_back_to_the_free_allowance(self):
        self.make_pro()
        job = uuid.uuid4()
        self.reserve(job)
        for _ in range(4):
            self.reserve()
        self.profile.is_pro_active = False
        self.profile.save()
        # The job already admitted is still a free retry...
        self.assertEqual(self.reserve(job)[1], 200)
        # ...but five jobs today is past the free allowance for anything new.
        result, status = self.reserve()
        self.assertEqual((status, result["reason"], result["accessPlan"]), (429, "motion_daily_limit", "free"))

    def test_utc_day_and_year_month_reset(self):
        end_year = datetime(2026, 12, 31, 23, 59, tzinfo=dt_timezone.utc)
        with patch("apps.motion.services.timezone.now", return_value=end_year):
            for _ in range(3):
                self.reserve()
        with patch(
            "apps.motion.services.timezone.now",
            return_value=end_year + timedelta(minutes=2),
        ):
            snapshot = entitlement(self.user)
            self.assertEqual(snapshot["daily"]["used"], 0)
            self.assertEqual(snapshot["monthly"]["used"], 0)
            self.assertEqual(self.reserve()[1], 201)

    def test_same_job_id_is_scoped_to_user(self):
        job = uuid.uuid4()
        self.reserve(job)
        other = CustomUser.objects.create_user("other@example.com", is_active=True)
        Profile.objects.create(user=other, plan_type="pro", is_pro_active=True)
        self.assertEqual(reserve_run(other, job, FINGERPRINT)[1], 201)

    @override_settings(WHOP_MOTION_WEBHOOK_SECRET="", WHOP_MOTION_PRODUCT_ID="", WHOP_MOTION_PLAN_ID="", WHOP_STUDIO_PRODUCT_IDS=[])
    def test_existing_pro_unlocks_motion_without_separate_plan_configuration(self):
        self.make_pro()
        self.assertFalse(MotionMembership.objects.exists())
        self.assertEqual(self.reserve()[1], 201)
        self.assertEqual(entitlement(self.user)["accessPlan"], "pro")

    def test_free_and_expired_pro_get_the_free_allowance_inactive_is_denied(self):
        self.assertEqual(self.reserve()[1], 201)
        self.assertEqual(entitlement(self.user)["accessPlan"], "free")
        self.make_pro()
        self.profile.pro_expires_at = NOW - timedelta(days=1)
        self.profile.save()
        with patch("apps.motion.services.timezone.now", return_value=NOW):
            result, status = self.reserve()
        self.assertEqual((status, result["accessPlan"]), (201, "free"))
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_pro_active)
        self.user.is_active = False
        self.user.save()
        result, status = self.reserve()
        self.assertEqual((status, result["reason"]), (403, "account_inactive"))

    @override_settings(MOTION_BILLING_ENABLED=False)
    def test_feature_flag_still_blocks_generation(self):
        self.assertEqual(self.reserve()[1], 503)

    @override_settings(WHOP_MOTION_WEBHOOK_SECRET="", WHOP_MOTION_PRODUCT_ID="", WHOP_MOTION_PLAN_ID="", WHOP_STUDIO_PRODUCT_IDS=[])
    def test_motion_flag_does_not_disable_existing_pro_webhook(self):
        self.make_pro()
        receipt = WebhookEvent.objects.create(provider="whop", event_type="membership.deactivated", raw_payload=event("membership.deactivated", product={"id": "prod_studio"}, plan={"id": "plan_studio"}))
        process_whop_webhook(receipt)
        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_pro_active)
        # Pro is gone, so Motion is back to the free allowance — not blocked.
        result, status = self.reserve()
        self.assertEqual((status, result["accessPlan"]), (201, "free"))

    def test_motion_does_not_touch_studio_counters(self):
        from apps.usage.models import DailyUsage, MonthlyUsage

        self.reserve()
        self.assertFalse(DailyUsage.objects.exists())
        self.assertFalse(MonthlyUsage.objects.exists())

    def test_api_requires_authentication(self):
        self.assertEqual(self.client.get("/api/motion/entitlements").status_code, 401)
        self.assertEqual(
            self.client.post("/api/usage/motion-run", {}, format="json").status_code,
            401,
        )

    def test_api_validation_and_response(self):
        self.client.force_authenticate(self.user)
        for body in (
            {},
            {"jobId": "bad", "fingerprint": "a"},
            {"jobId": str(uuid.uuid4()), "fingerprint": "a" * 64 + "\n"},
        ):
            self.assertEqual(
                self.client.post(
                    "/api/usage/motion-run", body, format="json"
                ).status_code,
                400,
            )
        response = self.client.post(
            "/api/usage/motion-run",
            {
                "jobId": str(uuid.uuid4()),
                "fingerprint": FINGERPRINT,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["accessPlan"], "free")
        self.assertEqual(response.data["daily"]["remaining"], 2)
        self.assertEqual(response["Cache-Control"], "no-store")
        # Pro reads as unlimited: no limit and nothing remaining to count.
        self.make_pro()
        response = self.client.get("/api/motion/entitlements")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["accessPlan"], "pro")
        self.assertIsNone(response.data["daily"]["limit"])
        self.assertIsNone(response.data["daily"]["remaining"])


class SignatureTests(TestCase):
    def test_legacy_prefixed_secret_and_rotation(self):
        body = b'{"test":true}'
        timestamp = str(int(time.time()))
        key = b"legacy-secret"
        signature = base64.b64encode(
            hmac.new(
                key, f"msg_test.{timestamp}.".encode() + body, hashlib.sha256
            ).digest()
        ).decode()
        headers = {
            "webhook-id": "msg_test",
            "webhook-timestamp": timestamp,
            "webhook-signature": "v1,bad v1," + signature,
        }
        secret = "whsec_" + base64.b64encode(key).decode()
        self.assertTrue(verify_signature(body, headers, secret))
        self.assertFalse(verify_signature(body + b" ", headers, secret))
        self.assertFalse(verify_signature(body, {**headers, "webhook-id": ""}, secret))
        self.assertFalse(verify_signature(body, headers, "whsec_%%%"))
