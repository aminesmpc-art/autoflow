/* ============================================================
   Sign in with Google, from a side panel.

   Chrome offers two routes and only one of them fits here.

   chrome.identity.getAuthToken is the easy one, but it returns an ACCESS
   token for Google's own APIs, and this backend verifies an ID token —
   GoogleLoginView calls verify_oauth2_token on `id_token`. Handing it an
   access token would fail verification every time, with an error that reads
   like a server fault rather than the wrong kind of credential. It is also
   Chrome-profile bound, which the web build could not reuse.

   So: launchWebAuthFlow against Google's OAuth endpoint asking for an
   id_token directly. The redirect lands on the extension's own
   chromiumapp.org URL, which Chrome intercepts, and the token comes back in
   the fragment.

   The client id is fetched from the backend rather than compiled in, because
   the backend is the thing that has to verify against it. A constant here
   could drift from the one the server checks, and the failure would look like
   "Google authentication failed" with nothing pointing at the mismatch.
   ============================================================ */

import { getGoogleConfig, loginWithGoogle } from '../shared/api';

/** A value Google echoes back, so a replayed redirect cannot be accepted. */
function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SignInResult {
  ok: boolean;
  message: string;
  /** True when the person closed the window — not a failure worth shouting. */
  cancelled?: boolean;
}

export async function signInWithGoogle(): Promise<SignInResult> {
  const config = await getGoogleConfig();
  if (!config?.client_id) {
    return { ok: false, message: 'Could not reach AutoFlow to start Google sign-in. Check your connection.' };
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const state = nonce();
  const expectedNonce = nonce();

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.client_id);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('nonce', expectedNonce);
  url.searchParams.set('state', state);
  // Always show the chooser: a shared machine should not silently reuse an
  // account the person did not pick.
  url.searchParams.set('prompt', 'select_account');

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  } catch (e: any) {
    const message = String(e?.message || e);
    if (/closed by the user|canceled|cancelled/i.test(message)) {
      return { ok: false, cancelled: true, message: 'Sign-in was cancelled.' };
    }
    /* The most common real failure, and it is a console setting rather than a
       bug: this exact redirect has to be registered on the OAuth client. Say
       the URI, because it is the thing that has to be pasted. */
    return {
      ok: false,
      message: `Google refused the sign-in window (${message}). If this persists, `
        + `${redirectUri} must be an authorised redirect URI on the AutoFlow OAuth client.`,
    };
  }

  if (!redirect) return { ok: false, cancelled: true, message: 'Sign-in was cancelled.' };

  /* An implicit-flow token comes back in the fragment, not the query. */
  const fragment = redirect.includes('#') ? redirect.slice(redirect.indexOf('#') + 1) : '';
  const params = new URLSearchParams(fragment);
  if (params.get('state') !== state) {
    return { ok: false, message: 'Google returned an unexpected response. Try again.' };
  }
  const idToken = params.get('id_token');
  if (!idToken) {
    const err = params.get('error') || new URL(redirect).searchParams.get('error');
    return { ok: false, message: err ? `Google refused: ${err}` : 'Google did not return a sign-in token.' };
  }

  // The backend verifies it and hands back the AutoFlow session.
  return loginWithGoogle(idToken);
}
