from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("usage", "0007_add_full_runs_today"),
    ]

    operations = [
        migrations.AddField(
            model_name="monthlyusage",
            name="studio_runs_used",
            field=models.PositiveIntegerField(
                default=0, help_text="Studio workflow runs this month"
            ),
        ),
    ]
