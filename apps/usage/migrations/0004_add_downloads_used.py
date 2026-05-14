"""Add downloads_used field to DailyUsage for server-side download tracking."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("usage", "0003_add_text_full_prompts"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailyusage",
            name="downloads_used",
            field=models.PositiveIntegerField(
                default=0, help_text="Media downloads today"
            ),
        ),
    ]
