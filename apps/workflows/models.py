"""Published Studio workflow templates.

The extension used to compile its templates in, so adding one meant a rebuild,
a Chrome Web Store review, and waiting for users to update — to change prompt
text and node positions. Templates are declarative data, not code, so they can
be served instead. (MV3 forbids remotely hosted *code*; a JSON config is
explicitly allowed. Nothing in this payload may ever become executable.)

Authoring still happens in the extension repo, in TypeScript, covered by its
tests. `scripts/publish-templates.js` validates and POSTs the result here. This
model is the mailbox, not the editor: one row holding the whole payload, so
there is no schema migration every time a template grows a field, and no
temptation to hand-edit a fourteen-node graph in an admin form.
"""

import hashlib
import json

from django.db import models


class TemplateBundle(models.Model):
    """The current published payload. One row, replaced on each publish.

    History is kept — an older row is how a bad publish gets rolled back
    without needing the publishing machine.
    """

    payload = models.JSONField(
        help_text="The full {schemaVersion, publishedAt, templates[]} document."
    )
    schema_version = models.PositiveIntegerField(default=1)
    etag = models.CharField(max_length=64, db_index=True, editable=False)
    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Only one bundle is served. Untick to roll back to the previous one.",
    )
    published_at = models.DateTimeField(auto_now_add=True)
    published_by = models.CharField(max_length=255, blank=True)
    note = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-published_at"]
        verbose_name = "Template bundle"

    def __str__(self) -> str:
        count = len(self.payload.get("templates", [])) if self.payload else 0
        return f"{count} templates — {self.published_at:%Y-%m-%d %H:%M}"

    def save(self, *args, **kwargs):
        # Content-addressed, so an unchanged republish keeps its ETag and every
        # client's conditional request stays a 304.
        body = json.dumps(self.payload, sort_keys=True, separators=(",", ":"))
        self.etag = hashlib.sha256(body.encode()).hexdigest()[:32]
        self.schema_version = int(self.payload.get("schemaVersion", 1))
        super().save(*args, **kwargs)

    @property
    def template_count(self) -> int:
        return len(self.payload.get("templates", [])) if self.payload else 0

    @classmethod
    def current(cls):
        return cls.objects.filter(is_active=True).first()

    def for_viewer(self, *, is_pro: bool) -> dict:
        """The payload as this viewer may see it.

        Pro templates go out as metadata with empty ``nodes`` and ``edges``
        unless the account is entitled. Sending the graph and hiding it in the
        UI would put the workflow one DevTools call away, which is not gating —
        and these graphs are the product.
        """
        templates = []
        for tpl in self.payload.get("templates", []):
            if tpl.get("tier") == "pro" and not is_pro:
                templates.append(
                    {
                        **{k: v for k, v in tpl.items() if k not in ("nodes", "edges")},
                        "nodes": [],
                        "edges": [],
                        "locked": True,
                    }
                )
            else:
                templates.append(tpl)

        return {**self.payload, "templates": templates}
