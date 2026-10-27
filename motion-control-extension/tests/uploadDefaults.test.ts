import { loadUploadChoice, UPLOAD_CHOICE_KEY } from '../src/uploadDefaults';

it.each([undefined, null, 'true'])('initializes automatic uploads when no valid preference exists: %s', async value => {
  const stored: Record<string, unknown> = { [UPLOAD_CHOICE_KEY]: value };
  (globalThis as any).chrome = { storage: { local: {
    get: jest.fn(async () => ({ ...stored })),
    set: jest.fn(async values => { Object.assign(stored, values); }),
  } } };
  expect(await loadUploadChoice()).toBe(true);
  expect(stored[UPLOAD_CHOICE_KEY]).toBe(true);
  await loadUploadChoice();
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
});

it.each([true, false])('preserves the user preference %s', async value => {
  (globalThis as any).chrome = { storage: { local: {
    get: jest.fn(async () => ({ [UPLOAD_CHOICE_KEY]: value })), set: jest.fn(),
  } } };
  expect(await loadUploadChoice()).toBe(value);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
