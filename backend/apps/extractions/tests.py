"""Tests for extraction privacy and quota enforcement.

Two holes these cover:
  - every saved extraction was served publicly and put in the sitemap
  - the quota was checked in the browser but never on create
"""
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.extractions.models import SavedExtraction
from apps.plans.models import Profile
from apps.users.models import CustomUser


def make_user(email, is_pro=False):
    user = CustomUser.objects.create_user(email=email, password="pw12345!", is_active=True)
    Profile.objects.create(
        user=user,
        plan_type="pro" if is_pro else "free",
        is_pro_active=is_pro,
    )
    return user


def make_extraction(user, name="clip.mp4", is_public=False):
    return SavedExtraction.objects.create(
        user=user,
        video_name=name,
        video_concept="A concept",
        voiceover_text="Some private transcript",
        shots=[{"shot_id": 1, "image_prompt": "a", "video_prompt": "b"}],
        is_public=is_public,
    )


class PublicGalleryPrivacyTests(APITestCase):
    def setUp(self):
        self.owner = make_user("owner@example.com")
        self.other = make_user("other@example.com")

    def test_new_extractions_are_private_by_default(self):
        self.assertFalse(make_extraction(self.owner).is_public)

    def test_gallery_excludes_private_extractions(self):
        make_extraction(self.owner, "private.mp4", is_public=False)
        make_extraction(self.owner, "published.mp4", is_public=True)

        res = self.client.get(reverse("extractions-public"))

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        names = [r["video_name"] for r in res.data]
        self.assertEqual(names, ["published.mp4"])

    def test_private_extraction_is_not_addressable_by_id(self):
        private = make_extraction(self.owner, is_public=False)

        res = self.client.get(reverse("extractions-public-detail", args=[private.pk]))

        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_published_extraction_is_addressable_by_id(self):
        pub = make_extraction(self.owner, is_public=True)

        res = self.client.get(reverse("extractions-public-detail", args=[pub.pk]))

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data["is_public"])

    def test_owner_can_publish_and_unpublish(self):
        ex = make_extraction(self.owner)
        url = reverse("extractions-detail", args=[ex.pk])
        self.client.force_authenticate(self.owner)

        self.assertEqual(self.client.patch(url, {"is_public": True}, format="json").status_code, 200)
        ex.refresh_from_db()
        self.assertTrue(ex.is_public)

        self.client.patch(url, {"is_public": False}, format="json")
        ex.refresh_from_db()
        self.assertFalse(ex.is_public)

    def test_cannot_publish_someone_elses_extraction(self):
        ex = make_extraction(self.owner)
        self.client.force_authenticate(self.other)

        res = self.client.patch(
            reverse("extractions-detail", args=[ex.pk]), {"is_public": True}, format="json"
        )

        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        ex.refresh_from_db()
        self.assertFalse(ex.is_public)

    def test_patch_with_nothing_editable_is_rejected(self):
        ex = make_extraction(self.owner)
        self.client.force_authenticate(self.owner)

        res = self.client.patch(
            reverse("extractions-detail", args=[ex.pk]), {"video_name": "x"}, format="json"
        )

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class ExtractionQuotaTests(APITestCase):
    """The create endpoint must enforce, not just report."""

    def setUp(self):
        self.free = make_user("free@example.com", is_pro=False)
        self.pro = make_user("pro@example.com", is_pro=True)
        self.payload = {
            "video_name": "v.mp4",
            "video_concept": "c",
            "voiceover_text": "t",
            "character_sheets": [],
            "shots": [],
        }

    def test_free_user_blocked_after_four_in_a_month(self):
        for _ in range(4):
            make_extraction(self.free)
        self.client.force_authenticate(self.free)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(res.data["limit"], 4)
        self.assertEqual(res.data["period"], "month")
        # And nothing was written.
        self.assertEqual(SavedExtraction.objects.filter(user=self.free).count(), 4)

    def test_free_user_allowed_under_the_limit(self):
        for _ in range(3):
            make_extraction(self.free)
        self.client.force_authenticate(self.free)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(SavedExtraction.objects.filter(user=self.free).count(), 4)

    def test_pro_user_gets_the_daily_allowance(self):
        for _ in range(4):
            make_extraction(self.pro)
        self.client.force_authenticate(self.pro)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

    def test_pro_user_blocked_after_twenty_in_a_day(self):
        for _ in range(20):
            make_extraction(self.pro)
        self.client.force_authenticate(self.pro)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(res.data["period"], "day")

    def test_check_limit_and_create_agree(self):
        for _ in range(4):
            make_extraction(self.free)
        self.client.force_authenticate(self.free)

        check = self.client.get(reverse("extractions-check-limit"))
        created = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertFalse(check.data["allowed"])
        self.assertEqual(created.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_created_extraction_is_private(self):
        self.client.force_authenticate(self.free)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertFalse(SavedExtraction.objects.get(pk=res.data["id"]).is_public)

    def test_quota_is_per_user(self):
        for _ in range(4):
            make_extraction(self.free)
        other = make_user("fresh@example.com")
        self.client.force_authenticate(other)

        res = self.client.post(reverse("extractions-list"), self.payload, format="json")

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)


