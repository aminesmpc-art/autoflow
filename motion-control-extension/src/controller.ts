import { useStudioStore } from '../../studio-extension/src/studio/store';
import { getProfile } from '../../studio-extension/src/shared/api';
import { admitMotionJob, jobFor } from './billing';
import { MOTION_BILLING_CHECK } from './buildFlags';
import { getSource } from '../../studio-extension/src/studio/clip/sourceStore';
import { bridge } from '../../studio-extension/src/studio/engine/bridge';
import { configuration, graphFor, MOTION_ID, preflight, type MotionData } from './model';
import { clearMotionOutput, continuityRetryThrough } from '../../studio-extension/src/studio/ask/motionContinuity';
import { holdAwake, letSleep } from './keepAwake';
import { prepareWorkingTabs } from './backgroundTabs';
import { checkUploadFileAccess } from '../../studio-extension/src/background/uploadFileAccess';
import { loadUploadChoice } from './uploadDefaults';

let starting = false;
export const engine = () => import('../../studio-extension/src/studio/engine/WorkflowRunner');

export async function startGeneration(data: MotionData, retry = false, piece?: number): Promise<void> {
  if (starting || useStudioStore.getState().isRunning) throw new Error('A generation is already in progress.');
  starting = true;
  try {
    const uploadAllowed = await loadUploadChoice();
    const problem = preflight(data, { sourceAvailable: !!getSource(data.sourceKey), uploadAllowed, retry, piece });
    if (problem) throw new Error(problem);
    const accessError = await checkUploadFileAccess();
    if (accessError) throw new Error(accessError);
    await prepareWorkingTabs(data.platform);
    if (bridge.getStatus() !== 'connected') throw new Error('The extension connection is unavailable. Reopen the workspace.');
    const profile = await getProfile();
    if (!profile) throw new Error('Sign in to AutoFlow, or reconnect to verify your account.');
    const { runner } = await engine();
    const next: MotionData = { ...data, configurationAtRun: configuration(data), motionRetryPiece: undefined, motionRetryThrough: undefined };
    next.motionJob = await jobFor(data, profile.email, retry, getSource(data.sourceKey));
    let graph = graphFor(next);
    useStudioStore.setState({ nodes: graph.nodes, edges: graph.edges, isDirty: true });
    if (!await useStudioStore.getState().saveWorkflow()) throw new Error('Could not save the job safely. Free some local storage and try again. Nothing was started.');
    /* Skipped only by `npm run build:test`, which the store packager refuses. */
    if (MOTION_BILLING_CHECK) await admitMotionJob(next.motionJob);
    // A denied admission must not clear completed videos from the saved project.
    if (piece != null) {
      const through = data.motionContinuity ? continuityRetryThrough(data.motionPieces, piece) : piece;
      next.motionPieces = data.motionPieces.map(p => p.index >= piece && p.index <= through ? clearMotionOutput(p) : p);
      next.motionRetryPiece = piece;
      next.motionRetryThrough = through;
    }
    next.motionJob = { ...next.motionJob, started: true };
    graph = graphFor(next);
    useStudioStore.setState({ nodes: graph.nodes, edges: graph.edges, isDirty: true });
    if (!await useStudioStore.getState().saveWorkflow()) throw new Error('Your job was admitted but could not be saved. Reopen the project and retry this job; do not create a new generation.');
    // The job runs only while the computer is awake (keepAwake.ts).
    holdAwake();
    try { await runner.run(graph.nodes, graph.edges, retry ? { only: new Set([MOTION_ID]) } : {}); }
    finally { letSleep(); }
    await useStudioStore.getState().saveWorkflow();
  } finally { starting = false; }
}

/**
 * "Find people & items": one turn with the analysis engine over the selected
 * part of the video, which writes the list onto the project (motionTargetList).
 *
 * Not a job. Nothing goes to Flow and nothing is generated, so there is no
 * admission, no upload consent and no upload check; the run's scan branch
 * (executeMotionNode, motionScanTargets) returns before any of that. Targeted
 * at the one node so a full run's reset never touches finished clips.
 */
export async function scanTargets(data: MotionData): Promise<void> {
  if (starting || useStudioStore.getState().isRunning) throw new Error('A generation is already in progress.');
  starting = true;
  try {
    if (!getSource(data.sourceKey)) throw new Error('Add the motion video first.');
    if (!['gemini', 'chatgpt', 'claude'].includes(data.platform)) throw new Error('Choose a supported analysis engine.');
    await prepareWorkingTabs(data.platform);
    if (bridge.getStatus() !== 'connected') throw new Error('The extension connection is unavailable. Reopen the workspace.');
    const { runner } = await engine();
    const graph = graphFor({ ...data, motionScanTargets: true });
    useStudioStore.setState({ nodes: graph.nodes, edges: graph.edges, isDirty: true });
    try { await runner.run(graph.nodes, graph.edges, { only: new Set([MOTION_ID]) }); }
    finally {
      useStudioStore.getState().updateNodeData(MOTION_ID, { motionScanTargets: undefined });
      await useStudioStore.getState().saveWorkflow();
    }
    const node = useStudioStore.getState().nodes.find(n => n.id === MOTION_ID);
    const error = String((node?.data as any)?.errorMessage || '');
    if (!Array.isArray((node?.data as any)?.motionTargetList) || (node?.data as any)?.status === 'error') {
      throw new Error(error || 'The scan did not finish. Try again.');
    }
  } finally { starting = false; }
}
