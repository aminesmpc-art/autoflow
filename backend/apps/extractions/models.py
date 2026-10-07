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
