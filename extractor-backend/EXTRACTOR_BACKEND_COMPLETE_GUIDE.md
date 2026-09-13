# 🎥 AutoFlow PromptExtractor — Complete Engineering Manual & Guidebook

> **Service Component:** Video Multimodal Prompt Reverse-Engineering Engine  
> **Repository Path:** `c:\Users\HP PROBOOK\Desktop\autoflow\extractor-backend`  
> **Core Stack:** Python 3.12, FastAPI 0.115, Google GenAI SDK (Gemini 2.5 Flash), Vertex AI, Google Cloud Storage, yt-dlp, json-repair, Supabase, PyJWT

---

## 📑 Table of Contents
1. [Introduction & Service Role](#1-introduction--service-role)
2. [End-to-End Processing Lifecycle](#2-end-to-end-processing-lifecycle)
3. [Deep Multimodal Prompt Engineering](#3-deep-multimodal-prompt-engineering)
4. [Dual AI Infrastructure: Vertex AI vs Google AI Studio](#4-dual-ai-infrastructure-vertex-ai-vs-google-ai-studio)
5. [URL Downloader & Anti-Bot Bypass Architecture](#5-url-downloader--anti-bot-bypass-architecture)
6. [Quota Enforcement & Django Core Integration](#6-quota-enforcement--django-core-integration)
7. [API Specification & Schemas](#7-api-specification--schemas)
8. [Configuration & Environment Variables](#8-configuration--environment-variables)
9. [Local Development, Deployment & Troubleshooting](#9-local-development-deployment--troubleshooting)

---

## 1. Introduction & Service Role

In generative video workflows (e.g. creating content with **Google Veo**, **Runway Gen-3**, **Midjourney**, or **Luma Dream Machine**), creators frequently find reference videos on TikTok, Instagram Reels, or YouTube and want to replicate their visual style, camera dynamics, lighting, and character appearance.

**PromptExtractor** is the microservice that performs this reverse-engineering:
- It ingests video files or URLs.
- It passes the video through **Google Gemini 2.5 Flash** with custom director instructions.
- It returns structured, ready-to-render image prompts, motion prompts, character turnaround sheets, and dialogue transcriptions.

---

## 2. End-to-End Processing Lifecycle

```
[1. User Request] ──> POST /api/videos/analyze (Video Binary or URL)
         │
         ▼
[2. Auth & Quota Check] ──> Validate JWT & query Django: /api/extractions/check-limit/
         │
         ▼
[3. Ingestion & Pre-processing]
         ├─ Direct Upload: Stored in OS tempfile (Validated size < 500MB)
         └─ URL: yt-dlp / RapidAPI proxy download -> local MP4
         │
         ▼
[4. AI Cloud Pipeline]
         ├─ Vertex AI: Upload to GCS (gs://...) -> Call Gemini 2.5 Flash
         └─ AI Studio: Upload to Gemini Files API -> Wait for ACTIVE status
         │
         ▼
[5. Structured Extraction & Self-Healing]
         ├─ Gemini returns JSON string
         ├─ Regex clean markdown fences (```json ... ```)
         └─ json-repair fallback parser fixes unescaped quotes or trailing commas
         │
         ▼
[6. Polling & Result Delivery] ──> GET /api/videos/status/{job_id} -> Status: "completed"
```

---

## 3. Deep Multimodal Prompt Engineering

PromptExtractor uses a two-tier prompt architecture in `app/api/videos.py`:

### Tier 1: System Instruction
```python
SYSTEM_INSTRUCTION = """You are an expert Film Director and Visual Engineer.
Your goal is to reverse-engineer video footage into production-ready prompt streams:
1. Static Image Generation: Focus on texture, lighting, lens, 8k detail.
2. Video Dynamics: Focus on physics, gravity, wind, and camera movement."""
```

### Tier 2: Dynamic Analysis Prompt with Style Modifiers
The prompt asks Gemini to structure the response into five key fields:
- `video_concept`: High-level mood, lighting, and narrative summary.
- `voiceover_text`: Transcribed or translated spoken dialogue.
- `characters_description`: Physical traits and clothing breakdown of all visible subjects.
- `character_sheets`: Turnaround concept art prompts with neutral grey backdrops for character consistency.
- `shots`: Sequential array containing `time_range`, `image_prompt` (photographic/artistic still prompt), and `video_prompt` (camera trajectory, subject velocity, physics).

#### Style Directives:
- **`faithful`**: Default behavior; reproduces the source medium.
- **`cinematic`**: Adds anamorphic lens tags, shallow depth of field, and film color grading.
- **`photorealistic`**: Focuses on believable skin pore detail, real lighting, and camera focal lengths.
- **`illustrated`**: Shifts prompts to 2D vector / linework illustration.
- **`anime`**: Shifts prompts to cel-shading, expressive facial keys, and high-contrast lighting.
- **`3d`**: Generates Unreal Engine 5 / Octane subsurface scattering 3D render prompts.

---

## 4. Dual AI Infrastructure: Vertex AI vs Google AI Studio

To accommodate both enterprise cloud billing and zero-setup developer environments, PromptExtractor supports two operational modes in `process_video()`:

### 1. Vertex AI Mode (Enterprise & Production)
- **Activated When:** `GCP_PROJECT_ID` and `GCP_CREDENTIALS_JSON` are configured.
- **Workflow:**
  1. Creates temporary Google OAuth2 credentials from the service account JSON.
  2. Uploads the video file to the configured Google Cloud Storage bucket (`GCS_BUCKET_NAME`).
  3. Initializes `genai.Client(vertexai=True, project=..., location=...)`.
  4. References the video via its Cloud Storage URI (`gs://bucket/videos/uuid.mp4`).
  5. Deletes the temporary GCS blob in the `finally` block once analysis completes.

### 2. Google AI Studio Mode (Developer & Fallback)
- **Activated When:** `GEMINI_API_KEY` is provided without GCP credentials.
- **Workflow:**
  1. Initializes `genai.Client(api_key=...)`.
  2. Uploads the local video file via `client.files.upload()`.
  3. Polls the file status until it reaches `ACTIVE`.
  4. Generates analysis content and deletes the file from Gemini Files storage upon completion.

---

## 5. URL Downloader & Anti-Bot Bypass Architecture

Downloading video from social media platforms (Instagram, TikTok, YouTube) often triggers datacenter bot blocks. PromptExtractor implements a multi-tier defense:

```
[Target URL]
     │
     ├─► [Tier 1: RapidAPI Proxy] (For Instagram Reels & TikTok if RAPIDAPI_KEY set)
     │        │
     │        ├─► Success: Download video payload directly via HTTP stream
     │        └─► Failure: Fallback to Tier 2
     │
     └─► [Tier 2: yt-dlp Engine]
              │
              ├─► Residential Proxy: Route requests via PROXY_URL
              ├─► Cookie Injection: Load netscape cookies via YT_DLP_COOKIES
              └─► Validation: Reject empty payloads (< 150 KB)
```

---

## 6. Quota Enforcement & Django Core Integration

Because video analysis with Gemini 2.5 Flash incurs model costs, PromptExtractor validates customer plan entitlements prior to processing heavy uploads:

```python
async def enforce_extraction_limit(authorization: Optional[str]) -> None:
    if not settings.enforce_extraction_limits or not authorization:
        return

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{settings.django_api_url.rstrip('/')}/extractions/check-limit/",
                headers={"Authorization": authorization},
            )
        if resp.status_code == 200:
            state = resp.json()
            if state.get("allowed") is False:
                raise HTTPException(
                    status_code=429,
                    detail=f"You have reached your limit of {state.get('limit')} extractions."
                )
    except Exception:
        # Fails open on connection timeout to avoid blocking paying users during network blips
        return
```

---

## 7. API Specification & Schemas

### Key Models (`app/api/videos.py`)

```python
class ExtractionOptions(BaseModel):
    shot_count: Optional[int] = Field(default=None, ge=1, le=40)
    language: str = "auto"
    style: str = "faithful"
    character_sheets: bool = True

class AnalyzeUrlRequest(BaseModel):
    url: str
    options: Optional[ExtractionOptions] = None

class JobStatusResponse(BaseModel):
    job_id: str
    status: str          # "pending" | "processing" | "completed" | "failed"
    step: str            # Human-readable progress description
    error: Optional[str]
    result: Optional[dict]
```

---

## 8. Configuration & Environment Variables

| Variable | Type | Description |
|---|---|---|
| `FRONTEND_URL` | String | Allowed CORS origin (e.g. `http://localhost:3000`). |
| `JWT_SECRET_KEY` | String | Secret key for decoding user authentication tokens. |
| `JWT_ALGORITHM` | String | JWT algorithm (`HS256`). |
| `GEMINI_API_KEY` | String | Google AI Studio API key. |
| `GCP_PROJECT_ID` | String | Google Cloud Project ID for Vertex AI. |
| `GCP_LOCATION` | String | GCP Region (default: `us-central1`). |
| `GCP_CREDENTIALS_JSON` | String | Service Account private key JSON as a single-line string. |
| `GCS_BUCKET_NAME` | String | Bucket name for staging video files (default: `autoflow-extractor-videos`). |
| `DJANGO_API_URL` | String | URL of the central AutoFlow Django backend (`https://api.auto-flow.studio/api`). |
| `ENFORCE_EXTRACTION_LIMITS` | Boolean | Whether to perform server-to-server quota checks. |
| `RAPIDAPI_KEY` | String | RapidAPI key for Instagram/TikTok proxy unblocking. |
| `PROXY_URL` | String | Residential HTTP proxy for `yt-dlp` (e.g. `http://user:pass@ip:port`). |
| `YT_DLP_COOKIES` | String | Netscape format cookies for bot-blocked platforms. |

---

## 9. Local Development, Deployment & Troubleshooting

### Local Run Commands
```bash
# Setup virtualenv
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install packages
pip install -r requirements.txt

# Start local server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Common Issues & Troubleshooting
1. **`429 Too Many Requests` on Upload:**
   - Cause: User has exhausted their extraction allowance on AutoFlow.
   - Solution: Upgrade plan or reset allowance in Django admin.
2. **`empty media response` on Instagram URL:**
   - Cause: Instagram blocked the server's IP address.
   - Solution: Set `RAPIDAPI_KEY` or provide valid cookies in `YT_DLP_COOKIES`.
3. **`JSONDecodeError` on Gemini Output:**
   - Cause: Model emitted unescaped quotes in prompt strings.
   - Solution: `json-repair` automatically intercepts and sanitizes the output.
