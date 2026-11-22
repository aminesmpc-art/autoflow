"""JWT authentication that refuses suspended accounts (apps/plans/bypass.py).

A suspended account's tokens stop working at once, without waiting for them
to expire: every API call answers 401 with code "account_suspended".
"""
from rest_framework import exceptions
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.plans.bypass import SUSPENDED_CODE, SUSPENDED_MESSAGE, is_suspended


class AutoFlowJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if is_suspended(user):
            raise exceptions.AuthenticationFailed({"detail": SUSPENDED_MESSAGE, "code": SUSPENDED_CODE})
        return user
