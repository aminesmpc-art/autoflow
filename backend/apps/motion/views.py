import json
import logging

from django.conf import settings
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .billing import configured, process_event
from .services import entitlement, reserve_run
from .signatures import verify_signature

logger = logging.getLogger(__name__)


class MotionRunSerializer(serializers.Serializer):
    jobId = serializers.UUIDField()
    fingerprint = serializers.RegexField(r"\A[0-9a-f]{64}\Z", trim_whitespace=False)


class MotionEntitlementView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(
            entitlement(request.user), headers={"Cache-Control": "no-store"}
        )


class MotionRunView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        serializer = MotionRunSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result, status_code = reserve_run(
            request.user,
            serializer.validated_data["jobId"],
            serializer.validated_data["fingerprint"],
        )
        return Response(
            result, status=status_code, headers={"Cache-Control": "no-store"}
        )


class MotionWebhookView(APIView):
    permission_classes = (AllowAny,)
    authentication_classes = ()
    throttle_classes = ()  # Whop retries/bursts must not share anonymous login limits.

    def post(self, request):
        # Receive subscriptions before enabling paid runs, but never with partial configuration.
        if not configured():
            return Response({"error": "Motion billing is not configured"}, status=503)
        raw = request.body
        if len(raw) > 256 * 1024:
            return Response({"error": "Webhook payload too large"}, status=413)
        if not verify_signature(
            raw, request.headers, settings.WHOP_MOTION_WEBHOOK_SECRET
        ):
            return Response({"error": "Invalid webhook signature"}, status=403)
        event_id = request.headers["webhook-id"]
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not isinstance(
                payload.get("data"), dict
            ):
                raise TypeError("Expected a webhook object")
            if payload.get("api_version") != "v1" or payload.get("id") != event_id:
                raise ValueError("Unsupported webhook version or inconsistent ID")
            if (
                not isinstance(payload.get("type"), str)
                or not 0 < len(payload["type"]) <= 100
            ):
                raise ValueError("Invalid webhook event type")
            if not isinstance(payload.get("timestamp"), str):
                raise TypeError("Missing webhook event timestamp")
            result = process_event(payload, event_id)
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            return Response({"error": str(exc)}, status=400)
        except Exception:
            logger.exception("Motion webhook transaction failed (event %s)", event_id)
            return Response(
                {"error": "Webhook processing failed; retry required"}, status=500
            )
        return Response({"received": True, "disposition": result})
