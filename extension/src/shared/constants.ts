/* ============================================================
   AutoFlow – Constants
   ============================================================ */

export const EXTENSION_NAME = 'AutoFlow';
export const MAX_IMAGES_PER_PROMPT = 10;
export const MAX_FRAMES_PER_PROMPT = 2;                  // frames mode: Start + End only
export const MAX_SHARED_IMAGES = 3;                    // shared reference images pool
export const IMAGE_UPLOAD_BATCH_SIZE = 5;               // upload in batches of N to avoid overwhelming Flow
export const MAX_RETRIES = 2;
export const BACKOFF_BASE_MS = 5000;
export const GENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const POLL_INTERVAL_MS = 2000;
export const DOM_SETTLE_MS = 1000;
export const IMAGE_ATTACH_MAX_RETRIES = 3;            // retries per image-attachment strategy
export const IMAGE_ATTACH_VERIFY_TIMEOUT_MS = 30000;  // wait for ingredient chips (images upload to Google servers)
export const DEFAULT_WAIT_BETWEEN_PROMPTS_SEC = 2;
export const DISCLAIMER =
  'Third-party tool. Not affiliated with Google. Automates your interactions with Flow in your browser session.';
