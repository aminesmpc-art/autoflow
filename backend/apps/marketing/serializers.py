"""Marketing API serializers."""
from rest_framework import serializers


class SubscribeSerializer(serializers.Serializer):
    """Validates opt-in requests for the marketing email sequence."""

    email = serializers.EmailField()
    source = serializers.ChoiceField(
        choices=["extension", "website", "manual"],
        default="extension",
    )
