"""Only for a disposable, loopback PostgreSQL cluster, never deployment settings."""

import os

from .test import *

# No fallback to .env, DATABASE_URL, or production connection settings.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "postgres",
        "USER": "postgres",
        "HOST": "127.0.0.1",
        "PORT": int(os.environ["MOTION_DISPOSABLE_PG_PORT"]),
        "TEST": {"NAME": "test_motion_disposable"},
    }
}
