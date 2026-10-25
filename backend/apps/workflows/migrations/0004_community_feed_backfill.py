"""Bring the posts made before the feed into it (2026-10-25).

- Every row gets the outline its card's mini map draws.
- Pending rows are published: posting is instant now, and the owner chose to
  publish the queue that was waiting rather than review it.
- An author name that is just the part of the author's email before the @ is
  cleared. Older clients sent exactly that, and a public feed should not print
  it; the card says "Someone" until the author picks a display name, which then
  replaces the name on all of their posts.
"""

from django.db import migrations


def forwards(apps, schema_editor):
    from apps.workflows.community import outline_of

    CommunityTemplate = apps.get_model("workflows", "CommunityTemplate")
    for row in CommunityTemplate.objects.select_related("author").iterator():
        fields = {"outline": outline_of(row.payload)}
        if row.status == "pending":
            fields["status"] = "published"
        local = (getattr(row.author, "email", "") or "").split("@")[0]
        if row.author_name and local and row.author_name.strip().lower() == local.lower():
            fields["author_name"] = ""
        CommunityTemplate.objects.filter(pk=row.pk).update(**fields)


class Migration(migrations.Migration):
    dependencies = [
        ("workflows", "0003_community_feed"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
