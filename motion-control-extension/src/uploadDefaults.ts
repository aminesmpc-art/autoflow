export const UPLOAD_CHOICE_KEY = 'af_debug_upload';

export async function loadUploadChoice(): Promise<boolean> {
  const stored = await chrome.storage.local.get(UPLOAD_CHOICE_KEY);
  if (typeof stored[UPLOAD_CHOICE_KEY] === 'boolean') return stored[UPLOAD_CHOICE_KEY];
  await chrome.storage.local.set({ [UPLOAD_CHOICE_KEY]: true });
  return true;
}
