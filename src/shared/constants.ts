/* ============================================================
   AutoFlow – Constants
   ============================================================ */

export const EXTENSION_NAME = 'AutoFlow';
export const MAX_IMAGES_PER_PROMPT = 3;
export const MAX_RETRIES = 2;
export const BACKOFF_BASE_MS = 5000;
export const GENERATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const POLL_INTERVAL_MS = 2000;
export const DOM_SETTLE_MS = 1000;
export const IMAGE_ATTACH_MAX_RETRIES = 3;            // retries per image-attachment strategy
export const IMAGE_ATTACH_VERIFY_TIMEOUT_MS = 10000;  // wait for ingredient chips (images upload to Google servers)
export const DEFAULT_WAIT_BETWEEN_PROMPTS_SEC = 2;
export const DISCLAIMER =
  'Third-party tool. Not affiliated with Google. Automates your interactions with Flow in your browser session.';
