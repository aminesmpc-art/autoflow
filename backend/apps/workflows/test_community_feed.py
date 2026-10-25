"""The community feed "like Facebook" (2026-10-25): instant posts, display
names, paging, delete, reports that hide a post after three people, and the
backfill of the posts made before it.

Run on SQLite by default and on a disposable PostgreSQL with
config.settings.test_motion_postgres — the like endpoint once passed here and
failed live on Postgres, and the report view has the same savepoint shape.
"""

import importlib
from datetime import timedelta

from django.apps import apps as django_apps
from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.test import RequestFactory, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.users.models import CustomUser
from apps.workflows.admin import CommunityTemplateAdmin
from apps.workflows.community import (
    AUTO_HIDE_REPORTS,
    CommunityMember,
    CommunityReport,
    CommunityTemplate,
    clean_display_name,
    outline_of,
)
from apps.workflows.community_views import POSTS_PER_DAY

WORKFLOW = {
    "id": "wf", "name": "Dance swap", "description": "", "category": "Video",
    "nodes": [
        {"id": "a", "type": "prompt", "position": {"x": 0, "y": 10.6}, "data": {"label": "Idea"}},
        {"id": "b", "type": "generate", "position": {"x": 300, "y": 0},
         "data": {"label": "Clip", "platform": "flow", "mediaType": "video"}},
    ],
    "edges": [{"id": "e1", "source": "a", "target": "b"}, {"id": "e2", "source": "a", "target": "gone"}],
}


def user(email, active=True, staff=False):
    return CustomUser.objects.create_user(email=email, password="x", is_active=active, is_staff=staff)


class Feed(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.alice = user("alice.smith@example.com")
        self.bob = user("bob@example.com")

    def as_(self, who):
        self.client.force_authenticate(user=who)
        return self.client

    def post(self, who, **extra):
        body = {"template": WORKFLOW, "name": "Dance swap", "description": "My best one", **extra}
        return self.as_(who).post("/api/templates/community/submit", body, format="json")


class Outline(TestCase):
    def test_draws_nodes_and_only_edges_between_them(self):
        out = outline_of(WORKFLOW)
        self.assertEqual([n["type"] for n in out["nodes"]], ["prompt", "generate"])
        self.assertEqual(out["nodes"][1]["platform"], "flow")
        self.assertEqual(out["nodes"][1]["media"], "video")
        self.assertEqual(out["nodes"][0]["y"], 11)
        self.assertEqual(out["edges"], [[0, 1]])

    def test_survives_junk(self):
        self.assertEqual(outline_of(None), {"nodes": [], "edges": []})
        self.assertEqual(outline_of({"nodes": ["x", {"id": 1, "position": {"x": "nan?"}}]})["nodes"][0]["x"], 0)


class DisplayName(TestCase):
    def test_rules(self):
        self.assertEqual(clean_display_name("  Lola   Creates "), ("Lola Creates", ""))
        self.assertTrue(clean_display_name("a")[1])
        self.assertTrue(clean_display_name("me@mail")[1])
        self.assertTrue(clean_display_name("www.spam.example")[1])
        self.assertTrue(clean_display_name("visit https://x")[1])


class Posting(Feed):
    def test_a_post_is_live_at_once_with_the_chosen_name(self):
        res = self.post(self.alice, display_name="Alice Makes")
        self.assertEqual(res.status_code, 201, res.data)
        row = CommunityTemplate.objects.get(pk=res.data["id"])
        self.assertEqual(row.status, CommunityTemplate.Status.PUBLISHED)
        self.assertEqual(row.author_name, "Alice Makes")
        self.assertEqual(row.outline["edges"], [[0, 1]])
        self.assertTrue(res.data["card"]["mine"])
        listed = self.client.get("/api/templates/community?sort=new").data["templates"]
        self.assertEqual([c["name"] for c in listed], ["Dance swap"])

    def test_no_display_name_means_no_post_and_never_the_email(self):
        res = self.post(self.alice, author_name="alice.smith")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "display_name_required")
        self.assertFalse(CommunityTemplate.objects.exists())

    def test_the_name_is_kept_and_renaming_updates_older_posts(self):
        self.post(self.alice, display_name="Alice")
        self.assertEqual(self.post(self.alice).status_code, 201)
        self.post(self.alice, display_name="Alice B")
        self.assertEqual(set(CommunityTemplate.objects.values_list("author_name", flat=True)), {"Alice B"})

    def test_unverified_and_stopped_accounts_cannot_post(self):
        lurker = user("new@example.com", active=False)
        self.assertEqual(self.post(lurker, display_name="New").status_code, 403)
        CommunityMember.objects.create(user=self.bob, display_name="Bob", can_post=False)
        self.assertEqual(self.post(self.bob).status_code, 403)

    def test_a_day_holds_ten_posts(self):
        self.post(self.alice, display_name="Alice")
        for _ in range(POSTS_PER_DAY - 1):
            self.assertEqual(self.post(self.alice).status_code, 201)
        self.assertEqual(self.post(self.alice).status_code, 429)
        CommunityTemplate.objects.update(created_at=timezone.now() - timedelta(days=2))
        self.assertEqual(self.post(self.alice).status_code, 201)

    def test_a_title_is_required(self):
        res = self.post(self.alice, display_name="Alice", name=" ", template={**WORKFLOW, "name": ""})
        self.assertEqual(res.status_code, 400)


