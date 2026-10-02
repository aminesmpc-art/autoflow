"""Read-only deployment checks. Never outputs settings values or customer data."""

import re

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection
from django.db.migrations.recorder import MigrationRecorder
from django.urls import resolve

from apps.motion.models import MotionMembership, MotionRun, MotionWebhookReceipt
from apps.motion.views import MotionEntitlementView, MotionRunView


class Command(BaseCommand):
    help = "Check Motion deployment prerequisites without changing records or exposing secrets."

    def add_arguments(self, parser):
        parser.add_argument("--extension-id", help="Production Chrome Web Store extension ID.")
        parser.add_argument("--require-enabled", action="store_true")

    def handle(self, *args, **options):
        failures = []

        def check(ok, label):
            self.stdout.write(f"[{'OK' if ok else 'FAIL'}] {label}")
            if not ok:
                failures.append(label)

        check(not settings.DEBUG, "DEBUG disabled")
        check(connection.vendor == "postgresql", "PostgreSQL for atomic job admission")
        check(bool(settings.WHOP_WEBHOOK_SECRET), "Existing Pro webhook secret configured")
        self.stdout.write("[INFO] Motion uses existing Pro; no separate Motion product or webhook is required")
        if options["require_enabled"]:
            check(settings.MOTION_BILLING_ENABLED, "Motion billing enabled")
        else:
            self.stdout.write("[INFO] Billing switch is " + ("enabled" if settings.MOTION_BILLING_ENABLED else "disabled"))
        extension_id = options.get("extension_id")
        if extension_id:
            valid = bool(re.fullmatch(r"[a-p]{32}", extension_id))
            check(valid, "Valid store extension ID")
            check(valid and f"chrome-extension://{extension_id}" in settings.CORS_ALLOWED_ORIGINS,
                  "Exact Motion extension origin is allowed")
        else:
            self.stdout.write("[WARN] Extension origin not checked; pass --extension-id before release")
        for path, view in (
            ("/api/motion/entitlements", MotionEntitlementView),
            ("/api/usage/motion-run", MotionRunView),
        ):
            try:
                ok = resolve(path).func.view_class is view
            except (AttributeError, LookupError):
                ok = False
            check(ok, f"Route installed: {path}")
        try:
            tables = set(connection.introspection.table_names())
            for model in (MotionMembership, MotionRun, MotionWebhookReceipt):
                check(model._meta.db_table in tables, f"{model.__name__} table exists")
            applied = MigrationRecorder(connection).applied_migrations()
            check(("motion", "0001_initial") in applied, "Motion initial migration recorded")
        except DatabaseError:
            check(False, "Database readable (connection details suppressed)")
        if failures:
            raise CommandError(f"{len(failures)} prerequisites failed. No settings or records were changed.")
        self.stdout.write("[OK] Checked prerequisites passed. This is NOT an end-to-end payment, OAuth or provider test.")
