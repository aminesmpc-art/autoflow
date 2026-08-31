"""Production settings — optimized for Railway deployment."""
import dj_database_url

from .base import *  # noqa: F401, F403

DEBUG = False

# ── Database (Railway provides DATABASE_URL) ──
if database_url := config("DATABASE_URL", default=""):  # noqa: F405
    DATABASES = {"default": dj_database_url.parse(database_url)}

# ── Security ──
SECURE_SSL_REDIRECT = config("SECURE_SSL_REDIRECT", default=False, cast=bool)  # noqa: F405
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # Railway is behind a proxy

# ── CSRF trusted origins (required for admin behind proxy) ──
CSRF_TRUSTED_ORIGINS = [
    "https://*.railway.app",
    "https://*.up.railway.app",
    "https://auto-flow.studio",
    "https://api.auto-flow.studio",
]

# Allow specific Chrome extension origins + known domains
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGIN_REGEXES = []
CORS_ALLOWED_ORIGINS = [  # noqa: F405
    # AutoFlow Queue Manager.
    "chrome-extension://egplmjhmcicjkojopeoaohofckgeoipc",
    # AutoFlow Studio. Missing since CORS was locked down, which is why Studio
    # could not sign in: the browser dropped the login response for want of an
    # Access-Control-Allow-Origin header, and the extension could only report
    # it as "Could not reach the server". Existing sessions kept working, so it
    # surfaced only when somebody's token ran out.
    "chrome-extension://knodokbipcajhdpafplmlljbaamgfkao",
    "https://auto-flow.studio",
    "https://www.auto-flow.studio",
    "https://api.auto-flow.studio",
]

# An UNPACKED extension gets a different id from the published one, so a local
# build is a different origin and none of the ids above match it. Rather than
# widen the list with a regex — which would let any extension through and undo
# the lockdown this list exists for — extra origins can be named explicitly in
# the environment, one per line or comma separated. Empty by default.
CORS_ALLOWED_ORIGINS += [
    o for o in config("EXTRA_CORS_ORIGINS", default="", cast=Csv()) if o  # noqa: F405
]

# ── Static files with WhiteNoise ──
MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")  # noqa: F405
WHITENOISE_USE_FINDERS = True

# ── Email ──
EMAIL_BACKEND = config(  # noqa: F405
    "EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend"
)

# ── ALLOWED_HOSTS ──
ALLOWED_HOSTS += [  # noqa: F405
    "api.auto-flow.studio",
    "auto-flow.studio",
    ".railway.app",
]
RAILWAY_DOMAIN = config("RAILWAY_PUBLIC_DOMAIN", default="")  # noqa: F405
if RAILWAY_DOMAIN:
    ALLOWED_HOSTS.append(RAILWAY_DOMAIN)  # noqa: F405
