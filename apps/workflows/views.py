"""Serving and publishing Studio workflow templates."""

import logging

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.plans.services import get_entitlement_snapshot

from .models import TemplateBundle

logger = logging.getLogger(__name__)


class TemplateListView(APIView):
    """The current template bundle.

    Deliberately open to anonymous callers. A fresh install should see a
    gallery before it sees a login form, and the free templates are not
    secret — they ship inside the extension anyway.

    A token, when present, is what unlocks Pro templates. It is optional
    rather than required, so this endpoint has to read it itself instead of
    leaning on IsAuthenticated.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        bundle = TemplateBundle.current()
        if bundle is None:
            # Nothing published yet. Not an error: the extension falls back to
            # the templates compiled into it, which is the designed floor.
            return Response(
                {"schemaVersion": 1, "templates": []},
                status=status.HTTP_200_OK,
            )

        is_pro = self._is_pro(request)

        # ETag covers entitlement, or a user upgrading would keep being handed
        # their cached locked-down copy until the bundle happened to change.
        etag = f'"{bundle.etag}-{"pro" if is_pro else "free"}"'
        if request.headers.get("If-None-Match") == etag:
            response = Response(status=status.HTTP_304_NOT_MODIFIED)
            response["ETag"] = etag
            return response

        response = Response(bundle.for_viewer(is_pro=is_pro))
        response["ETag"] = etag
        response["Cache-Control"] = "no-cache"  # revalidate, do not blind-cache
        return response

    @staticmethod
    def _is_pro(request) -> bool:
        """Entitlement from the bearer token, if there is a usable one.

        Any failure means "not Pro". A malformed or expired token is a reason
        to serve the free set, never a reason to fail the request — the
        gallery must still open.
        """
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication

            validated = JWTAuthentication().authenticate(request)
            if not validated:
                return False
            user, _ = validated
            return bool(get_entitlement_snapshot(user).get("is_pro_active"))
        except Exception:
            logger.info("Template request carried a token that did not validate")
            return False


class TemplatePublishView(APIView):
    """Receive a bundle from scripts/publish-templates.js.

    Guarded by a shared admin token rather than a user login: this is called
    by a build script, and giving it a real account would mean a credential
    that could do everything else too.

    Validation already ran on the publishing side, where a failure is a
    readable list of problems next to the source. The checks here are the ones
    that matter for *this* side of the wire — shape, and not silently
    replacing a good bundle with an empty one.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        expected = getattr(settings, "TEMPLATE_PUBLISH_TOKEN", "") or ""
        provided = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        # Constant-time compare: this is a bearer secret on a public endpoint.
        from hmac import compare_digest

        if not expected or not provided or not compare_digest(provided, expected):
            return Response({"detail": "Not authorised."}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data
        if not isinstance(payload, dict) or not isinstance(payload.get("templates"), list):
            return Response(
                {"detail": "Expected {schemaVersion, templates: [...]}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        templates = payload["templates"]
        if not templates:
            # An empty publish would blank every gallery on the next fetch.
            # If the intent is to withdraw everything, deactivate the bundle
            # in the admin instead — that is reversible and deliberate.
            return Response(
                {"detail": "Refusing to publish an empty bundle."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        missing = [
            t.get("id", "<no id>")
            for t in templates
            if not t.get("id") or not isinstance(t.get("nodes"), list) or not isinstance(t.get("edges"), list)
        ]
        if missing:
            return Response(
                {"detail": f"Templates missing id/nodes/edges: {', '.join(missing[:5])}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        previous = TemplateBundle.current()
        bundle = TemplateBundle(
            payload=payload,
            published_by=request.headers.get("X-Published-By", "publish-script"),
            note=request.headers.get("X-Publish-Note", ""),
        )
        bundle.save()

        if previous and previous.etag == bundle.etag:
            # Identical content: keep the older row as the active one so its
            # ETag stays stable and every client's revalidation is still a 304.
            bundle.is_active = False
            bundle.save(update_fields=["is_active"])
            return Response({"status": "unchanged", "etag": previous.etag, "count": previous.template_count})

        TemplateBundle.objects.exclude(pk=bundle.pk).filter(is_active=True).update(is_active=False)
        logger.info("Published %s templates (etag %s)", bundle.template_count, bundle.etag)
        return Response(
            {"status": "published", "etag": bundle.etag, "count": bundle.template_count},
            status=status.HTTP_201_CREATED,
        )
