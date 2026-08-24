"""
PromptExtractor SaaS — FastAPI Backend
AI-powered video prompt extraction service.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api import videos, gallery, health, clip


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    yield


app = FastAPI(
    title="PromptExtractor API",
    version="1.0.0",
    description="AI-powered video prompt extraction for image and video generation tools.",
    lifespan=lifespan,
)

# CORS
#
# The Chrome extension calls this from a chrome-extension:// page, and that
# origin can never be in a static list: it differs between an unpacked build
# and a published one, so pinning it would work in development and break the
# day the extension ships.
#
# Allowing any extension origin is deliberate rather than lazy. CORS is not
# the security boundary here — every endpoint that costs anything requires a
# bearer token this service verifies and a quota the Django API enforces, and
# a bearer token is not a cookie the browser attaches on its own. An origin
# that cannot authenticate gains nothing by being allowed to ask.
#
# The pattern is the real one: extension IDs are exactly 32 characters in a-p.
EXTENSION_ORIGIN = r"^chrome-extension://[a-p]{32}$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
    ],
    allow_origin_regex=EXTENSION_ORIGIN,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(videos.router, prefix="/api/videos", tags=["Videos"])
app.include_router(gallery.router, prefix="/api/gallery", tags=["Gallery"])
# Reading a video for the Clipping node: one call instead of six chat
# transcriptions, and timings that make the per-clip locating unnecessary.
app.include_router(clip.router, prefix="/api/clip", tags=["Clip"])
