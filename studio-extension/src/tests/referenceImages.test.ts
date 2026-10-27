/** @jest-environment jsdom */
/// <reference types="node" />
import { webcrypto } from 'crypto';
import { identifyReference, ensureReferenceImages, referenceProject, referenceReceiptKey,
  ReferenceReceipt, ReferenceFile, matchingReferenceRow, referenceReceipts,
  referenceSearchQueries, isDurableMediaKey } from '../content/flow/referenceImages';

beforeAll(() => Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle }));
const PROJECT = 'https://flow.google.com/project/one';
const ID = 'id:11111111-1111-1111-1111-111111111111';
const OTHER = 'id:22222222-2222-2222-2222-222222222222';
const file = async (contents = 'same picture') => identifyReference('image/png', btoa(contents));

function harness(store = new Map<string, ReferenceReceipt>()) {
  let attached: string[] = [];
  const deps = {
    project: PROJECT,
    read: jest.fn(async (key: string) => store.get(key)),
    write: jest.fn(async (key: string, receipt: ReferenceReceipt) => { store.set(key, receipt); }),
    attached: () => attached,
    upload: jest.fn(async (_file: ReferenceFile) => { attached.push(ID); return true; }),
    select: jest.fn(async (receipt: ReferenceReceipt) => { attached.push(receipt.mediaId || ID); return true; }),
    stopped: () => false, log: jest.fn(),
  };
  return { deps, store, setAttached: (ids: string[]) => { attached = ids; } };
}

describe('reference image identity', () => {
  it('keeps identical bytes stable across registrations', async () => {
    expect(await file()).toEqual(await file());
    expect((await file()).id).toMatch(/^ref_[a-f0-9]{64}$/);
  });
  it('does not reuse changed images', async () => {
    expect((await file('new')).id).not.toBe((await file()).id);
  });
  it('preserves real file extensions', async () => {
    expect((await identifyReference('image/webp', btoa('webp'))).filename).toMatch(/\.webp$/);
  });
  it('gives Flow a short name while the id keeps the whole hash', async () => {
    /* The 64-character hash made a 75-character name that Flow's picker cut
       off on screen ("af_ref_511ae6e81a020c3…") and nobody could search for. */
    const image = await file();
    expect(image.filename).toMatch(/^af_ref_[a-f0-9]{16}\.png$/);
    expect(image.id).toMatch(/^ref_[a-f0-9]{64}$/);
    expect(image.id.slice(4, 20)).toBe(image.filename.slice(7, 23));
  });
  it('rejects malformed data and unsupported types', async () => {
    await expect(identifyReference('image/png', '%%%')).rejects.toThrow();
    await expect(identifyReference('text/plain', btoa('text'))).rejects.toThrow('Unsupported');
  });
  it('scopes receipts by Flow project, ignoring subpages and query strings', () => {
    expect(referenceProject(`${PROJECT}/character/example?x=1`)).toBe(PROJECT);
    expect(referenceReceiptKey(PROJECT, 'x')).not.toBe(referenceReceiptKey(`${PROJECT}2`, 'x'));
    expect(() => referenceProject('https://flow.google.com/')).toThrow('project');
  });
});

