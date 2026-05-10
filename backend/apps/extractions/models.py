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
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Saved Extraction"
        verbose_name_plural = "Saved Extractions"

    def __str__(self):
        return f"{self.video_name} ({self.user.email})"
