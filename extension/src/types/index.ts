/* ============================================================
   AutoFlow – Shared Type Definitions
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
  // Queue run limits
  lite_used: number;
  lite_limit: number;
  lite_remaining: number;
  flow_used: number;
  flow_limit: number;
  flow_remaining: number;
  full_monthly_used: number;
  full_monthly_limit: number;
  full_monthly_remaining: number;
}

// ── Prompt Status ──
export type PromptStatus = 'not-added' | 'queued' | 'running' | 'submitted' | 'done' | 'failed';

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
  images: ImageMeta[];  // 0..10
  status: PromptStatus;
  attempts: number;
  error?: string;
  outputFiles: string[];
  tileIds?: string[];   // tile IDs created when this prompt was generated
  mediaId?: string;     // API media ID for direct server status lookup
  isExtension?: boolean; // True if this prompt extends the previous one in the chain
  baseIndex?: number;    // The index of the base prompt this extends
}

// ── Input method for filling prompts ──
export type InputMethod = 'paste' | 'type';

// ── Media & creation types ──
export type MediaType = 'video' | 'image';
export type CreationType = 'ingredients' | 'frames';
export type Orientation = 'landscape' | 'portrait';

// ── Automation mode ──
export type AutomationMode = 'full' | 'flow' | 'lite';

// ── Video resolution for downloads ──
export type VideoResolution = 'Original (720p)' | '1080p Upscaled' | '4K';
export type ImageResolution = '1K' | '2K' | '4K';
export type VideoDuration = '4s' | '6s' | '8s' | '10s';

// ── Image generation model & ratio ──
export type ImageModel = 'Nano Banana Pro' | 'Nano Banana 2' | 'Imagen 4';
export type ImageRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

// ── Settings snapshot ──
export interface QueueSettings {
  mediaType: MediaType;              // 'video' or 'image'
  creationType: CreationType;        // 'ingredients' or 'frames'
  model: string;
  orientation: Orientation;          // 'landscape' or 'portrait'
  generations: 1 | 2 | 3 | 4;
  duration?: VideoDuration;
  voiceIngredient?: string;          // Voice character name (e.g., 'Achernar'), or 'none'
  stopOnError: boolean;
  automationMode: AutomationMode;   // 'full' | 'flow' | 'lite'

  // Timing
  waitMinSec: number;                // Min wait time between prompts (default 10)
  waitMaxSec: number;                // Max wait time between prompts (default 20)
  typingMode: boolean;               // Enable variable-speed typing mode (default false)
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

  // Notifications
  showNotifications: boolean;        // Chrome notification on queue complete (default true)
  notificationSound: boolean;        // Play sound when queue completes (default false)

  // Legacy (kept for backward compat)
  autoDownload: boolean;
  waitBetweenPromptsSec: number;
  inputMethod: InputMethod;
  typingCharsPerSecond: number;
  variableTypingDelay: boolean;

  // LLM settings
  llmEnabled?: boolean;
  llmApiKey?: string;
  llmModel?: string;
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
  // ── Scheduling ──
  chainId?: string;              // ID of the chain this queue belongs to (if any)
  scheduledAt?: number;          // Legacy: Unix timestamp (ms)
  scheduleStatus?: 'scheduled' | 'firing' | 'expired' | 'cancelled';
}

// ── Scheduled Chain (playlist of queues) ──
export interface ChainResult {
  queueId: string;
  queueName: string;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  promptsDone: number;
  promptsFailed: number;
  promptsTotal: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ScheduledChain {
  id: string;                    // Unique chain ID
  queueIds: string[];            // Ordered list of queue IDs to run
  currentIndex: number;          // Which queue is running now (0-based)
  scheduledAt: number;           // When to start (Unix ms)
  waitBetweenSec: number;        // Seconds to wait between queues
  status: 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  results: ChainResult[];
}

// ── Tile state as detected by the scanner ──
export type ScannedTileState = 'completed' | 'failed' | 'generating' | 'unknown';

// ── Scanned asset for Library ──
export interface ScannedAsset {
  index: number;            // sequential index across all assets
  tileId: string;           // Flow's data-tile-id (unique per tile)
  label: string;            // display label
  thumbnailUrl: string;
  videoSrc: string;         // video src URL (empty for images)
  locator: string;          // CSS selector to re-find this tile
  selected: boolean;
  mediaType: 'video' | 'image';    // detected media type
  tileState: ScannedTileState;     // tile state at scan time
  promptLabel: string;             // prompt text (for display & search)
  groupIndex: number;              // virtuoso row data-index (for ordering)
  groupId: string;                 // unique group identifier (row-based)
  generationNum: number;           // which generation within the prompt (1, 2, 3…)
  totalInGroup: number;            // total generations for this prompt
  promptNumber: number;            // sequential prompt number (oldest = 1)
  isRetry: boolean;                // true if this tile came from a retry (merged group)
  modelName?: string;              // AI model used (e.g. "Veo 3.1 - Fast") — from Batch view
  createdAt?: string;              // creation date text (e.g. "Created Mar 31, 2026") — from Batch view
}

// ── Prompt history — saved when a queue runs, used for library sorting ──
export interface PromptHistoryEntry {
  queueId: string;
  queueName: string;
  timestamp: number;
  prompts: { index: number; text: string }[];
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
  | 'APPLY_VOICE'
  | 'ATTACH_INGREDIENT_IMAGES'
  | 'ATTACH_FRAME_IMAGES'
  | 'FILL_PROMPT'
  | 'CLICK_GENERATE'
  | 'EXTEND_VIDEO'
  | 'WAIT_FOR_COMPLETE'
  | 'DOWNLOAD_OUTPUTS'
  | 'MARK_DONE'
  | 'MARK_SUBMITTED'
  | 'MARK_FAILED'
  | 'NEXT'
  | 'PAUSED'
  | 'WAIT_BETWEEN_PROMPTS'
  | 'WAIT_FOR_REPROMPT';

// ── Messages between side panel ↔ background ↔ content script ──
export type MessageType =
  | 'START_QUEUE'
  | 'PAUSE_QUEUE'
  | 'RESUME_QUEUE'
  | 'STOP_QUEUE'
  | 'SKIP_CURRENT'
  | 'RETRY_FAILED'
  | 'QUEUE_STATUS_UPDATE'
  | 'QUEUE_PHASE_UPDATE'
  | 'PROMPT_STATUS_UPDATE'
  | 'LOG'
  | 'DOWNLOAD_FILE'
  | 'SCAN_LIBRARY'
  | 'SCAN_RESULT'
  | 'PREVIEW_ASSET'
  | 'FOCUS_FLOW_TAB'
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
  | 'AUTO_SCAN_LIBRARY'
  | 'SCAN_FAILED_TILES'
  | 'FAILED_TILES_RESULT'
  | 'RETRY_FAILED_TILES'
  | 'RETRY_SINGLE_TILE'
  | 'UPSCALE_SELECTED'
  | 'SET_DOWNLOAD_RENAME'
  | 'SUPPRESS_DOWNLOADS'
  | 'UNSUPPRESS_DOWNLOADS'
  | 'REACT_TRIGGER'
  | 'MAIN_WORLD_PASTE'
  | 'TRUSTED_ENTER'
  | 'TRUSTED_CLICK'
  | 'REPROMPT_NEEDED'
  | 'REPROMPT_RESPONSE'
  | 'BATCH_REPROMPT_NEEDED'
  | 'BATCH_REPROMPT_RESPONSE'
  | 'QUEUE_RESUME_AVAILABLE'
  | 'RESUME_QUEUE_CONFIRMED'
  | 'DISCARD_INTERRUPTED_QUEUE'
  | 'QUEUE_RECOVERY_RESULT'
  | 'PLAY_NOTIFICATION_SOUND'
  | 'INSTALL_NETWORK_SNIFFER'
  | 'BATCH_API_DOWNLOAD'
  | 'VERIFY_MEDIA_URL'
  | 'FAKE_CANCEL_ALERT'
  | 'DOWNLOAD_PROGRESS'
  | 'SCHEDULE_CHAIN'
  | 'KEEPALIVE_PING'
  | 'CANCEL_CHAIN'
  | 'CHAIN_PROGRESS'
  | 'API_STATUS_CHANGED'
  | 'CHECK_API_AVAILABILITY'
  | 'CALL_LLM'
  | 'TEST_LLM_CONNECTION'
  | 'RUN_ACTIVE_CHECK'
  | 'CAPTURED_REQUEST_INFO';

export interface Message {
  type: MessageType;
  payload?: any;
}

// ── Flow API types (from aisandbox-pa.googleapis.com) ──

/** Mapped status from Google Flow's mediaGenerationStatus enum. */
export type FlowGenerationState = 'queued' | 'generating' | 'completed' | 'failed' | 'unknown';

