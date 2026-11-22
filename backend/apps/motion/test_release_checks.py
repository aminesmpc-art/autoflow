from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from apps.motion.models import MotionMembership, MotionRun, MotionWebhookReceipt


@override_settings(
    DEBUG=False,
    WHOP_WEBHOOK_SECRET="ws_private_do_not_print",
    WHOP_MOTION_WEBHOOK_SECRET="",
    WHOP_MOTION_PRODUCT_ID="",
    WHOP_MOTION_PLAN_ID="",
    WHOP_STUDIO_PRODUCT_IDS=[],
    MOTION_BILLING_ENABLED=False,
    CORS_ALLOWED_ORIGINS=["chrome-extension://" + "a" * 32],
)
class ReleaseCheckTests(TestCase):
    def check_release(self, **options):
        output = StringIO()
        call_command("check_motion_release", stdout=output, **options)
        return output.getvalue()

    def test_sqlite_is_not_accepted_as_production(self):
        with self.assertRaisesMessage(CommandError, "prerequisites failed"):
            self.check_release()

    def test_passes_pre_enable_check_without_writes_or_secret_values(self):
        with patch.object(connection, "vendor", "postgresql"), CaptureQueriesContext(connection) as queries:
            output = self.check_release(extension_id="a" * 32)
        self.assertIn("prerequisites passed", output)
        for secret in ("ws_private_do_not_print", "prod_motion", "plan_motion", "prod_studio"):
            self.assertNotIn(secret, output)
        self.assertFalse(any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "CREATE", "ALTER")) for q in queries))
        for model in (MotionMembership, MotionRun, MotionWebhookReceipt):
            self.assertEqual(model.objects.count(), 0)

    def test_disabled_admission_blocks_final_release_check(self):
        with patch.object(connection, "vendor", "postgresql"), self.assertRaises(CommandError):
            self.check_release(require_enabled=True)

    @override_settings(MOTION_BILLING_ENABLED=True)
    def test_enabled_final_check_and_exact_extension_origin(self):
        with patch.object(connection, "vendor", "postgresql"):
            self.assertIn("prerequisites passed", self.check_release(require_enabled=True, extension_id="a" * 32))
            with self.assertRaises(CommandError):
                self.check_release(require_enabled=True, extension_id="b" * 32)

    @override_settings(WHOP_WEBHOOK_SECRET="")
    def test_existing_pro_webhook_must_be_configured(self):
        with patch.object(connection, "vendor", "postgresql"), self.assertRaises(CommandError):
            self.check_release()

    def test_missing_table_fails(self):
        with patch.object(connection, "vendor", "postgresql"), patch.object(connection.introspection, "table_names", return_value=[]), self.assertRaises(CommandError):
            self.check_release()
