from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import TemplateBundle


@admin.register(TemplateBundle)
class TemplateBundleAdmin(ModelAdmin):
    """Read-mostly. Bundles arrive from the publish script, not from here.

    The one thing worth doing by hand is unticking `is_active` on a bad
    publish — that rolls back to the previous bundle without needing the
    machine that published it.
    """

    list_display = ("published_at", "template_count", "schema_version", "is_active", "published_by", "note")
    list_filter = ("is_active", "schema_version")
    readonly_fields = ("etag", "published_at", "schema_version", "template_count")
    search_fields = ("note", "published_by")
