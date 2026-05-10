from django.contrib import admin
from unfold.admin import ModelAdmin
from .models import SavedExtraction

@admin.register(SavedExtraction)
class SavedExtractionAdmin(ModelAdmin):
    list_display = ("video_name", "user", "created_at")
    list_filter = ("created_at",)
    search_fields = ("video_name", "user__email")
    readonly_fields = ("created_at", "updated_at")
