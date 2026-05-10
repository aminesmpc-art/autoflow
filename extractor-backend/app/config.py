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
