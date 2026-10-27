/**
 * "please make the tool not slow becouse the panal get glitch and samtims stop"
 *
 * Measured on the built Motion panel: every save read ALL of chrome.storage
 * back (get(null)) to list names, and rewrote every finished clip, which a
 * Motion node keeps as a data:video URL. Saves now keep clips in the IndexedDB
 * vault with a reference in the workflow, and list from a small index.
 */
const vault = new Map<string, Blob>();
const refuse = { on: false };
jest.mock('../studio/clip/vault', () => ({
  saveMedia: jest.fn(async (key: string, blob: Blob) => { if (refuse.on) return false; vault.set(key, blob); return true; }),
  loadMedia: jest.fn(async (key: string) => vault.get(key)),
  dropMedia: jest.fn(async (prefix: string) => { for (const k of [...vault.keys()]) if (k.startsWith(prefix)) vault.delete(k); }),
}));

import { useStudioStore } from '../studio/store';
import { saveMedia } from '../studio/clip/vault';

let mem: Record<string, any>;
let getAll = 0;
const clone = (v: any) => JSON.parse(JSON.stringify(v));
const local: any = {
  get: jest.fn(async (keys: any) => {
    if (keys == null) { getAll++; return clone(mem); }
    const list = typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(list.filter((k: string) => k in mem).map((k: string) => [k, mem[k]])));
  }),
  set: jest.fn(async (items: any) => { Object.assign(mem, clone(items)); }),
  remove: jest.fn(async (key: string) => { delete mem[key]; }),
};

const CLIP = `data:video/mp4;base64,${btoa('x'.repeat(300_000))}`;
const PHOTO = `data:image/png;base64,${btoa('p'.repeat(300_000))}`;
const motion = (pieces = [CLIP, CLIP]) => ({
  id: 'motion-workspace', type: 'motion', position: { x: 0, y: 0 },
  data: { type: 'motion', label: 'M', motionPieces: pieces.map((videoUrl, i) => ({ index: i + 1, status: 'done', videoUrl })) },
});
const open = (id: string, nodes: any[]) => useStudioStore.setState({
  workflow: { id, name: id, createdAt: 1, updatedAt: 1 }, nodes, edges: [], isDirty: true,
} as any);
const saved = (id: string) => mem[`studio_workflow_${id}`];

beforeEach(() => {
  mem = {}; getAll = 0; vault.clear(); refuse.on = false;
  delete local.getKeys;
  jest.clearAllMocks();
  (globalThis as any).chrome = { storage: { local } };
});

