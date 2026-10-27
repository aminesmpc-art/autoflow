/**
 * One clip into another — the rule both run paths share.
 * See src/shared/videoReference.ts for the review this answers and the live
 * measurement the token match rests on.
 */

/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  asbToken, decodeClipRef, encodeClipRef, takesVideoReference, tileToken, videoReferenceFor,
} from '../shared/videoReference';

const TOKEN = 'ANqvLOaxqHlZe7G4dI4IPIcHbyjnx5kK3E49';
const FRAME = 'data:image/jpeg;base64,/9j/4AAQ';

describe('the clip token', () => {
  it('is read off a thumbnail, a player and a rendition alike', () => {
    expect(asbToken(`https://flow.google.com/asb/${TOKEN}`)).toBe(TOKEN);
    expect(asbToken(`https://flow.google.com/asb/${TOKEN}=mm,22,15`)).toBe(TOKEN);
    expect(asbToken(`https://flow.google.com/asb/${TOKEN}?x=1`)).toBe(TOKEN);
  });

  it('is absent from URLs in the other id space', () => {
    expect(asbToken('https://flow-content.google/video/0b9e…?Expires=1&Signature=2')).toBe('');
    expect(asbToken('data:image/png;base64,AAAA')).toBe('');
    expect(asbToken(undefined)).toBe('');
  });
});

describe('the reference string', () => {
  it('round-trips, prompts with colons and quotes included', () => {
    const ref = { token: TOKEN, title: 'Ruby: "hi" — waves at camera' };
    expect(decodeClipRef(encodeClipRef(ref))).toEqual(ref);
  });

  it('leaves an ordinary library filename alone', () => {
    expect(decodeClipRef('Motion-Control-1-silent-part1-of-2.mp4')).toBeNull();
    expect(decodeClipRef('clip:{not json')).toBeNull();
    expect(decodeClipRef(encodeClipRef({ token: '', title: '' }))).toBeNull();
  });
});

describe('which models take a whole clip', () => {
  it('is the Omni family only', () => {
    expect(takesVideoReference('Omni 1.1 Flash')).toBe(true);
    expect(takesVideoReference('Omni Flash')).toBe(true);
    expect(takesVideoReference('Veo 3.1 - Fast')).toBe(false);
    expect(takesVideoReference('Nano Banana Pro')).toBe(false);
  });
});

describe('what a wired clip becomes', () => {
  const done = {
    thumbnailUrl: `https://flow.google.com/asb/${TOKEN}`,
    referenceUrl: FRAME,
    sentPrompt: 'Ruby waves and speaks to camera, warm light',
  };

  it('is the clip itself on Omni', () => {
    const r = videoReferenceFor(done, 'Omni 1.1 Flash');
    expect(r.kind).toBe('clip');
    if (r.kind !== 'clip') return;
    expect(decodeClipRef(r.styleReference)).toEqual({ token: TOKEN, title: done.sentPrompt });
    expect(r.note).toContain('video reference');
  });

  it('finds the token in a saved result when the clip ran earlier', () => {
    const r = videoReferenceFor({ resultUrl: `https://flow.google.com/asb/${TOKEN}=mm,22,15` }, 'Omni 1.1 Flash');
    expect(r.kind === 'clip' && decodeClipRef(r.styleReference)?.token).toBe(TOKEN);
  });

  it('is its last frame on Veo, and says why and what to switch to', () => {
    const r = videoReferenceFor(done, 'Veo 3.1 - Fast');
    expect(r).toEqual(expect.objectContaining({ kind: 'frame', frame: FRAME }));
    if (r.kind === 'frame') expect(r.note).toMatch(/cannot take a video.*Omni 1\.1 Flash/);
  });

  it('falls back to the last frame on Omni when the clip cannot be named', () => {
    const r = videoReferenceFor({ referenceUrl: FRAME }, 'Omni 1.1 Flash');
    expect(r.kind).toBe('frame');
  });

  it('refuses before anything is spent when there is nothing to use', () => {
    expect(videoReferenceFor({}, 'Veo 3.1 - Fast').kind).toBe('none');
    expect(videoReferenceFor(undefined, 'Omni 1.1 Flash').kind).toBe('none');
  });

  it('takes the token from the tile id when no URL carries it', () => {
    /* flowTileIdentity names a video tile by its token; a result whose media
       URL came from the API still has that. */
    const r = videoReferenceFor({ tileId: TOKEN, sentPrompt: 'x' }, 'Omni 1.1 Flash');
    expect(r.kind === 'clip' && decodeClipRef(r.styleReference)?.token).toBe(TOKEN);
    expect(tileToken('0b9e2f4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c')).toBe('');
    expect(tileToken('')).toBe('');
  });
});

describe('both run paths', () => {
  /* The canvas runner and the worker each build a node's config. If they
     decided V differently, a clip would go whole on one press and as a frame
     on the next, depending on which path took the run. */
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it.each([
    ['the canvas runner', 'studio/engine/WorkflowRunner.ts'],
    ['the worker', 'background/runCoordinator.ts'],
  ])('%s decides with videoReferenceFor and stops when the clip cannot go on', (_name, file) => {
    const src = read(file);
    expect(src).toContain("from '../../shared/videoReference'".replace('../../', file.startsWith('background') ? '../' : '../../'));
    expect(src).toMatch(/videoReferenceFor\(/);
    expect(src).toMatch(/if \(ref\.kind === 'none'\) throw new Error\(ref\.error\);/);
    expect(src).toMatch(/\|\| videoReference !== undefined/);
  });
});
