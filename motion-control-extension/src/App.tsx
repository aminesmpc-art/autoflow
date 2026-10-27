import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../../studio-extension/src/studio/store';
import { getProfile } from '../../studio-extension/src/shared/api';
import { bridge } from '../../studio-extension/src/studio/engine/bridge';
import { getSource, putSource, sourceKeyFor } from '../../studio-extension/src/studio/clip/sourceStore';
import { MotionPreview } from '../../studio-extension/src/studio/components/MotionPreview';
import { MOTION_PRESETS } from '../../studio-extension/src/studio/ask/motionGuidance';
import type { MotionPieceRow } from '../../studio-extension/src/studio/ask/motionControl';
import { configuration, defaults, graphFor, MOTION_ID, preflight, replacingMany, type MotionData } from './model';
import { engine, scanTargets, startGeneration } from './controller';
import Replacements from './Replacements';
import { usableReplacements } from '../../studio-extension/src/studio/ask/motionTargets';
import Account, { openAccount, type Profile } from './Account';
import Upload, { pickFile } from './Upload';
import Icon from './Icon';
import BrandMark from './BrandMark';
import Projects from './Projects';
import { freePlanState, getMotionEntitlement, motionPlanStep, PRO_PRICE, untilReset, type MotionEntitlement } from './billing';
import { MOTION_BILLING_CHECK } from './buildFlags';
import { UpgradeLink, UPGRADE_OPENED } from './Upgrade';
import { backgroundAllowed, loadTabsChoice, TABS_CHOICE_KEY, workerFlags, type TabsChoice } from './backgroundTabs';
import { checkUploadFileAccess, isUploadFileAccessError, openUploadFileAccessSettings } from '../../studio-extension/src/background/uploadFileAccess';
import { loadUploadChoice } from './uploadDefaults';
import { letSleep } from './keepAwake';
import { pickFolder, saveClips, saveSummary } from './saveClips';
import VideoRange from './VideoRange';
import SocialImport from './SocialImport';
import { planMotionVideo, preciseSeconds, trimProblem } from '../../studio-extension/src/studio/ask/motionRange';
import { clearMotionOutput, continuityRetryThrough, endingFrame } from '../../studio-extension/src/studio/ask/motionContinuity';

const extension = !!globalThis.chrome?.runtime?.id;

/* What each transformation keeps and what it changes. This is the one choice
   on the page that wastes a generation when it is wrong, and the old panel
   layout hid these lines at its own width — three names to guess between. */
const modes = [
  { id: 'move', name: 'Transfer motion', sub: 'Keeps the motion, timing and camera. Changes who performs it.', icon: 'motion' },
  { id: 'swap', name: 'Replace subject', sub: 'Keeps the motion and the dialogue. Changes only the character.', icon: 'user' },
  { id: 'restyle', name: 'Restyle video', sub: 'Keeps the movement. Changes the whole look.', icon: 'sparkle' },
  /* "you dont add new plase for the feature of muilt characters": the list
     lived inside Replace subject, a step above the cards, and nobody found it.
     Same Replace job underneath (motionMode 'swap' + motionReplaceMany). */
  { id: 'many', name: 'Replace people & items', sub: 'Keeps the motion and everything else. Changes the people or items you choose, each with an image, a few words, or both.', icon: 'users' },
] as const;
const directions: Record<string, string> = {
  move: 'Optional. For example: keep her facing the camera.',
  swap: 'Optional. Anything in the shot that must stay exactly as it is.',
  restyle: 'Describe the new look. For example: liquid chrome, no water, same silhouette.',
};
const engines: Record<string, { name: string; url: string }> = {
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { name: 'Claude', url: 'https://claude.ai/' },
};

type StageId = 'prepare' | 'upload' | 'generate';
const STAGES: { id: StageId; label: string; detail: string }[] = [
  { id: 'prepare', label: 'Prepare', detail: 'Cutting the video and writing a prompt for each piece' },
  { id: 'upload', label: 'Upload', detail: 'Putting the pieces into Flow' },
  { id: 'generate', label: 'Generate', detail: 'Generating the pieces in Flow' },
];

/* Read from structured state only. statusNote is shown, never parsed — a
   stage worked out of a sentence breaks silently the day the sentence is
   reworded. */
