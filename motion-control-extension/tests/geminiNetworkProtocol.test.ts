import {
  generationPrompt,
  MAX_RESPONSE_CHARS,
  parseGeminiTextResponse,
} from '../../studio-extension/src/content/gemini/networkProtocol';

const ENDPOINT = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const PROMPT = 'Explain the camera move in this clip, keeping the original timing.';
const ANSWER = 'The camera tracks forward while the subject turns toward the open doorway.';

/* Synthetic protocol fixtures, never captured account data. The relevant
   response fields are body[4][0] (first candidate), candidate[0] (id),
   candidate[1][0] (visible answer), candidate[8][0] (completion), and
   body[1][0] (conversation id). Candidate[37] is deliberately untrusted. */
function candidate(text: unknown = ANSWER, complete: unknown = 2, id: unknown = 'rc_fixture'): any[] {
  const value: any[] = [];
  value[0] = id;
  value[1] = [text];
  value[8] = [complete];
  return value;
}

function responseBody(value: unknown = candidate(), conversation: unknown = 'c_fixture'): any[] {
  const body: any[] = [];
  if (conversation !== undefined) body[1] = [conversation];
  body[4] = [value];
  return body;
}

function envelope(body: unknown): unknown[] {
  return [['wrb.fr', null, JSON.stringify(body), null, null, null, 'generic']];
}

function frame(value: unknown): string {
  const json = JSON.stringify(value);
  // Google-style framing uses a numeric length followed by a JSON envelope.
  // Unicode makes byte length differ from JavaScript string length.
  const bytes = new Blob([json]).size;
  return `${bytes}\n${json}\n`;
}

function stream(...bodies: unknown[]): string {
  return ")]}'\n\n" + bodies.map(body => frame(envelope(body))).join('');
}

function requestBody(prompt: unknown = PROMPT): string {
  const inner = [[prompt], null, null];
  return new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify(inner)]), at: 'synthetic-token' }).toString();
}

describe('Gemini generation request correlation', () => {
  it('extracts the exact prompt from the generation request body', () => {
    expect(generationPrompt(ENDPOINT + '?bl=synthetic&_reqid=17&rt=c', 'POST', requestBody())).toBe(PROMPT);
  });

  it('trims only edge whitespace while preserving Unicode, brackets, quotes, newlines and plus signs', () => {
    const prompt = '  A + B ["quoted"] \\ path — forêt 🌲\nSecond line  ';
    expect(generationPrompt(ENDPOINT, 'POST', requestBody(prompt))).toBe(prompt.trim());
  });

  it('accepts the same endpoint when the page opens a same-origin relative URL', () => {
    expect(generationPrompt(new URL(ENDPOINT).pathname, 'POST', requestBody())).toBe(PROMPT);
  });

  it.each([
    ENDPOINT.replace('https:', 'http:'),
    ENDPOINT.replace('gemini.google.com', 'gemini.google.com.attacker.test'),
    ENDPOINT.replace('gemini.google.com', 'other.google.com'),
    ENDPOINT + '/other',
    'https://gemini.google.com/_/BardChatUi/data/batchexecute',
    'https://gemini.google.com/app',
  ])('ignores a different endpoint: %s', url => {
    expect(generationPrompt(url, 'POST', requestBody())).toBeNull();
  });

  it.each(['GET', 'PUT', 'DELETE', 'HEAD'])('ignores %s requests', method => {
    expect(generationPrompt(ENDPOINT, method, requestBody())).toBeNull();
  });

  it.each([
    undefined,
    null,
    {},
    '',
    'at=only-a-token',
    'f.req=%7Binvalid',
    new URLSearchParams({ 'f.req': JSON.stringify({ 1: 'not-an-array' }) }).toString(),
    new URLSearchParams({ 'f.req': JSON.stringify([null, '{invalid']) }).toString(),
    new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify([null])]) }).toString(),
    requestBody(17),
    requestBody(null),
    requestBody(''),
  ])('ignores a malformed or missing prompt body: %p', body => {
    expect(generationPrompt(ENDPOINT, 'POST', body)).toBeNull();
  });
});

