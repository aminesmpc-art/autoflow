"""Import all existing registered users into the marketing email sequence.

Usage:
    # Preview which users would be imported (dry run):
    python manage.py import_users_to_marketing --dry-run

    # Import all users and send them Email 1:
    python manage.py import_users_to_marketing

    # Import without sending Email 1 (just create subscriber entries):
    python manage.py import_users_to_marketing --no-send
"""
from django.core.management.base import BaseCommand

from apps.marketing.models import EmailSequenceSubscriber
from apps.marketing.services import send_marketing_email
from apps.users.models import CustomUser


class Command(BaseCommand):
    help = "Import all existing users into the marketing email sequence"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview which users would be imported without making changes.",
        )
        parser.add_argument(
            "--no-send",
            action="store_true",
            help="Create subscriber entries but don't send Email 1.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        no_send = options["no_send"]

        # Get all active users who are NOT already subscribers
        existing_emails = set(
            EmailSequenceSubscriber.objects.values_list("email", flat=True)
        )
        users = CustomUser.objects.filter(is_active=True).exclude(
            email__in=existing_emails
        )

        total = users.count()
        self.stdout.write(f"Found {total} users not yet in the marketing sequence.")

        if dry_run:
            for user in users[:20]:  # Show first 20
                self.stdout.write(f"  → {user.email}")
            if total > 20:
                self.stdout.write(f"  ... and {total - 20} more")
            self.stdout.write(self.style.WARNING("Dry run — no changes made."))
            return

        created = 0
        sent = 0
        errors = 0

        for user in users:
            try:
                subscriber = EmailSequenceSubscriber.objects.create(
                    email=user.email,
                    source="manual",
                )
                created += 1

                if not no_send:
                    success = send_marketing_email(subscriber, 1)
                    if success:
                        sent += 1
                    else:
                        errors += 1

            except Exception as e:
                self.stderr.write(f"Error for {user.email}: {e}")
                errors += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done! Created: {created} | Emails sent: {sent} | Errors: {errors}"
            )
        )
