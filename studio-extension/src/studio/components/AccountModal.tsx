/* ============================================================
   Sign in, register, or see who you are — without leaving the gallery.

   Studio could show a plan and a run counter but had nowhere to sign in; that
   lived only in the side panel, which is a different surface the canvas cannot
   open. So the footer said "Free · 3/15" with no way to act on it.

   Deliberately thin: it calls the same login/register the side panel does, and
   the server stays the authority on what a session is worth. Nothing here
   decides entitlements — it reads them back and shows them.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { login, register, logout, getProfile } from '../../shared/api';

export interface Account {
  email: string;
  isPro: boolean;
}

interface Props {
  open: boolean;
  account: Account | null;
  onClose: () => void;
  /** Called after anything that changes who is signed in. */
  onChanged: (account: Account | null) => void;
}

type Mode = 'signin' | 'register';

export function AccountModal({ open, account, onClose, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Escape closes, as in every other dialog.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Clear anything left from a previous visit.
  useEffect(() => {
    if (open) { setError(null); setNotice(null); setPassword(''); }
  }, [open]);

  const submit = useCallback(async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Email and password are both needed.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = mode === 'signin'
        ? await login(email.trim(), password)
        : await register(email.trim(), password);

      if (!res.ok) {
        setError(res.message || 'That did not work.');
        return;
      }
      /* Registering does not sign you in — the account has to be verified
         first. Saying so beats a modal that closes and changes nothing. */
      const profile = await getProfile();
      if (!profile) {
        setNotice(res.message || 'Account created. Check your email to verify it, then sign in.');
        setMode('signin');
        return;
      }
      onChanged({ email: profile.email, isPro: !!profile.is_pro_active });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [busy, email, password, mode, onChanged, onClose]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      try { await chrome.storage.local.remove('af_cached_profile'); } catch { /* best effort */ }
      onChanged(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [onChanged, onClose]);

  if (!open) return null;

  return (
    <div className="sg-modal" onClick={onClose} role="presentation">
      {/* Clicks inside must not fall through to the backdrop's close. */}
      <div
        className="sg-modal__card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={account ? 'Account' : 'Sign in'}
      >
        <button className="sg-modal__x" onClick={onClose} aria-label="Close">✕</button>

        {account ? (
          <>
            <div className="sg-modal__avatar">{account.email.charAt(0).toUpperCase()}</div>
            <h2 className="sg-modal__title">{account.email}</h2>
            <p className="sg-modal__sub">
              {account.isPro ? 'Pro — unlimited runs' : 'Free plan'}
            </p>
            {!account.isPro && (
              <a
                className="sg-modal__primary"
                href="https://auto-flow.studio/#pricing"
                target="_blank"
                rel="noopener noreferrer"
              >
                Upgrade to Pro
              </a>
            )}
            <button className="sg-modal__ghost" onClick={signOut} disabled={busy}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        ) : (
          <>
            <h2 className="sg-modal__title">
              {mode === 'signin' ? 'Sign in' : 'Create an account'}
            </h2>
            <p className="sg-modal__sub">
              Your plan and run limits follow the account, not this browser.
            </p>

            <form
              className="sg-modal__form"
              onSubmit={(e) => { e.preventDefault(); submit(); }}
            >
              <input
                className="sg-modal__input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="sg-modal__input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <div className="sg-modal__error">⚠ {error}</div>}
              {notice && <div className="sg-modal__notice">✓ {notice}</div>}
              <button className="sg-modal__primary" type="submit" disabled={busy}>
                {busy
                  ? 'Working…'
                  : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <button
              className="sg-modal__switch"
              onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(null); }}
            >
              {mode === 'signin'
                ? 'No account? Create one'
                : 'Already have an account? Sign in'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
