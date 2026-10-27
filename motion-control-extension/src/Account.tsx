import { useEffect, useRef, useState } from 'react';
import { getProfile, login, logout, register, resendVerificationEmail } from '../../studio-extension/src/shared/api';
import { signInWithGoogle } from '../../studio-extension/src/sidepanel/googleSignIn';
import Icon from './Icon';
import { comparePlansUrl, FREE_DAILY_JOBS, freePlanState, PRO_PRICE, type MotionEntitlement } from './billing';
import { MOTION_BILLING_CHECK } from './buildFlags';
import { UpgradeLink } from './Upgrade';
export type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;

/** Open the account sheet from anywhere — the checklist's "Sign in" uses it. */
export const openAccount = () => window.dispatchEvent(new Event('motion:account'));

export default function Account({ profile, entitlement, onChange, disabled }: { profile: Profile | null; entitlement?: MotionEntitlement | null; onChange: () => Promise<void>; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const confirmation = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'login' | 'register' | 'verify'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const switchView = (next: typeof view) => {
    if (pending.current) return;
    setMessage(''); setNotice(''); setPassword(''); setConfirmPassword(''); setView(next);
  };
  const clearPasswords = () => { setPassword(''); setConfirmPassword(''); };
  const open = () => { if (!dialog.current?.open) dialog.current?.showModal(); };
  useEffect(() => { if (dialog.current?.open) heading.current?.focus(); }, [view]);
  useEffect(() => {
    window.addEventListener('motion:account', open);
    return () => window.removeEventListener('motion:account', open);
  }, []);
  const authenticate = async (google = false, resend = false) => {
    if (pending.current) return;
    if (!google && view === 'register' && password !== confirmPassword) {
      setMessage('Passwords do not match. Please enter the same password twice.');
      confirmation.current?.focus(); return;
    }
    if (!google && view === 'register' && password.length < 8) {
      setMessage('Use a password with at least 8 characters.'); return;
    }
    if (!globalThis.chrome?.runtime?.id) { setMessage('Load this extension in Chrome to sign in.'); return; }
    pending.current = true; setBusy(true); setMessage(''); setNotice('');
    try {
      if (resend) {
        const result = await resendVerificationEmail(email.trim());
        if (result.ok) setNotice(result.message); else setMessage(result.message);
        return;
      }
      if (!google && view === 'register') {
        const result = await register(email.trim(), password);
        if (!result.ok) { setMessage(result.message); return; }
        clearPasswords(); setView('verify'); return;
      }
      const result = google ? await signInWithGoogle() : await login(email.trim(), password);
      if (!result.ok) { setMessage(result.message); return; }
      clearPasswords(); await onChange(); dialog.current?.close(); setView('login');
    } catch { setMessage('Could not reach the account service. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const initial = (profile?.email || '?').charAt(0).toUpperCase();
  return <>
    {profile
      ? <button className={`avatar ${entitlement?.accessPlan === 'pro' ? 'avatar--pro' : ''}`} disabled={disabled} onClick={open}
          aria-label={`Account: ${profile.email}, ${entitlement?.accessPlan === 'pro' ? 'AutoFlow Pro' : 'Free plan'}`} title={profile.email}>
          {initial}
        </button>
      : <button className="btn btn--secondary btn--sm signin" disabled={disabled} onClick={open}>Sign in</button>}
    <dialog ref={dialog} className="sheet" aria-labelledby="account-title" onClose={clearPasswords}
      onCancel={e => { if (pending.current) e.preventDefault(); }}>
      <button className="icon-btn sheet__close" disabled={busy} aria-label="Close account" onClick={() => dialog.current?.close()}><Icon name="close" /></button>
      <span className="sheet__eyebrow">One AutoFlow account</span>
      <h2 id="account-title" ref={heading} tabIndex={-1}>{profile ? 'Your account' : view === 'register' ? 'Create your account' : view === 'verify' ? 'Check your email' : 'Welcome to Motion'}</h2>
      <p>{view === 'register' && !profile ? 'Sign up here without leaving Motion. Use the same email as your subscription.'
        : view === 'verify' && !profile ? 'Your account is created. Verify your email, then come back here to sign in.'
        : 'Use your AutoFlow account. This extension keeps its own session.'}</p>
      {profile ? <div className="sheet__body">
          <div className="sheet__who"><span className="avatar avatar--lg" aria-hidden="true">{initial}</span>
            <span><strong>{profile.email}</strong><small>{!MOTION_BILLING_CHECK ? 'Subscription check off (test build)'
              : !entitlement || entitlement.reason === 'motion_unavailable' ? 'Motion allowance unavailable'
              : entitlement.accessPlan === 'pro' ? 'AutoFlow Pro · unlimited Motion' : `Free plan · ${FREE_DAILY_JOBS} Motion jobs a day`}</small></span></div>
          <p className="sheet__plan">{!MOTION_BILLING_CHECK ? 'This is a test build: the Motion subscription is not checked and jobs are not counted. Never upload it to the Web Store.'
            : !entitlement || entitlement.reason === 'motion_unavailable' ? 'Motion is not available right now: AutoFlow could not confirm your allowance. Generation stays locked until it can.'
            : !entitlement.active ? 'Your AutoFlow account is not active yet. Verify your email, then refresh.'
            : entitlement.accessPlan === 'pro' ? 'Unlimited Motion jobs with AutoFlow Pro.'
            : `${entitlement.daily.remaining ?? 0} of ${entitlement.daily.limit ?? FREE_DAILY_JOBS} free Motion jobs left today. Upgrade to AutoFlow Pro for unlimited jobs.`}</p>
          <p className="sheet__hint">Free: {FREE_DAILY_JOBS} Motion jobs a day, resetting at midnight UTC. AutoFlow Pro: unlimited. One job is one press of Generate — every piece of that video counts once, together, and retrying it never uses another. Provider failures do not refund a job. AI provider accounts and credits are separate.</p>
          {freePlanState(entitlement ?? null) && <UpgradeLink className="btn btn--primary btn--lg btn--block" email={profile.email} place="account">
            <Icon name="sparkle" />Upgrade to Pro · {PRO_PRICE}</UpgradeLink>}
          <a className="sheet__link" href={comparePlansUrl()} target="_blank" rel="noreferrer">{entitlement?.accessPlan === 'pro' ? 'AutoFlow Pro plan' : 'Compare plans'}<Icon name="external" /></a>
          <button className="btn btn--secondary btn--block" disabled={busy} onClick={async () => { setBusy(true); try { await onChange(); } finally { setBusy(false); } }}>Refresh account</button>
          <button className="btn btn--secondary btn--lg btn--block" disabled={busy} onClick={async () => { setBusy(true); try { await logout(); await onChange(); } finally { setBusy(false); } }}>Sign out</button>
        </div> : view === 'verify' ? <div className="sheet__body" aria-busy={busy}>
          <p className="sheet__verification">Check the inbox for <strong>{email.trim()}</strong>. Open the verification link in the email. Check your spam folder too.</p>
          <button className="btn btn--primary btn--lg btn--block" disabled={busy} onClick={() => switchView('login')}>Back to sign in</button>
          <button className="btn btn--secondary btn--lg btn--block" disabled={busy} onClick={() => void authenticate(false, true)}>{busy ? 'Sending…' : 'Resend verification email'}</button>
          <button className="sheet__link sheet__switch" disabled={busy} onClick={() => switchView('register')}>Use a different email</button>
        </div> :
        <form aria-busy={busy} onSubmit={e => { e.preventDefault(); void authenticate(); }}>
          <label>Email<input name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Password<input name="password" type="password" autoComplete={view === 'register' ? 'new-password' : 'current-password'} disabled={busy}
            minLength={view === 'register' ? 8 : undefined} aria-describedby={view === 'register' ? 'password-hint' : undefined}
            value={password} onChange={e => setPassword(e.target.value)} required /></label>
          {view === 'register' && <>
            <small id="password-hint" className="sheet__hint">At least 8 characters.</small>
            <label>Confirm password<input ref={confirmation} name="confirm-password" type="password" autoComplete="new-password" disabled={busy}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required /></label>
          </>}
          <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? (view === 'register' ? 'Creating account…' : 'Signing in…') : view === 'register' ? 'Create account' : 'Sign in'}</button>
          <button className="btn btn--secondary btn--lg btn--block" type="button" disabled={busy} onClick={() => void authenticate(true)}>Continue with Google</button>
          <button className="sheet__link sheet__switch" type="button" disabled={busy} onClick={() => switchView(view === 'register' ? 'login' : 'register')}>
            {view === 'register' ? 'Already have an account? Sign in' : 'Create an AutoFlow account'}
          </button>
        </form>}
      {notice && <p role="status" className="sheet__notice">{notice}</p>}
      {message && <p role="alert" className="sheet__error">{message}</p>}
      <a className="sheet__link" href="privacy.html" target="_blank" rel="noreferrer">Privacy &amp; data use<Icon name="external" /></a>
    </dialog>
  </>;
}