describe('upload once and reuse', () => {
  it('uploads once, then searches on the second generation with a fresh engine', async () => {
    const first = harness();
    const image = await file();
    expect(await ensureReferenceImages([image], first.deps)).toBe(true);
    expect(first.deps.upload).toHaveBeenCalledTimes(1);
    const second = harness(first.store);
    expect(await ensureReferenceImages([await file()], second.deps)).toBe(true);
    expect(second.deps.upload).not.toHaveBeenCalled();
    expect(second.deps.select).toHaveBeenCalledWith({ filename: image.filename, mediaId: ID });
  });
  it('skips the library when the exact loaded image is already attached', async () => {
    const h = harness();
    const image = await file();
    await ensureReferenceImages([image], h.deps);
    await ensureReferenceImages([image], h.deps);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
    expect(h.deps.select).not.toHaveBeenCalled();
  });
  it('uploads separately in a different project', async () => {
    const h = harness();
    const image = await file();
    await ensureReferenceImages([image], h.deps);
    h.setAttached([]);
    await ensureReferenceImages([image], { ...h.deps, project: `${PROJECT}2` });
    expect(h.deps.upload).toHaveBeenCalledTimes(2);
  });
  it('deduplicates the same picture connected twice', async () => {
    const h = harness();
    const image = await file();
    await ensureReferenceImages([image, image], h.deps);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
  });
  it('maps subject and place independently even when input order changes', async () => {
    const h = harness();
    const subject = await file('subject');
    const place = await file('place');
    h.deps.upload.mockImplementation(async image => {
      h.setAttached([...h.deps.attached(), image.id === subject.id ? ID : OTHER]);
      return true;
    });
    await ensureReferenceImages([subject, place], h.deps);
    h.setAttached([]);
    await ensureReferenceImages([place, subject], h.deps);
    expect(h.deps.upload).toHaveBeenCalledTimes(2);
    expect(h.deps.select.mock.calls.map(([r]) => r.mediaId)).toEqual([OTHER, ID]);
  });
  it('saves an upload intent before dispatch and searches after a timeout', async () => {
    const h = harness();
    const image = await file();
    h.deps.upload.mockImplementation(async () => {
      expect(h.store.get(referenceReceiptKey(PROJECT, image.id))).toEqual({ filename: image.filename });
      throw new Error('tab reloaded');
    });
    await expect(ensureReferenceImages([image], h.deps)).rejects.toThrow('tab reloaded');
    const next = harness(h.store);
    await ensureReferenceImages([image], next.deps);
    expect(next.deps.upload).not.toHaveBeenCalled();
    expect(next.deps.select).toHaveBeenCalledTimes(1);
  });
  it('never substitutes an unrelated existing chip as proof', async () => {
    const h = harness();
    h.setAttached([OTHER]);
    h.deps.upload.mockResolvedValue(true);
    await expect(ensureReferenceImages([await file()], h.deps)).rejects.toThrow('not attached');
  });
  it('does not duplicate a cached asset when the picker is unavailable', async () => {
    const h = harness();
    const image = await file();
    await ensureReferenceImages([image], h.deps);
    h.setAttached([]);
    h.deps.select.mockResolvedValue(false);
    await expect(ensureReferenceImages([image], h.deps)).rejects.toThrow('No duplicate');
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
  });
  it('rejects a cached selection of the wrong picture', async () => {
    const h = harness();
    const image = await file();
    await ensureReferenceImages([image], h.deps);
    h.setAttached([]);
    h.deps.select.mockImplementation(async () => { h.setAttached([OTHER]); return true; });
    await expect(ensureReferenceImages([image], h.deps)).rejects.toThrow('not attached');
  });
  it('accepts the one new chip when yesterday\'s key was an /asb/ token', async () => {
    /* The receipt held the chip's /asb/ token from the first upload. The next
       day the same picture came back under another one, and "the saved
       reference could not be attached". A token is not durable; the chip this
       attach added is the picture the picker matched by name. */
    const h = harness();
    const image = await file();
    h.store.set(referenceReceiptKey(PROJECT, image.id), { filename: image.filename, mediaId: 'asb:yesterday' });
    h.deps.select.mockImplementation(async () => { h.setAttached(['asb:today']); return true; });
    expect(await ensureReferenceImages([image], h.deps)).toBe(true);
    expect(h.deps.upload).not.toHaveBeenCalled();
    expect(h.store.get(referenceReceiptKey(PROJECT, image.id))).toEqual({ filename: image.filename, mediaId: 'asb:today' });
  });
  it('still refuses two new chips, which prove nothing about which is ours', async () => {
    const h = harness();
    const image = await file();
    h.store.set(referenceReceiptKey(PROJECT, image.id), { filename: image.filename, mediaId: 'asb:yesterday' });
    h.deps.select.mockImplementation(async () => { h.setAttached(['asb:a', 'asb:b']); return true; });
    await expect(ensureReferenceImages([image], h.deps)).rejects.toThrow('not attached');
  });
  it('cancels without uploading', async () => {
    const h = harness();
    expect(await ensureReferenceImages([await file()], { ...h.deps, stopped: () => true })).toBe(false);
    expect(h.deps.upload).not.toHaveBeenCalled();
  });
  it('fails before uploading if durable storage is unavailable', async () => {
    const h = harness();
    h.deps.write.mockRejectedValue(new Error('storage unavailable'));
    await expect(ensureReferenceImages([await file()], h.deps)).rejects.toThrow('storage');
    expect(h.deps.upload).not.toHaveBeenCalled();
  });
});

