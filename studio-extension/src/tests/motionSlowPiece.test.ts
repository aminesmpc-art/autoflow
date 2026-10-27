/// <reference types="node" />

/**
 * A slow piece no longer stops the others.
 *
 * 2026-10-01: piece 2's upload was still processing in Flow when the check ran
 * out, the runner threw at the upload step, and piece 1 — in Flow and ready —
 * was never generated. Now a piece whose upload is pending is passed over at
 * the upload step, the ready pieces are generated first, and the slow one is
 * checked again at the end — the same upload, never another copy.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { recordMotionUpload, type MotionPieceRow } from '../studio/ask/motionControl';

const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
const at = RUNNER.indexOf('private async executeMotionNode');
const body = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

const row = (): MotionPieceRow => ({
  index: 2, of: 2, startSec: 5, endSec: 10, seconds: 5, cutsSpeech: false,
  filename: 'Untitled-motion-silent-part2-of-2', prompt: 'p'.repeat(30), why: '', status: 'idle',
});

describe('what an upload reply makes of a piece', () => {
  it('still processing: in Flow, not ready, and checked again later', () => {
    const r = row();
    recordMotionUpload(r, { ok: false, uploadState: 'pending', tabId: 7, projectUrl: 'https://flow.google.com/project/x' });
    expect(r.uploaded).toBe(false);
    expect(r.uploadPending).toEqual({ tabId: 7, projectUrl: 'https://flow.google.com/project/x' });
  });

  it('ready on the second look', () => {
    const r = row();
    recordMotionUpload(r, { ok: false, uploadState: 'pending', tabId: 7, projectUrl: 'p' });
    recordMotionUpload(r, { ok: true, confirmed: true, uploadState: 'ready', tabId: 7, projectUrl: 'p' });
    expect(r.uploaded).toBe(true);
    expect(r.uploadPending).toBeUndefined();
  });

  it('failed outright: nothing pending — that still stops the run', () => {
    const r = row();
    recordMotionUpload(r, { ok: false, uploadState: 'failed' });
    expect(r.uploaded).toBe(false);
    expect(r.uploadPending).toBeUndefined();
  });
});

describe('the runner', () => {
  const failedUpload = body.slice(
    body.indexOf('if (!upload?.ok || upload.confirmed !== true) {'),
    body.indexOf('could not be put into Flow'),
  );

  it('passes over a pending upload instead of stopping the run', () => {
    expect(failedUpload).toMatch(/if \(row\.uploadPending\) \{[\s\S]*?continue;\s*\}/);
    expect(failedUpload.indexOf('if (row.uploadPending) {')).toBeLessThan(failedUpload.indexOf("row.status = 'error';"));
  });

  it('still stops on an upload that failed outright', () => {
    expect(body).toMatch(/throw new Error\(\s*`Piece \$\{row\.index\} could not be put into Flow: \$\{why\}\. `/);
  });

  it('generates the ready pieces first, the slow ones last', () => {
    expect(body).toMatch(/const order = \[\.\.\.rows\.filter\(\(r\) => !r\.uploadPending\), \.\.\.rows\.filter\(\(r\) => !!r\.uploadPending\)\];/);
    expect(body).toMatch(/for \(const row of order\) \{/);
  });

  it('checks a slow piece again before generating it, and never uploads another copy', () => {
    const from = body.indexOf('if (row.uploadPending && !row.uploaded) {');
    const recheck = body.slice(from, body.indexOf("row.status = 'running';", from));
    expect(from).toBeGreaterThan(body.indexOf('for (const row of order) {'));
    expect(recheck).toMatch(/type: 'DEBUG_UPLOAD_TO_FLOW', verifyOnly: true, pending: row\.uploadPending, names: \[row\.filename\]/);
    expect(recheck).not.toMatch(/files:/);
    expect(recheck).toMatch(/recordMotionUpload\(row, again\);/);
    /* Still not ready: that piece needs attention, the run carries on. */
    expect(recheck).toMatch(/failures\.push\([\s\S]*?continue;/);
  });

  it('moves the panel on to generating once every upload is in or pending', () => {
    expect(body).toMatch(/motionUploaded: rows\.every\(\(r\) => r\.uploaded \|\| !!r\.uploadPending \|\| r\.status === 'done'\)/);
  });
});
