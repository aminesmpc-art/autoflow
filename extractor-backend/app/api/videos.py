"""
Video analysis endpoints — Core SaaS feature.
Handles video upload, Gemini AI processing, and prompt extraction.
"""

import json
import re
import time
import uuid
import os
import tempfile
from typing import Optional
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter()
settings = get_settings()

# In-memory job store (replace with Supabase in production)
jobs: dict = {}

security = HTTPBearer()

def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============================================================================
# AI Configuration
# ============================================================================

SYSTEM_INSTRUCTION = """You are an expert Film Director and Visual Engineer.
Your goal is to reverse-engineer video footage into production-ready prompt streams:
1. Static Image Generation: Focus on texture, lighting, lens, 8k detail.
2. Video Dynamics: Focus on physics, gravity, wind, and camera movement."""

ANALYSIS_PROMPT = """Analyze this video with deep reasoning.

Understand the SOUL of this video — mood, narrative, visual style.
Transcribe any spoken dialogue into "voiceover_text".
Describe all prominent characters in "characters_description".

For each character, create a "character_sheet" with:
- Layout: "Character design sheet, concept art turnaround, multiple views"
- Subject: facial structure, age, hair, eye color, body type, posture
- Wardrobe: detailed clothing materials, accessories
- Style: "Studio rim lighting, neutral grey backdrop, 8k, UE5 render style"

For scene prompts, break down each shot with:
- `shot_id`: sequential number
- `time_range`: timestamp range
- `image_prompt`: production-ready still image prompt
- `video_prompt`: motion/animation prompt for VEO/Runway

**OUTPUT FORMAT (Strict JSON, no markdown):**
{
  "video_concept": "Overall mood and style summary...",
  "voiceover_text": "Transcription...",
  "characters_description": "Character breakdown...",
  "character_sheets": [{"character_name": "...", "prompt": "..."}],
  "shots": [{"shot_id": 1, "time_range": "...", "image_prompt": "...", "video_prompt": "..."}]
}

Analyze the ENTIRE video now. Be extremely detailed."""


# ============================================================================
# Schemas
# ============================================================================

class VideoJob(BaseModel):
    job_id: str
    status: str
    message: str
    result: Optional[dict] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    step: str
    error: Optional[str] = None
    result: Optional[dict] = None


# ============================================================================
# Helpers
# ============================================================================

def clean_json_response(text: str) -> str:
    """Remove markdown code fencing from response."""
    pattern = r'^```(?:json)?\s*\n?(.*?)\n?```\s*$'
    match = re.match(pattern, text.strip(), re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    text = re.sub(r'^```(?:json)?\s*\n?', '', text.strip())
    text = re.sub(r'\n?```\s*$', '', text)
    return text.strip()


async def process_video(job_id: str, video_path: str):
    """Background task to process video with Gemini AI."""
    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["step"] = "Uploading to AI..."

        # Import Gemini client
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)

        # Upload video
        uploaded_file = client.files.upload(file=Path(video_path))

        # Wait for processing
        jobs[job_id]["step"] = "AI is analyzing your video..."
        for _ in range(120):
            file_status = client.files.get(name=uploaded_file.name)
            state = file_status.state.name if hasattr(file_status.state, 'name') else str(file_status.state)
            if state == "ACTIVE":
                break
            if state == "FAILED":
                raise RuntimeError("Video processing failed on Gemini")
            time.sleep(2)

        schema = {
            "type": "OBJECT",
            "properties": {
                "video_concept": {"type": "STRING"},
                "voiceover_text": {"type": "STRING"},
                "characters_description": {"type": "STRING"},
                "character_sheets": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "character_name": {"type": "STRING"},
                            "prompt": {"type": "STRING"}
                        }
                    }
                },
                "shots": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "shot_id": {"type": "INTEGER"},
                            "time_range": {"type": "STRING"},
                            "image_prompt": {"type": "STRING"},
                            "video_prompt": {"type": "STRING"}
                        }
                    }
                }
            }
        }

        # Run analysis
        jobs[job_id]["step"] = "Extracting prompts..."
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[file_status, ANALYSIS_PROMPT],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.7,
                max_output_tokens=8192,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )

        # Parse result
        clean_json = clean_json_response(response.text)
        try:
            analysis_data = json.loads(clean_json)
        except json.JSONDecodeError as e:
            # Fallback for minor unescaped quotes if schema fails
            clean_json = clean_json.replace('\\', '\\\\')
            analysis_data = json.loads(clean_json)

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["step"] = ""
        jobs[job_id]["result"] = analysis_data

        # Cleanup
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception:
            pass

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["step"] = ""

    finally:
        if os.path.exists(video_path):
            os.remove(video_path)


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/analyze", response_model=VideoJob)
async def analyze_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    user: dict = Depends(verify_jwt),
):
    """Upload and analyze a video to extract AI prompts. Returns a job ID for polling."""

    # Validate file type
    if video.content_type not in settings.allowed_video_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {settings.allowed_video_types}",
        )

    # Save to temp file
    job_id = str(uuid.uuid4())
    temp_dir = tempfile.gettempdir()
    video_path = os.path.join(temp_dir, f"{job_id}_{video.filename}")

    content = await video.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.max_video_size_mb:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Video too large. Max size: {settings.max_video_size_mb}MB",
        )

    with open(video_path, "wb") as f:
        f.write(content)

    # Create job
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "step": "Queued...",
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Start background processing
    background_tasks.add_task(process_video, job_id, video_path)

    return VideoJob(
        job_id=job_id,
        status="pending",
        message="Video analysis started. Poll /api/videos/status/{job_id} for updates.",
    )


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Get the status of a video analysis job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        step=job.get("step", ""),
        error=job.get("error"),
        result=job.get("result"),
    )
