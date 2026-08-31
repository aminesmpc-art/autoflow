/**
 * Putting a question to the server, and refusing an answer that ignored it.
 *
 * The hazard this exists for was watched happening, not imagined. During the
 * rolling deploy that shipped attachments, the same probe against the same URL
 * returned 415 from one instance and a cheerful 200 from the other: the older
 * build dropped the unknown `attachments` key — its request model ignores
 * fields it does not know — and answered the prompt as plain text.
 *
 * Put the framing question through that and it comes back with eight confident
 * speaker positions for stills the model never saw. That is the exact failure
 * this whole pipeline is built to refuse: a fabricated answer wearing the shape
 * of a real one, discovered later as a clip cropped to the wrong half of the
 * frame, with nothing in the log to say why.
 *
 * The extension ships through a store review and the service deploys on a push,
 * so a client ahead of its server is the normal state, not the exception.
 */

import { askOnServer, isUnavailable } from '../studio/clip/readingApi';

jest.mock('../shared/api', () => ({
  getAccessToken: async () => 'a-token',
  getExtractorBase: async () => 'https://extractor.test',
}));

const STILL = 'data:image/jpeg;base64,AAAA';

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
  delete (globalThis as any).fetch;
  jest.restoreAllMocks();
});

describe('sending the attachments', () => {
  it('puts them in the body when there are some', async () => {
    const f = answers({ text: '{"positions":[]}', attachments_received: 2 });

    await askOnServer('where is the speaker', { attachments: [STILL, STILL] });

    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.attachments).toEqual([STILL, STILL]);
  });

  it('leaves the field off entirely when there are none', async () => {
    /* A server that predates attachments should see exactly the request it
       always saw, not an empty array it has to have an opinion about. */
    const f = answers({ text: '{"clips":[]}', attachments_received: 0 });

    await askOnServer('rank these moments');

    expect(JSON.parse(f.mock.calls[0][1].body)).not.toHaveProperty('attachments');
  });

  it('drops anything that is not a data URL before it leaves the browser', async () => {
    const f = answers({ text: '{}', attachments_received: 1 });

    await askOnServer('look', { attachments: [STILL, 'https://example.com/a.jpg'] });

    expect(JSON.parse(f.mock.calls[0][1].body).attachments).toEqual([STILL]);
  });
});

describe('refusing an answer about nothing', () => {
  it('rejects a reply that did not count the attachments back', async () => {
    answers({ text: '{"positions":[{"n":1,"x":0.1}]}' });   // no field at all

    await expect(
      askOnServer('where is the speaker', { attachments: [STILL] }),
    ).rejects.toThrow(/without looking at the attachment/);
  });

  it('rejects a reply that counted back the wrong number', async () => {
    /* Eight stills went up, one was read. The seven positions it did not look
       at are the dangerous part, and they are indistinguishable in the reply. */
    answers({ text: '{"positions":[]}', attachments_received: 1 });

    await expect(
      askOnServer('where is the speaker', { attachments: new Array(8).fill(STILL) }),
    ).rejects.toThrow(/without looking at the attachment/);
  });

  it('calls that unavailable, so the run falls back instead of failing', async () => {
    /* The distinction earns its keep here. The chat CAN carry these stills, so
       the right answer to "this server ignored them" is to ask somewhere that
       will — not to stop the run, and not to use the answer. */
    answers({ text: '{"positions":[]}' });

    const error = await askOnServer('where', { attachments: [STILL] }).catch((e) => e);

    expect(isUnavailable(error)).toBe(true);
  });

  it('accepts the reply when the count matches', async () => {
    answers({ text: '{"positions":[]}', attachments_received: 3 });

    await expect(
      askOnServer('where', { attachments: [STILL, STILL, STILL] }),
    ).resolves.toBe('{"positions":[]}');
  });

  it('does not demand a count on a question that sent nothing', async () => {
    /* The ranking sends no attachments, and has worked against servers that
       never had the field. Requiring it there would break the step that is
       already deployed and working. */
    answers({ text: '{"clips":[]}' });

    await expect(askOnServer('rank these')).resolves.toBe('{"clips":[]}');
  });
});
