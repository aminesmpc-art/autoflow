import { sleep } from '../../studio-extension/src/content/gemini/wait';
import { answerGeminiWait } from '../../studio-extension/src/background/geminiWait';

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  (globalThis as any).chrome = { runtime: { id: 'motion', sendMessage: jest.fn() } };
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('the worker response releases a hidden wait even if its page timer never fires', async () => {
  chrome.runtime.sendMessage = jest.fn().mockResolvedValue({ elapsed: true });
  await sleep(500);
  expect(jest.getTimerCount()).toBe(0);
});
it('a failed worker leaves the page timer available', async () => {
  chrome.runtime.sendMessage = jest.fn().mockRejectedValue(new Error('worker recycled'));
  let done = false;
  const wait = sleep(500).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  jest.advanceTimersByTime(500); await wait;
});
it('an old worker response cannot wake the wait prematurely', async () => {
  chrome.runtime.sendMessage = jest.fn().mockResolvedValue({});
  let done = false;
  const wait = sleep(500).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  jest.advanceTimersByTime(500); await wait;
});
it('foreground waits use the page clock', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const wait = sleep(500); jest.advanceTimersByTime(500); await wait;
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

const sender = { id: 'motion', tab: { id: 7 }, frameId: 0, url: 'https://gemini.google.com/app/fixture' } as chrome.runtime.MessageSender;
it('answers an authenticated Gemini main frame after the requested bounded delay', () => {
  const reply = jest.fn();
  expect(answerGeminiWait(500, sender, reply)).toBe(true);
  jest.advanceTimersByTime(499); expect(reply).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1); expect(reply).toHaveBeenCalledWith({ elapsed: true });
});
it.each([0, -1, 2001, Infinity, NaN, '500', undefined])('rejects an invalid delay %s', ms => {
  const reply = jest.fn();
  expect(answerGeminiWait(ms, sender, reply)).toBe(false);
  expect(reply).toHaveBeenCalledWith({ elapsed: false });
  expect(jest.getTimerCount()).toBe(0);
});
it.each([
  { ...sender, id: 'other-extension' }, { ...sender, frameId: 1 },
  { ...sender, url: 'https://gemini.google.com.evil.test/app' }, { ...sender, url: 'https://flow.google.com/' },
  { ...sender, tab: undefined }, { ...sender, url: undefined },
])('rejects messages outside the Gemini main frame', other => {
  expect(answerGeminiWait(500, other, jest.fn())).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