describe('a save', () => {
  it('keeps finished clips in the vault and only a reference in the workflow', async () => {
    open('wf_a', [motion()]);
    expect(await useStudioStore.getState().saveWorkflow()).toBe(true);
    const pieces = saved('wf_a').nodes[0].data.motionPieces;
    expect(pieces.map((p: any) => p.videoUrl)).toEqual([
      'vault:wf:wf_a:motion-workspace:motionPieces.0.videoUrl|video/mp4',
      'vault:wf:wf_a:motion-workspace:motionPieces.1.videoUrl|video/mp4']);
    expect(vault.size).toBe(2);
    // In memory nothing changed: the clip still plays.
    expect((useStudioStore.getState().nodes[0].data as any).motionPieces[0].videoUrl).toBe(CLIP);
  });

  it('moves photos too, wherever they sit, and leaves small strings alone', async () => {
    const node = motion([]);
    Object.assign(node.data, { subjectImage: PHOTO, wish: 'keep the camera still', motionReplacements: [{ targetId: 't1', image: PHOTO }] });
    open('wf_a', [node, { id: 'subject', type: 'image', position: { x: 0, y: 0 }, data: { type: 'image', imageData: PHOTO } }]);
    await useStudioStore.getState().saveWorkflow();
    const [m, image] = saved('wf_a').nodes;
    expect(m.data.subjectImage).toBe('vault:wf:wf_a:motion-workspace:subjectImage|image/png');
    expect(m.data.motionReplacements[0].image).toBe('vault:wf:wf_a:motion-workspace:motionReplacements.0.image|image/png');
    expect(image.data.imageData).toBe('vault:wf:wf_a:subject:imageData|image/png');
    expect(m.data.wish).toBe('keep the camera still');
    expect(JSON.stringify(saved('wf_a')).length).toBeLessThan(2000);
  });

  it('brings media back as the identical string, so run fingerprints still match', async () => {
    const node = motion([CLIP]);
    Object.assign(node.data, { subjectImage: PHOTO });
    open('wf_a', [node]);
    await useStudioStore.getState().saveWorkflow();
    open('other', []);
    await useStudioStore.getState().loadWorkflow('wf_a');
    const data = useStudioStore.getState().nodes[0].data as any;
    expect(data.subjectImage).toBe(PHOTO);
    expect(data.motionPieces[0].videoUrl).toBe(CLIP);
  });

  it('does not write an unchanged clip again', async () => {
    open('wf_a', [motion()]);
    await useStudioStore.getState().saveWorkflow();
    await useStudioStore.getState().saveWorkflow();
    expect(saveMedia).toHaveBeenCalledTimes(2);
  });

  it('writes a clip again when the vault evicted it for room', async () => {
    open('wf_a', [motion([CLIP])]);
    await useStudioStore.getState().saveWorkflow();
    vault.clear();
    await useStudioStore.getState().saveWorkflow();
    expect(vault.size).toBe(1);
  });

  it('keeps the clip in the workflow when the vault refuses it', async () => {
    refuse.on = true;
    open('wf_a', [motion([CLIP])]);
    await useStudioStore.getState().saveWorkflow();
    expect(saved('wf_a').nodes[0].data.motionPieces[0].videoUrl).toBe(CLIP);
  });

  it('never reads all of storage once the index exists', async () => {
    open('wf_a', [motion()]);
    await useStudioStore.getState().saveWorkflow();
    getAll = 0;
    for (let i = 0; i < 3; i++) await useStudioStore.getState().saveWorkflow();
    await useStudioStore.getState().listWorkflows();
    expect(getAll).toBe(0);
    expect(useStudioStore.getState().savedWorkflows.map(w => w.id)).toEqual(['wf_a']);
  });

  it('lands in order when saves overlap, and keeps later changes dirty', async () => {
    open('wf_a', [motion([])]);
    const first = useStudioStore.getState().saveWorkflow();
    useStudioStore.setState({ nodes: [{ ...motion([]), data: { ...motion([]).data, label: 'renamed' } }] } as any);
    const second = useStudioStore.getState().saveWorkflow();
    await Promise.all([first, second]);
    expect(saved('wf_a').nodes[0].data.label).toBe('renamed');
    expect(useStudioStore.getState().isDirty).toBe(false);
  });
});

describe('a load', () => {
  it('turns references back into playable clips', async () => {
    open('wf_a', [motion()]);
    await useStudioStore.getState().saveWorkflow();
    open('other', []);
    await useStudioStore.getState().loadWorkflow('wf_a');
    expect((useStudioStore.getState().nodes[0].data as any).motionPieces.map((p: any) => p.videoUrl)).toEqual([CLIP, CLIP]);
  });

  it('leaves a clip the vault no longer has empty, rather than a broken reference', async () => {
    open('wf_a', [motion([CLIP])]);
    await useStudioStore.getState().saveWorkflow();
    vault.clear();
    await useStudioStore.getState().loadWorkflow('wf_a');
    expect((useStudioStore.getState().nodes[0].data as any).motionPieces[0].videoUrl).toBe('');
  });
});

describe('the list', () => {
  it('is built once from workflows saved before the index', async () => {
    mem.studio_workflow_old = { id: 'old', name: 'Old one', createdAt: 1, updatedAt: 5, nodes: [{}], edges: [] };
    expect((await useStudioStore.getState().listWorkflows()).map(w => w.name)).toEqual(['Old one']);
    expect(getAll).toBe(1);
    await useStudioStore.getState().listWorkflows();
    expect(getAll).toBe(1);
  });

  it('heals against the stored keys without reading their values', async () => {
    mem.studio_index_workflows = { gone: { id: 'gone', name: 'Gone', createdAt: 0, updatedAt: 9, nodeCount: 0 } };
    mem.studio_workflow_new = { id: 'new', name: 'New', createdAt: 1, updatedAt: 2, nodes: [], edges: [] };
    local.getKeys = jest.fn(async () => Object.keys(mem));
    expect((await useStudioStore.getState().listWorkflows()).map(w => w.id)).toEqual(['new']);
    expect(getAll).toBe(0);
  });

  it('forgets a deleted workflow and its clips', async () => {
    open('wf_a', [motion()]);
    await useStudioStore.getState().saveWorkflow();
    await useStudioStore.getState().deleteWorkflow('wf_a');
    expect(saved('wf_a')).toBeUndefined();
    expect(mem.studio_index_workflows.wf_a).toBeUndefined();
    expect(vault.size).toBe(0);
  });
});
