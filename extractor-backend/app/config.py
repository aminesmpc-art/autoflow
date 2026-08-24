"""Application configuration — loaded from environment variables."""

from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

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

    # Limits
    max_video_size_mb: int = 500
    allowed_video_types: list[str] = [
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/webm",
    ]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
