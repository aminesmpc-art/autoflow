"""Binance Pay: a month of Pro paid in USDT (2026-11-22)."""
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("plans", "0003_profile_pro_expires_at"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BinancePayment",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("order_id", models.CharField(max_length=64, unique=True)),
                ("amount", models.DecimalField(decimal_places=8, max_digits=12)),
                ("currency", models.CharField(default="USDT", max_length=12)),
                ("paid_at", models.DateTimeField()),
                ("order_type", models.CharField(blank=True, default="", max_length=16)),
                ("payer_binance_id", models.CharField(blank=True, default="", max_length=32)),
                ("pro_until", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="binance_payments", to=settings.AUTH_USER_MODEL)),
            ],
            options={"verbose_name": "Binance payment", "verbose_name_plural": "Binance payments", "ordering": ["-created_at"]},
        ),
    ]
