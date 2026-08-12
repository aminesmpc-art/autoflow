"""Community templates: two new tables, nothing existing touched.

Additive on purpose. No column on TemplateBundle is altered or dropped, so a
process still running the previous release keeps working through the deploy.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("workflows", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="CommunityTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("author_name", models.CharField(blank=True, max_length=120)),
                ("name", models.CharField(max_length=120)),
                ("description", models.CharField(blank=True, max_length=300)),
                ("category", models.CharField(default="Community", max_length=60)),
                ("thumbnail", models.CharField(default="\U0001f9e9", max_length=16)),
                ("node_count", models.PositiveIntegerField(default=0)),
                ("payload", models.JSONField(help_text="The template document the extension loads.")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending review"),
                            ("published", "Published"),
                            ("rejected", "Rejected"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("review_note", models.CharField(blank=True, max_length=300)),
                ("install_count", models.PositiveIntegerField(db_index=True, default=0)),
                ("like_count", models.PositiveIntegerField(db_index=True, default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="community_templates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Community template",
                "ordering": ["-like_count", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="TemplateLike",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "template",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="likes",
                        to="workflows.communitytemplate",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="template_likes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"verbose_name": "Template like"},
        ),
        migrations.AddConstraint(
            model_name="templatelike",
            constraint=models.UniqueConstraint(fields=("template", "user"), name="one_like_per_user"),
        ),
    ]
