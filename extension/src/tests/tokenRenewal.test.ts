/* Renewing the login without signing anyone out.

   The server rotates refresh tokens and blacklists the one it replaced. When
   the panel opened after the hour-long access token had lapsed, several
   requests 401'd together and each renewed on its own with the same refresh
   token: the first succeeded, the second was refused as blacklisted, and the
   refusal cleared the tokens — the fresh pair included. Production logged it
   as two /api/auth/refresh 401s two milliseconds apart; the user saw usage
   fail and two Create modes vanish.

   These run the real api.ts against a fake server that rotates exactly as
   SimpleJWT does.
*/

const store: Record<string, any> = {};

// @ts-ignore
global.chrome = {
  storage: {
    local: {
      get: jest.fn((key: string, cb: (r: any) => void) => cb({ [key]: store[key] })),
      set: jest.fn((items: Record<string, any>, cb?: () => void) => { Object.assign(store, items); cb?.(); }),
      remove: jest.fn((key: string, cb?: () => void) => { delete store[key]; cb?.(); }),
    },
  },
  runtime: { getManifest: () => ({ version: '9.1' }) },
} as any;

import { getDailyUsage, getProfile } from '../shared/api';

const TOKEN_KEY = 'autoflow_auth_tokens';

const json = (status: number, body: any) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const authOf = (opts: any): string => {
  const h = opts?.headers;
  if (!h) return '';
  return typeof h.get === 'function' ? (h.get('Authorization') || '') : (h.Authorization || h.authorization || '');
};

/** A server that accepts one access token and rotates refresh tokens. */
function rotatingServer(opts: { refreshFails?: 'network' } = {}) {
  let liveAccess = 'A2';
  let liveRefresh = 'R1';
  const blacklisted = new Set<string>();
  const calls = { refresh: 0 };

  const fetchMock = jest.fn(async (url: string, init: any = {}) => {
    if (url.includes('/api/auth/refresh')) {
      calls.refresh += 1;
      if (opts.refreshFails === 'network') throw new TypeError('Failed to fetch');
      const sent = JSON.parse(init.body).refresh;
      // Let the parallel request arrive while this one is in flight.
      await new Promise((r) => setTimeout(r, 5));
      if (sent !== liveRefresh || blacklisted.has(sent)) return json(401, { detail: 'Token is blacklisted' });
      blacklisted.add(sent);
      liveRefresh = 'R2';
      return json(200, { access: liveAccess, refresh: liveRefresh });
    }
    if (authOf(init) !== `Bearer ${liveAccess}`) return json(401, { detail: 'expired' });
    if (url.includes('/api/entitlements')) return json(200, { is_pro_active: false, text_used_today: 3, text_daily_limit: 50, text_remaining_today: 47 });
    if (url.includes('/api/auth/me')) return json(200, { user: { email: 'you@example.com' }, profile: { plan_type: 'free', is_pro_active: false } });
    return json(404, {});
  });
  return { fetchMock, calls };
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  store[TOKEN_KEY] = { access: 'A1-expired', refresh: 'R1' };
});

describe('renewing an expired login', () => {
  it('renews once for requests that fail together, and keeps you signed in', async () => {
    const server = rotatingServer();
    // @ts-ignore
    global.fetch = server.fetchMock;

    const [usage, profile] = await Promise.all([getDailyUsage(), getProfile()]);

    expect(server.calls.refresh).toBe(1);
    expect(usage?.text_remaining).toBe(47);
    expect(profile?.email).toBe('you@example.com');
    expect(store[TOKEN_KEY]).toEqual({ access: 'A2', refresh: 'R2' });
    expect(store.af_session_expired).toBeUndefined();
  });

  it('does not sign you out when another part of the extension renewed first', async () => {
    /* The service worker and the panel each have their own copy of this
       module, so they can still race: one renews, the other is refused for
       the token the first just retired. The refusal must defer to the pair
       the winner stored. */
    const server = rotatingServer();
    const inner = server.fetchMock.getMockImplementation()!;
    // @ts-ignore
    global.fetch = jest.fn(async (url: string, init: any = {}) => {
      if (url.includes('/api/auth/refresh')) {
        // The other context renews and stores first; this request is refused.
        store[TOKEN_KEY] = { access: 'A2', refresh: 'R2' };
        return json(401, { detail: 'Token is blacklisted' });
      }
      return inner(url, init);
    });

    const usage = await getDailyUsage();

    expect(usage?.text_remaining).toBe(47);
    expect(store[TOKEN_KEY]).toEqual({ access: 'A2', refresh: 'R2' });
    expect(store.af_session_expired).toBeUndefined();
  });

  it('keeps the login through a network failure while renewing', async () => {
    const server = rotatingServer({ refreshFails: 'network' });
    // @ts-ignore
    global.fetch = server.fetchMock;

    const usage = await getDailyUsage();

    expect(usage).toBeNull();                       // this call fails…
    expect(store[TOKEN_KEY]).toEqual({ access: 'A1-expired', refresh: 'R1' }); // …the login stays
    expect(store.af_session_expired).toBeUndefined();
  });

  it('still signs you out when the login really has expired', async () => {
    const server = rotatingServer();
    store[TOKEN_KEY] = { access: 'A1-expired', refresh: 'R0-long-gone' };
    // @ts-ignore
    global.fetch = server.fetchMock;

    const usage = await getDailyUsage();

    expect(usage).toBeNull();
    expect(store[TOKEN_KEY]).toBeUndefined();
    expect(store.af_session_expired).toBe(true);
  });
});