class Paging(Feed):
    def test_next_offset_until_the_end(self):
        for i in range(5):
            CommunityTemplate.objects.create(author=self.alice, author_name="A", name=f"p{i}", payload=WORKFLOW)
        first = self.client.get("/api/templates/community?sort=new&limit=2").data
        self.assertEqual([c["name"] for c in first["templates"]], ["p4", "p3"])
        self.assertEqual(first["next"], 2)
        last = self.client.get("/api/templates/community?sort=new&limit=2&offset=4").data
        self.assertEqual([c["name"] for c in last["templates"]], ["p0"])
        self.assertIsNone(last["next"])

    def test_an_old_client_still_gets_its_list(self):
        CommunityTemplate.objects.create(author=self.alice, author_name="A", name="old", payload=WORKFLOW)
        data = self.client.get("/api/templates/community").data
        self.assertEqual(len(data["templates"]), 1)
        self.assertIn("outline", data["templates"][0])


class Deleting(Feed):
    def test_only_the_author_or_staff(self):
        row = CommunityTemplate.objects.create(author=self.alice, author_name="A", name="mine", payload=WORKFLOW)
        self.assertEqual(self.as_(self.bob).delete(f"/api/templates/community/{row.pk}").status_code, 403)
        self.assertEqual(self.as_(self.alice).delete(f"/api/templates/community/{row.pk}").status_code, 204)
        other = CommunityTemplate.objects.create(author=self.alice, author_name="A", name="x", payload=WORKFLOW)
        boss = user("boss@example.com", staff=True)
        self.assertEqual(self.as_(boss).delete(f"/api/templates/community/{other.pk}").status_code, 204)
        self.assertFalse(CommunityTemplate.objects.exists())


class Reporting(Feed):
    def setUp(self):
        super().setUp()
        self.row = CommunityTemplate.objects.create(author=self.alice, author_name="A", name="r", payload=WORKFLOW)
        self.url = f"/api/templates/community/{self.row.pk}/report"

    def report(self, who, reason="spam"):
        return self.as_(who).post(self.url, {"reason": reason}, format="json")

    def test_three_people_hide_it_one_person_cannot(self):
        self.assertEqual(self.report(self.bob).status_code, 200)
        self.assertTrue(self.report(self.bob).data["already"])
        self.row.refresh_from_db()
        self.assertEqual((self.row.report_count, self.row.status), (1, "published"))
        for n in range(AUTO_HIDE_REPORTS - 1):
            self.report(user(f"r{n}@example.com"))
        self.row.refresh_from_db()
        self.assertEqual(self.row.status, CommunityTemplate.Status.HIDDEN)
        self.assertEqual(self.client.get("/api/templates/community").data["templates"], [])
        self.assertEqual(self.client.get(f"/api/templates/community/{self.row.pk}").status_code, 404)

    def test_not_your_own_and_a_real_reason(self):
        self.assertEqual(self.report(self.alice).status_code, 400)
        self.assertEqual(self.report(self.bob, reason="because").status_code, 400)

    def test_restore_dismisses_and_needs_three_new_reports(self):
        reporters = [user(f"q{n}@example.com") for n in range(AUTO_HIDE_REPORTS)]
        for who in reporters:
            self.report(who)
        request = RequestFactory().post("/")
        request.user = user("admin@example.com", staff=True)
        request.session = {}
        request._messages = FallbackStorage(request)
        CommunityTemplateAdmin(CommunityTemplate, AdminSite()).restore(
            request, CommunityTemplate.objects.filter(pk=self.row.pk))
        self.row.refresh_from_db()
        self.assertEqual((self.row.status, self.row.report_count), ("published", 0))
        self.assertEqual(CommunityReport.objects.filter(dismissed=False).count(), 0)
        self.report(self.bob)
        self.row.refresh_from_db()
        self.assertEqual((self.row.status, self.row.report_count), ("published", 1))


class Likes(Feed):
    def test_toggle_still_works(self):
        row = CommunityTemplate.objects.create(author=self.alice, author_name="A", name="l", payload=WORKFLOW)
        url = f"/api/templates/community/{row.pk}/like"
        self.assertEqual(self.as_(self.bob).post(url).data, {"liked": True, "likes": 1})
        self.assertEqual(self.as_(self.bob).post(url).data, {"liked": False, "likes": 0})


class Me(Feed):
    def test_read_and_set(self):
        self.assertEqual(self.as_(self.alice).get("/api/templates/community/me").data["displayName"], "")
        self.assertEqual(self.as_(self.alice).post("/api/templates/community/me", {"display_name": "x@y"},
                                                   format="json").status_code, 400)
        res = self.as_(self.alice).post("/api/templates/community/me", {"display_name": "Alice"}, format="json")
        self.assertEqual(res.data["displayName"], "Alice")


class Backfill(Feed):
    def test_old_posts_join_the_feed_without_the_email(self):
        old = CommunityTemplate.objects.create(author=self.alice, author_name="alice.smith", name="o",
                                               payload=WORKFLOW, status=CommunityTemplate.Status.PENDING)
        CommunityTemplate.objects.filter(pk=old.pk).update(outline={})
        named = CommunityTemplate.objects.create(author=self.bob, author_name="Bobby", name="n", payload=WORKFLOW)
        importlib.import_module("apps.workflows.migrations.0004_community_feed_backfill").forwards(django_apps, None)
        old.refresh_from_db()
        named.refresh_from_db()
        self.assertEqual((old.status, old.author_name), ("published", ""))
        self.assertEqual(old.outline["edges"], [[0, 1]])
        self.assertEqual(named.author_name, "Bobby")
        self.assertEqual(old.as_card()["author"], "Someone")