describe('exact library matching', () => {
  function row(name: string, src: string): HTMLElement {
    const el = document.createElement('button');
    el.innerHTML = '<span class="asset-title"></span><img>';
    el.querySelector('span')!.textContent = name;
    el.querySelector('img')!.src = src;
    return el;
  }
  it('matches renamed assets by stable media ID despite renewed signed URLs', () => {
    const right = row('renamed', `https://flow-content.google/image/${ID.slice(3)}?Signature=new`);
    expect(matchingReferenceRow([row('wrong', 'blob:other'), right], { filename: 'old.png', mediaId: ID })).toBe(right);
  });
  it('does not guess from the first result or from a partial filename', () => {
    expect(matchingReferenceRow([row('af_one.png extra', 'blob:x')], { filename: 'af_one.png' })).toBeNull();
  });
  it('accepts an exact upload name but rejects duplicate ambiguous names', () => {
    const one = row('af_one', `https://flow-content.google/image/${ID.slice(3)}`);
    expect(matchingReferenceRow([one], { filename: 'af_one.png' })).toBe(one);
    expect(matchingReferenceRow([one, row('af_one', 'blob:y')], { filename: 'af_one.png' })).toBeNull();
  });
  it('does not fall back to filename when the stored identity differs', () => {
    expect(matchingReferenceRow([row('af_one.png', `https://flow-content.google/image/${OTHER.slice(3)}`)],
      { filename: 'af_one.png', mediaId: ID })).toBeNull();
  });
  it('finds the picture by name when the stored key is an /asb/ token', () => {
    /* The two key spaces cannot be compared, so the content-hash name decides. */
    const name = 'af_ref_511ae6e81a020c3f';
    const uuidRow = row(name, `https://flow-content.google/image/${ID.slice(3)}`);
    expect(matchingReferenceRow([row('other', `https://flow-content.google/image/${OTHER.slice(3)}`), uuidRow],
      { filename: `${name}.png`, mediaId: 'asb:yesterday' })).toBe(uuidRow);
    const tokenRow = row(name, 'https://flow.google.com/asb/today');
    expect(matchingReferenceRow([tokenRow], { filename: `${name}.png`, mediaId: 'asb:yesterday' })).toBe(tokenRow);
  });
  it('reads a long name Flow cut short, but never a bare prefix', () => {
    const long = `af_ref_511ae6e81a020c3${'0'.repeat(42)}.png`;
    const cut = row('af_ref_511ae6e81a020c3…', 'blob:x');
    expect(matchingReferenceRow([cut], { filename: long })).toBe(cut);
    expect(matchingReferenceRow([row('af_ref_511ae6e81a020c3...', 'blob:x')], { filename: long })).not.toBeNull();
    expect(matchingReferenceRow([row('af_ref_511…', 'blob:x')], { filename: long })).toBeNull();
    expect(matchingReferenceRow([row('af_ref_999ae6e81a020c3…', 'blob:x')], { filename: long })).toBeNull();
  });
  it('treats only Flow media UUIDs as durable', () => {
    expect(isDurableMediaKey(ID)).toBe(true);
    expect(isDurableMediaKey('asb:token')).toBe(false);
    expect(isDurableMediaKey('')).toBe(false);
    expect(isDurableMediaKey(undefined)).toBe(false);
  });
});

describe('what is typed into Flow\'s search', () => {
  it('tries the short name first, then the full one, then lists everything', () => {
    const long = `af_ref_511ae6e81a020c3f${'0'.repeat(48)}.png`;
    expect(referenceSearchQueries({ filename: long })).toEqual([
      'af_ref_511ae6e81a020c3f', long.slice(0, -4), long, '',
    ]);
  });
  it('adds Flow\'s own id only when it is a durable one', () => {
    expect(referenceSearchQueries({ filename: 'af_ref_511ae6e81a020c3f.png', mediaId: ID }))
      .toEqual(['af_ref_511ae6e81a020c3f', 'af_ref_511ae6e81a020c3f.png', ID.slice(3), '']);
    expect(referenceSearchQueries({ filename: 'af_ref_511ae6e81a020c3f.png', mediaId: 'asb:token' }))
      .toEqual(['af_ref_511ae6e81a020c3f', 'af_ref_511ae6e81a020c3f.png', '']);
  });
});

it('persists receipts using extension storage, not image bytes', async () => {
  const data: Record<string, unknown> = {};
  (globalThis as any).chrome = { storage: { local: {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (values: Record<string, unknown>) => Object.assign(data, values),
  } } };
  await referenceReceipts.write('key', { filename: 'a.png', mediaId: ID });
  expect(await referenceReceipts.read('key')).toEqual({ filename: 'a.png', mediaId: ID });
  expect(await referenceReceipts.read('missing')).toBeUndefined();
});