/** Parsed generation status from Google Flow's API. */
export interface FlowGenerationStatus {
  /** Media/generation UUID (e.g. "5e32aa45-0db9-4d25-a56d-332db6c42a24") */
  mediaId: string;
  /** Project UUID */
  projectId: string;
  /** Workflow UUID */
  workflowId: string;
  /** Mapped status */
  state: FlowGenerationState;
  /** Raw API status string (e.g. "MEDIA_GENERATION_STATUS_SUCCESSFUL") */
  rawStatus: string;
  /** Detailed failure reason from API (safety, server error, etc.) */
  failureReason?: string;
  /** The prompt text used */
  promptText: string;
  /** Model name (e.g. "veo_3_1_t2v_fast_ultra") */
  modelName: string;
  /** Video aspect ratio */
  aspectRatio: string;
  /** Video duration (e.g. "8s") */
  duration: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** Remaining credits after this generation */
  remainingCredits?: number;
}

// ── Default settings ──
export const DEFAULT_SETTINGS: QueueSettings = {
  mediaType: 'video',
  creationType: 'ingredients',
  model: 'Veo 3.1 - Fast',
  orientation: 'landscape',
  generations: 1,
  duration: '8s',
  voiceIngredient: 'none',
  stopOnError: false,
  automationMode: 'flow',

  // Timing
  waitMinSec: 10,
  waitMaxSec: 20,
  typingMode: false,
  typingSpeedMultiplier: 1.0,

  // Download
  autoDownloadVideos: false,
  videoResolution: 'Original (720p)',
  autoDownloadImages: false,
  imageResolution: '1K',

  // Image generation
  imageModel: 'Nano Banana Pro',
  imageRatio: '16:9',

  // Interface
  language: 'English',

  // Notifications
  showNotifications: true,
  notificationSound: false,

  // Legacy
  autoDownload: true,
  waitBetweenPromptsSec: 2,
  inputMethod: 'paste',
  typingCharsPerSecond: 25,
  variableTypingDelay: true,

  // LLM settings
  llmEnabled: false,
  llmApiKey: '',
  llmModel: 'gemini-1.5-flash',
};

export const AVAILABLE_MODELS = [
  'Omni Flash',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Veo 3.1 - Quality',
  'Veo 3.1 - Lite [Lower Priority]',
];

export const AVAILABLE_VOICES = [
  'none',
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
];