function stageOf(running: boolean, pieces: MotionPieceRow[], uploaded?: boolean): StageId | null {
  if (!running) return null;
  if (!pieces.length) return 'prepare';
  return uploaded ? 'generate' : 'upload';
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pad = (n: number) => String(n).padStart(2, '0');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** For comparing two lines of display text, not for reading state out of them. */
const bare = (s: string) => s.replace(/[.…\s]+$/, '').toLowerCase();

export default function App() {
  const nodes = useStudioStore(s => s.nodes);
  const running = useStudioStore(s => s.isRunning);
  const saving = useStudioStore(s => s.saveState);
  const dirty = useStudioStore(s => s.isDirty);
  const data = (nodes.find(n => n.id === MOTION_ID)?.data || defaults()) as MotionData;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [recoveringPiece, setRecoveringPiece] = useState(0);
  const [view, setView] = useState<'workspace' | 'results'>('workspace');
  const [resultFilter, setResultFilter] = useState<'all' | 'done' | 'error'>('all');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entitlement, setEntitlement] = useState<MotionEntitlement | null>(null);
  const [uploadAllowed, setUploadAllowed] = useState(false);
  const [fileAccessError, setFileAccessError] = useState<string | null | undefined>(undefined);
  /* null until read: writing the worker's keys from a guessed default could
     briefly undo a choice the user already made. */
  const [tabsChoice, setTabsChoice] = useState<TabsChoice | null>(null);
  const [attention, setAttention] = useState<{ text: string; canOpen: boolean } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState({ flow: false, analysis: false });
  const locked = running || busy;
  /* "Find people & items" (Replacements.tsx): one analysis turn, no job. */
  const [scanning, setScanning] = useState(false);
  const scanPeople = async () => {
    if (locked || scanning) return;
    setScanning(true); setError('');
    try { await scanTargets(data); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setScanning(false); }
  };
  const many = replacingMany(data);
  const replacing = many ? usableReplacements(data.motionReplacements) : [];
  const pieces = data.motionPieces || [];
  const complete = pieces.filter(p => p.status === 'done').length;
  const failed = pieces.filter(p => p.status === 'error').length;
  const visiblePieces = running || resultFilter === 'all' ? pieces : pieces.filter(p => p.status === resultFilter);
  const settingsChanged = !!data.configurationAtRun && data.configurationAtRun !== configuration(data);
  const patch = useCallback((values: Partial<MotionData>) => useStudioStore.getState().updateNodeData(MOTION_ID, values), []);
  const refreshAccount = useCallback(async () => {
    if (!extension) return;
    const account = await getProfile();
    setProfile(account);
    setEntitlement(account && MOTION_BILLING_CHECK ? await getMotionEntitlement() : null);
  }, []);

  useEffect(() => {
    if (!extension) return;
    // Reconnect after a recycled worker without replaying any execution command.
    const syncRun = ({ status }: { status: string }) => {
      if (status === 'connected') bridge.send('STUDIO_RUN_STATE', { running: useStudioStore.getState().isRunning });
    };
    bridge.on('status', syncRun);
    bridge.connect(); void refreshAccount();
    void loadUploadChoice().then(setUploadAllowed).catch(() => setError('Could not initialize automatic uploads. Reopen Motion and try again.'));
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.af_debug_upload) setUploadAllowed(changes.af_debug_upload.newValue === true);
      if (changes.af_session_expired?.newValue) { setProfile(null); setEntitlement(null); }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { bridge.off('status', syncRun); bridge.disconnect(); chrome.storage.onChanged.removeListener(changed); };
  }, [refreshAccount]);

  useEffect(() => {
    if (!extension) return;
    let active = true;
    const refresh = () => { void checkUploadFileAccess().then(message => { if (active) setFileAccessError(message); }); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    chrome.tabs.onActivated.addListener(refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      chrome.tabs.onActivated.removeListener(refresh);
    };
  }, []);

  /* No job can be running when the panel opens (the run lives in this page),
     so whatever an earlier panel held is let go; and so is ours on the way out
     (keepAwake.ts). */
  useEffect(() => {
    if (!extension) return;
    letSleep();
    window.addEventListener('pagehide', letSleep);
    return () => window.removeEventListener('pagehide', letSleep);
  }, []);

  /* "While it works" (backgroundTabs.ts): read the choice once, then keep the
     shared worker's keys in step with it and with the engine. */
  useEffect(() => {
    if (!extension) return;
    void loadTabsChoice().then(setTabsChoice)
      .catch(() => setError('Could not read the working tab preference. Reopen Motion before generating.'));
  }, []);
  useEffect(() => {
    if (!extension || tabsChoice === null) return;
    void chrome.storage.local.set(workerFlags(tabsChoice, data.platform)).catch(() => {});
  }, [tabsChoice, data.platform]);
  const saveTabsChoice = async (choice: TabsChoice) => {
    const before = tabsChoice;
    setTabsChoice(choice);
    try { await chrome.storage.local.set({ [TABS_CHOICE_KEY]: choice }); }
    catch { setTabsChoice(before); setError('Could not save how Motion handles the tabs.'); }
  };

  /* With the tabs left alone, a site that needs a person (a sign-in, a
     dialog) is no longer brought forward. The worker says so in its run
     state; this is where Motion shows it, with the one click that opens it. */
  useEffect(() => {
    if (!extension) return;
    const heard = (msg: any) => {
      if (msg?.type !== 'PANEL_RUN_STATE') return;
      const text = String(msg.payload?.needsAttention || '');
      setAttention(text ? { text, canOpen: typeof msg.payload?.attentionTabId === 'number' } : null);
    };
    chrome.runtime.onMessage.addListener(heard);
    return () => chrome.runtime.onMessage.removeListener(heard);
  }, []);
  useEffect(() => { if (!running) setAttention(null); }, [running]);

  /* The free plan's upgrade invitations — null for Pro, for a test build, and
     whenever the allowance is unknown. */
  const free = freePlanState(entitlement);
  const isFree = !!free, reached = !!free?.reached;
  const [upgradeOpenedAt, setUpgradeOpenedAt] = useState(0);
  const [proWelcome, setProWelcome] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* The plan was read when the panel opened and after each run, and nowhere
     else: someone who paid in the checkout tab came back to "Upgrade" where
     Generate should be, until they found Refresh inside the account sheet.
     Coming back to the panel now reads it again, ten seconds apart at most. */
  const lastRead = useRef(0);
  const reread = useCallback(() => {
    if (Date.now() - lastRead.current < 10_000) return;
    lastRead.current = Date.now();
    void refreshAccount();
  }, [refreshAccount]);

  useEffect(() => {
    if (!extension) return;
    const back = () => { if (document.visibilityState === 'visible') reread(); };
    const opened = () => setUpgradeOpenedAt(Date.now());
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    window.addEventListener(UPGRADE_OPENED, opened);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener(UPGRADE_OPENED, opened);
    };
  }, [reread]);

  /* A side panel stays visible beside the checkout tab, so it may never lose
     focus to get it back. While a checkout may be open, look for Pro every 15
     seconds for up to 15 minutes. */
  useEffect(() => {
    if (!upgradeOpenedAt || !isFree) return;
    const timer = setInterval(() => {
      if (Date.now() - upgradeOpenedAt > 15 * 60_000) setUpgradeOpenedAt(0);
      else reread();
    }, 15_000);
    return () => clearInterval(timer);
  }, [upgradeOpenedAt, isFree, reread]);

  /* Free a moment ago and Pro now: say so, once. */
  const wasFree = useRef(false);
  useEffect(() => {
    if (isFree) { wasFree.current = true; return; }
    if (wasFree.current && entitlement?.accessPlan === 'pro') { setProWelcome(true); setUpgradeOpenedAt(0); }
    wasFree.current = false;
  }, [isFree, entitlement]);
  useEffect(() => {
    if (!proWelcome) return;
    const timer = setTimeout(() => setProWelcome(false), 20_000);
    return () => clearTimeout(timer);
  }, [proWelcome]);

  /* Out of free jobs: count down to midnight UTC, and read the plan again when
     it passes, so Generate comes back by itself. */
  useEffect(() => {
    if (!reached) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [reached]);
  const resetIn = reached ? untilReset(entitlement?.daily.resetsAt, now) : '';
  useEffect(() => {
    if (reached && entitlement?.daily.resetsAt && !resetIn) reread();
  }, [reached, resetIn, entitlement, reread]);

  useEffect(() => {
    if (!extension) return;
    let live = true;
    const check = async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const domain = data.platform === 'gemini' ? 'gemini.google.com' : data.platform === 'claude' ? 'claude.ai' : 'chatgpt.com';
        if (live) setConnected({ flow: tabs.some(t => /flow\.google\.com|labs\.google\/(fx|flow)/.test(t.url || '')), analysis: tabs.some(t => (t.url || '').includes(domain)) });
      } catch { /* Status remains unavailable; preflight still checks execution. */ }
    };
    void check(); const timer = setInterval(check, 8000);
    return () => { live = false; clearInterval(timer); };
  }, [data.platform]);

  useEffect(() => {
    const file = getSource(data.sourceKey);
    if (!file) { setSourceUrl(''); return; }
    const url = URL.createObjectURL(file); setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data.sourceKey]);

  useEffect(() => {
    if (!extension || running) return;
    const timer = setTimeout(() => { void useStudioStore.getState().saveWorkflow(); }, 900);
    return () => clearTimeout(timer);
  }, [nodes, running]);

  useEffect(() => {
    if (!extension || !running) return;
    const timer = setInterval(() => {
      if (useStudioStore.getState().isDirty) void useStudioStore.getState().saveWorkflow();
    }, 5000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!extension || (!running && !busy && !dirty)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running, busy, dirty]);

  useEffect(() => {
    if (!running) return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const addVideo = async (file: File, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) throw new Error('Choose an MP4, MOV or WebM video.');
    if (file.size > 500 * 1024 * 1024) throw new Error('Choose a video smaller than 500 MB for this workspace.');
    const url = URL.createObjectURL(file);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const video = document.createElement('video'); video.preload = 'metadata';
        const finish = (error?: string) => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute('src'); video.load(); if (error) reject(new Error(error)); };
        const timer = setTimeout(() => finish('Could not read this video. Try an MP4 file.'), 12000);
        video.onloadedmetadata = () => { const d = video.duration; if (Number.isFinite(d) && d > 0) { resolve(d); finish(); } else finish('The video has no readable duration.'); };
        video.onerror = () => finish('This video format could not be decoded. Try MP4.'); video.src = url;
      });
      if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
      const key = sourceKeyFor(file); putSource(key, file);
      patch({ sourceKey: key, sourceName: file.name, sourceSize: file.size, sourceDuration: duration,
        ...(key !== data.sourceKey ? { motionVideoMode: 'full', motionTrimStart: undefined, motionTrimEnd: undefined } : {}) });
    } finally { URL.revokeObjectURL(url); }
  };

  const addImage = async (file: File, role: 'subject' | 'place') => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file);
    });
    await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = () => reject(new Error('The image is damaged or unsupported.')); image.src = value; });
    patch(role === 'subject' ? { subjectImage: value, subjectName: file.name } : { placeImage: value, placeName: file.name });
  };

  const run = async (retry = false, piece?: number) => {
    if (!extension) { setError('Load the built extension in Chrome to generate. This browser preview does not run automation.'); return; }
    if (locked) return;
    if (!retry && pieces.length && !confirm('Start a new generation? Existing results will be replaced in this project. Download any clips you want to keep first.')) return;
    if (retry && piece && data.motionContinuity) {
      const through = continuityRetryThrough(pieces, piece);
      const outputs = pieces.filter(p => p.index >= piece && p.index <= through && (p.videoUrl || p.tileId));
      if (outputs.length && !confirm(`Regenerate ${through === piece ? `piece ${piece}` : `pieces ${piece}–${through}`}? Later clips in this scene depend on this ending frame and must be rebuilt. Existing results in this range will be replaced; download them first. Flow may charge for the new generations.`)) return;
    }
    setBusy(true); setError('');
    try { setView('results'); setResultFilter('all'); await startGeneration(data, retry, piece); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); void refreshAccount(); }
  };

  /* "Download all" (saveClips.ts): the folder is picked on the click itself,
     because Chrome only opens its picker in answer to one. */
  const downloadAll = async () => {
    if (exporting) return;
    const ready = pieces.filter(p => p.status === 'done' && p.videoUrl);
    if (!ready.length) return;
    setSaveNote(null);
    let folder;
    try { folder = await pickFolder(); }
    catch (e) { setSaveNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); return; }
    if (!folder) return;
    setExporting({ done: 0, total: ready.length });
    try {
      const result = await saveClips(folder, ready.map(p => ({ index: p.index, url: p.videoUrl! })), data.label, pieces.length,
        done => setExporting({ done, total: ready.length }));
      setSaveNote(saveSummary(result, folder.name));
    } finally { setExporting(null); }
  };

  const setUploadConsent = async (allowed: boolean) => {
    setUploadAllowed(allowed);
    try { await chrome.storage.local.set({ af_debug_upload: allowed }); }
    catch { setUploadAllowed(!allowed); setError('Could not save upload consent.'); }
  };

  const patchPiece = (index: number, values: Partial<MotionPieceRow>) => patch({ motionPieces: pieces.map(p => p.index === index ? { ...p, ...values } : p) });
  const resetScene = (index: number, reset: boolean) => {
    const through = continuityRetryThrough(pieces, index);
    const hasOutput = pieces.some(p => p.index >= index && p.index <= through && (p.videoUrl || p.tileId));
    if (hasOutput && !confirm(`Change the scene boundary for piece ${index}? Saved results for pieces ${index}–${through} will be cleared so they can be regenerated. Download clips you want to keep first. Nothing generates until you press Retry.`)) return;
    patch({ motionPieces: pieces.map(p => p.index >= index && p.index <= through
      ? { ...(hasOutput ? clearMotionOutput(p) : p), ...(p.index === index ? { continuityReset: reset } : {}) } : p) });
  };
  const recoverFrame = async (index: number) => {
    if (locked) return;
    const row = pieces.find(p => p.index === index);
    if (!row) return;
    setBusy(true); setRecoveringPiece(index); setError('');
    try {
      const { recoverMotionEndFrame } = await import('../../studio-extension/src/studio/media/motionEndFrame');
      const frame = await recoverMotionEndFrame(row.videoUrl);
      patchPiece(index, { endFrameUrl: frame, endFrameError: undefined });
      if (extension && !await useStudioStore.getState().saveWorkflow()) throw new Error('Ending frame recovered but could not be saved. Free some local storage before continuing.');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      patchPiece(index, { endFrameError: message }); setError(message);
    } finally { setBusy(false); setRecoveringPiece(0); }
  };
  const newProject = async () => {
    if (!confirm('Start a new project? This project stays saved locally.')) return;
    if (extension && !await useStudioStore.getState().saveWorkflow()) { setError('Could not save this project. Try again before starting a new one.'); return; }
    useStudioStore.getState().newWorkflow(); useStudioStore.setState(graphFor(defaults())); setView('workspace'); setResultFilter('all'); setError('');
  };

  /* ── What stands between the user and Generate ────────────────────────
   *
   * The button used to be disabled with nothing saying why, and the reasons
   * sat at the bottom of the page under every creative choice. These are the
   * same conditions the controller's preflight checks, listed with their
   * fixes, so a blocked button always has an answer next to it. */
  const sourceReady = !!sourceUrl;
  const analysis = engines[data.platform] || engines.gemini;
  const rangeProblem = trimProblem(data.sourceDuration, data);
  const pieceCount = rangeProblem ? 0 : planMotionVideo(data.sourceDuration || 0, data).length;
  const previewRange = data.motionVideoMode === 'trim' && !rangeProblem ? { start: data.motionTrimStart!, end: data.motionTrimEnd! } : undefined;
  const needs = [
    ...(extension ? [{ id: 'file-access', ok: fileAccessError === null,
      title: fileAccessError === undefined ? 'Checking browser upload access' : fileAccessError ? 'Enable browser file access' : 'Browser uploads ready',
      note: fileAccessError || undefined,
      fix: { label: 'Open extension settings', run: () => { void openUploadFileAccessSettings().catch(() => setError('Open your browser Extensions page, choose AutoFlow Motion → Details, and enable Allow access to file URLs.')); } } }] : []),
    { id: 'video', ok: sourceReady,
      title: sourceReady ? 'Motion video added' : data.sourceName ? 'Choose the motion video again' : 'Add a motion video',
      note: !sourceReady && data.sourceName ? `${data.sourceName} is no longer loaded` : undefined,
      fix: { label: 'Choose video', run: () => pickFile('motion-video') } },
    ...(rangeProblem ? [{ id: 'range', ok: false, title: 'Adjust the video trim', note: rangeProblem,
      fix: { label: 'Adjust trim', run: () => { document.getElementById('trim-start')?.focus(); } } }] : []),
    ...(data.motionMode === 'swap' && !many ? [{ id: 'subject', ok: !!data.subjectImage,
      title: data.subjectImage ? 'Subject image added' : 'Add a subject image', note: undefined,
      fix: { label: 'Add image', run: () => pickFile('motion-subject') } }] : []),
    ...(many ? [{ id: 'replacements', ok: replacing.length > 0,
      title: replacing.length ? `${replacing.length} change${replacing.length === 1 ? '' : 's'} chosen` : 'Choose who or what to replace',
      note: replacing.length ? 'Everything else stays as in the video' : 'Find people & items, then give each one an image or words',
      fix: { label: 'Show list', run: () => document.getElementById('replace-title')?.scrollIntoView({ block: 'center' }) } }] : []),
    ...(data.motionMode === 'restyle' ? [{ id: 'direction', ok: !!data.wish.trim(),
      title: data.wish.trim() ? 'New look described' : 'Describe the new look', note: 'Restyle video needs a direction',
      fix: { label: 'Write it', run: () => { const el = document.getElementById('motion-direction'); el?.scrollIntoView({ block: 'center' }); el?.focus(); } } }] : []),
    { id: 'account', ok: !!profile,
      title: profile ? 'Signed in' : 'Sign in to AutoFlow', note: profile?.email,
      fix: { label: 'Sign in', run: openAccount } },
    ...(profile ? [{ id: 'motion-plan', ...motionPlanStep(entitlement),
      fix: { label: 'Account', run: openAccount } }] : []),
  ];
  const missing =needs.filter(n => !n.ok).length + (uploadAllowed ? 0 : 1);
  const canGenerate = extension && missing === 0 && !preflight(data, { sourceAvailable: sourceReady, uploadAllowed, retry: false });
  const firstMissing = needs.find(n => !n.ok)?.title || (!uploadAllowed ? 'Allow automated video uploads' : '');
  const showSteps = () => {
    setView('workspace');
    requestAnimationFrame(() => document.getElementById('checklist')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const stage = stageOf(running, pieces, data.motionUploaded);
  const current = pieces.find(p => p.status === 'running');
  const unfinished = pieces.some(p => p.status !== 'done');

  let statusTitle: string, statusDetail: string;
  if (running) {
    statusTitle = current ? `Generating piece ${current.index} of ${current.of}` : data.statusNote || STAGES.find(s => s.id === stage)?.detail || 'Working…';
    statusDetail = `${time(elapsed)} elapsed · keep this panel open`;
  } else if (busy) {
    statusTitle = recoveringPiece ? `Reading piece ${recoveringPiece}'s ending frame…` : 'Starting…';
    statusDetail = recoveringPiece ? 'The completed video is kept; no generation is submitted.' : 'Checking your account and inputs';
  } else if (!extension) {
    statusTitle = 'Design preview'; statusDetail = 'Load the extension in Chrome to generate.';
  } else if (pieces.length) {
    statusTitle = complete === pieces.length ? `All ${plural(pieces.length, 'piece')} ready` : `${complete} of ${plural(pieces.length, 'piece')} ready`;
    statusDetail = missing ? `Before generating again: ${firstMissing.toLowerCase()}` : complete === pieces.length ? 'Review them in Your results.' : 'Retry resumes each piece where it stopped — finished steps are kept.';
  } else if (missing) {
    statusTitle = `${plural(missing, 'step')} before you can generate`; statusDetail = firstMissing;
  } else {
    statusTitle = 'Ready to generate';
    statusDetail = `${plural(pieceCount, 'piece')} · ${!MOTION_BILLING_CHECK ? 'test build, not counted' : free?.left === 1 ? 'uses your last free job today' : 'uses 1 Motion job'}`;
  }

  const saveText = !extension ? 'Preview' : saving === 'error' ? 'Save failed' : saving === 'saving' ? 'Saving…' : 'Saved';
  const uiMode = many ? 'many' : data.motionMode;
  const jumpTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* ── The setup, in the order the choices depend on each other ─────────
   *
   * "NOW I WANT FULL UPGRADE OF THE UI". The mode used to come after the
   * references, though it decides which references are needed (Replace
   * subject requires a subject; Replace people & items has its own list).
   * Now: the video, what changes, the references that mode needs, then the
   * direction and output. */
  const refsReady = many ? replacing.length > 0 : data.motionMode === 'swap' ? !!data.subjectImage : !!(data.subjectImage || data.placeImage);
  const setup = [
    { id: 'step-video', label: 'Video', done: sourceReady },
    { id: 'step-mode', label: 'Change', done: true },
    { id: 'step-refs', label: 'References', done: refsReady },
    { id: 'step-direction', label: 'Direction', done: !!data.wish.trim() },
  ];
  const doneChecks = needs.filter(n => n.ok);

  return <div className="app">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="bar">
      <span className="brand" aria-hidden="true"><BrandMark /></span>
      <div className="bar__titles">
        <h1>Motion Control</h1>
        <div className="project-row">
          <input className="project-name" aria-label="Project name" value={data.label} disabled={locked} spellCheck={false}
            onChange={e => { patch({ label: e.target.value }); useStudioStore.getState().setWorkflowName(e.target.value); }} />
          <span className={`save ${saving === 'error' ? 'save--error' : ''}`} title={extension ? 'Saved locally on this device' : undefined}>{saveText}</span>
        </div>
      </div>
      <div className="bar__actions">
        <button className="icon-btn" aria-label="New project" title="New project" disabled={locked} onClick={() => void newProject().catch(e => setError(String(e)))}><Icon name="plus" /></button>
        <Projects disabled={locked || !extension} onOpen={() => { setView('workspace'); setResultFilter('all'); setError(''); }} onError={setError} />
        {free && <UpgradeLink className="upgrade-pill" email={profile?.email} place="top_bar" title={`Unlimited Motion with AutoFlow Pro · ${PRO_PRICE}`}>
          <Icon name="sparkle" /><span>Upgrade</span></UpgradeLink>}
        <Account profile={profile} entitlement={entitlement} disabled={locked} onChange={refreshAccount} />
      </div>
    </header>

    <nav className="tabs" aria-label="Motion views">
      <button className="tab" aria-current={view === 'workspace' ? 'page' : undefined} onClick={() => setView('workspace')}><Icon name="motion" />Create</button>
      <button className="tab" aria-current={view === 'results' ? 'page' : undefined} onClick={() => setView('results')}><Icon name="grid" />Your results<span className="tab__count">{complete}</span></button>
    </nav>

    <main id="workspace" tabIndex={-1}>
      {!extension && <div className="notice notice--info"><Icon name="info" /><span>Design preview only. Load the extension in Chrome to connect your account and generate.</span></div>}
      {(error || data.errorMessage) && <div className="notice notice--error" role="alert"><Icon name="alert" /><span>{error || data.errorMessage}
        {extension && isUploadFileAccessError(error || data.errorMessage || '') && <button type="button" className="btn btn--secondary btn--sm"
          onClick={() => void openUploadFileAccessSettings().catch(() => setError('Open your browser Extensions page, choose AutoFlow Motion → Details, and enable Allow access to file URLs.'))}>Open extension settings</button>}
      </span></div>}
      {attention && <div className="notice notice--error notice--action" role="alert"><Icon name="alert" /><span>{attention.text}</span>
        {attention.canOpen && <button type="button" className="btn btn--secondary btn--sm" onClick={() => { void chrome.runtime.sendMessage({ type: 'PANEL_OPEN_ATTENTION_TAB' }).catch(() => {}); }}>Open tab</button>}</div>}

      {view === 'workspace' ? <div className="create">
        <nav className="setup-nav" aria-label="Setup sections">
          {setup.map((item, i) => <button key={item.id} type="button" onClick={() => jumpTo(item.id)}>
            <span className={`setup-nav__n${item.done ? ' is-ready' : ''}`}>{item.done ? <Icon name="check" /> : i + 1}</span><small>{item.label}</small></button>)}
        </nav>

        <Step n={1} id="step-video" title="Motion video" done={sourceReady}
          aside={data.sourceDuration ? `${preciseSeconds(data.sourceDuration)} · ${pieceCount ? plural(pieceCount, 'clip') : 'Check trim'}` : undefined}>
          <Upload id="motion-video" variant="stage" label="Drop your motion video here" hint={'or click to choose · MP4, MOV or WebM, up to 500 MB'}
            accept="video/*" icon="video" preview={sourceUrl} name={data.sourceName}
            meta={data.sourceDuration ? preciseSeconds(data.sourceDuration) : undefined} disabled={locked} onFile={addVideo} previewRange={previewRange} />
          <SocialImport disabled={locked} onBusy={setBusy} onFile={addVideo} />
          {data.sourceDuration > 0
            ? <VideoRange duration={data.sourceDuration} range={data} disabled={locked} onChange={range => patch({ ...range })}
              onPreview={sourceReady ? () => {
                const video = document.querySelector<HTMLVideoElement>('#motion-video video');
                if (video && previewRange) { video.currentTime = previewRange.start; void video.play().catch(() => setError('Could not play the preview. Try the video player above.')); }
              } : undefined} />
            : <p className="hint"><Icon name="check" />Keep the full video, or trim the start and end before splitting into clips.</p>}
        </Step>

        <Step n={2} id="step-mode" title="What changes" done>
          <fieldset className="modes"><legend className="visually-hidden">Transformation</legend>
            {modes.map(m => <label key={m.id} className={`mode ${uiMode === m.id ? 'is-selected' : ''}`}>
              <input type="radio" name="mode" value={m.id} checked={uiMode === m.id} disabled={locked}
                onChange={() => patch(m.id === 'many' ? { motionMode: 'swap', motionReplaceMany: true } : { motionMode: m.id, motionReplaceMany: false })} />
              <span className="mode__icon"><Icon name={m.icon} /></span>
              <span className="mode__text"><strong>{m.name}</strong><small>{m.sub}</small></span>
              <span className="mode__radio" aria-hidden="true" />
            </label>)}
          </fieldset>
        </Step>

        <Step n={3} id="step-refs" title={many ? 'People & items' : 'References'} done={refsReady}
          aside={many ? (replacing.length ? `${plural(replacing.length, 'change')}` : 'Choose what changes') : 'Who & where'}>
          {many && <Replacements data={data} patch={patch} locked={locked} scanning={scanning}
            onScan={() => void scanPeople()} onError={setError} />}
          <div className={`refs${many ? ' refs--single' : ''}`}>
            {!many && <div className="ref">
              <div className="ref__head"><Icon name="user" /><h3>Subject</h3><span className={`badge ${data.motionMode === 'swap' ? 'badge--required' : ''}`}>{data.motionMode === 'swap' ? 'Required' : 'Optional'}</span></div>
              <Upload id="motion-subject" variant="tile" label="Your character or subject" cta="Add subject" hint="Who performs"
                accept="image/png,image/jpeg,image/webp" icon="user" preview={data.subjectImage} name={data.subjectName} disabled={locked}
                onFile={f => addImage(f, 'subject')} onRemove={() => patch({ subjectImage: '', subjectName: '' })} />
            </div>}
            <div className="ref">
              <div className="ref__head"><Icon name="place" /><h3>Place</h3><span className="badge">Optional</span></div>
              <Upload id="motion-place" variant="tile" label="A different setting" cta="Add place" hint="Where it happens"
                accept="image/png,image/jpeg,image/webp" icon="place" preview={data.placeImage} name={data.placeName} disabled={locked}
                onFile={f => addImage(f, 'place')} onRemove={() => patch({ placeImage: '', placeName: '' })} />
            </div>
          </div>
          <p className="hint">{many
            ? 'The place changes only the setting — leave it empty to keep the video\'s own.'
            : 'The subject sets who appears. The place changes only the setting — leave it empty to keep the video\'s own.'}</p>
        </Step>

        <Step n={4} id="step-direction" title="Direction & output" done={!!data.wish.trim()}>
          <div className="field">
            <label className="field__label" htmlFor="motion-direction">Your direction
              <span className={`badge ${data.motionMode === 'restyle' ? 'badge--required' : ''}`}>{data.motionMode === 'restyle' ? 'Required' : 'Optional'}</span></label>
            <textarea id="motion-direction" rows={3} placeholder={directions[data.motionMode] || directions.move} value={data.wish} disabled={locked} onChange={e => patch({ wish: e.target.value })} />
          </div>
          <fieldset className="format-picker" disabled={locked}>
            <legend className="field__label">Output format</legend>
            <div className="format-options">
              {([{ ratio: '9:16', title: 'Portrait', icon: 'portrait' }, { ratio: '16:9', title: 'Landscape', icon: 'landscape' }] as const).map(format =>
                <label key={format.ratio} className={`format-option ${(data.aspectRatio || '9:16') === format.ratio ? 'is-selected' : ''}`}>
                  <input type="radio" name="output-format" value={format.ratio} checked={(data.aspectRatio || '9:16') === format.ratio}
                    onChange={() => patch({ aspectRatio: format.ratio })} />
                  <span className="format-option__icon"><Icon name={format.icon} /></span>
                  <span><strong>{format.title}</strong><small>{format.ratio}</small></span>
                  <span className="format-option__check" aria-hidden="true"><Icon name="check" /></span>
                </label>)}
            </div>
          </fieldset>
          <div className="settings">
            <label className="toggle"><input type="checkbox" checked={data.motionContinuity === true} disabled={locked} onChange={e => patch({ motionContinuity: e.target.checked })} />
              <span><strong>Keep clips consistent</strong><small>Use each generated clip’s ending frame as a reference for the next. Helps visual continuity; not a guaranteed seamless join.</small></span></label>
            {data.motionContinuity && <p className="hint settings__note"><Icon name="info" />Clips run in order. Missing ending frames pause dependent clips. Use Start new scene in results for intentional scene changes.</p>}
            <label className="toggle"><input type="checkbox" checked={data.motionLipSync === true} disabled={locked} onChange={e => patch({ motionLipSync: e.target.checked })} />
              <span><strong>Keep exact lip sync</strong><small>Tells Omni to copy every mouth movement from your video, in time with the speech.</small></span></label>
            <label className="toggle"><input type="checkbox" checked={data.motionMuteAudio} disabled={locked} onChange={e => patch({ motionMuteAudio: e.target.checked })} />
              <span><strong>Remove source audio</strong><small>A visual-only edit. Useful when speech in the video causes errors.</small></span></label>
            {data.motionLipSync && data.motionMuteAudio && <p className="hint settings__note"><Icon name="info" />Clips come back silent, with the mouths still moving as in your video, so the original sound can go back on in your editor.</p>}
          </div>
          <details className="fold"><summary><Icon name="settings" />Advanced controls</summary>
            <div className="fold__body">
              <div className="field"><label className="field__label" htmlFor="motion-engine">AI analysis engine</label>
                <select id="motion-engine" value={data.platform} disabled={locked} onChange={e => patch({ platform: e.target.value })}><option value="gemini">Gemini</option><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select>
                <span className="field__note">Watches each piece and writes its prompt. Generation itself happens in Flow.</span></div>
              <div className="field"><label className="field__label" htmlFor="motion-tabs">While it works</label>
                <select id="motion-tabs" value={tabsChoice ?? 'show'} disabled={locked || !extension || tabsChoice === null || !backgroundAllowed(data.platform)}
                  onChange={e => void saveTabsChoice(e.target.value as TabsChoice)}>
                  <option value="show">Show the working tab</option><option value="background">Work in the background</option></select>
                <span className="field__note">{!backgroundAllowed(data.platform)
                  ? 'ChatGPT needs its tab in front, so Motion keeps bringing it forward. Choose Gemini or Claude for the other options.'
                  : tabsChoice === 'background'
                    ? `Flow and ${analysis.name} stay in the background. Their working tabs are protected from automatic discarding until the job ends. Keep this panel open.`
                    : `Motion keeps ${analysis.name} or Flow in front while its step runs. If you switch away, Motion brings the working tab back until the job ends.`}</span></div>
              <div className="field"><label className="field__label" htmlFor="motion-focus">Prompt focus</label>
                <select id="motion-focus" value={data.motionPreset} disabled={locked} onChange={e => patch({ motionPreset: e.target.value })}>{MOTION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
              <label className="toggle"><input type="checkbox" checked={data.motionAlternatives} disabled={locked} onChange={e => patch({ motionAlternatives: e.target.checked })} />
                <span><strong>Save alternative prompts</strong><small>Two extra wordings per piece, for review. They never generate on their own.</small></span></label>
            </div>
          </details>
        </Step>

        <section className="checklist" id="checklist" aria-labelledby="checklist-title">
          <div className="checklist__head"><h2 id="checklist-title">Before you generate</h2>
            <span className={`checklist__count ${missing ? '' : 'checklist__count--ok'}`}>{missing ? `${missing} left` : 'All set'}</span></div>
          <ul>
            {needs.filter(n => !n.ok).map(n => <li key={n.id} className="check-row">
              <span className="check-row__mark" aria-hidden="true" />
              <span className="check-row__text">{n.title}{n.note && <small>{n.note}</small>}</span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={locked} onClick={n.fix.run}>{n.fix.label}</button>
            </li>)}
            <li className={`check-row ${uploadAllowed ? 'is-ok' : ''}`}>
              <label className="consent">
                <input type="checkbox" checked={uploadAllowed} disabled={locked || !extension} onChange={e => void setUploadConsent(e.target.checked)} />
                <span className="check-row__text"><strong>Automatic video uploads</strong><small>Enabled by default. Send my selected video, images and prompts to the chosen AI analysis service and Google Flow when I generate. Only use media you have permission to upload. Chrome shows a debugging banner during Flow uploads. <a href="privacy.html" target="_blank" rel="noreferrer">Privacy &amp; data use</a></small></span>
              </label>
            </li>
          </ul>
          {doneChecks.length > 0 && <p className="checklist__done"><Icon name="check" /><span>{doneChecks.map(n => n.title).join(' · ')}</span></p>}
          <div className="connections" aria-label="Connected tabs">
            <a className="connection" href="https://flow.google.com/" target="_blank" rel="noreferrer">
              <span className={`dot ${connected.flow ? 'is-on' : ''}`} aria-hidden="true" /><span>Open Google Flow<small>{connected.flow ? 'Tab open' : 'Opens when needed'}</small></span><Icon name="external" /></a>
            <a className="connection" href={analysis.url} target="_blank" rel="noreferrer">
              <span className={`dot ${connected.analysis ? 'is-on' : ''}`} aria-hidden="true" /><span>Open {analysis.name}<small>{connected.analysis ? 'Tab open' : 'Analysis engine'}</small></span><Icon name="external" /></a>
          </div>
          <p className="hint">Each failed clip gets up to 3 automatic Retry clicks when Flow offers Retry, using the same prompt and references. It then stops for your review. Retries may use Flow credits.</p>
        </section>
      </div> : <section className="results" aria-labelledby="results-title">
        {!pieces.length && !locked ? <div className="empty">
          <span className="empty__icon"><Icon name="video" /></span>
          <h2 id="results-title">Your next performance starts here.</h2>
          <p>Add a motion video and choose what changes. Each piece gets its own preview, editable prompt and retry.</p>
          <button className="btn btn--secondary" onClick={() => setView('workspace')}>Set up your motion<Icon name="arrow" /></button>
        </div> : <>
          <div className="results__head">
            <h2 id="results-title">Your clips</h2>
            {pieces.length > 0 && <span>{complete} of {pieces.length} complete</span>}
          </div>
          {pieces.length > 0 && <div className="meter" role="progressbar" aria-label="Pieces complete" aria-valuemin={0} aria-valuemax={pieces.length} aria-valuenow={complete}>
            <span style={{ width: `${(complete / pieces.length) * 100}%` }} /></div>}
          {running && stage && <RunProgress stage={stage} title={statusTitle} note={current ? data.statusNote : undefined} elapsed={elapsed} />}
          {!running && busy && !pieces.length && <RunProgress stage="prepare" title="Starting…" elapsed={0} />}
          {pieces.length > 0 && <div className="results__tools">
            <nav className="result-filters" aria-label="Filter clips">
              {([{ id: 'all', name: 'All clips', count: pieces.length }, { id: 'done', name: 'Ready', count: complete }, { id: 'error', name: 'Needs attention', count: failed }] as const).map(f =>
                <button type="button" key={f.id} className={`filter--${f.id}${f.count ? ' has-items' : ''}`} aria-pressed={(running ? 'all' : resultFilter) === f.id} disabled={running} onClick={() => setResultFilter(f.id)}>{f.name}<span>{f.count}</span></button>)}
            </nav>
            {complete > 0 && <button type="button" className="btn btn--secondary btn--sm" disabled={running || !!exporting || !extension} onClick={() => void downloadAll()}>
              <Icon name="download" />{exporting ? `Saving ${exporting.done} of ${exporting.total}…` : complete === 1 ? 'Download the clip' : `Download all ${complete} clips`}</button>}
          </div>}
          {saveNote && <p className={`save-all__note${saveNote.ok ? '' : ' is-error'}`} role="status">{saveNote.text}</p>}
          {settingsChanged && <div className="notice"><Icon name="info" /><span>Inputs changed since this run. These results use the previous settings — start a new generation to apply your changes.</span></div>}
          <div className="pieces">{visiblePieces.map(p => <PieceCard key={p.index} piece={p} running={running} locked={locked} settingsChanged={settingsChanged}
            continuity={data.motionContinuity === true} previous={pieces.find(before => before.index === p.index - 1)} recovering={recoveringPiece === p.index}
            inFlow={p.uploaded ?? data.motionUploaded === true}
            onPatch={values => patchPiece(p.index, values)} onRetry={() => void run(true, p.index)} onReset={reset => resetScene(p.index, reset)} onRecover={() => void recoverFrame(p.index)} />)}</div>
          {pieces.length > 0 && visiblePieces.length === 0 && <div className="filter-empty"><Icon name="check" /><p>{resultFilter === 'error' ? 'No clips need attention.' : 'Your finished clips will appear here.'}</p><button className="btn btn--ghost btn--sm" onClick={() => setResultFilter('all')}>Show all clips</button></div>}
          {pieces.length > 1 && <p className="hint"><Icon name="info" />{data.motionContinuity ? 'Clips share ending-frame references. Regenerating an earlier clip rebuilds its dependent scene. Review joins before combining.' : 'Each piece is a separate generation. Review the joins before combining them.'}</p>}
          {free && !running && complete > 0 && <div className="notice notice--upgrade"><Icon name="sparkle" />
            <span>Loved it? For {PRO_PRICE}, Pro makes Motion unlimited — and Studio and Queue Manager too.</span>
            <UpgradeLink className="btn btn--secondary btn--sm" email={profile?.email} place="after_clip">Upgrade<Icon name="external" /></UpgradeLink></div>}
        </>}
      </section>}

      <footer className="actionbar">
        <div className="actionbar__status">
          {running ? <span className="pulse" aria-hidden="true" /> : <span className={`actionbar__dot${missing && extension && !pieces.length ? ' is-waiting' : ''}`} aria-hidden="true" />}
          <div><strong>{statusTitle}</strong><span>{statusDetail}</span></div>
          {!locked && extension && missing > 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={showSteps}>Show steps</button>}
        </div>
        <div className="actionbar__buttons">
          {locked
            ? <button className="btn btn--danger btn--lg btn--block" onClick={() => void engine().then(({ runner }) => runner.stop())} disabled={!running}><Icon name="stop" />Stop</button>
            : <>
              {unfinished && pieces.length > 0 && <button className="btn btn--secondary btn--lg" disabled={settingsChanged} onClick={() => void run(true)}><Icon name="retry" />Retry unfinished</button>}
              {/* Today's free jobs are used: the one useful thing this button
                  can still do is offer the plan without a limit. Retry stays. */}
              {free?.reached
                ? <UpgradeLink className="btn btn--primary btn--lg" email={profile?.email} place="limit"><Icon name="sparkle" />Upgrade · {PRO_PRICE}</UpgradeLink>
                : <button className="btn btn--primary btn--lg" disabled={!canGenerate} onClick={() => void run()}><Icon name="play" />{pieces.length ? 'Generate again' : 'Generate motion'}</button>}
            </>}
        </div>
        {free && !locked && <p className="plan-line">{free.reached
          ? <><Icon name="clock" />All {free.limit} free jobs used today · {resetIn ? `${free.limit} more in ${resetIn}` : 'they reset at midnight UTC'}</>
          : <>Free plan · {free.left === 1 ? 'last free job today' : `${free.left} of ${free.limit} left today`} · <UpgradeLink email={profile?.email} place="plan_line">Go unlimited with Pro<Icon name="arrow" /></UpgradeLink></>}</p>}
        {proWelcome && <p className="plan-line plan-line--pro" role="status"><Icon name="check" />AutoFlow Pro is on — unlimited Motion jobs. Thank you!</p>}
      </footer>
    </main>
  </div>;
}

/** One numbered setup step; the number turns into a check once its part is done. */
function Step({ n, id, title, aside, done, children }: {
  n: number; id: string; title: string; aside?: string; done?: boolean; children: React.ReactNode;
}) {
  return <section className="step" aria-labelledby={id}>
    <h2 className="step__title" id={id}>
      <span className={`step__n${done ? ' is-done' : ''}`}>{done ? <Icon name="check" /> : n}</span>{title}
      {aside && <span className="step__aside">{aside}</span>}
    </h2>
    {children}
  </section>;
}

function RunProgress({ stage, title, note, elapsed }: { stage: StageId; title: string; note?: string; elapsed: number }) {
  const at = STAGES.findIndex(s => s.id === stage);
  return <section className="run" aria-label="Generation progress">
    <div className="run__top">
      <span className="pulse" aria-hidden="true" />
      <strong className="run__title" aria-live="polite">{title}</strong>
      <span className="run__clock"><Icon name="clock" />{time(elapsed)}</span>
    </div>
    <ol className="stages">{STAGES.map((s, i) => <li key={s.id} className={`stage ${i < at ? 'is-done' : i === at ? 'is-current' : ''}`} aria-current={i === at ? 'step' : undefined}>
      <span className="stage__bar" /><span>{s.label}</span></li>)}</ol>
    {note && bare(note) !== bare(title) && <span className="run__meta">{note}</span>}
    <span className="run__meta"><Icon name="check" />Keep this panel open. Your computer stays awake until the job ends.</span>
  </section>;
}

function PieceCard({ piece: p, running, locked, settingsChanged, inFlow, continuity, previous, recovering, onPatch, onRetry, onReset, onRecover }: {
  piece: MotionPieceRow; running: boolean; locked: boolean; settingsChanged: boolean;
  /** This piece is in Flow's library — per piece, or the old node-wide flag. */
  inFlow: boolean;
  continuity: boolean; previous?: MotionPieceRow; recovering: boolean;
  onReset: (reset: boolean) => void; onRecover: () => void;
  onPatch: (values: Partial<MotionPieceRow>) => void; onRetry: () => void;
}) {
  /* The steps this piece has already passed. A retry resumes it at the first
     one that is not done — so showing them is showing what a retry keeps.
     A finished clip has passed them all, so it shows the clip instead. */
  const steps = [
    { label: 'Prompt', done: !!p.prompt.trim() },
    { label: 'In Flow', done: inFlow || p.status === 'done' },
    { label: 'Clip', done: p.status === 'done' },
  ];
  const chip = p.status === 'done' ? 'Complete' : p.status === 'running' ? 'Generating' : p.status === 'error' ? 'Needs attention' : running ? 'Queued' : 'Not generated';
  const wait = p.status === 'running' ? 'Generating in Flow…' : p.status === 'error' ? 'This piece needs another try' : running ? 'Queued — generates after the pieces before it' : 'Not generated yet';
  return <article className={`piece is-${p.status}`} aria-label={`Piece ${p.index}`}>
    <header className="piece__head">
      <span className="piece__num">{pad(p.index)}</span>
      <span className="piece__time">{time(p.startSec)}–{time(p.endSec)}</span>
      {p.cutsSpeech && <span className="tag">cuts mid-speech</span>}
      <span className={`chip chip--${p.status}`}>{chip}</span>
    </header>
    {p.status !== 'done' && <ol className="piece__steps" aria-label="Saved steps for this piece">
      {steps.map((s) => <li key={s.label} className={s.done ? 'is-done' : ''}>{s.label}
        <span className="visually-hidden">{s.done ? ', done' : ', not yet'}</span></li>)}
    </ol>}
    {p.status === 'done'
      ? <MotionPreview key={`${p.videoUrl}-${p.posterUrl}`} videoUrl={p.videoUrl} posterUrl={p.posterUrl} index={p.index} />
      : <div className="piece__wait"><Icon name={p.status === 'error' ? 'alert' : p.status === 'running' ? 'motion' : 'clock'} /><span>{wait}</span></div>}
    {p.errorMessage && <p className="piece__error">{p.errorMessage}</p>}
    {continuity && <div className="piece__continuity">
      {p.status === 'done' ? <>
        <div className="continuity-frame">
          {endingFrame(p.endFrameUrl) ? <img src={p.endFrameUrl} alt={`Ending frame for piece ${p.index}`} /> : <Icon name="image" />}
          <span><strong>{endingFrame(p.endFrameUrl) ? 'Ending frame saved' : 'Ending frame missing'}</strong><small>{p.continuityReset || p.index === 1 ? 'Starts a scene' : `Continues piece ${p.index - 1}`} · {p.index < p.of ? 'reference for the next clip' : 'last clip'}</small></span>
        </div>
        {!endingFrame(p.endFrameUrl) && <><p className="field__note">{p.endFrameError || 'The video is complete. Recover its frame before continuing; this does not regenerate it.'}</p><button type="button" className="btn btn--secondary btn--sm" disabled={locked || !p.videoUrl} onClick={onRecover}>{recovering ? 'Reading frame…' : 'Recover ending frame'}</button></>}
      </> : <div className="continuity-frame"><Icon name="image" /><span><strong>{p.continuityReset || p.index === 1 ? 'New scene · original references' : `Continue from piece ${p.index - 1}`}</strong><small>{p.continuityReset || p.index === 1 ? 'No previous ending frame attached' : endingFrame(previous?.endFrameUrl) && previous?.status === 'done' ? 'Previous ending frame ready' : 'Waiting for the previous clip’s ending frame'}</small></span></div>}
      {p.index > 1 && <label className="toggle"><input type="checkbox" checked={!!p.continuityReset} disabled={locked || settingsChanged} onChange={e => onReset(e.target.checked)} /><span>Start new scene<small>Use original references without the previous ending frame.</small></span></label>}
    </div>}
    {/* Keyed on status so a piece that fails opens its prompt — that is
        usually the fix — while a toggle the user made within one status is
        left alone. */}
    <details className="piece__prompt" key={p.status} open={p.status === 'error' || undefined}>
      <summary>Prompt{p.alternatives?.length ? ` · ${plural(p.alternatives.length, 'alternative')}` : ''}</summary>
      <textarea aria-label={`Prompt for piece ${p.index}`} rows={3} value={p.prompt} disabled={locked} onChange={e => onPatch({ prompt: e.target.value })} />
      {p.alternatives?.length ? <div className="alts"><span>Use a different wording. This does not generate anything.</span>
        {p.alternatives.map((a, i) => <button className="alt" disabled={locked} key={i} onClick={() => onPatch({ prompt: a })}>{a}</button>)}</div> : null}
    </details>
    <footer className="piece__actions">
      <label className="toggle"><input type="checkbox" checked={!!p.muteRequested || !!p.audioMuted} disabled={locked || p.audioMuted} onChange={e => onPatch({ muteRequested: e.target.checked })} />{p.audioMuted ? 'Audio removed' : 'Mute on retry'}</label>
      <button className="btn btn--secondary btn--sm" disabled={locked || settingsChanged} onClick={onRetry}><Icon name="retry" />{p.status === 'done' ? 'Regenerate' : 'Retry piece'}</button>
      {p.videoUrl && <a className="icon-btn" href={p.videoUrl} download={`motion-piece-${p.index}.mp4`} target="_blank" rel="noreferrer" aria-label={`Download piece ${p.index}`} title="Download"><Icon name="download" /></a>}
    </footer>
  </article>;
}
