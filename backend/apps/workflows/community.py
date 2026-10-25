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

2. Publish on submit. Everything landed as PENDING — until the owner chose,
   on 2026-10-25, a feed "like Facebook": a post goes live at once, and the
   people reading it police it. Three reports from three different accounts
   take it down automatically (HIDDEN) until an admin looks; a person who
   should not post can be stopped (CommunityMember.can_post). PENDING stays
   for rows from before that choice.

3. Count a like twice. The join table carries a unique constraint rather than
   a bare integer, so a double press is a no-op at the database rather than a
   race in the view.
"""

import re

from django.conf import settings
from django.db import models

# Reports from this many different people hide a post until an admin decides.
AUTO_HIDE_REPORTS = 3


def _coord(value) -> int:
    try:
        return max(-100_000, min(100_000, int(round(float(value)))))
    except (TypeError, ValueError):
        return 0


def outline_of(payload) -> dict:
    """The few fields a feed card's mini map draws, taken once at save.

    The list endpoint does not send payloads — forty graphs for forty cards is
    the cost that rule exists to avoid — so the card needs its own small
    picture of the workflow: each node's kind, label, platform and place on the
    canvas, and which node feeds which. Nothing here is executable or needed to
    run the workflow; the graph itself still comes with the detail request.
    """
    nodes = payload.get("nodes") if isinstance(payload, dict) else None
    if not isinstance(nodes, list):
        return {"nodes": [], "edges": []}
    index: dict = {}
    out = []
    for node in nodes[:60]:
        if not isinstance(node, dict):
            continue
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        pos = node.get("position") if isinstance(node.get("position"), dict) else {}
        index[str(node.get("id", ""))] = len(out)
        out.append({
            "type": str(node.get("type") or data.get("type") or "node")[:24],
            "label": str(data.get("label") or "")[:40],
            "platform": str(data.get("platform") or "")[:16],
            "media": str(data.get("mediaType") or "")[:8],
            "x": _coord(pos.get("x")),
            "y": _coord(pos.get("y")),
        })
    edges = []
    for edge in payload.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        source, target = index.get(str(edge.get("source"))), index.get(str(edge.get("target")))
        if source is not None and target is not None and source != target and [source, target] not in edges:
            edges.append([source, target])
    return {"nodes": out, "edges": edges[:200]}


def clean_display_name(raw) -> tuple:
    """(name, problem). The name every post shows, chosen by its author.

    Posts used to show the part of the email address before the @, which is
    not something a public feed should print. A display name with an @ in it
    would bring that back, and one with a link turns every post into an ad.
    """
    name = " ".join(str(raw or "").split())[:40]
    if len(name) < 2:
        return "", "Choose a display name of at least 2 characters."
    if "@" in name:
        return "", "A display name cannot contain @."
    if re.search(r"https?://|www\.|\.(com|net|org|io|gg|ly)\b", name, re.I):
        return "", "A display name cannot be a link."
    return name, ""


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
        HIDDEN = "hidden", "Hidden — reported, waiting for review"
        REJECTED = "rejected", "Removed"

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_templates",
    )
    # Denormalised so a list request does not join the user table, and so a
    # deleted account does not blank the credit on everything it shared.
    author_name = models.CharField(max_length=120, blank=True)

    name = models.CharField(max_length=120)
    # The post's caption. 300 was a card subtitle; a post says more.
    description = models.CharField(max_length=1000, blank=True)
    category = models.CharField(max_length=60, default="Community")
    thumbnail = models.CharField(max_length=16, default="🧩")
    node_count = models.PositiveIntegerField(default=0)

    payload = models.JSONField(help_text="The template document the extension loads.")
    outline = models.JSONField(default=dict, blank=True, help_text="What the feed's mini map draws (outline_of).")

    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PUBLISHED, db_index=True
    )
    review_note = models.CharField(max_length=300, blank=True)

    install_count = models.PositiveIntegerField(default=0, db_index=True)
    like_count = models.PositiveIntegerField(default=0, db_index=True)
    # Open reports — dismissed ones are not counted, so a post an admin has
    # restored needs three NEW reports to come down again.
    report_count = models.PositiveIntegerField(default=0, db_index=True)

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
            self.outline = outline_of(self.payload)
        super().save(*args, **kwargs)

    def as_card(self, liked_by_viewer: bool = False, mine: bool = False) -> dict:
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
            "outline": self.outline or {"nodes": [], "edges": []},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "mine": mine,
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


class CommunityMember(models.Model):
    """A person as the feed knows them: the name their posts show, and whether
    they may post at all. Kept here rather than on the user model, because it
    is the feed's business and nothing else reads it."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="community_member"
    )
    display_name = models.CharField(max_length=40, blank=True)
    can_post = models.BooleanField(
        default=True, help_text="Untick to stop this person posting. Their existing posts stay as they are."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Community member"

    def __str__(self) -> str:
        return self.display_name or str(self.user_id)


class CommunityReport(models.Model):
    """One person reporting one post, once.

    Unique per (post, person) at the database, for the same reason likes are:
    three reports have to mean three people, or one angry account could take
    anything down by pressing the button three times.
    """

    class Reason(models.TextChoices):
        SEXUAL = "sexual", "Sexual content"
        VIOLENCE = "violence", "Violence or hate"
        SPAM = "spam", "Spam or scam"
        STOLEN = "stolen", "Stolen work"
        OTHER = "other", "Something else"

    template = models.ForeignKey(CommunityTemplate, on_delete=models.CASCADE, related_name="reports")
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="template_reports"
    )
    reason = models.CharField(max_length=16, choices=Reason.choices, default=Reason.OTHER)
    note = models.CharField(max_length=300, blank=True)
    # Set when an admin restores the post, so these stop counting toward the
    # next automatic hide.
    dismissed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["template", "reporter"], name="one_report_per_user")
        ]
        verbose_name = "Community report"

    def __str__(self) -> str:
        return f"{self.get_reason_display()} — {self.template_id}"
