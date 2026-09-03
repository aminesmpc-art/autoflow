"""Liveness and production-readiness endpoints."""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.config import get_settings

router = APIRouter()


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "promptextractor-api"}


@router.get("/health/ready")
async def readiness_check():
    settings = get_settings()
    checks = {
        "model_credentials": bool(
            settings.gemini_api_key
            or (settings.gcp_project_id and settings.gcp_credentials_json)
        ),
        "secure_jwt_secret": (
            settings.jwt_secret_key != "insecure-dev-key-change-me"
            and len(settings.jwt_secret_key.encode("utf-8")) >= 32
        ),
        "quota_authority": bool(settings.django_api_url) if settings.enforce_extraction_limits else True,
        "shared_job_store": bool(settings.redis_url),
    }
    ready = all(checks.values())
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )
