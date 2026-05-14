"""Management command to send pending marketing follow-up emails.

Run this on a cron schedule (recommended: every hour):

    python manage.py send_marketing_emails

Or with verbose output:

    python manage.py send_marketing_emails --verbosity=2

What it does:
    1. Finds subscribers who received Email 1 but haven't taken action
    2. Checks if enough time has passed (3 days for Email 2, 7 days for Email 3)
    3. Sends the appropriate follow-up email
    4. Prints a summary of what was sent
"""
from django.core.management.base import BaseCommand

from apps.marketing.services import process_pending_reminders


class Command(BaseCommand):
    help = "Send pending marketing follow-up emails (Email 2 at 3 days, Email 3 at 7 days)"

    def handle(self, *args, **options):
        verbosity = options.get("verbosity", 1)

        if verbosity >= 1:
            self.stdout.write("Scanning for pending marketing emails...")

        stats = process_pending_reminders()

        if verbosity >= 1:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Done! Scanned: {stats['scanned']} | "
                    f"Email 2 sent: {stats['email_2_sent']} | "
                    f"Email 3 sent: {stats['email_3_sent']} | "
                    f"Skipped: {stats['skipped']} | "
                    f"Errors: {stats['errors']}"
                )
            )

        if stats["errors"] > 0:
            self.stderr.write(
                self.style.ERROR(
                    f"{stats['errors']} email(s) failed — check logs for details."
                )
            )
