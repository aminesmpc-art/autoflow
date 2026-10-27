import { configuration, defaults, graphFor, MOTION_ID, preflight, recover } from '../src/model';
import { validateTemplate } from '../../studio-extension/src/studio/templates/validate';

test('builds only one motion job and connects optional references to distinct ports', () => {
  const graph = graphFor({ ...defaults(), subjectImage: 'data:image/png;base64,AA', placeImage: 'data:image/png;base64,BB' });
  expect(validateTemplate({ id: 'motion', name: 'Motion', nodeCount: 3, ...graph })).toEqual([]);
  expect(graph.edges.map(e => [e.source, e.targetHandle])).toEqual([['subject', 'image_ref'], ['place', 'place_ref']]);
  expect(graph.nodes.filter(n => n.type === 'motion').map(n => n.id)).toEqual([MOTION_ID]);
});

test('empty optional references produce no dangling edges', () => {
  expect(graphFor(defaults()).edges).toEqual([]);
  expect(graphFor(defaults()).nodes).toHaveLength(1);
});

test('landscape is saved on the motion job and changing format invalidates retry', () => {
  const data = defaults(); data.configurationAtRun = configuration(data);
  const landscape = { ...data, aspectRatio: '16:9' as const };
  expect(graphFor(landscape).nodes[0].data.aspectRatio).toBe('16:9');
  expect(configuration(landscape)).not.toBe(configuration(data));
  expect(preflight(landscape, { sourceAvailable: true, uploadAllowed: true, retry: true })).toMatch(/Settings or inputs changed/);
  expect(configuration({ ...data, aspectRatio: undefined })).toBe(configuration(data));
});

test('requires source and explicit upload consent before paid work', () => {
  const opts = { sourceAvailable: false, uploadAllowed: false, retry: false };
  expect(preflight(defaults(), opts)).toMatch(/source video/);
  expect(preflight(defaults(), { ...opts, sourceAvailable: true })).toMatch(/Enable video uploads/);
  expect(preflight(defaults(), { ...opts, sourceAvailable: true, uploadAllowed: true })).toBeNull();
});

test('validates mode-specific input requirements', () => {
  const opts = { sourceAvailable: true, uploadAllowed: true, retry: false };
  expect(preflight({ ...defaults(), motionMode: 'swap' }, opts)).toMatch(/subject image/);
  expect(preflight({ ...defaults(), motionMode: 'restyle' }, opts)).toMatch(/Describe/);
  expect(preflight({ ...defaults(), platform: 'unavailable' }, opts)).toMatch(/supported/);
});

test('changed settings cannot silently reuse old pieces', () => {
  const data = defaults(); data.configurationAtRun = configuration(data);
  expect(preflight({ ...data, wish: 'new look' }, { sourceAvailable: true, uploadAllowed: true, retry: true })).toMatch(/changed/);
});

test('interrupted jobs are recoverable without marking unfinished clips complete', () => {
  const data = defaults(); data.status = 'running';
  data.motionPieces = [{ index: 1, of: 1, startSec: 0, endSec: 8, seconds: 8, cutsSpeech: false, filename: 'clip.mp4', prompt: 'test', why: '', status: 'running' }];
  const restored = recover(data);
  expect(restored.status).toBe('error'); expect(restored.motionPieces[0].status).toBe('error');
  expect(restored.errorMessage).toMatch(/Check Flow/);
});

test('uploaded pieces can retry without the source but muting still requires it', () => {
  const data = defaults(); data.sourceKey = 'source'; data.motionPreparedFrom = 'source'; data.motionUploaded = true;
  data.motionPieces = [{ index: 1, of: 1, startSec: 0, endSec: 8, seconds: 8, cutsSpeech: false, filename: 'clip.mp4', prompt: 'test', why: '', status: 'error' }];
  data.configurationAtRun = configuration(data);
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: false, retry: true })).toBeNull();
  data.motionPieces[0].muteRequested = true;
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: true, retry: true })).toMatch(/original video/);
});

/* ── Retry resumes each piece where it broke ──────────────────────────────
   The check before a retry follows the same per-piece rules as the runner
   (motionWork): it asks for the video only when some piece still has to be
   cut, and for uploads only when some piece still has to go into Flow. */
const prepared = () => {
  const data = defaults(); data.sourceKey = 'source'; data.motionPreparedFrom = 'source';
  data.motionPieces = [1, 2].map((index) => ({ index, of: 2, startSec: (index - 1) * 7, endSec: index * 7, seconds: 7,
    cutsSpeech: false, filename: `p${index}.mp4`, prompt: 'directed', why: '', status: 'idle' as const, uploaded: true }));
  data.configurationAtRun = configuration(data);
  return data;
};

test('a retry after a failed upload needs the video for the pieces not yet in Flow', () => {
  const data = prepared();
  data.motionPieces[1].uploaded = false;
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: true, retry: true })).toMatch(/source video/);
  expect(preflight(data, { sourceAvailable: true, uploadAllowed: false, retry: true })).toMatch(/Enable video uploads/);
});

test('a retry with every piece in Flow needs neither the video nor the upload switch', () => {
  expect(preflight(prepared(), { sourceAvailable: false, uploadAllowed: false, retry: true })).toBeNull();
});

test('"Retry piece" asks only for what that piece needs', () => {
  const data = prepared();
  data.motionPieces[1].uploaded = false;              // piece 2 still has to go into Flow
  data.motionPieces[0].status = 'error';               // piece 1 is in Flow and failed to generate
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: false, retry: true, piece: 1 })).toBeNull();
  expect(preflight(data, { sourceAvailable: false, uploadAllowed: false, retry: true, piece: 2 })).toMatch(/source video/);
});
