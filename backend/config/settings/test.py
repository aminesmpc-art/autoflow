"""Offline tests: never connect to configured production databases or email."""

from .base import *

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
RESEND_API_KEY = ""
SECRET_KEY = "motion-offline-tests-only-not-a-production-secret-key"
ALLOWED_HOSTS = ["testserver", "localhost"]
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}
MOTION_BILLING_ENABLED = False
WHOP_MOTION_WEBHOOK_SECRET = ""
WHOP_MOTION_PRODUCT_ID = ""
WHOP_MOTION_PLAN_ID = ""
WHOP_STUDIO_PRODUCT_IDS = []
