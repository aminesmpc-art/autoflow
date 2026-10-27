/// <reference types="node" />
import { confirmUploadLanded } from '../background/debugUpload';
import { motionWork, recordMotionUpload, MotionPieceRow } from '../studio/ask/motionControl';

const row = (): MotionPieceRow => ({ index: 1, of: 2, startSec: 0, endSec: 8, seconds: 8,
  cutsSpeech: false, filename: 'piece.mp4', prompt: 'Move like the source.', why: '', status: 'idle', uploaded: false });

describe('Motion only generates from verified ready video uploads', () => {
  it('does not mark a file ready merely because the chooser accepted it', () => {
    const piece = row();
    expect(recordMotionUpload(piece, { ok: true })).toBe(false);
    expect(piece.uploaded).toBe(false);
    expect(piece.uploadPending).toBeDefined();
  });
  it('preserves a pending upload and its real filename for a recheck without cutting or uploading again', () => {
    const piece = row();
    recordMotionUpload(piece, { ok: false, uploadState: 'pending', names: ['actual.mp4'],
      tabId: 12, projectUrl: 'https://flow.google.com/project/one' });
    expect(piece.filename).toBe('actual.mp4');
    expect(piece.uploadPending?.tabId).toBe(12);
    expect(motionWork().needsUpload(piece)).toBe(true); // runs the verify-only branch
    expect(motionWork().needsCut(piece)).toBe(false);
    expect(motionWork().needsPrompt(piece)).toBe(false);
  });
  it('clears the pending state only after readiness is verified', () => {
    const piece = row();
    recordMotionUpload(piece, { ok: false, uploadState: 'pending' });
    expect(recordMotionUpload(piece, { ok: true, confirmed: true, uploadState: 'ready' })).toBe(true);
    expect(piece.uploadPending).toBeUndefined();
    expect(motionWork().needsUpload(piece)).toBe(false);
  });
  it('allows an explicitly failed upload to be uploaded again while preserving its prompt', () => {
    const piece = row();
    recordMotionUpload(piece, { ok: false, uploadState: 'failed' });
    expect(piece.uploadPending).toBeUndefined();
    expect(motionWork().needsCut(piece)).toBe(true);
    expect(motionWork().needsPrompt(piece)).toBe(false);
  });
  it('leaves completed pieces outside upload retries', () => {
    const piece = { ...row(), status: 'done' as const };
    expect(motionWork().needsUpload(piece)).toBe(false);
    expect(motionWork().needsCut(piece)).toBe(false);
  });
  it('does not accept a filesystem path as a Flow asset name', () => {
    const piece = row();
    recordMotionUpload(piece, { ok: true, confirmed: true, names: ['C:\\Downloads\\piece.mp4'] });
    expect(piece.filename).toBe('piece.mp4');
  });
});

describe('worker upload confirmation', () => {
  let send: jest.Mock;
  beforeEach(() => {
    send = jest.fn();
    (globalThis as any).chrome = { tabs: { sendMessage: send } };
  });
  it('rejects a named processing row even from an older page that reports ok', async () => {
    send.mockResolvedValue({ ok: true, processing: ['piece'] });
    const result = await confirmUploadLanded(12, ['piece.mp4']);
    expect(result.ok).toBe(false);
    expect(result.failed).not.toBe(true);
    expect(result.note).toContain('still processing');
  });
  it('distinguishes explicit failure from uncertain upload status', async () => {
    send.mockResolvedValue({ ok: false, failed: ['piece'] });
    expect(await confirmUploadLanded(12, ['piece.mp4'])).toMatchObject({ ok: false, failed: true, ran: true });
  });
  it('never authorizes generation when the page cannot be reached', async () => {
    send.mockRejectedValue(new Error('tab reloaded'));
    const result = await confirmUploadLanded(12, ['piece.mp4']);
    expect(result).toMatchObject({ ok: false, ran: false });
    expect(result.failed).not.toBe(true);
  });
  it('confirms a ready asset', async () => {
    send.mockResolvedValue({ ok: true, found: ['piece'], failed: [], processing: [] });
    expect(await confirmUploadLanded(12, ['piece.mp4'])).toMatchObject({ ok: true, ran: true });
  });
});
