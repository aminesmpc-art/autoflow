"""Marketing email sequence models."""
import uuid

from django.db import models


class EmailSequenceSubscriber(models.Model):
    """Tracks a user who opted into the marketing email sequence.

    Separate from CustomUser so marketing data stays isolated from auth,
    and non-registered visitors can subscribe in the future.
    """

    SOURCE_CHOICES = [
        ("extension", "Chrome Extension"),
        ("website", "Website"),
        ("manual", "Manual / Admin"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, db_index=True)
    action_taken = models.BooleanField(
        default=False,
        help_text="True when the user clicked the CTA or purchased.",
    )

    # Sequence progress
    emails_sent = models.PositiveSmallIntegerField(
        default=0,
        help_text="Number of emails sent so far (0–3).",
    )
    last_email_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp of the most recent email in the sequence.",
    )
    sequence_completed = models.BooleanField(
        default=False,
        help_text="True when all 3 emails have been sent or user took action.",
    )

    # Click-tracking token (used in CTA redirect URL)
    tracking_token = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        db_index=True,
        help_text="Unique token embedded in CTA links for click tracking.",
    )

    # Metadata
    source = models.CharField(
        max_length=50,
        choices=SOURCE_CHOICES,
        default="extension",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Email Subscriber"
        verbose_name_plural = "Email Subscribers"

    def __str__(self):
        status = "✅ acted" if self.action_taken else f"📧 {self.emails_sent}/3"
        return f"{self.email} ({status})"
