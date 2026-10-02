import { isUnavailable, readVideoOnServer } from '../studio/clip/readingApi';

jest.mock('../shared/api', () => ({
  getAccessToken: async () => 'token',
  getExtractorBase: async () => 'https://extractor.test',
}));

afterEach(() => {
  delete (globalThis as any).fetch;
});

it('cancels an accepted server job when the run is aborted', async () => {
  const controller = new AbortController();
  const fetchMock = jest.fn()
    .mockImplementationOnce(async () => {
      controller.abort();
      return {
        ok: true,
        status: 202,
        json: async () => ({ job_id: 'job-123' }),
      };
    })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'cancelling' }) });
  (globalThis as any).fetch = fetchMock;

  const file = new File([new Uint8Array([1, 2, 3])], 'video.mp4', { type: 'video/mp4' });
  await expect(
    readVideoOnServer(file, 10, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe('https://extractor.test/api/clip/status/job-123');
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
});

it('does not turn a quota-authority outage into an unmetered fallback', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({ detail: 'Clipping quota service is temporarily unavailable.' }),
  });
  (globalThis as any).fetch = fetchMock;

  const file = new File([new Uint8Array([1, 2, 3])], 'video.mp4', { type: 'video/mp4' });
  let failure: unknown;
  try {
    await readVideoOnServer(file, 10, { baseUrl: 'https://extractor.test' });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  expect(isUnavailable(failure)).toBe(false);
  expect((failure as Error).message).toMatch(/quota service/i);
});
