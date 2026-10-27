/// <reference types="node" />
/**
 * "Same videos, we want to change 2 characters, or 1 character and the item."
 * Replace mode: find the people and items, give up to four of them new images,
 * keep everything else. A scan is one analysis turn, never a Motion job.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { configuration, defaults, graphFor, preflight, recover, targetsKey, type MotionData } from '../src/model';
import { scanTargets } from '../src/controller';
import { runner } from '../../studio-extension/src/studio/engine/WorkflowRunner';
import { admitMotionJob } from '../src/billing';
import { getSource } from '../../studio-extension/src/studio/clip/sourceStore';

const nodes: any[] = [];
jest.mock('../src/billing', () => ({ admitMotionJob: jest.fn(), jobFor: jest.fn() }));
jest.mock('../../studio-extension/src/shared/api', () => ({ getProfile: jest.fn() }));
jest.mock('../../studio-extension/src/studio/clip/sourceStore', () => ({ getSource: jest.fn(() => ({})) }));
jest.mock('../../studio-extension/src/studio/engine/bridge', () => ({ bridge: { getStatus: () => 'connected' } }));
jest.mock('../../studio-extension/src/background/uploadFileAccess', () => ({ checkUploadFileAccess: jest.fn(async () => null) }));
jest.mock('../../studio-extension/src/studio/engine/WorkflowRunner', () => ({ runner: { run: jest.fn() } }));
jest.mock('../../studio-extension/src/studio/store', () => ({ useStudioStore: {
  getState: () => ({
    isRunning: false, nodes,
    saveWorkflow: async () => true,
    updateNodeData: (id: string, values: any) => { const n = nodes.find(x => x.id === id); if (n) n.data = { ...n.data, ...values }; },
  }),
  setState: (s: any) => { nodes.length = 0; nodes.push(...(s.nodes || [])); },
} }));

const IMG = 'data:image/png;base64,AAAA';
const project = (over: Partial<MotionData> = {}): MotionData => ({
  ...defaults(), motionMode: 'swap', motionReplaceMany: true, sourceKey: 'video-1', sourceDuration: 9,
  motionReplacements: [{ targetId: 't1', kind: 'person', label: 'woman on the left', image: IMG }], ...over,
});
const ready = { sourceAvailable: true, uploadAllowed: true, retry: false };

beforeEach(() => {
  jest.clearAllMocks(); nodes.length = 0;
  (globalThis as any).chrome = { storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) } } };
});

describe('the project', () => {
  it('can replace chosen people/items without the single subject image', () => {
    expect(preflight(project(), ready)).toBeNull();
    expect(preflight(project({ motionReplacements: [] }), ready)).toMatch(/Find people & items, then choose at least one to replace/);
  });

  it('keeps Replace subject about its one subject image, with any list left unused', () => {
    const single = project({ motionReplaceMany: false });
    expect(preflight(single, ready)).toMatch(/Add a subject image for Replace subject/);
    expect((graphFor({ ...single, subjectImage: IMG }).nodes[0].data as any).motionReplacements).toBeUndefined();
    expect(graphFor({ ...single, subjectImage: IMG }).edges.map(e => e.targetHandle)).toEqual(['image_ref']);
  });

  it('drops the subject image from a people & items run, which uses the list instead', () => {
    expect(graphFor(project({ subjectImage: IMG, placeImage: IMG })).edges.map(e => e.targetHandle)).toEqual(['place_ref']);
  });

  it('moves a project saved before the card onto it', () => {
    const legacy = { ...project(), motionReplaceMany: undefined };
    expect(recover(legacy).motionReplaceMany).toBe(true);
    expect(recover({ ...legacy, motionReplacements: [] }).motionReplaceMany).toBeUndefined();
  });

  it('refuses more replacements than Flow takes with these settings', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ targetId: `t${i + 1}`, kind: 'person' as const, label: `p${i}`, image: IMG }));
    expect(preflight(project({ motionReplacements: four }), ready)).toBeNull();
    expect(preflight(project({ motionReplacements: four, placeImage: IMG, motionContinuity: true }), ready))
      .toMatch(/Flow takes 3 replacement image\(s\) with these settings.*Remove 1, or describe them in words instead\./);
  });

  it('takes words instead of an image, without counting them against the image limit', () => {
    const words = (i: number) => ({ targetId: `w${i}`, kind: 'person' as const, label: `w${i}`, text: 'an old wizard' });
    const four = Array.from({ length: 4 }, (_, i) => ({ targetId: `t${i + 1}`, kind: 'person' as const, label: `p${i}`, image: IMG }));
    expect(preflight(project({ motionReplacements: [words(1)] }), ready)).toBeNull();
    expect(preflight(project({ motionReplacements: [...four, words(1), words(2)] }), ready)).toBeNull();
    // A row with neither an image nor words is not a change.
    expect(preflight(project({ motionReplacements: [{ targetId: 'x', kind: 'item', label: 'x', text: '  ' }] }), ready))
      .toMatch(/choose at least one to replace/);
  });

  it('counts changed words as a changed setting', () => {
    const a = project({ motionReplacements: [{ targetId: 't1', kind: 'person', label: 'man', text: 'an old wizard' }] });
    const b = project({ motionReplacements: [{ targetId: 't1', kind: 'person', label: 'man', text: 'a young knight' }] });
    expect(configuration(a)).not.toBe(configuration(b));
  });

  it('counts a changed replacement as a changed setting, in Replace mode only', () => {
    const a = project();
    const b = project({ motionReplacements: [{ ...a.motionReplacements![0], image: `${IMG}BB` }] });
    expect(configuration(a)).not.toBe(configuration(b));
    expect(configuration({ ...a, motionMode: 'move' })).toBe(configuration({ ...b, motionMode: 'move' }));
  });

  it('sends replacements to the run only in Replace mode', () => {
    expect((graphFor(project()).nodes[0].data as any).motionReplacements).toHaveLength(1);
    expect((graphFor(project({ motionMode: 'move' })).nodes[0].data as any).motionReplacements).toBeUndefined();
  });

  it('ties a scan to the video and the trim', () => {
    expect(targetsKey(project())).toBe('video-1|');
    expect(targetsKey(project({ motionVideoMode: 'trim', motionTrimStart: 1, motionTrimEnd: 5 } as any))).not.toBe('video-1|');
  });
});

describe('the scan', () => {
  it('runs the one node with the scan flag, never admits a job, and clears the flag after', async () => {
    (runner.run as jest.Mock).mockImplementation(async (graphNodes: any[]) => {
      expect(graphNodes[0].data.motionScanTargets).toBe(true);
      nodes[0].data = { ...nodes[0].data, motionTargetList: [{ id: 't1', kind: 'person', label: 'woman on the left' }], status: 'idle' };
    });
    await scanTargets(project());
    expect(runner.run).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), { only: new Set(['motion-workspace']) });
    expect(admitMotionJob).not.toHaveBeenCalled();
    expect(nodes[0].data.motionScanTargets).toBeUndefined();
  });

  it('reports a scan that did not finish', async () => {
    (runner.run as jest.Mock).mockImplementation(async () => {
      nodes[0].data = { ...nodes[0].data, status: 'error', errorMessage: 'Gemini did not answer.' };
    });
    await expect(scanTargets(project({ motionTargetList: undefined }))).rejects.toThrow('Gemini did not answer.');
  });

  it('needs the video', async () => {
    (getSource as jest.Mock).mockReturnValueOnce(undefined);
    await expect(scanTargets(project())).rejects.toThrow(/Add the motion video first/);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('the panel', () => {
  const APP = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const REP = readFileSync(join(__dirname, '..', 'src', 'Replacements.tsx'), 'utf8');

  it('is its own card in What changes, with the list right under the cards', () => {
    expect(APP).toMatch(/\{ id: 'many', name: 'Replace people & items'/);
    expect(APP).toMatch(/patch\(m\.id === 'many' \? \{ motionMode: 'swap', motionReplaceMany: true \} : \{ motionMode: m\.id, motionReplaceMany: false \}\)/);
    expect(APP.indexOf('{many && <Replacements ')).toBeGreaterThan(APP.indexOf('<p className="mode-explanation">'));
    expect(APP).toMatch(/\{!many && <div className="ref">/);
  });

  it('shows the scan and up to the limit', () => {
    expect(REP).toMatch(/Find people &amp; items|'Find people & items'/);
    expect(REP).toMatch(/disabled=\{locked \|\| \(!rep\?\.image && full\)\}/);
    expect(REP).toMatch(/\{rep\?\.image \? 'Change image' : 'Image…'\}/);
    expect(REP).toMatch(/\{rep\?\.text \? 'Edit words' : rep\?\.image \? 'Add words' : 'Describe…'\}/);
    expect(REP).toMatch(/The video or trim changed since the last scan/);
  });
});
