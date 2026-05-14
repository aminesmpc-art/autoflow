"""Marketing API views — subscribe to sequence and track CTA clicks."""
import logging

from django.shortcuts import redirect
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import SubscribeSerializer
from .services import mark_action_taken, subscribe_to_sequence

logger = logging.getLogger(__name__)


class SubscribeView(APIView):
    """Accept an email opt-in and trigger the marketing email sequence.

    POST /api/marketing/subscribe
    Body: {"email": "user@example.com", "source": "extension"}
    """

    permission_classes = [AllowAny]

    def post(self, request):
        # Rate limit: max 10 subscribe attempts per IP per hour
        from django.core.cache import cache

        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR", "unknown")
        )
        cache_key = f"marketing_subscribe:{ip}"
        attempts = cache.get(cache_key, 0)
        if attempts >= 10:
            return Response(
                {"detail": "Too many requests. Try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        cache.set(cache_key, attempts + 1, timeout=3600)

        serializer = SubscribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        subscriber, created, message = subscribe_to_sequence(
            email=serializer.validated_data["email"],
            source=serializer.validated_data.get("source", "extension"),
        )

        http_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(
            {
                "message": message,
                "subscribed": True,
                "email": subscriber.email,
            },
            status=http_status,
        )


class TrackClickView(APIView):
    """Track a CTA click and redirect to the actual offer page.

    GET /api/marketing/track/<uuid:token>

    When a user clicks the CTA button in the email, they hit this endpoint.
    We mark their action as taken (stops future emails) and redirect them
    to the real CTA URL. Think of it as a tiny checkpoint before the destination.
    """

    permission_classes = [AllowAny]

    def get(self, request, token):
        subscriber, success, redirect_url = mark_action_taken(str(token))

        if success:
            logger.info("CTA click tracked for %s", subscriber.email)
        else:
            logger.warning("CTA click with invalid token: %s", token)

        # Always redirect — even on invalid tokens, send them to the CTA page
        return redirect(redirect_url)
