"""Publish a template bundle from a file on the server.

    python manage.py publish_templates
    python manage.py publish_templates --file path/to/templates.json

The third way to publish, and the one that needs no credential of any kind.

- The admin upload form is the everyday route: you are already signed in, and
  nothing has to be stored anywhere.
- The token endpoint exists for CI, and is off unless TEMPLATE_PUBLISH_TOKEN
  is set.
- This runs on the server itself, over an already-authenticated Railway
  session. No password to type, no token to create, nothing to leak. It is
  also what makes the very first publish possible before anyone has logged in
  to the admin at all.

The file is produced by `npm run templates:export` in studio-extension, where
it has already been validated against the same rules the extension applies
when it loads a template. The checks here are the ones that matter on this
side: right shape, and not empty.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.workflows.models import TemplateBundle

DEFAULT_FILE = Path("apps/workflows/fixtures/templates.json")


class Command(BaseCommand):
    help = "Publish a workflow template bundle from a JSON file."

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default=str(DEFAULT_FILE),
            help=f"Path to templates.json (default: {DEFAULT_FILE})",
        )
        parser.add_argument(
            "--note",
            default="",
            help="Shows in the admin list, so a bad publish is easy to find and roll back.",
        )
        parser.add_argument(
            "--by",
            default="manage.py",
            help="Who published this.",
        )

    def handle(self, *args, **options):
        path = Path(options["file"])
        if not path.exists():
            raise CommandError(f"{path} does not exist. Run `npm run templates:export` first.")

        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise CommandError(f"{path} is not valid JSON: {exc}")

        if not isinstance(payload, dict) or not isinstance(payload.get("templates"), list):
            raise CommandError('Expected {"schemaVersion": 1, "templates": [...]}')

        templates = payload["templates"]
        if not templates:
            # An empty publish blanks every gallery on the next fetch. To
            # withdraw everything, untick is_active in the admin — reversible,
            # and obviously deliberate.
            raise CommandError("That file has no templates in it. Refusing to publish an empty bundle.")

        broken = [
            t.get("id", "(no id)")
            for t in templates
            if not t.get("id") or not isinstance(t.get("nodes"), list) or not isinstance(t.get("edges"), list)
        ]
        if broken:
            raise CommandError(f"Templates missing id, nodes or edges: {', '.join(broken[:5])}")

        previous = TemplateBundle.current()
        bundle = TemplateBundle(
            payload=payload,
            published_by=options["by"],
            note=options["note"],
        )
        bundle.save()

        if previous and previous.etag == bundle.etag:
            # Identical content. Keeping the older row active leaves its ETag
            # stable, so every extension's revalidation stays a 304 rather than
            # re-downloading a bundle it already holds.
            bundle.is_active = False
            bundle.save(update_fields=["is_active"])
            self.stdout.write(
                self.style.WARNING(
                    f"No change — the {previous.template_count} templates already published are identical."
                )
            )
            return

        TemplateBundle.objects.exclude(pk=bundle.pk).filter(is_active=True).update(is_active=False)
        self.stdout.write(
            self.style.SUCCESS(
                f"Published {bundle.template_count} templates (etag {bundle.etag}). "
                "Extensions pick them up the next time Studio opens."
            )
        )