class ExtractionShapeTests(APITestCase):
    """What the upgraded extractor returns has to survive being saved.

    The serializer lists its fields, so anything the extractor added and the
    serializer did not name was dropped on save without an error — the master
    prompt would have been shown once and gone from the history.
    """

    def setUp(self):
        self.user = make_user("shape@example.com")
        self.client.force_authenticate(self.user)

    def test_new_fields_round_trip(self):
        payload = {
            "video_name": "v.mp4",
            "video_concept": "c",
            "voiceover_text": "t",
            "character_sheets": [{"character_name": "Marco", "prompt": "sheet"}],
            "shots": [{
                "shot_id": 1, "time_range": "00:00.0 - 00:04.0",
                "image_prompt": "a", "video_prompt": "b",
                "start_sec": 0.0, "end_sec": 4.0, "characters": ["Marco"],
                "camera": {"shot_size": "medium", "lens": "35mm", "movement": "dolly in"},
                "dialogue": 'MARCO: "Service."', "sound": "sizzle",
                "thumbnail_url": "https://x.example/api/videos/thumbs/abc/1.jpg",
            }],
            "master_prompt": "A chef plates a dish.",
            "master_prompt_json": {"scene": "kitchen", "audio": {"music": ""}},
            "details": {"aspect_ratio": "9:16", "thumbnails_id": "abc", "warnings": []},
        }

        created = self.client.post(reverse("extractions-list"), payload, format="json")
        listed = self.client.get(reverse("extractions-list")).data[0]

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(listed["master_prompt"], "A chef plates a dish.")
        self.assertEqual(listed["master_prompt_json"]["scene"], "kitchen")
        self.assertEqual(listed["details"]["thumbnails_id"], "abc")
        self.assertEqual(listed["shots"][0]["camera"]["lens"], "35mm")

    def test_an_old_client_that_sends_none_of_them_still_saves(self):
        res = self.client.post(
            reverse("extractions-list"),
            {"video_name": "v.mp4", "video_concept": "c", "voiceover_text": "t",
             "character_sheets": [], "shots": []},
            format="json",
        )

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["master_prompt"], "")
        self.assertIsNone(res.data["master_prompt_json"])
        self.assertEqual(res.data["details"], {})


class BreakdownKindTests(APITestCase):
    """A "why it works" breakdown is saved as its own kind of extraction."""

    def setUp(self):
        self.user = make_user("kinds@example.com", is_pro=True)
        self.client.force_authenticate(self.user)

    def save_breakdown(self):
        return self.client.post(
            reverse("extractions-list"),
            {
                "video_name": "ad.mp4",
                "video_concept": "A UGC ad for running shoes.",
                "voiceover_text": "",
                "character_sheets": [],
                "shots": [],
                "kind": "breakdown",
                "breakdown": {"hook": {"strength": 8}, "beats": [], "pacing": {"cut_count": 12}},
            },
            format="json",
        )

    def test_a_breakdown_round_trips(self):
        res = self.save_breakdown()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        saved = self.client.get(reverse("extractions-list")).data[0]
        self.assertEqual(saved["kind"], "breakdown")
        self.assertEqual(saved["breakdown"]["pacing"]["cut_count"], 12)

    def test_prompts_is_the_default_kind(self):
        self.assertEqual(make_extraction(self.user).kind, "prompts")

    def test_an_unknown_kind_is_refused(self):
        res = self.client.post(
            reverse("extractions-list"),
            {"video_name": "x", "video_concept": "", "voiceover_text": "", "character_sheets": [],
             "shots": [], "kind": "poetry"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_breakdown_counts_toward_the_daily_allowance(self):
        before = self.client.get(reverse("extractions-check-limit")).data["used"]
        self.save_breakdown()
        after = self.client.get(reverse("extractions-check-limit")).data["used"]
        self.assertEqual(after, before + 1)

    def test_the_public_gallery_never_lists_a_breakdown(self):
        self.save_breakdown()
        SavedExtraction.objects.filter(kind="breakdown").update(is_public=True)
        pk = SavedExtraction.objects.get(kind="breakdown").pk
        self.assertEqual(self.client.get(reverse("extractions-public")).data, [])
        res = self.client.get(reverse("extractions-public-detail", args=[pk]))
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)


class EditedVersionTests(APITestCase):
    """Edit-by-chat saves a new version onto the same row."""

    def setUp(self):
        self.owner = make_user("editor@example.com")
        self.other = make_user("someone@example.com")
        self.ex = make_extraction(self.owner)

    def patch(self, user, data):
        self.client.force_authenticate(user)
        return self.client.patch(reverse("extractions-detail", args=[self.ex.pk]), data, format="json")

    def test_the_owner_saves_a_new_version_in_place(self):
        shots = [{"shot_id": 1, "image_prompt": "golden hour", "video_prompt": "b"}]
        res = self.patch(self.owner, {"shots": shots, "master_prompt": "At golden hour."})

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.ex.refresh_from_db()
        self.assertEqual(self.ex.shots, shots)
        self.assertEqual(self.ex.master_prompt, "At golden hour.")
        self.assertEqual(SavedExtraction.objects.filter(user=self.owner).count(), 1)

    def test_an_edit_does_not_count_toward_the_allowance(self):
        self.client.force_authenticate(self.owner)
        before = self.client.get(reverse("extractions-check-limit")).data["used"]
        self.patch(self.owner, {"video_concept": "edited"})
        after = self.client.get(reverse("extractions-check-limit")).data["used"]
        self.assertEqual(before, after)

    def test_nobody_else_can_edit_it(self):
        res = self.patch(self.other, {"video_concept": "mine now"})
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.ex.refresh_from_db()
        self.assertEqual(self.ex.video_concept, "A concept")

    def test_the_owner_kind_and_user_cannot_be_changed(self):
        res = self.patch(self.owner, {"kind": "breakdown", "user": self.other.pk, "video_concept": "ok"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.ex.refresh_from_db()
        self.assertEqual(self.ex.kind, "prompts")
        self.assertEqual(self.ex.user, self.owner)
