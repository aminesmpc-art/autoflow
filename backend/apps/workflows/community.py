"""Community templates — workflows published by users, not by us.

TemplateBundle next door is a mailbox: one row holding the whole official
payload, replaced on each publish. That shape is right for a curated set we
author and ship together, and wrong for this. A marketplace needs a row per
template, because each one has its own author, its own likes, its own install
count and its own moderation state — none of which can live in a blob that is
replaced wholesale every time anything changes.

So this is a separate model rather than a field on that one. The two are
served by different endpoints and the extension merges them, which also means
a broken community submission can never take the official bundle down with it.

Three things this design refuses to do:

1. Trust the payload. A template is a node graph the extension will render and
   run. `validate_template_shape` rejects anything that is not the expected
   document before it is ever stored — the same argument as the bundle's
   validator, for a much less trusted source.

2. Publish on submit. Everything lands as PENDING. Anything reaching every
   user within seconds of a stranger pressing a button is not a feature.

3. Count a like twice. The join table carries a unique constraint rather than
   a bare integer, so a double press is a no-op at the database rather than a
   race in the view.
"""

from django.conf import settings
from django.db import models


def validate_template_shape(payload) -> str:
    """The reason this payload cannot be stored, or an empty string.

    Deliberately shallow. The extension's own validateTemplate is the real
    gate on handles, ports and edges — it lives with the code that renders
    them and cannot drift from it. Repeating that logic in Python is how the
    two stop agreeing. What matters here is that the thing is a template at
    all, and small enough not to be an attack.
    """
    if not isinstance(payload, dict):
        return "The template must be a JSON object."
    for field in ("id", "name", "nodes", "edges"):
        if field not in payload:
            return f'The template is missing "{field}".'
    if not isinstance(payload.get("nodes"), list) or not payload["nodes"]:
        return "The template has no nodes."
    if not isinstance(payload.get("edges"), list):
        return "The template's edges must be a list."
    if len(payload["nodes"]) > 60:
        return "That template has more than 60 nodes."
    # A node graph is text. Anything this large is not one.
    import json

    if len(json.dumps(payload)) > 400_000:
        return "That template is larger than 400 KB."
    return ""


class CommunityTemplate(models.Model):
    """One user-submitted workflow."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        PUBLISHED = "published", "Published"
        REJECTED = "rejected", "Rejected"

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_templates",
    )
    # Denormalised so a list request does not join the user table, and so a
    # deleted account does not blank the credit on everything it shared.
    author_name = models.CharField(max_length=120, blank=True)

    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    category = models.CharField(max_length=60, default="Community")
    thumbnail = models.CharField(max_length=16, default="🧩")
    node_count = models.PositiveIntegerField(default=0)

    payload = models.JSONField(help_text="The template document the extension loads.")

    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    review_note = models.CharField(max_length=300, blank=True)

    install_count = models.PositiveIntegerField(default=0, db_index=True)
    like_count = models.PositiveIntegerField(default=0, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-like_count", "-created_at"]
        verbose_name = "Community template"

    def __str__(self) -> str:
        return f"{self.name} — {self.author_name or self.author_id} ({self.status})"

    def save(self, *args, **kwargs):
        if isinstance(self.payload, dict):
            nodes = self.payload.get("nodes")
            if isinstance(nodes, list):
                self.node_count = len(nodes)
        super().save(*args, **kwargs)

    def as_card(self, liked_by_viewer: bool = False) -> dict:
        """What the extension's gallery needs, and nothing else.

        The payload is left out on purpose: a list of forty templates should
        not carry forty node graphs. The extension fetches one when it opens
        it, which is also where the install is counted.
        """
        return {
            "id": f"community_{self.pk}",
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "thumbnail": self.thumbnail,
            "nodeCount": self.node_count,
            "author": self.author_name or "Someone",
            "likes": self.like_count,
            "installs": self.install_count,
            "liked": liked_by_viewer,
            "community": True,
        }


class TemplateLike(models.Model):
    """One person, one like.

    A unique constraint rather than an integer the view increments: two taps
    on a slow connection are one like, and that has to be true at the database
    or it is not true at all.
    """

    template = models.ForeignKey(
        CommunityTemplate, on_delete=models.CASCADE, related_name="likes"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="template_likes"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["template", "user"], name="one_like_per_user")
        ]
        verbose_name = "Template like"
