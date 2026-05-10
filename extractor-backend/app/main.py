"""
PromptExtractor SaaS — FastAPI Backend
AI-powered video prompt extraction service.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api import videos, gallery, health


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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router, prefix="/api", tags=["Health"])
app.include_router(videos.router, prefix="/api/videos", tags=["Videos"])
app.include_router(gallery.router, prefix="/api/gallery", tags=["Gallery"])
