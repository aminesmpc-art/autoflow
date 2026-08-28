"""Retroactively make already-published extractions private.

Publishing became opt-in, but rows created before that were left public so the
/prompts gallery and the sitemap kept working. Whether to unpublish them is a
judgement call — it protects work whose owners were never asked, and it drops
URLs Google has already indexed. This does it when you decide to.

Dry run by default. Pass --apply to actually change rows.
"""
from django.core.management.base import BaseCommand

from apps.extractions.models import SavedExtraction


class Command(BaseCommand):
    help = "Make previously auto-published extractions private."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually unpublish. Without this, only reports.",
        )
        parser.add_argument(
            "--before",
            help="Only rows created before this date (YYYY-MM-DD). "
                 "Use it to spare anything published deliberately since the change.",
        )

    def handle(self, *args, **options):
        qs = SavedExtraction.objects.filter(is_public=True)

        if options.get("before"):
            from django.utils.dateparse import parse_date

            cutoff = parse_date(options["before"])
            if not cutoff:
                self.stderr.write(self.style.ERROR("--before must be YYYY-MM-DD"))
                return
            qs = qs.filter(created_at__date__lt=cutoff)

        total = qs.count()
        if not total:
            self.stdout.write(self.style.SUCCESS("Nothing public to unpublish."))
            return

        owners = qs.values("user__email").distinct().count()
        self.stdout.write(
            f"{total} public extraction(s) across {owners} owner(s).\n"
            f"The public gallery and sitemap will drop these URLs."
        )

        if not options["apply"]:
            self.stdout.write("\nDRY RUN — re-run with --apply to unpublish.")
            return

        updated = qs.update(is_public=False)
        self.stdout.write(self.style.SUCCESS(f"\nUnpublished {updated} extraction(s)."))
        remaining = SavedExtraction.objects.filter(is_public=True).count()
        self.stdout.write(f"{remaining} extraction(s) still public.")
