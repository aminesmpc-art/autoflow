/** @jest-environment-options {"url":"https://gemini.google.com/app"} */
import { installGeminiNetwork } from '../../studio-extension/src/background/geminiNetwork';

declare const require: (id: string) => any;
const { TextDecoder, TextEncoder } = require('util');

const endpoint = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const tokenA = 'motion-turn-token-0001';
const tokenB = 'motion-turn-token-0002';
const prompt = 'Describe this motion exactly.';

function requestBody(text = prompt): string {
  return new URLSearchParams({ 'f.req': JSON.stringify([null, JSON.stringify([[text]])]) }).toString();
}

function responseBody(text = 'The subject walks forward.', complete = true): string {
  const candidate: unknown[] = ['rc_fixture', [text]];
  candidate[8] = [complete ? 2 : 1];
  const body: unknown[] = [null, ['c_fixture', 'r_fixture']];
  body[4] = [candidate];
  const frame = JSON.stringify([['wrb.fr', null, JSON.stringify(body)]]);
  return `)]}'\n\n${frame.length}\n${frame}\n`;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('Gemini MAIN-world passive observer', () => {
  let messages: jest.SpyInstance;
  let nativeFetch: jest.Mock;
  let nativeOpen: jest.Mock;
  let nativeSend: jest.Mock;
  let xhrClass: typeof XMLHttpRequest;
  let listeners: EventListenerOrEventListenerObject[];
  let originalXHR: typeof XMLHttpRequest;
  let originalFetch: typeof fetch;
  let originalDecoder: typeof globalThis.TextDecoder;
  let originalEncoder: typeof globalThis.TextEncoder;
  let originalRequest: typeof globalThis.Request;

  function control(type: string, token = tokenA, extra: Record<string, unknown> = {},
    origin = location.origin, source: MessageEventSource | null = window): void {
    window.dispatchEvent(new MessageEvent('message', {
      source, origin, data: { source: 'autoflow-gemini-control', type, token, prompt, ...extra },
    }));
  }

  function emitted(type: string): Record<string, any>[] {
    return messages.mock.calls.map(call => call[0]).filter(message => message.type === type);
  }

  function xhr(url = endpoint, body = requestBody(), method = 'POST'): XMLHttpRequest {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.send(body);
    return request;
  }

  function load(request: XMLHttpRequest, status = 200, body = responseBody()): void {
    Object.assign(request, { status, responseText: body });
    request.dispatchEvent(new Event('load'));
  }

  function fetchResponse(status: number, body: string): Response {
    const chunks = [new TextEncoder().encode(body.slice(0, 13)), new TextEncoder().encode(body.slice(13))];
    return {
      status,
      clone: jest.fn(() => ({ body: { getReader: () => ({
        read: jest.fn(async () => chunks.length
          ? { value: chunks.shift(), done: false } : { done: true }),
        cancel: jest.fn().mockResolvedValue(undefined),
      }) } })),
    } as unknown as Response;
  }

  beforeEach(() => {
    jest.resetModules();
    listeners = [];
    originalXHR = window.XMLHttpRequest;
    originalFetch = window.fetch;
    originalDecoder = globalThis.TextDecoder;
    originalEncoder = globalThis.TextEncoder;
    originalRequest = globalThis.Request;
    Object.assign(globalThis, { TextDecoder, TextEncoder });
    delete (window as any).__af_gemini_network_v1;
    messages = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    const add = window.addEventListener.bind(window);
    jest.spyOn(window, 'addEventListener').mockImplementation(((type: string,
      listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'message') listeners.push(listener);
      add(type, listener, options);
    }) as typeof window.addEventListener);
    nativeOpen = jest.fn();
    nativeSend = jest.fn();
    class MockXHR extends EventTarget {
      status = 0;
      responseText = '';
      responseType = '';
      open(...args: unknown[]) { return nativeOpen(...args); }
      send(...args: unknown[]) { return nativeSend(...args); }
    }
    xhrClass = MockXHR as unknown as typeof XMLHttpRequest;
    window.XMLHttpRequest = xhrClass;
    nativeFetch = jest.fn().mockResolvedValue(fetchResponse(200, responseBody()));
    window.fetch = nativeFetch;
    jest.isolateModules(() => require('../../studio-extension/src/content/gemini/networkHook'));
  });

  afterEach(() => {
    for (const listener of listeners) window.removeEventListener('message', listener);
    jest.restoreAllMocks();
    window.XMLHttpRequest = originalXHR;
    window.fetch = originalFetch;
    Object.assign(globalThis, { TextDecoder: originalDecoder, TextEncoder: originalEncoder, Request: originalRequest });
    delete (window as any).__af_gemini_network_v1;
  });

  it('requires same-window, same-origin control and a valid token', () => {
    control('ARM', tokenA, {}, 'https://other.test');
    control('ARM', tokenA, {}, location.origin, null);
    control('ARM', 'short');
    control('ARM', tokenA, { source: 'another-source' });
    expect(emitted('ARMED')).toHaveLength(0);
    load(xhr());
    expect(emitted('STARTED')).toHaveLength(0);
    control('ARM');
    expect(emitted('ARMED')).toEqual([{ source: 'autoflow-gemini-network', token: tokenA, type: 'ARMED' }]);
    expect(messages).toHaveBeenLastCalledWith(expect.any(Object), 'https://gemini.google.com');
  });

  it('claims only the exact prompt on the correct generation POST', () => {
    control('ARM');
    load(xhr(endpoint, requestBody('An earlier prompt')));
    load(xhr('https://other.test/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'));
    load(xhr(endpoint.replace('StreamGenerate', 'batchexecute')));
    load(xhr(endpoint, requestBody(), 'GET'));
    expect(emitted('STARTED')).toHaveLength(0);
    expect(emitted('COMPLETE')).toHaveLength(0);
    const request = xhr();
    expect(emitted('STARTED')).toHaveLength(1);
    load(request);
    expect(emitted('COMPLETE')[0]).toMatchObject({
      token: tokenA, reply: { text: 'The subject walks forward.', candidateId: 'rc_fixture' },
    });
    expect(nativeOpen).toHaveBeenLastCalledWith('POST', endpoint);
    expect(nativeSend).toHaveBeenLastCalledWith(requestBody());
  });

  it('observes only one request per armed turn', () => {
    control('ARM');
    const first = xhr();
    const duplicate = xhr();
    load(duplicate, 200, responseBody('Wrong duplicate result'));
    expect(emitted('STARTED')).toHaveLength(1);
    expect(emitted('COMPLETE')).toHaveLength(0);
    load(first);
    expect(emitted('COMPLETE')).toHaveLength(1);
  });

  it('ignores old turn completion and a release belonging to the old token', () => {
    control('ARM');
    const old = xhr();
    control('ARM', tokenB);
    control('RELEASE', tokenA);
    load(old);
    expect(emitted('COMPLETE')).toHaveLength(0);
    load(xhr());
    expect(emitted('COMPLETE')).toHaveLength(1);
    expect(emitted('COMPLETE')[0].token).toBe(tokenB);
  });

  it('ignores late completion after the current token is released', () => {
    control('ARM');
    const request = xhr();
    control('RELEASE');
    load(request);
    expect(emitted('COMPLETE')).toHaveLength(0);
    expect(emitted('UNREADABLE')).toHaveLength(0);
    load(xhr());
    expect(emitted('STARTED')).toHaveLength(1);
  });

  it.each([400, 403, 429, 500])('cannot complete an HTTP %i XHR', status => {
    control('ARM');
    load(xhr(), status);
    expect(emitted('COMPLETE')).toHaveLength(0);
    expect(emitted('UNREADABLE')).toHaveLength(1);
  });

  it.each(['abort', 'error', 'timeout'])('cannot complete an XHR %s', event => {
    control('ARM');
    xhr().dispatchEvent(new Event(event));
    expect(emitted('COMPLETE')).toHaveLength(0);
    expect(emitted('UNREADABLE')).toHaveLength(1);
  });

  it('does not turn an unfinished response into success at EOF', () => {
    control('ARM');
    load(xhr(), 200, responseBody('Still writing', false));
    expect(emitted('COMPLETE')).toHaveLength(0);
    expect(emitted('UNREADABLE')).toHaveLength(1);
  });

  it('passes through the native fetch promise and reads only a response clone', async () => {
    const result = fetchResponse(200, responseBody());
    const pending = Promise.resolve(result);
    nativeFetch.mockReturnValue(pending);
    control('ARM');
    const init = { method: 'POST', body: requestBody() };
    const returned = window.fetch(endpoint, init);
    expect(returned).toBe(pending);
    expect(await returned).toBe(result);
    await flush();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch).toHaveBeenCalledWith(endpoint, init);
    expect(result.clone).toHaveBeenCalledTimes(1);
    expect(emitted('COMPLETE')).toHaveLength(1);
  });

  it('does not correlate an overridden Request body with the original Request prompt', async () => {
    class FixtureRequest {
      url = endpoint;
      method = 'POST';
      clone = jest.fn(() => ({ text: async () => requestBody() }));
    }
    (globalThis as any).Request = FixtureRequest;
    const request = new FixtureRequest();
    const init = { body: requestBody('A different actual request prompt.') };
    control('ARM');
    await window.fetch(request as unknown as Request, init);
    await flush();
    expect(request.clone).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch).toHaveBeenCalledWith(request, init);
    expect(emitted('STARTED')).toHaveLength(0);
    expect(emitted('COMPLETE')).toHaveLength(0);
  });

  it('preserves native fetch behavior when cloning a consumed Request throws', async () => {
    class FixtureRequest {
      url = endpoint;
      method = 'POST';
      clone = jest.fn(() => { throw new TypeError('Body has already been consumed.'); });
    }
    (globalThis as any).Request = FixtureRequest;
    const request = new FixtureRequest();
    const failure = new TypeError('Native fetch rejects the consumed request.');
    const pending = Promise.reject(failure);
    nativeFetch.mockReturnValue(pending);
    control('ARM');
    const returned = window.fetch(request as unknown as Request);
    expect(returned).toBe(pending);
    await expect(returned).rejects.toBe(failure);
    await flush();
    expect(request.clone).toHaveBeenCalledTimes(1);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch).toHaveBeenCalledWith(request, undefined);
    expect(emitted('STARTED')).toHaveLength(0);
    expect(emitted('COMPLETE')).toHaveLength(0);
  });

  it.each([['HTTP error', 500, true], ['incomplete response', 200, false]])(
    'cannot complete fetch with %s', async (_name, status, complete) => {
      nativeFetch.mockResolvedValue(fetchResponse(status as number, responseBody('Draft', complete as boolean)));
      control('ARM');
      await window.fetch(endpoint, { method: 'POST', body: requestBody() });
      await flush();
      expect(emitted('COMPLETE')).toHaveLength(0);
      expect(emitted('UNREADABLE')).toHaveLength(1);
    },
  );

  it('preserves fetch rejection and reports no completion', async () => {
    const failure = new Error('request aborted');
    nativeFetch.mockRejectedValue(failure);
    control('ARM');
    await expect(window.fetch(endpoint, { method: 'POST', body: requestBody() })).rejects.toBe(failure);
    await flush();
    expect(emitted('COMPLETE')).toHaveLength(0);
    expect(emitted('UNREADABLE')).toHaveLength(1);
  });

  it('keeps installation idempotent without wrapping native requests twice', () => {
    const installedFetch = window.fetch;
    const installedSend = xhrClass.prototype.send;
    jest.isolateModules(() => require('../../studio-extension/src/content/gemini/networkHook'));
    expect(window.fetch).toBe(installedFetch);
    expect(xhrClass.prototype.send).toBe(installedSend);
    control('ARM');
    load(xhr());
    expect(emitted('STARTED')).toHaveLength(1);
    expect(nativeSend).toHaveBeenCalledTimes(1);
  });
});

