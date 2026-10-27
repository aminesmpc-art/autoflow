import { createRoot } from 'react-dom/client';
import { Boundary } from './Boundary';
import { hydrate } from '../../studio-extension/src/studio/clip/sourceStore';
import { useStudioStore } from '../../studio-extension/src/studio/store';
import { defaults, graphFor, MOTION_ID, recover, type MotionData } from './model';
import App from './App';
import './panel.css';

/* "why he cant open ??? and its soo slow": the panel was an empty dark box.
   Nothing is drawn until the saved videos and project are read, and a render
   error unmounts everything, so slow, broken and stale all looked the same.
   Now it always says which one it is. */
const say = (text: string) => {
  const line = document.createElement('p');
  line.className = 'boot';
  line.setAttribute('role', 'status');
  line.textContent = text;
  document.getElementById('root')!.replaceChildren(line);
};

async function mount() {
  if (globalThis.chrome?.runtime?.id) {
    let step = 'your saved videos';
    const slow = setTimeout(() => say(`Still opening Motion — reading ${step}. A large project can take a few seconds.`), 6000);
    try {
      await hydrate().catch(() => undefined);
      step = 'your project';
      await useStudioStore.getState().loadLastWorkflow();
    } finally {
      clearTimeout(slow);
    }
    const saved = useStudioStore.getState().nodes.find(n => n.id === MOTION_ID);
    const data = saved ? recover({ ...defaults(), ...saved.data } as MotionData) : defaults();
    const graph = graphFor(data);
    useStudioStore.setState({ ...graph, isRunning: false, isPaused: false });
  } else {
    useStudioStore.setState(graphFor(defaults()));
    /* Design preview only: a plain browser tab, never the extension. Lets the
       running and results states be rendered and checked without a live run. */
    Object.assign(globalThis, { __motionPreview: { store: useStudioStore, id: MOTION_ID } });
  }
  createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
}

function showError(error: unknown) {
  say(`Motion could not open: ${error instanceof Error ? error.message : String(error)}. Reopen the workspace to try again.`);
}

if (globalThis.chrome?.runtime?.id && navigator.locks) {
  void navigator.locks.request('autoflow-motion-workspace', { ifAvailable: true }, async lock => {
    if (!lock) {
      say('Motion is already open in another browser panel. Use that panel to avoid duplicate generations.');
      return;
    }
    await mount();
    await new Promise<void>(() => { /* Hold ownership until this document closes. */ });
  }).catch(showError);
} else void mount().catch(showError);
