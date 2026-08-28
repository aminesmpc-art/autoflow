"""Tests for auto-provisioning accounts from Whop payments.

Covers the case that stranded two paying customers: money arrives for an email
that has no AutoFlow account.
"""
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from apps.plans.models import Profile
from apps.users.models import CustomUser, PasswordResetToken
from apps.users.services import confirm_password_reset, request_password_reset
from apps.webhooks.models import WebhookEvent
from apps.webhooks.services import process_whop_webhook

BUYER = "newbuyer@example.com"


def make_event(event_type, email, membership_id="mem_abc123"):
    return WebhookEvent.objects.create(
        provider="whop",
        event_type=event_type,
        raw_payload={
            "data": {
                "id": membership_id,
                "user_email": email,
                "user_id": "user_whop_1",
                "total": "10.00",
            }
        },
    )


@patch("apps.users.services.send_paid_account_ready_email")
class ProvisionPaidCustomerTests(TestCase):
    def test_purchase_for_unknown_email_creates_active_pro_account(self, mock_email):
        event = make_event("membership.activated", BUYER)

        process_whop_webhook(event)

        user = CustomUser.objects.get(email=BUYER)
        self.assertTrue(user.is_active, "buyer must be able to log in without a verification click")

        profile = Profile.objects.get(user=user)
        self.assertTrue(profile.is_pro_active)
        self.assertEqual(profile.plan_type, "pro")
        self.assertEqual(profile.whop_membership_id, "mem_abc123")

        event.refresh_from_db()
        self.assertTrue(event.processed)
        self.assertEqual(event.linked_user_id, user.id)

        self.assertEqual(mock_email.call_count, 1, "buyer must be told the account exists")

    def test_profile_is_created_so_pro_actually_applies(self, mock_email):
        """sync_profile_plan is a .filter().update() — it no-ops without a Profile."""
        process_whop_webhook(make_event("membership.activated", BUYER))

        user = CustomUser.objects.get(email=BUYER)
        self.assertTrue(Profile.objects.filter(user=user).exists())
        self.assertTrue(Profile.objects.get(user=user).is_pro_active)

    def test_second_webhook_for_same_purchase_is_idempotent(self, mock_email):
        process_whop_webhook(make_event("membership.activated", BUYER))
        process_whop_webhook(make_event("payment.succeeded", BUYER))

        self.assertEqual(CustomUser.objects.filter(email=BUYER).count(), 1)
        self.assertEqual(
            mock_email.call_count, 1,
            "welcome email must not be resent for every webhook of one purchase",
        )

    def test_provisioned_buyer_can_set_a_password(self, mock_email):
        """The reason we set a usable password instead of set_unusable_password().

        request_password_reset() refuses accounts without a usable password, so
        an unusable one would leave the buyer permanently locked out.
        """
        process_whop_webhook(make_event("membership.activated", BUYER))

        ok, msg = request_password_reset(BUYER)
        self.assertTrue(ok, f"buyer must be able to request a password: {msg}")
        self.assertNotIn("Google", msg)

        code = PasswordResetToken.objects.filter(user__email=BUYER).latest("created_at").code
        ok, msg = confirm_password_reset(BUYER, code, "a-real-password-123")
        self.assertTrue(ok, msg)

        user = CustomUser.objects.get(email=BUYER)
        self.assertTrue(user.check_password("a-real-password-123"))

    def test_setup_code_is_issued_on_provision(self, mock_email):
        process_whop_webhook(make_event("membership.activated", BUYER))
        self.assertTrue(PasswordResetToken.objects.filter(user__email=BUYER).exists())

    def test_cancellation_for_unknown_email_creates_nothing(self, mock_email):
        """No money arrived, so there is nothing to provision an account for."""
        event = make_event("membership.went_invalid", BUYER)

        process_whop_webhook(event)

        self.assertFalse(CustomUser.objects.filter(email=BUYER).exists())
        event.refresh_from_db()
        self.assertFalse(event.processed, "should stay parked for auto-linking")
        mock_email.assert_not_called()

    def test_existing_user_is_linked_without_being_recreated(self, mock_email):
        user = CustomUser.objects.create_user(email=BUYER, password="x", is_active=True)
        Profile.objects.create(user=user)

        event = make_event("membership.activated", BUYER)
        process_whop_webhook(event)

        self.assertEqual(CustomUser.objects.filter(email=BUYER).count(), 1)
        self.assertTrue(Profile.objects.get(user=user).is_pro_active)
        event.refresh_from_db()
        self.assertEqual(event.linked_user_id, user.id)
        mock_email.assert_not_called()

    def test_provisioning_failure_leaves_the_payment_parked(self, mock_email):
        """A failure here must never silently swallow a payment."""
        event = make_event("membership.activated", BUYER)

        with patch(
            "apps.users.services.provision_paid_user",
            side_effect=RuntimeError("db exploded"),
        ):
            process_whop_webhook(event)

        event.refresh_from_db()
        self.assertFalse(event.processed, "must remain parked so it can be retried")
        self.assertIsNone(event.linked_user_id)

    def test_email_casing_does_not_create_a_duplicate(self, mock_email):
        process_whop_webhook(make_event("membership.activated", BUYER))
        process_whop_webhook(make_event("payment.succeeded", BUYER.upper()))

        self.assertEqual(CustomUser.objects.filter(email__iexact=BUYER).count(), 1)


@patch("apps.users.services.send_paid_account_ready_email")
class ProvisionParkedPaymentsCommandTests(TestCase):
    """The backlog rescue for payments that stranded before provisioning existed."""

    def setUp(self):
        # A parked purchase, exactly as the two stranded customers look in prod.
        self.parked = make_event("membership.activated", BUYER)
        self.parked.processed = False
        self.parked.linked_user = None
        self.parked.save()

    def _run(self, *args):
        out = StringIO()
        call_command("provision_parked_payments", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_reports_but_changes_nothing(self, mock_email):
        output = self._run()

        self.assertIn(BUYER, output)
        self.assertIn("DRY RUN", output)
        self.assertIn("NEW account will be created", output)
        self.assertFalse(CustomUser.objects.filter(email=BUYER).exists())
        self.parked.refresh_from_db()
        self.assertFalse(self.parked.processed)
        mock_email.assert_not_called()

    def test_apply_rescues_the_buyer(self, mock_email):
        output = self._run("--apply")

        user = CustomUser.objects.get(email=BUYER)
        self.assertTrue(Profile.objects.get(user=user).is_pro_active)
        self.parked.refresh_from_db()
        self.assertTrue(self.parked.processed)
        self.assertEqual(self.parked.linked_user_id, user.id)
        self.assertIn("pro_active=True", output)
        self.assertEqual(mock_email.call_count, 1)

    def test_email_filter_skips_other_buyers(self, mock_email):
        make_event("membership.activated", "someone.else@example.com")

        self._run("--apply", "--email", BUYER)

        self.assertTrue(CustomUser.objects.filter(email=BUYER).exists())
        self.assertFalse(CustomUser.objects.filter(email="someone.else@example.com").exists())

    def test_cancellations_are_not_rescued(self, mock_email):
        self.parked.delete()
        make_event("membership.went_invalid", BUYER)

        output = self._run("--apply")

        self.assertFalse(CustomUser.objects.filter(email=BUYER).exists())
        self.assertIn("aren't purchases", output)
