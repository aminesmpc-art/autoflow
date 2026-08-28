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

    def test_patch_without_is_public_is_rejected(self):
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
