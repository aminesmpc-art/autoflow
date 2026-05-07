/* ============================================================
   Grok Auto – Type Definitions
   ============================================================ */

// ── Auth & Backend ──
export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface UserProfile {
  email: string;
  plan_type: string;
  is_pro_active: boolean;
  daily_limit: number;
}

export interface DailyUsageResponse {
  text_used: number;
  text_limit: number;
  text_remaining: number;
  full_used: number;
  full_limit: number;
  full_remaining: number;
  plan_type: string;
  is_pro: boolean;
}

// ── Queue & Prompt Types ──
export interface QueueObject {
  id: string;
  name: string;
  prompts: PromptItem[];
  settings: QueueSettings;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped';
  currentPromptIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptItem {
  text: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  attempts: number;
  tileIds?: string[];
  outputFiles?: string[];
  images?: ImageMeta[];
  imageDataUrls?: string[];  // base64 data URLs for image-to-video uploads
  imageNames?: string[];     // original filenames for the images
  extendPrompts?: string[];  // up to 2 extension prompts for video extend (10+10+10=30s)
}

export interface QueueSettings {
  mediaType: 'image' | 'video';
  videoResolution: '480p' | '720p';
  videoDuration: '6s' | '10s';
  aspectRatio: '2:3' | '3:2' | '1:1' | '9:16' | '16:9';
  autoDownload: boolean;
  waitMinSec: number;
  waitMaxSec: number;
  stopOnError: boolean;
  waitForCompletion: boolean;
  inputMethod: 'paste' | 'type';
  typingCharsPerSecond: number;
  videoExtend: boolean;           // enable video extend workflow
  extendDuration: '+6s' | '+10s'; // duration for each extension segment
}

export const DEFAULT_SETTINGS: QueueSettings = {
  mediaType: 'image',
  videoResolution: '720p',
  videoDuration: '6s',
  aspectRatio: '2:3',
  autoDownload: true,
  waitMinSec: 10,
  waitMaxSec: 20,
  stopOnError: false,
  waitForCompletion: false,
  inputMethod: 'paste',
  typingCharsPerSecond: 25,
  videoExtend: false,
  extendDuration: '+10s',
};

// ── Image Metadata ──
export interface ImageMeta {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  lastModified: number;
}

// ── Log Entry ──
export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  queueId?: string;
  promptIndex?: number;
}

// ── Messages ──
export type MessageType =
  | 'START_QUEUE'
  | 'PAUSE_QUEUE'
  | 'RESUME_QUEUE'
  | 'STOP_QUEUE'
  | 'SKIP_CURRENT'
  | 'RETRY_FAILED'
  | 'SCAN_LIBRARY'
  | 'DOWNLOAD_SELECTED'
  | 'DOWNLOAD_FILE'
  | 'LOG'
  | 'QUEUE_STATUS_UPDATE'
  | 'PROMPT_STATUS_UPDATE'
  | 'RUN_LOCK_CHANGED'
  | 'QUEUE_SUMMARY'
  | 'FAILED_TILES_RESULT'
  | 'GET_IMAGE_BLOBS'
  | 'UPLOAD_IMAGES'
  | 'PING'
  | 'SET_DOWNLOAD_RENAME'
  | 'GENERATION_PROGRESS'
  | 'SCAN_PAGE'
  | 'SCAN_PAGE_RESULT';

export interface Message {
  type: MessageType;
  payload?: any;
}

// ── Scanned Asset ──
export interface ScannedAsset {
  index: number;
  thumbnailUrl: string;
  promptLabel: string;
  locator: string;
  selected: boolean;
  mediaType: 'image' | 'video';
  promptNumber: number;
  generationNum: number;
}
