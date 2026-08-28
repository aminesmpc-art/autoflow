"""Initial TemplateBundle.

Hand-written: django-unfold is in requirements.txt but not installed in the
authoring environment, so makemigrations could not run there. Verify with
`python manage.py makemigrations workflows --check --dry-run` on a machine
with the dependencies installed — it should report no changes.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="TemplateBundle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "payload",
                    models.JSONField(
                        help_text="The full {schemaVersion, publishedAt, templates[]} document."
                    ),
                ),
                ("schema_version", models.PositiveIntegerField(default=1)),
                ("etag", models.CharField(db_index=True, editable=False, max_length=64)),
                (
                    "is_active",
                    models.BooleanField(
                        db_index=True,
                        default=True,
                        help_text="Only one bundle is served. Untick to roll back to the previous one.",
                    ),
                ),
                ("published_at", models.DateTimeField(auto_now_add=True)),
                ("published_by", models.CharField(blank=True, max_length=255)),
                ("note", models.CharField(blank=True, max_length=500)),
            ],
            options={
                "verbose_name": "Template bundle",
                "ordering": ["-published_at"],
            },
        ),
    ]
