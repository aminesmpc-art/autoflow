"""Rescue payments that stranded because the buyer never registered.

Before auto-provisioning existed, a Whop webhook whose email matched no
account was parked unprocessed and nothing was said to anyone. Those events
are still sitting there. This re-runs them through process_whop_webhook(),
which now builds the account, applies Pro, and emails the buyer a code.

Dry run by default. Pass --apply to actually create accounts and send email.
"""
from django.core.management.base import BaseCommand

from apps.plans.models import Profile
from apps.users.models import CustomUser
from apps.webhooks.models import WebhookEvent
from apps.webhooks.services import (
    ACTIVATION_EVENTS,
    _extract_whop_payload,
    process_whop_webhook,
)

PURCHASE_EVENTS = tuple(ACTIVATION_EVENTS) + ("payment.succeeded",)


class Command(BaseCommand):
    help = "Provision accounts for parked Whop payments whose buyer never registered."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually create accounts and send email. Without this, only reports.",
        )
        parser.add_argument(
            "--email",
            help="Limit to a single buyer's email address.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        only_email = (options.get("email") or "").lower().strip()

        parked = WebhookEvent.objects.filter(
            provider="whop",
            processed=False,
            linked_user__isnull=True,
        ).order_by("created_at")

        # Group by buyer so one account is reported once, not once per webhook.
        by_email = {}
        skipped_non_purchase = 0
        skipped_no_email = 0

        for event in parked:
            email = _extract_whop_payload(event.raw_payload)["email"]
            if not email:
                skipped_no_email += 1
                continue
            if only_email and email != only_email:
                continue
            if event.event_type not in PURCHASE_EVENTS:
                skipped_non_purchase += 1
                continue
            by_email.setdefault(email, []).append(event)

        if not by_email:
            self.stdout.write(self.style.SUCCESS("No parked payments to rescue."))
            self._report_skips(skipped_non_purchase, skipped_no_email)
            return

        mode = "APPLYING" if apply_changes else "DRY RUN — nothing will change"
        self.stdout.write(self.style.WARNING(f"{mode}\n"))

        rescued = 0
        for email, events in sorted(by_email.items()):
            has_account = CustomUser.objects.filter(email__iexact=email).exists()
            note = "account exists, just needs linking" if has_account else "NEW account will be created"
            self.stdout.write(
                f"  {email}\n"
                f"    {len(events)} parked event(s): "
                f"{', '.join(sorted({e.event_type for e in events}))}\n"
                f"    oldest: {events[0].created_at:%Y-%m-%d %H:%M}\n"
                f"    -> {note}"
            )

            if not apply_changes:
                continue

            for event in events:
                process_whop_webhook(event)

            event_ids = [e.id for e in events]
            still_parked = WebhookEvent.objects.filter(id__in=event_ids, processed=False).count()
            user = CustomUser.objects.filter(email__iexact=email).first()
            # user.profile raises when the row is missing, so query it instead.
            is_pro = bool(
                user
                and Profile.objects.filter(user=user, is_pro_active=True).exists()
            )

            if still_parked:
                self.stdout.write(self.style.ERROR(
                    f"    FAILED — {still_parked} event(s) still parked"
                ))
            else:
                rescued += 1
                self.stdout.write(self.style.SUCCESS(
                    f"    done — pro_active={is_pro}, welcome email sent"
                ))

        self.stdout.write("")
        if apply_changes:
            self.stdout.write(self.style.SUCCESS(f"Rescued {rescued}/{len(by_email)} buyer(s)."))
        else:
            self.stdout.write(
                f"{len(by_email)} buyer(s) would be rescued. Re-run with --apply to do it."
            )
        self._report_skips(skipped_non_purchase, skipped_no_email)

    def _report_skips(self, non_purchase: int, no_email: int):
        if non_purchase:
            self.stdout.write(
                f"Skipped {non_purchase} parked event(s) that aren't purchases "
                f"(no account should be created for those)."
            )
        if no_email:
            self.stdout.write(
                f"Skipped {no_email} parked event(s) with no email in the payload."
            )