describe('Gemini complete network reply parsing', () => {
  it('reads the complete answer and identifiers from a framed response', () => {
    expect(parseGeminiTextResponse(stream(responseBody()))).toEqual({
      text: ANSWER, candidateId: 'rc_fixture', conversationId: 'c_fixture',
    });
  });

  it('keeps Unicode and JSON-looking text intact across framing', () => {
    const text = 'Forêt 🌲 — ["camera", {"angle":"wide"}]\nA literal quote: " and a slash: \\.';
    expect(parseGeminiTextResponse(stream(responseBody(candidate(text))))?.text).toBe(text);
  });

  it('uses the completed update after partial chunks', () => {
    expect(parseGeminiTextResponse(stream(
      responseBody(candidate('The camera', 1)),
      responseBody(candidate('The camera tracks forward', 1)),
      responseBody(candidate(ANSWER, 2)),
    ))?.text).toBe(ANSWER);
  });

  it('uses the latest complete candidate rather than the first completed chunk', () => {
    expect(parseGeminiTextResponse(stream(
      responseBody(candidate('The earlier complete answer.', 2, 'rc_earlier')),
      responseBody(candidate(ANSWER, 2, 'rc_latest')),
    ))).toEqual({ text: ANSWER, candidateId: 'rc_latest', conversationId: 'c_fixture' });
  });

  it.each(['rc_fixture', 'rc_newer'])('rejects a later unfinished candidate (%s) after an earlier completion', id => {
    expect(parseGeminiTextResponse(stream(
      responseBody(candidate()),
      responseBody(candidate('This update is still being written', 1, id)),
    ))).toBeNull();
  });

  it('does not treat stable partial text as a completed reply', () => {
    expect(parseGeminiTextResponse(stream(
      responseBody(candidate(ANSWER, 1)),
      responseBody(candidate(ANSWER, 1)),
    ))).toBeNull();
  });

  it('requires an explicit complete marker', () => {
    const value = candidate();
    delete value[8];
    expect(parseGeminiTextResponse(stream(responseBody(value)))).toBeNull();
  });

  it('never appends private thinking fields to the visible answer', () => {
    const value = candidate();
    value[37] = [['PRIVATE_THINKING_ONLY: consider a different answer.']];
    const result = parseGeminiTextResponse(stream(responseBody(value)));
    expect(result?.text).toBe(ANSWER);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_THINKING_ONLY');
  });

  it('does not substitute thinking text when the visible answer is missing', () => {
    const value = candidate(null);
    value[37] = [['This is not the visible answer.']];
    expect(parseGeminiTextResponse(stream(responseBody(value)))).toBeNull();
  });

  it('allows an absent conversation identifier without inventing one', () => {
    const body = responseBody();
    delete body[1];
    expect(parseGeminiTextResponse(stream(body))).toEqual({ text: ANSWER, candidateId: 'rc_fixture' });
  });

  it.each([
    null,
    {},
    [null],
    candidate('', 2),
    candidate(42, 2),
    candidate(ANSWER, 2, 'not-a-candidate-id'),
  ])('rejects an invalid first candidate: %p', value => {
    expect(parseGeminiTextResponse(stream(responseBody(value)))).toBeNull();
  });

  it('does not borrow a different candidate when the first is unfinished', () => {
    const body = responseBody(candidate('Still writing', 1));
    body[4].push(candidate(ANSWER, 2, 'rc_alternative'));
    expect(parseGeminiTextResponse(stream(body))).toBeNull();
  });

  it('ignores unrelated envelope records without treating them as answers', () => {
    expect(parseGeminiTextResponse(
      ")]}'\n\n" + frame([['di', 7], ['af.httprm', 17]]) + frame(envelope(responseBody())),
    )?.text).toBe(ANSWER);
  });

  // Live StreamGenerate replies (Oct 2026) end with di, af.httprm and an "e" end-of-stream row.
  const END_ROWS = [['di', 7], ['af.httprm', 17, '-1', 31], ['e', 4, null, null, 1234]];

  it('reads the answer when the stream ends with the "e" end-of-stream row', () => {
    const words = ANSWER.split(' ');
    const partials = Array.from({ length: 8 }, (_, i) => responseBody(candidate(words.slice(0, i + 1).join(' '), 1)));
    expect(parseGeminiTextResponse(stream(...partials, responseBody()) + frame(END_ROWS))).toEqual({
      text: ANSWER, candidateId: 'rc_fixture', conversationId: 'c_fixture',
    });
  });

  it('reads the answer when the "e" row shares a frame with the final reply', () => {
    expect(parseGeminiTextResponse(")]}'\n\n" + frame([...envelope(responseBody()), ...END_ROWS]))?.text)
      .toBe(ANSWER);
  });

  it('does not treat the "e" row as a completion marker', () => {
    expect(parseGeminiTextResponse(stream(responseBody(candidate(ANSWER, 1))) + frame(END_ROWS))).toBeNull();
  });

  it('still rejects an "er" error row after a complete reply', () => {
    expect(parseGeminiTextResponse(stream(responseBody()) + frame([['er', null, null, null, null, 400]]))).toBeNull();
  });

  it.each([
    '\nnot-json',
    '\n128\n',
    '\n128\n[["wrb.fr"',
    '\n[',
  ])('rejects an incomplete or malformed suffix even after a complete reply: %p', suffix => {
    expect(parseGeminiTextResponse(stream(responseBody()) + suffix)).toBeNull();
  });

  it('rejects a malformed later response body rather than returning an older answer', () => {
    const malformed = frame([['wrb.fr', null, '{invalid-json']]);
    expect(parseGeminiTextResponse(stream(responseBody()) + malformed)).toBeNull();
  });

  it('rejects a truncated JSON envelope', () => {
    const complete = stream(responseBody());
    expect(parseGeminiTextResponse(complete.slice(0, -3))).toBeNull();
  });

  it('bounds the response before parsing', () => {
    expect(MAX_RESPONSE_CHARS).toBe(8 * 1024 * 1024);
    expect(parseGeminiTextResponse(' '.repeat(MAX_RESPONSE_CHARS + 1))).toBeNull();
  });
});
