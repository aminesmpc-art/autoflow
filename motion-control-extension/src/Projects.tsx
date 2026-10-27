import { useRef, useState } from 'react';
import { useStudioStore } from '../../studio-extension/src/studio/store';
import { defaults, graphFor, MOTION_ID, recover, type MotionData } from './model';
import Icon from './Icon';

type Project = Awaited<ReturnType<ReturnType<typeof useStudioStore.getState>['listWorkflows']>>[number];

export default function Projects({ disabled, onOpen, onError }: {
  disabled: boolean; onOpen: () => void; onError: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setProjects(await useStudioStore.getState().listWorkflows());
    dialog.current?.showModal();
  };
  const load = async (id: string) => {
    setBusy(true);
    try {
      if (!await useStudioStore.getState().saveWorkflow()) throw new Error('Could not save the current project. Please try again.');
      await useStudioStore.getState().loadWorkflow(id);
      const state = useStudioStore.getState();
      if (state.workflow.id !== id) throw new Error('Could not open this project. Your current project is still available.');
      const saved = state.nodes.find(n => n.id === MOTION_ID);
      if (!saved) throw new Error('This is not a Motion project.');
      useStudioStore.setState({ ...graphFor(recover({ ...defaults(), ...saved.data } as MotionData)), isRunning: false, isPaused: false });
      dialog.current?.close(); onOpen();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    <button className="icon-btn" aria-label="Saved projects" title="Saved projects" disabled={disabled} onClick={() => void open().catch(e => onError(String(e)))}><Icon name="folder" /></button>
    <dialog className="sheet" ref={dialog} aria-labelledby="projects-title">
      <button className="icon-btn sheet__close" aria-label="Close projects" disabled={busy} onClick={() => dialog.current?.close()}><Icon name="close" /></button>
      <span className="sheet__eyebrow">Pick up where you left off</span>
      <h2 id="projects-title">Your motion projects</h2>
      <p>Saved on this device, in this extension.</p>
      <div className="sheet__body"><div className="project-list">{projects.length ? projects.map(p => <button key={p.id} disabled={busy} onClick={() => void load(p.id)}>
        <Icon name="motion" /><span><strong>{p.name}</strong><small>{new Date(p.updatedAt).toLocaleString()}</small></span><Icon name="arrow" />
      </button>) : <p>No saved projects yet. Your first project is saved as you work.</p>}</div></div>
    </dialog>
  </>;
}
