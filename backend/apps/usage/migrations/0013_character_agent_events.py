"""Event types for characters and AI agents (2026-11-22). Choices only: no SQL."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("usage", "0012_agent_runs"),
    ]

    operations = [
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
                    ("queue_run_agent", "Queue Run (Agent)"),
                    ("clipping_job_started", "Clipping Job Started"),
                    ("prompt_submitted", "Prompt Submitted to Flow"),
                    ("prompt_done", "Prompt Done"),
                    ("prompt_retried", "Prompt Sent Again"),
                    ("character_made", "Character Made"),
                    ("character_deleted", "Character Deleted"),
                    ("agent_connected", "AI Agent Connected"),
                ],
                db_index=True,
                max_length=50,
            ),
        ),
    ]
