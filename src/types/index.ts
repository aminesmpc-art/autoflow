/* ============================================================
   AutoFlow – Shared Type Definitions
   ============================================================ */

// ── Prompt Status ──
export type PromptStatus = 'not-added' | 'queued' | 'running' | 'done' | 'failed';

// ── Per-prompt image metadata (stored in chrome.storage.local) ──
export interface ImageMeta {
  id: string;           // unique id (crypto.randomUUID)
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  lastModified: number;
}

// ── A single prompt entry ──
export interface PromptEntry {
  id: string;
  index: number;        // 0-based position in the queue
  text: string;
  images: ImageMeta[];  // 0..3
  status: PromptStatus;
  attempts: number;
  error?: string;
  outputFiles: string[];
  tileIds?: string[];   // tile IDs created when this prompt was generated
}

// ── Input method for filling prompts ──
export type InputMethod = 'paste' | 'type';

// ── Media & creation types ──
export type MediaType = 'video' | 'image';
export type CreationType = 'ingredients' | 'frames';
export type Orientation = 'landscape' | 'portrait';

// ── Video resolution for downloads ──
export type VideoResolution = 'Original (720p)' | '1080p Upscaled' | '4K';
export type ImageResolution = '1K' | '2K' | '4K';

// ── Image generation model & ratio ──
export type ImageModel = 'Nano Banana Pro' | 'Nano Banana 2' | 'Imagen 4';
export type ImageRatio = 'Landscape (16:9)' | 'Portrait (9:16)' | 'Square (1:1)';

// ── Settings snapshot ──
export interface QueueSettings {
  mediaType: MediaType;              // 'video' or 'image'
  creationType: CreationType;        // 'ingredients' or 'frames'
  model: string;
  orientation: Orientation;          // 'landscape' or 'portrait'
  generations: 1 | 2 | 3 | 4;
  stopOnError: boolean;

  // Timing
  waitMinSec: number;                // Min wait time between prompts (default 10)
  waitMaxSec: number;                // Max wait time between prompts (default 20)
  humanizedMode: boolean;            // Enable human-like typing (default false)
  typingSpeedMultiplier: number;     // Typing speed multiplier 0.25–3.0 (default 1.0)

  // Download
  autoDownloadVideos: boolean;       // Auto-download generated videos
  videoResolution: VideoResolution;  // Download resolution for videos
  autoDownloadImages: boolean;       // Auto-download generated images
  imageResolution: ImageResolution;  // Download resolution for images

  // Image generation
  imageModel: ImageModel;            // Model for image generation
  imageRatio: ImageRatio;            // Aspect ratio for image generation

  // Interface
  language: string;                  // UI language (default 'English')

  // Legacy (kept for backward compat)
  autoDownload: boolean;
  waitBetweenPromptsSec: number;
  inputMethod: InputMethod;
  typingCharsPerSecond: number;
  variableTypingDelay: boolean;
}

// ── Run target ──
export type RunTarget = 'newProject' | 'currentProject' | null;

// ── Queue status ──
export type QueueStatus = 'pending' | 'running' | 'paused' | 'completed' | 'stopped';

// ── Queue object ──
export interface QueueObject {
  id: string;
  name: string;         // AUTOFLOW1, AUTOFLOW2…
  prompts: PromptEntry[];
  settings: QueueSettings;
  runTarget: RunTarget;
  status: QueueStatus;
  currentPromptIndex: number;
  createdAt: number;
  updatedAt: number;
}

// ── Scanned asset for Library ──
export interface ScannedAsset {
  index: number;
  label: string;
  thumbnailUrl: string;
  videoSrc: string;     // video src URL (empty for images)
  locator: string;      // selector or aria-label string to re-find
  selected: boolean;
  mediaType: 'video' | 'image';  // detected type of the asset
  promptLabel: string;  // prompt text (for grouping by prompt)
  groupIndex: number;   // virtuoso row data-index (for ordering)
}

// ── Log entry ──
export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  queueId?: string;
  promptIndex?: number;
}

// ── Automation state machine states ──
export type AutomationState =
  | 'IDLE'
  | 'ENSURE_PROJECT'
  | 'ENSURE_VIDEO_INGREDIENTS_MODE'
  | 'APPLY_SETTINGS'
  | 'VERIFY_SETTINGS'
  | 'ATTACH_INGREDIENT_IMAGES'
  | 'ATTACH_FRAME_IMAGES'
  | 'FILL_PROMPT'
  | 'CLICK_GENERATE'
  | 'WAIT_FOR_COMPLETE'
  | 'DOWNLOAD_OUTPUTS'
  | 'MARK_DONE'
  | 'MARK_FAILED'
  | 'NEXT'
  | 'PAUSED'
  | 'WAIT_BETWEEN_PROMPTS';

// ── Messages between side panel ↔ background ↔ content script ──
export type MessageType =
  | 'START_QUEUE'
  | 'PAUSE_QUEUE'
  | 'RESUME_QUEUE'
  | 'STOP_QUEUE'
  | 'SKIP_CURRENT'
  | 'RETRY_FAILED'
  | 'QUEUE_STATUS_UPDATE'
  | 'PROMPT_STATUS_UPDATE'
  | 'LOG'
  | 'DOWNLOAD_FILE'
  | 'SCAN_LIBRARY'
  | 'SCAN_RESULT'
  | 'PREVIEW_ASSET'
  | 'DOWNLOAD_SELECTED'
  | 'REFRESH_MODELS'
  | 'MODELS_RESULT'
  | 'MANUAL_INTERVENTION_NEEDED'
  | 'PING'
  | 'PONG'
  | 'UPLOAD_IMAGES_TO_FLOW'
  | 'ATTACH_IMAGES_RESULT'
  | 'GET_IMAGE_BLOBS'
  | 'IMAGE_BLOBS_RESULT'
  | 'RUN_LOCK_CHANGED'
  | 'QUEUE_SUMMARY'
  | 'SCAN_FAILED_TILES'
  | 'FAILED_TILES_RESULT'
  | 'RETRY_FAILED_TILES';

export interface Message {
  type: MessageType;
  payload?: any;
}

// ── Default settings ──
export const DEFAULT_SETTINGS: QueueSettings = {
  mediaType: 'video',
  creationType: 'ingredients',
  model: 'Veo 3.1 - Fast',
  orientation: 'landscape',
  generations: 1,
  stopOnError: false,

  // Timing
  waitMinSec: 10,
  waitMaxSec: 20,
  humanizedMode: false,
  typingSpeedMultiplier: 1.0,

  // Download
  autoDownloadVideos: false,
  videoResolution: 'Original (720p)',
  autoDownloadImages: false,
  imageResolution: '1K',

  // Image generation
  imageModel: 'Nano Banana Pro',
  imageRatio: 'Landscape (16:9)',

  // Interface
  language: 'English',

  // Legacy
  autoDownload: true,
  waitBetweenPromptsSec: 2,
  inputMethod: 'paste',
  typingCharsPerSecond: 25,
  variableTypingDelay: true,
};

export const AVAILABLE_MODELS = [
  'Veo 3.1 - Fast',
  'Veo 3.1 - Fast [Lower Priority]',
  'Veo 3.1 - Quality',
  'Veo 2 - Fast',
  'Veo 2 - Quality',
];
