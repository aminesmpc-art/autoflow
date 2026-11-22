from django.db import models
from django.conf import settings

class SavedExtraction(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_extractions",
        help_text="The user who saved this extraction."
    )
    video_name = models.CharField(max_length=255, help_text="Original filename of the video.")
    video_concept = models.TextField(blank=True, null=True, help_text="Overall concept of the video.")
    voiceover_text = models.TextField(blank=True, null=True, help_text="Extracted voiceover script.")
    character_sheets = models.JSONField(default=list, blank=True, help_text="List of character designs.")
    shots = models.JSONField(default=list, blank=True, help_text="Timeline of shots and prompts.")

    # The one prompt that makes a video like the whole source, as a paragraph
    # and as the fields people edit it in.
    master_prompt = models.TextField(blank=True, default="", help_text="One prompt for the whole video.")
    master_prompt_json = models.JSONField(null=True, blank=True, help_text="The master prompt as structured fields.")
    # Everything else the extractor reports about the whole video — the cast
    # in prose, the frame, the section analysed, its warnings, and the id its
    # shot thumbnails are stored under. One field, so the next addition to the
    # extractor's output does not need a migration to be kept.
    details = models.JSONField(default=dict, blank=True, help_text="Other extraction metadata.")

    # What kind of analysis this is. "prompts" is the extractor; "breakdown"
    # is "why it works", which writes no prompts and keeps its whole answer in
    # `breakdown`. Both are saved here so both appear in history and count
    # toward the same daily allowance.
    KIND_CHOICES = [("prompts", "Prompts"), ("breakdown", "Breakdown")]
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default="prompts", db_index=True)
    breakdown = models.JSONField(null=True, blank=True, help_text="A 'why it works' breakdown.")
    # The extractor job this came from. A saved row whose job was charged by
    # a reservation is not counted toward the allowance a second time.
    job_id = models.CharField(max_length=64, blank=True, default="", db_index=True)

    # Extractions are saved automatically the moment an analysis finishes, so
    # publishing has to be opt-in: the public gallery and the sitemap read this
    # flag, and before it existed every saved extraction — including the
    # transcript of whatever the user uploaded — was served to anyone and
    # submitted to Google for indexing.
    is_public = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Show this extraction in the public prompt gallery.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Saved Extraction"
        verbose_name_plural = "Saved Extractions"

    def __str__(self):
        return f"{self.video_name} ({self.user.email})"


class ExtractionCharge(models.Model):
    """What a job cost, reserved before the extractor does any model work.

    One row per job (the idempotency key is the extractor's job id), so a
    retried reservation never charges twice. A job that fails is refunded
    rather than deleted, which keeps the ledger whole.
    """

    import uuid as _uuid

    id = models.UUIDField(primary_key=True, default=_uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="extraction_charges",
    )
    idempotency_key = models.CharField(max_length=128)
    # Every ten analysed minutes is one; see apps/extractions/services.py.
    units = models.PositiveIntegerField(default=1)
    seconds = models.FloatField(default=0)
    kind = models.CharField(max_length=16, default="prompts")
    refunded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "idempotency_key"),
                name="unique_extraction_charge_per_user_job",
            ),
        ]
        indexes = [models.Index(fields=("user", "created_at"), name="extraction_charge_user_time")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} — {self.idempotency_key}: {self.units}"
