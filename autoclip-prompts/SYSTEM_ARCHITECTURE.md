# AutoClip: Comprehensive System Architecture & Design

This document details the complete end-to-end software architecture of **AutoClip**, explaining how its distributed backend, background task workers, AI processing engines, and media pipelines interact.

---

## 🏛️ High-Level System Architecture Diagram

```mermaid
graph TB
    subgraph Client["Frontend Client (React 18 + TypeScript)"]
        UI[Web Dashboard / Ant Design]
        WS_Client[WebSocket Progress Client]
        Player[Interactive Video & Waveform Player]
    end

    subgraph API_Gateway["API Gateway Layer (FastAPI)"]
        Router[FastAPI Asynchronous Router]
        Pydantic[Request Validation & Schemas]
        WS_Server[WebSocket Connection Manager]
    end

    subgraph Message_Broker["Message Broker & Task Queue"]
        Redis[(Redis Message Broker)]
        Celery_Queue[Celery Distributed Task Queue]
    end

    subgraph Worker_Fleet["Celery Worker Fleet (Background Tasks)"]
        Worker1[Task: Video Downloader]
        Worker2[Task: Audio Extraction & Preprocessing]
        Worker3[Task: Whisper Speech-to-Text]
        Worker4[Task: LLM Highlight Scoring & Prompts]
        Worker5[Task: FFmpeg Lossless Video Slicer]
    end

    subgraph External_Engines["External Processing Engines & APIs"]
        YTDLP[yt-dlp / Bilibili Engine]
        Whisper_Engine[Faster-Whisper / CTranslate2]
        LLM_Engine[LLM Provider API\n(Qwen / DeepSeek / Gemini / OpenAI)]
        FFmpeg_Bin[FFmpeg Binary (C/C++)]
    end

    subgraph Persistence["Persistence & Storage Layer"]
        DB[(SQLite / PostgreSQL via SQLAlchemy)]
        Storage[Local / Cloud File System\n/data/videos/\n/data/audio/\n/data/clips/\n/data/thumbnails/]
    end

    %% Interactions
    UI -->|HTTP POST: Start Project| Router
    Router -->|1. Validate Schema| Pydantic
    Router -->|2. Create DB Record| DB
    Router -->|3. Push Task (Task ID)| Redis
    Redis --> Celery_Queue
    Celery_Queue --> Worker_Fleet

    Worker1 -->|Execute Download| YTDLP
    YTDLP -->|Save .mp4| Storage

    Worker2 -->|Extract 16kHz Audio| FFmpeg_Bin
    FFmpeg_Bin -->|Save .mp3/.wav| Storage

    Worker3 -->|Transcribe Audio| Whisper_Engine
    Whisper_Engine -->|Timestamped Segments| DB

    Worker4 -->|Chained Prompts| LLM_Engine
    LLM_Engine -->|Scored Clips & Titles (JSON)| DB

    Worker5 -->|Lossless Cut (-c copy)| FFmpeg_Bin
    FFmpeg_Bin -->|Export Clips & Thumbs| Storage

    Worker_Fleet -.->|Heartbeat & Progress %| WS_Server
    WS_Server -.->|Live Broadcast| WS_Client
    WS_Client -.->|Update Progress Bar| UI
    Storage -.->|Stream Video & Audio| Player
```

---

## 🧩 Detailed Subsystem Breakdown

### 1. The API & Gateway Layer (`FastAPI`)
* **Role:** Serves as the entry point for all client requests, project management, and live status communication.
* **Key Components:**
  * **Asynchronous Endpoints (`async/await`):** Handles high I/O concurrency without blocking the main event loop.
  * **Pydantic Data Models:** Enforces strict type validation on incoming requests and outgoing responses.
  * **WebSocket Connection Manager (`websocket.py`):** Maintains persistent bi-directional WebSocket connections per user session to stream real-time task progress (`0% → 100%`) directly to the UI.

---

### 2. Task Queue & Asynchronous Worker Layer (`Celery + Redis`)
* **Role:** Completely decouples heavy video rendering and AI inference from the web server.
* **How It Works:**
  1. When a user submits a 2-hour video, FastAPI writes the job parameters into Redis and returns HTTP 202 (`Accepted`) in less than 50 milliseconds.
  2. Celery workers pick up the task from the Redis queue and execute the pipeline steps sequentially in the background.
  3. If a step fails, Celery handles automatic retries and logs the failure status to the database.

---

