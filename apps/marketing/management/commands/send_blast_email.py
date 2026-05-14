"""Send a one-off blast email to all users (or filtered subsets).

This is for sending custom announcements, not the automated sequence.

Usage:
    # Send to all active users:
    python manage.py send_blast_email --template marketing/blast_custom.html --subject "Big News!"

    # Send to marketing subscribers only:
    python manage.py send_blast_email --template marketing/blast_custom.html --subject "Update" --subscribers-only

    # Preview without sending:
    python manage.py send_blast_email --template marketing/blast_custom.html --subject "Test" --dry-run

    # Send to a single email (for testing):
    python manage.py send_blast_email --template marketing/blast_custom.html --subject "Test" --to test@example.com
"""
import logging

from django.conf import settings
from django.template.loader import render_to_string
from django.core.management.base import BaseCommand

from apps.marketing.models import EmailSequenceSubscriber
from apps.users.models import CustomUser

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Send a one-off blast email to all users or subscribers"

    def add_arguments(self, parser):
        parser.add_argument(
            "--template",
            type=str,
            required=True,
            help="Template path, e.g. 'marketing/blast_custom.html'",
        )
        parser.add_argument(
            "--subject",
            type=str,
            required=True,
            help="Email subject line.",
        )
        parser.add_argument(
            "--subscribers-only",
            action="store_true",
            help="Send only to marketing subscribers (not all users).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview recipients without sending.",
        )
        parser.add_argument(
            "--to",
            type=str,
            help="Send to a single email address (for testing).",
        )

    def handle(self, *args, **options):
        import resend

        template = options["template"]
        subject = options["subject"]
        dry_run = options["dry_run"]
        single_to = options.get("to")
        subscribers_only = options["subscribers_only"]

        # Build recipient list
        if single_to:
            recipients = [single_to]
        elif subscribers_only:
            recipients = list(
                EmailSequenceSubscriber.objects.values_list("email", flat=True)
            )
        else:
            recipients = list(
                CustomUser.objects.filter(is_active=True).values_list("email", flat=True)
            )

        total = len(recipients)
        self.stdout.write(f"Recipients: {total}")

        if dry_run:
            for email in recipients[:20]:
                self.stdout.write(f"  → {email}")
            if total > 20:
                self.stdout.write(f"  ... and {total - 20} more")
            self.stdout.write(self.style.WARNING("Dry run — no emails sent."))
            return

        # Setup Resend
        api_key = getattr(settings, "RESEND_API_KEY", "")
        if not api_key:
            self.stderr.write(self.style.ERROR("RESEND_API_KEY not configured!"))
            return

        resend.api_key = api_key
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "AutoFlow <noreply@auto-flow.studio>")
        product_name = getattr(settings, "MARKETING_PRODUCT_NAME", "AutoFlow Pro")
        cta_url = getattr(settings, "MARKETING_CTA_URL", "https://auto-flow.studio/upgrade")

        from datetime import datetime

        sent = 0
        errors = 0

        for email in recipients:
            try:
                html = render_to_string(template, {
                    "product_name": product_name,
                    "cta_url": cta_url,
                    "subscriber_email": email,
                    "year": datetime.now().year,
                })

                resend.Emails.send({
                    "from": from_email,
                    "to": [email],
                    "subject": subject,
                    "html": html,
                })
                sent += 1

                if sent % 10 == 0:
                    self.stdout.write(f"  Sent {sent}/{total}...")

            except Exception as e:
                errors += 1
                logger.error("Failed to send blast to %s: %s", email, e)

        self.stdout.write(
            self.style.SUCCESS(f"Done! Sent: {sent} | Errors: {errors}")
        )
