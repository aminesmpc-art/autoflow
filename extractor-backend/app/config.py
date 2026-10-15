"""Application configuration — loaded from environment variables."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    # AI
    gemini_api_key: str = ""

    # Vertex AI (uses GCP billing instead of AI Studio prepay)
    gcp_project_id: str = ""
    gcp_location: str = "us-central1"
    gcp_credentials_json: str = ""  # Service account JSON as string
    gcs_bucket_name: str = "autoflow-extractor-videos"

    # Where the CLIP endpoint talks to Vertex, and which model it asks for.
    #
    # Separate from gcp_location on purpose. The newest Gemini models are
    # served ONLY from the global endpoint — asking us-central1 for
    # gemini-3.7-flash returns "Publisher model ... was not found", which is
    # what happened the first time this ran. gcp_location stays whatever the
    # older analysis endpoint needs; this is the requirement of the model this
    # endpoint chose, so it belongs to this endpoint.
    clip_location: str = "global"
    # Overridable without a deploy, for pinning to an older model in a hurry.
    clip_model: str = ""
    # The same, for the prompt extractor. Empty follows clip_model, so one
    # variable moves both unless the extractor needs pinning on its own.
    extract_model: str = ""

    # Shot thumbnails. They outlive the job — a saved extraction shows them
    # for as long as it exists — so they get their own folder, and their own
    # bucket if this one is ever given a lifecycle rule that empties it.
    # Empty means gcs_bucket_name.
    thumbs_bucket_name: str = ""
    # The address thumbnails are served from, as the outside world sees this
    # service. Empty derives it from each request's forwarded headers.
    public_url: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id_starter: str = ""
    stripe_price_id_pro: str = ""

    # Frontend
    frontend_url: str = "http://localhost:3000"

    # Auth
    jwt_secret_key: str = "insecure-dev-key-change-me"
    jwt_algorithm: str = "HS256"

    # Django API — the authority on extraction quotas. This service is where
    # the expensive Gemini call happens, so it has to ask before starting one;
    # the browser's pre-flight check is advisory only.
    django_api_url: str = "https://api.auto-flow.studio/api"
    enforce_extraction_limits: bool = True

    # Shared job status. Redis makes polling work across web workers and keeps
    # completed results available through deploys; empty is for local tests.
    redis_url: str = ""
    job_state_ttl_sec: int = 24 * 60 * 60
    clip_job_stale_sec: int = 30 * 60
    max_concurrent_clip_jobs: int = 2
    max_concurrent_extract_jobs: int = 3

    # Explicit download-only imports; no AI work or generation quota.
    social_imports_enabled: bool = False
    social_imports_per_hour: int = 10
    max_concurrent_social_imports: int = 2

    # Ceilings on /api/clip/ask, which charges no quota of its own.
    # Far above legitimate use: the heaviest run the website produces is 46
    # asks (6 + 2N, twenty clips), spread over minutes of encoding. See
    # app/rate_limit.py for why this is a rate limit and not a quota.
    clip_ask_per_minute: int = 60
    clip_ask_per_day: int = 1000

    # Refining an extraction by chat. Edits charge no quota, so they are
    # rate-limited instead; and the video is kept this long after an
    # extraction so an edit can look at it again — the user chose one hour,
    # the smallest footprint, over a day.
    refine_per_minute: int = 10
    refine_per_day: int = 200
    refine_video_ttl_sec: int = 60 * 60

    # Limits
    max_video_size_mb: int = 500
    max_video_duration_sec: int = 2 * 60 * 60
    allowed_video_types: list[str] = [
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/webm",
        "video/x-matroska",
    ]

@lru_cache
def get_settings() -> Settings:
    return Settings()
