export function uploadFileAccessMessage(): string {
  const edge = typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent);
  return `Automatic upload needs file access. Open ${edge ? 'edge' : 'chrome'}://extensions, `
    + 'find this AutoFlow extension, open Details, and enable "Allow access to file URLs". '
    + 'This lets the extension read local files for upload. Then return and click Retry unfinished; your prepared prompts are kept.';
}

export function isUploadFileAccessError(message: string): boolean {
  return /Allow access to file URLs|DOM\.setFileInputFiles[\s\S]*Not allowed/i.test(message);
}

/** Open the user-controlled details page only from an explicit settings click. */
export async function openUploadFileAccessSettings(): Promise<void> {
  const edge = typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent);
  await chrome.tabs.create({ url: `${edge ? 'edge' : 'chrome'}://extensions/?id=${chrome.runtime.id}` });
}

/** Read the user's setting; never enable access or work around a denial. */
export async function checkUploadFileAccess(): Promise<string | null> {
  if (!chrome.extension?.isAllowedFileSchemeAccess) return null;
  try {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    return allowed === false ? uploadFileAccessMessage() : null;
  } catch {
    return 'Could not check local-file upload permission. Reload the extension and try again.';
  }
}
