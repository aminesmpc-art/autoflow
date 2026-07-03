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


class AnalyzeUrlRequest(BaseModel):
    url: str



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
    gcs_blob_name = None
    gcs_bucket_ref = None
    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["step"] = "Preparing video for AI..."

        # Detect mime type
        ext = Path(video_path).suffix.lower()
        mime_map = {".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".webm": "video/webm"}
        mime_type = mime_map.get(ext, "video/mp4")

        from google import genai
        from google.genai import types

        # Use Vertex AI (GCP billing) if configured, otherwise fall back to API key
        if settings.gcp_project_id and settings.gcp_credentials_json:
            import json as _json
            import tempfile as _tmpfile
            import uuid as _uuid
            from google.oauth2 import service_account as _sa
            from google.cloud import storage as _gcs

            # Create credentials from service account JSON
            creds_dict = _json.loads(settings.gcp_credentials_json)
            creds_file = _tmpfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
            _json.dump(creds_dict, creds_file)
            creds_file.close()

            credentials = _sa.Credentials.from_service_account_file(
                creds_file.name,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
            os.remove(creds_file.name)

            # Upload video to GCS
            jobs[job_id]["step"] = "Uploading to cloud storage..."
            storage_client = _gcs.Client(
                project=settings.gcp_project_id,
                credentials=credentials,
            )
            bucket = storage_client.bucket(settings.gcs_bucket_name)
            gcs_blob_name = f"videos/{_uuid.uuid4().hex}{ext}"
            blob = bucket.blob(gcs_blob_name)
            blob.upload_from_filename(video_path, content_type=mime_type)
            gcs_bucket_ref = bucket
            gcs_uri = f"gs://{settings.gcs_bucket_name}/{gcs_blob_name}"

            # Init genai client with Vertex AI
            client = genai.Client(
                vertexai=True,
                project=settings.gcp_project_id,
                location=settings.gcp_location,
                credentials=credentials,
            )

            # Reference video from GCS (no Files API needed)
            video_part = types.Part.from_uri(
                file_uri=gcs_uri,
                mime_type=mime_type,
            )

            jobs[job_id]["step"] = "AI is analyzing your video..."
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[video_part, ANALYSIS_PROMPT],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.7,
                    max_output_tokens=8192,
                    response_mime_type="application/json",
                ),
            )
        else:
            # Fallback: AI Studio with API key + Files API
            client = genai.Client(api_key=settings.gemini_api_key)
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

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[file_status, ANALYSIS_PROMPT],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.7,
                    max_output_tokens=8192,
                    response_mime_type="application/json",
                ),
            )

            # Cleanup uploaded file
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass

        # Parse result
        clean_json = clean_json_response(response.text)
        try:
            analysis_data = json.loads(clean_json)
        except json.JSONDecodeError as e:
            clean_json = clean_json.replace('\\', '\\\\')
            analysis_data = json.loads(clean_json)

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["step"] = ""
        jobs[job_id]["result"] = analysis_data

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["step"] = ""

    finally:
        # Clean up local file
        if os.path.exists(video_path):
            os.remove(video_path)
        # Clean up GCS file
        if gcs_blob_name and gcs_bucket_ref:
            try:
                gcs_bucket_ref.blob(gcs_blob_name).delete()
            except Exception:
                pass