describe('Gemini observer worker installer', () => {
  const sender = {
    id: 'motion', tab: { id: 17 }, frameId: 0, url: 'https://gemini.google.com/app/fixture',
  } as chrome.runtime.MessageSender;
  let executeScript: jest.Mock;

  beforeEach(() => {
    executeScript = jest.fn().mockResolvedValue([]);
    (globalThis as any).chrome = { runtime: { id: 'motion' }, scripting: { executeScript } };
  });

  it('installs only the fixed packaged observer in the sender main world', async () => {
    const reply = jest.fn();
    expect(installGeminiNetwork(sender, reply)).toBe(true);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 17 }, world: 'MAIN', files: ['gemini-network.js'],
    });
    await flush();
    expect(reply).toHaveBeenCalledWith({ installed: true });
  });

  it.each([
    { ...sender, id: 'another-extension' }, { ...sender, frameId: 1 },
    { ...sender, url: 'https://gemini.google.com.evil.test/app' },
    { ...sender, url: 'https://flow.google.com/' }, { ...sender, tab: undefined },
    { ...sender, url: undefined }, { ...sender, url: 'not a URL' },
  ])('rejects callers outside its Gemini main frame', other => {
    const reply = jest.fn();
    expect(installGeminiNetwork(other, reply)).toBe(false);
    expect(reply).toHaveBeenCalledWith({ installed: false });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('reports install failure without claiming the observer is active', async () => {
    executeScript.mockRejectedValue(new Error('tab closed'));
    const reply = jest.fn();
    expect(installGeminiNetwork(sender, reply)).toBe(true);
    await flush();
    expect(reply).toHaveBeenCalledWith({ installed: false });
  });
});
