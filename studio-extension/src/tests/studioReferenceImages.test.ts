/** @jest-environment jsdom */
/// <reference types="node" />
import { webcrypto } from 'crypto';
import { resolveStudioReferenceImages } from '../content/flow/studioReferenceImages';
import { getStudioImageFiles, releaseStudioImages } from '../content/flow/studioImages';

const START = 'data:image/png;base64,U1RBUlQ=';
const END = 'data:image/png;base64,RU5E';
beforeAll(() => Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle }));

test('resolves a Start tile before End bytes rather than grouping by storage type', async () => {
  const metas = await resolveStudioReferenceImages({ creationType: 'frames',
    referenceImageData: [END], referenceImageIds: ['start'],
    frameReferences: [{ kind: 'tile', tileId: 'start' }, { kind: 'data', dataUrl: END }],
  }, id => id === 'start' ? START : '');
  expect(getStudioImageFiles(metas.map(m => m.id))!.map(f => f.data))
    .toEqual(['U1RBUlQ=', 'RU5E']);
  releaseStudioImages(metas.map(m => m.id));
});

test('retains two frame slots when Start and End deliberately use the same image', async () => {
  const metas = await resolveStudioReferenceImages({ creationType: 'frames',
    frameReferences: [{ kind: 'data', dataUrl: START }, { kind: 'data', dataUrl: START }],
  }, () => '');
  expect(metas).toHaveLength(2);
  expect(getStudioImageFiles(metas.map(m => m.id))).toHaveLength(2);
  releaseStudioImages(metas.map(m => m.id));
});

test('still deduplicates ordinary ingredients and supports older payloads', async () => {
  const metas = await resolveStudioReferenceImages({ creationType: 'ingredients', referenceImageData: [START, START] }, () => '');
  expect(metas).toHaveLength(1);
  releaseStudioImages(metas.map(m => m.id));
});

test('missing tiles fail explicitly instead of dropping one frame', async () => {
  await expect(resolveStudioReferenceImages({ creationType: 'frames',
    frameReferences: [{ kind: 'tile', tileId: 'gone' }],
  }, () => '')).rejects.toThrow(/Reference tile gone not found/);
});

test('invalid later references clean up already registered frame bytes', async () => {
  const good = await resolveStudioReferenceImages({ referenceImageData: [START] }, () => '');
  releaseStudioImages(good.map(m => m.id));
  await expect(resolveStudioReferenceImages({ creationType: 'frames',
    frameReferences: [{ kind: 'data', dataUrl: START }, { kind: 'data', dataUrl: 'bad' }],
  }, () => '')).rejects.toThrow(/valid base64/);
  expect(getStudioImageFiles(good.map(m => m.id))).toBeNull();
});
