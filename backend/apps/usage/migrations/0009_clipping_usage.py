import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("usage", "0008_monthlyusage_studio_runs_used"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="dailyusage",
            name="clipping_jobs_used",
            field=models.PositiveIntegerField(default=0, help_text="Clipping jobs accepted today"),
        ),
        migrations.AlterField(
            model_name="usageevent",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("consume_prompt", "Consume Prompt"),
                    ("queue_started", "Queue Started"),
                    ("queue_finished", "Queue Finished"),
                    ("prompt_failed", "Prompt Failed"),
                    ("download_completed", "Download Completed"),
                    ("run_aborted", "Run Aborted"),
                    ("reward_granted", "Reward Granted"),
                    ("queue_run_lite", "Queue Run (Lite)"),
                    ("queue_run_flow", "Queue Run (Flow)"),
                    ("queue_run_full", "Queue Run (Full)"),
                    ("clipping_job_started", "Clipping Job Started"),
                ],
                db_index=True,
                max_length=50,
            ),
        ),
        migrations.CreateModel(
            name="ClippingUsage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("idempotency_key", models.CharField(max_length=128)),
                ("date", models.DateField(db_index=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="clipping_usages", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="clippingusage",
            constraint=models.UniqueConstraint(fields=("user", "idempotency_key"), name="unique_clipping_charge_per_user_job"),
        ),
        migrations.AddIndex(
            model_name="clippingusage",
            index=models.Index(fields=["user", "date"], name="clip_usage_user_date"),
        ),
    ]
