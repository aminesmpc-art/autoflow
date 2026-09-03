/**
 * The ceiling on what one run may spend on model asks.
 *
 * The daily quota counts readings, and only readings — /api/clip/read charges
 * it once and /api/clip/ask charges nothing. So the number nobody was watching
 * is the asks: one for the survey, then per cut up to four to locate the two
 * spoken lines, one to find the speaker across eight stills, and one to plan
 * the edit sheet. On footage the reading handles, that is 1 + N. On footage it
 * does not, ten clips is sixty-one asks and the allowance sees one job.
 *
 * The two properties worth pinning down are both about what a refusal must NOT
 * do. It must not be a ReadingUnavailable, because serverFirstAsk answers that
 * one by putting the same question to a chat tab — spending the money it was
 * told to stop spending, somewhere else. And it must count at the point of
 * sending rather than on success, or a run retries its way past the ceiling.
 */

import {
  askBudget, askOnServer, isBudgetSpent, isUnavailable, startAskBudget,
} from '../studio/clip/readingApi';

jest.mock('../shared/api', () => ({
  getAccessToken: async () => 'a-token',
  getExtractorBase: async () => 'https://extractor.test',
}));

function answers(body: unknown, status = 200) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  startAskBudget(null);
  delete (globalThis as any).fetch;
  jest.restoreAllMocks();
});

describe('the run budget', () => {
  it('counts nothing until one is opened', async () => {
    const f = answers({ text: 'ok' });
    expect(askBudget()).toBeNull();

    await askOnServer('one');
    await askOnServer('two');

    expect(f).toHaveBeenCalledTimes(2);
    expect(askBudget()).toBeNull();
  });

  it('lets a run spend exactly its ceiling', async () => {
    const f = answers({ text: 'ok' });
    startAskBudget(3);

    await askOnServer('one');
    await askOnServer('two');
    await askOnServer('three');

    expect(f).toHaveBeenCalledTimes(3);
    expect(askBudget()).toEqual({ ceiling: 3, spent: 3, left: 0 });
  });

  it('refuses the next one without sending it', async () => {
    const f = answers({ text: 'ok' });
    startAskBudget(1);
    await askOnServer('the only one');

    const error = await askOnServer('one too many').catch((e) => e);

    expect(isBudgetSpent(error)).toBe(true);
    /* The refusal has to happen before the request. One that has already been
       sent has not saved anything. */
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not look like a server that cannot answer', async () => {
    /* The load-bearing one. serverFirstAsk treats `unavailable` as "ask a chat
       tab instead", so a budget refusal wearing that flag would move the
       spending rather than stop it — and would look, from the outside, exactly
       like a working budget. */
    answers({ text: 'ok' });
    startAskBudget(1);
    await askOnServer('the only one');

    const error = await askOnServer('one too many').catch((e) => e);

    expect(isUnavailable(error)).toBe(false);
    expect(String(error.message)).toContain('1 model asks');
  });

  it('counts a failed ask, so retries cannot outlast the ceiling', async () => {
    /* A request that was sent and then failed is a request the model may have
       been paid for. Counting only successes would let a run whose asks all
       fail send them for ever. */
    answers({ detail: 'upstream exploded' }, 500);
    startAskBudget(2);

    await askOnServer('one').catch(() => {});
    await askOnServer('two').catch(() => {});
    const third = await askOnServer('three').catch((e) => e);

    expect(isBudgetSpent(third)).toBe(true);
    expect(askBudget()).toEqual({ ceiling: 2, spent: 2, left: 0 });
  });

  it('starts a fresh count for the next run', async () => {
    answers({ text: 'ok' });
    startAskBudget(1);
    await askOnServer('run one');
    expect(askBudget()!.left).toBe(0);

    startAskBudget(2);

    expect(askBudget()).toEqual({ ceiling: 2, spent: 0, left: 2 });
    await expect(askOnServer('run two')).resolves.toBe('ok');
  });

  it('treats a ceiling of zero or less as no budget at all', async () => {
    /* Rather than as a run that may do nothing — a caller passing 0 by
       accident should get the old behaviour, not a run that refuses its own
       survey ask and returns no clips. */
    const f = answers({ text: 'ok' });
    startAskBudget(0);
    expect(askBudget()).toBeNull();

    await askOnServer('still allowed');

    expect(f).toHaveBeenCalledTimes(1);
  });
});