async def process_video_url(job_id: str, url: str):
    """Background task to download video from URL and then process it with Gemini AI."""
    temp_dir = tempfile.mkdtemp()
    video_path = None
    temp_cookie_file = None
    try:
        jobs[job_id]["status"] = "processing"
        
        # --- 1. PRO FIX: RapidAPI Bypass for Blocked Platforms ---
        # If the user has configured RAPIDAPI_KEY, we offload Instagram/TikTok downloads
        # to a proxy API to avoid datacenter IP blocks.
        rapidapi_key = os.getenv("RAPIDAPI_KEY")
        rapidapi_host = os.getenv("RAPIDAPI_HOST", "instagram-scraper-api2.p.rapidapi.com")
        
        is_blocked_platform = "instagram.com" in url.lower() or "tiktok.com" in url.lower()
        
        if rapidapi_key and is_blocked_platform:
            jobs[job_id]["step"] = "Bypassing block using RapidAPI Proxy..."
            import httpx
            import aiofiles
            
            headers = {
                "X-RapidAPI-Key": rapidapi_key,
                "X-RapidAPI-Host": rapidapi_host
            }
            
            try:
                async with httpx.AsyncClient() as client:
                    api_url = f"https://{rapidapi_host}/v1/info"
                    response = await client.get(api_url, params={"url": url}, headers=headers, timeout=30.0)
                    
                    if response.status_code == 200:
                        data = response.json()
                        video_url = None
                        
                        # Handle common API response schemas
                        if isinstance(data, dict):
                            if "video_url" in data:
                                video_url = data["video_url"]
                            elif "data" in data and isinstance(data["data"], dict) and "video_url" in data["data"]:
                                video_url = data["data"]["video_url"]
                            elif "items" in data and len(data["items"]) > 0:
                                video_url = data["items"][0].get("video_versions", [{}])[0].get("url")
                                
                        if video_url:
                            jobs[job_id]["step"] = "Downloading proxy payload..."
                            proxy_video_path = os.path.join(temp_dir, 'video.mp4')
                            async with client.stream("GET", video_url) as r:
                                async with aiofiles.open(proxy_video_path, 'wb') as f:
                                    async for chunk in r.aiter_bytes():
                                        await f.write(chunk)
                            video_path = proxy_video_path
            except Exception as e:
                print(f"RapidAPI bypass failed, falling back to yt-dlp: {e}")
                pass
                
        # --- 2. Fallback to standard yt-dlp ---
        if not video_path or not os.path.exists(video_path):
            jobs[job_id]["step"] = "Downloading video from URL..."

            import yt_dlp
            import asyncio

            ydl_opts = {
                'format': 'best[ext=mp4]/best',
                'outtmpl': os.path.join(temp_dir, 'video.%(ext)s'),
                'noplaylist': True,
                'quiet': True,
                'max_filesize': 100 * 1024 * 1024,  # 100MB limit
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                }
            }

            # Check for cookies in environment variable to bypass login wall/bot blocks
            cookies_content = os.getenv("YT_DLP_COOKIES")
            if cookies_content:
                fd, temp_cookie_file = tempfile.mkstemp(suffix=".txt", prefix="cookies_")
                with os.fdopen(fd, 'w', encoding='utf-8') as f:
                    f.write(cookies_content)
                ydl_opts['cookiefile'] = temp_cookie_file

            loop = asyncio.get_event_loop()

            def _download():
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    return ydl.prepare_filename(info)

            video_path = await loop.run_in_executor(None, _download)

        if not video_path or not os.path.exists(video_path):
            raise RuntimeError("Failed to download video. Please verify the URL.")

        jobs[job_id]["step"] = "Video downloaded. Preparing for analysis..."
        await process_video(job_id, video_path)

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        
        err_msg = str(e)
        # Parse common media block errors to make them user-friendly
        if any(keyword in err_msg for keyword in ["empty media response", "403", "Sign in", "confirm you are not a bot", "Login required"]):
            if "instagram.com" in url.lower():
                err_msg = (
                    "Instagram sent an empty response. Because Instagram blocks server-side requests, "
                    "you need to either set a 'RAPIDAPI_KEY' (Pro Fix) or add your browser cookies to the "
                    "'YT_DLP_COOKIES' environment variable in Railway to extract from Instagram links."
                )
            elif "youtube.com" in url.lower() or "youtu.be" in url.lower():
                err_msg = (
                    "YouTube requested bot verification. To extract from YouTube links, please add your "
                    "browser cookies to the 'YT_DLP_COOKIES' environment variable in Railway."
                )
            elif "tiktok.com" in url.lower():
                err_msg = (
                    "TikTok blocked the server. Please either set a 'RAPIDAPI_KEY' (Pro Fix) or add your "
                    "browser cookies to the 'YT_DLP_COOKIES' environment variable in Railway to extract from TikTok."
                )
        
        jobs[job_id]["error"] = err_msg
        jobs[job_id]["step"] = ""
    finally:
        # Clean up temporary cookies file if created
        if temp_cookie_file and os.path.exists(temp_cookie_file):
            try:
                os.remove(temp_cookie_file)
            except Exception:
                pass
        # Clean up temporary directory
        try:
            if temp_dir and os.path.exists(temp_dir):
                import shutil
                shutil.rmtree(temp_dir)
        except Exception:
            pass


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/analyze-url", response_model=VideoJob)
async def analyze_video_url(
    background_tasks: BackgroundTasks,
    request: AnalyzeUrlRequest,
    user: dict = Depends(verify_jwt),
):
    """Analyze a video from URL (YouTube, TikTok, etc.). Returns a job ID for polling."""
    url = request.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL. Must start with http:// or https://",
        )

    job_id = str(uuid.uuid4())

    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "step": "Queued...",
        "result": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }

    background_tasks.add_task(process_video_url, job_id, url)

    return VideoJob(
        job_id=job_id,
        status="pending",
        message="Video URL analysis started. Poll /api/videos/status/{job_id} for updates.",
    )


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
