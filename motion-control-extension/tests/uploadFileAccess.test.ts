import { checkUploadFileAccess, uploadFileAccessMessage, isUploadFileAccessError, openUploadFileAccessSettings } from '../../studio-extension/src/background/uploadFileAccess';
import { uploadToFlow, uploadViaFileChooser } from '../../studio-extension/src/background/debugUpload';

beforeEach(() => {
  (globalThis as any).chrome = {
    extension: { isAllowedFileSchemeAccess: jest.fn().mockResolvedValue(false) },
    downloads: { search: jest.fn(), download: jest.fn() },
    debugger: { attach: jest.fn() },
    tabs: { sendMessage: jest.fn() },
  };
});
it('explains the user-controlled permission when denied', async () => {
  expect(await checkUploadFileAccess()).toContain('Allow access to file URLs');
});
it('permits uploads when file access is enabled', async () => {
  (chrome.extension.isAllowedFileSchemeAccess as jest.Mock).mockResolvedValue(true);
  expect(await checkUploadFileAccess()).toBeNull();
});
it('fails clearly when the permission check itself fails', async () => {
  (chrome.extension.isAllowedFileSchemeAccess as jest.Mock).mockRejectedValue(new Error('unavailable'));
  expect(await checkUploadFileAccess()).toContain('Could not check');
});
it('blocks before downloads, page interaction or debugger attachment', async () => {
  const result = await uploadToFlow(9, [{ dataUrl: 'data:video/mp4;base64,YQ==', filename: 'clip.mp4' }]);
  expect(result.ok).toBe(false);
  expect(result.error).toContain('Retry unfinished');
  expect(chrome.downloads.search).not.toHaveBeenCalled();
  expect(chrome.downloads.download).not.toHaveBeenCalled();
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  expect(chrome.debugger.attach).not.toHaveBeenCalled();
});
it('also protects the lower-level chooser entry point', async () => {
  expect((await uploadViaFileChooser(9, ['C:/clip.mp4'])).ok).toBe(false);
  expect(chrome.debugger.attach).not.toHaveBeenCalled();
});
it('shows Edge settings for Edge users', () => {
  const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Edg/140.0');
  expect(uploadFileAccessMessage()).toContain('edge://extensions');
  agent.mockRestore();
});

it('recognizes saved legacy errors and opens this extension details page on request', async () => {
  expect(isUploadFileAccessError('DOM.setFileInputFiles: {"code":-32000,"message":"Not allowed"}')).toBe(true);
  expect(isUploadFileAccessError('Flow generation timed out')).toBe(false);
  (globalThis as any).chrome.runtime = { id: 'motion-extension' };
  (globalThis as any).chrome.tabs.create = jest.fn(async () => ({}));
  const agent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Edg/140.0');
  await openUploadFileAccessSettings();
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'edge://extensions/?id=motion-extension' });
  agent.mockRestore();
});
