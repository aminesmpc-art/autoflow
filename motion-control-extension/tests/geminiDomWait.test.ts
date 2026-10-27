import { sleepOrDomChange } from '../../studio-extension/src/content/shared/hiddenWait';

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.body.innerHTML = '<message-content aria-busy="true">Working</message-content>';
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); document.body.innerHTML = ''; });

it.each(['text', 'aria-busy', 'class'])('wakes for Gemini %s completion changes with no page timer firing', async kind => {
  const deferred: Array<{ ms: number; finish: () => void }> = [];
  const clock = (ms: number) => new Promise<void>(finish => { deferred.push({ ms, finish }); });
  let done = false;
  const wait = sleepOrDomChange(2000, 250, clock).then(() => { done = true; });
  const reply = document.querySelector('message-content')!;
  if (kind === 'text') reply.firstChild!.textContent = 'Complete answer';
  else reply.setAttribute(kind, kind === 'class' ? 'complete' : 'false');
  await Promise.resolve();
  // An early final mutation is deferred to the minimum wait, never lost.
  expect(deferred.map(value => value.ms)).toEqual([2000, 250]);
  expect(done).toBe(false);
  deferred[1].finish(); await wait;
  expect(jest.getTimerCount()).toBe(0);
  // Observer is disconnected, and later worker responses cannot settle twice.
  deferred[0].finish(); reply.setAttribute('class', 'another-change'); await Promise.resolve();
  expect(deferred).toHaveLength(2);
});

it('the worker clock still reconciles when the page makes no DOM changes', async () => {
  await sleepOrDomChange(2000, 250, async () => {});
  expect(jest.getTimerCount()).toBe(0);
});