### 3. Speech-to-Text & Subtitle Engine (`Whisper`)
* **Engine:** Uses `faster-whisper` (implemented via `CTranslate2` for 4x faster execution and lower memory usage compared to standard PyTorch Whisper).
* **Processing Steps:**
  1. Audio is normalized to **16kHz mono** (standard input format for acoustic models).
  2. Runs Voice Activity Detection (VAD) to strip out silence.
  3. Emits structured JSON containing word-level and sentence-level timestamps:
     ```json
     {
       "start": 45.2,
       "end": 51.8,
       "text": "The fundamental law of compounding in business is..."
     }
     ```

---

### 4. LLM Highlight Reasoning Engine (`llm_providers.py`)
* **Architecture Pattern:** Provider Factory pattern allowing dynamic switching between different AI backends (Alibaba DashScope Qwen, SiliconFlow DeepSeek, Google Gemini, OpenAI, or local Ollama).
* **The 4-Stage Chained Prompt Execution:**
  ```
  Raw Subtitles 
       │
       ▼
  [Stage 1: Outline Extractor] ──► Breaks transcript into logical chapters
       │
       ▼
  [Stage 2: Highlight Scorer]  ──► Grades segments 0-100 on viral potential
       │
       ▼
  [Stage 3: Hook & Title]      ──► Writes 3-second visual hooks & high-CTR titles
       │
       ▼
  [Stage 4: Compiler]          ──► Assembles themed compilations (e.g., Top 5)
  ```

---

### 5. Media Slicing & Export Engine (`FFmpeg`)
* **Role:** High-speed, frame-accurate cutting and thumbnail generation.
* **Lossless Fast Cut (Stream Copy):**
  ```bash
  ffmpeg -ss {start_time} -to {end_time} -i input.mp4 -c copy -avoid_negative_ts 1 output_clip.mp4
  ```
  * **Why Stream Copy (`-c copy`):** It directly copies the compressed H.264/H.265 video packets without re-encoding frames. A 60-second clip cuts in **under 1.5 seconds**.

* **Thumbnail Capture:**
  ```bash
  ffmpeg -ss {start_time + 1.0} -i input.mp4 -vframes 1 -q:v 2 thumbnail.jpg
  ```

---

### 6. Persistence & Storage Layer
* **Database (SQLAlchemy ORM):** Stores relational models for `Projects`, `Tasks`, `Clips`, `Collections`, and `User Settings`.
* **Storage Hierarchy:**
  ```
  /data/
  ├── videos/        # Original downloaded source videos (.mp4)
  ├── audio/         # Extracted 16kHz mono audio tracks (.mp3/.wav)
  ├── transcripts/   # Raw Whisper subtitle JSONs (.json / .srt)
  ├── clips/         # Exported final short clips (.mp4)
  └── thumbnails/    # High-quality preview stills (.jpg)
  ```

---

## ⚡ Architectural Benefits & Strengths

| Architectural Decision | Why It Was Chosen | Benefit |
| :--- | :--- | :--- |
| **Decoupled Task Queue (Celery/Redis)** | Video processing takes minutes/hours. Web servers should never hold HTTP connections open for long jobs. | Zero server timeouts; handles multiple concurrent users without crashing. |
| **Stream Copy Video Slicing (`-c copy`)** | Re-encoding 4K video consumes 100% GPU/CPU power and takes minutes per clip. | Near-instant clip generation (<2s per clip); virtually zero CPU usage. |
| **Modular LLM Factory** | AI model landscape evolves rapidly. | Easily swap between Qwen, DeepSeek, or Gemini 3.7 with a single config line. |
| **CTranslate2 Whisper Optimization** | Standard PyTorch Whisper is slow and memory-heavy on CPU. | 4x faster transcription speed; runs smoothly even on budget VPS servers. |
| **WebSocket Progress Streaming** | Polling HTTP `/status` every second creates unnecessary database load. | Instant UI updates with minimal network overhead. |

---

## ⚠️ Architectural Limitations & How to Upgrade

1. **Text-Only Blindness (Original Design):**
   * *Limitation:* The original engine only evaluates text subtitles, making it blind to visual comedy or gaming action.
   * *Upgrade:* Replace the text-only LLM call with **Gemini 3.7**, which accepts raw video and audio directly.

2. **Keyframe Alignment on Stream Copy:**
   * *Limitation:* `-c copy` cuts at the nearest keyframe (I-frame), which can sometimes be off by 0.5 seconds.
   * *Upgrade:* Use smart re-encoding only on the first/last few frames (`accurate seek` with FFmpeg) while stream-copying the middle body.
