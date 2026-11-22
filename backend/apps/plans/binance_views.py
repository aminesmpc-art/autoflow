"""Binance Pay endpoints (apps/plans/binance.py)."""
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.plans import binance


class BinanceInfoView(APIView):
    """What the checkout shows: the Pay ID, the price, whether it is open."""
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(binance.checkout_info())


class ClaimThrottle(UserRateThrottle):
    """Order IDs are long, but guessing is still not free: 12 tries an hour."""
    rate = "12/hour"


class BinanceClaimView(APIView):
    """Check one Binance order and give its month of Pro."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [ClaimThrottle]

    def post(self, request):
        try:
            result = binance.claim(request.user, request.data.get("order_id"))
        except binance.ClaimError as e:
            return Response({"ok": False, "detail": e.message}, status=e.status)
        return Response(result, status=status.HTTP_200_OK)
