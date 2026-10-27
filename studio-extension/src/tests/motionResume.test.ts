/**
 * "Why do we need to retry every step? Save the steps and retry only the
 *  broken ones."
 *
 * Every checkpoint used to be all-or-nothing for the whole node:
 *
 *   a failed upload of one piece      re-cut and re-uploaded EVERY piece
 *   the director failing on piece 2   threw away piece 1's prompt too, gave
 *                                     every piece the plain sentence, and a
 *                                     retry never asked again
 *
 * Now each piece records its own progress — a prompt, a place in Flow's
 * library, a clip — and a retry resumes each at the first step it has not
 * passed. These tests run the rules against rows, the way a retry sees them.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { motionWork, motionResumeNote, type MotionPieceRow } from '../studio/ask/motionControl';

const row = (index: number, over: Partial<MotionPieceRow> = {}): MotionPieceRow => ({
  index, of: 3, startSec: (index - 1) * 7, endSec: index * 7, seconds: 7, cutsSpeech: false,
  filename: `Motion-part${index}-of-3.mp4`, prompt: '', why: '', status: 'idle', uploaded: false, ...over,
});

/** What a retry would do to each piece: which it cuts, directs and uploads. */
const plan = (rows: MotionPieceRow[], opts?: Parameters<typeof motionWork>[0]) => {
  const w = motionWork(opts);
  return {
    cut: rows.filter(w.needsCut).map((r) => r.index),
    direct: rows.filter(w.needsPrompt).map((r) => r.index),
    upload: rows.filter(w.needsUpload).map((r) => r.index),
  };
};

const PROMPT = 'Apply the pose and motion from input video to provided character from this image.';

describe('a retry resumes each piece where it broke', () => {
  it('does everything for every piece on a fresh run', () => {
    expect(plan([row(1), row(2), row(3)])).toEqual({ cut: [1, 2, 3], direct: [1, 2, 3], upload: [1, 2, 3] });
  });

  it('after the director stopped at piece 2, asks only for 2 and 3', () => {
    /* Piece 1's prompt used to be thrown away with the rest. */
    const rows = [row(1, { prompt: PROMPT }), row(2), row(3)];
    const p = plan(rows);
    expect(p.direct).toEqual([2, 3]);
    /* Nothing is in Flow yet, so every piece still has an upload ahead of it
       — piece 1 is cut for that, not to be directed again. */
    expect(p.upload).toEqual([1, 2, 3]);
  });

  it('after the upload failed on piece 2, re-cuts and re-uploads 2 and 3 only', () => {
    /* The case that kept happening: "15.0s source -> 2 piece(s)", every piece
       cut again, every piece uploaded again, piece 1 duplicated in Flow. */
    const rows = [row(1, { prompt: PROMPT, uploaded: true }), row(2, { prompt: PROMPT }), row(3, { prompt: PROMPT })];
    expect(plan(rows)).toEqual({ cut: [2, 3], direct: [], upload: [2, 3] });
  });

  it('after a generation failed, cuts, directs and uploads nothing', () => {
    const rows = [
      row(1, { prompt: PROMPT, uploaded: true, status: 'done' }),
      row(2, { prompt: PROMPT, uploaded: true, status: 'error' }),
      row(3, { prompt: PROMPT, uploaded: true }),
    ];
    expect(plan(rows)).toEqual({ cut: [], direct: [], upload: [] });
  });

  it('re-uploads only the piece Flow could not find by name', () => {
    /* The generation found piece 2 missing from the library and cleared its
       flag: the library, not the upload's own report, is the proof. */
    const rows = [
      row(1, { prompt: PROMPT, uploaded: true, status: 'done' }),
      row(2, { prompt: PROMPT, uploaded: false, status: 'error' }),
      row(3, { prompt: PROMPT, uploaded: true, status: 'done' }),
    ];
    expect(plan(rows)).toEqual({ cut: [2], direct: [], upload: [2] });
  });

  it('never sends a finished clip back to Flow', () => {
    expect(plan([row(1, { prompt: PROMPT, status: 'done', uploaded: false })]).upload).toEqual([]);
  });

  it('scopes "Retry piece" to that piece, even with another broken', () => {
    const rows = [row(1, { prompt: PROMPT, uploaded: true, status: 'done' }), row(2), row(3, { prompt: PROMPT })];
    expect(plan(rows, { onlyPiece: 3 })).toEqual({ cut: [3], direct: [], upload: [3] });
  });

  it('reads rows saved before the flag was per piece by the old node-wide one', () => {
    const legacy = [1, 2].map((i) => {
      const r = row(i, { prompt: PROMPT });
      delete (r as any).uploaded;
      return r;
    });
    expect(plan(legacy, { legacyUploaded: true }).upload).toEqual([]);
    expect(plan(legacy, { legacyUploaded: false }).upload).toEqual([1, 2]);
  });
});

describe('the director, resumed', () => {
  it('is shown what was already written, and told which pieces are missing', () => {
    const note = motionResumeNote([{ index: 1, prompt: 'first' }, { index: 3, prompt: 'third' }], [2]);
    expect(note).toMatch(/Piece 1: first/);
    expect(note).toMatch(/Piece 3: third/);
    expect(note).toMatch(/do not rewrite them/);
    expect(note).toMatch(/still missing a prompt: 2\./);
    /* So piece 2 still starts where piece 1 ends and leads into piece 3. */
    expect(note).toMatch(/continues from the piece before it and leads into/);
  });

  it('speaks in the plural when more than one is missing', () => {
    expect(motionResumeNote([{ index: 1, prompt: 'x' }], [2, 3])).toMatch(/pieces still missing a prompt: 2, 3\./);
  });
});

describe('the runner keeps each step\'s result the moment it has one', () => {
  const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const at = RUNNER.indexOf('private async executeMotionNode');
  const body = RUNNER.slice(at, RUNNER.indexOf('private async askAgent(', at));

  it('takes its rules from motionWork, not a copy of them', () => {
    expect(body).toMatch(/motionWork\(\{ onlyPiece, throughPiece, legacyUploaded: nodeData\.motionUploaded === true \}\)/);
  });

  it('saves each prompt as it is written, before asking for the next', () => {
    const write = body.indexOf('row.prompt = got.prompt;');
    const save = body.indexOf('checkpoint();', write);
    const next = body.indexOf('studioLog(\'Motion\', `Piece ${got.index}', write);
    expect(write).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(write);
    expect(next).toBeGreaterThan(save);
  });

  it('stops when the director fails — and never substitutes the plain sentence', () => {
    expect(body).toMatch(/prompt\(s\) are saved — retry asks only for the rest/);
    expect(body).not.toMatch(/plainMotionPrompt\(/);
  });

  it('uploads one piece per call, and marks it only after Flow took it', () => {
    expect(body).toMatch(/files: \[\{ dataUrl: cuts\.get\(row\.index\) as string, filename: row\.filename \}\]/);
    const failed = body.indexOf('if (!upload?.ok || upload.confirmed !== true) {');
    const marked = body.lastIndexOf('recordMotionUpload(row, upload);');
    expect(failed).toBeGreaterThan(-1);
    expect(marked).toBeGreaterThan(failed);
  });

  it('sends a piece back to "not uploaded" when Flow cannot find it', () => {
    expect(body).toMatch(/if \(why\.includes\(LIBRARY_MISS\) \|\| why\.includes\('Video upload failed in Flow:'\)\) \{\s*row\.uploaded = false;/);
  });

  it('recognises the very sentence the Flow page writes', () => {
    /* One constant on both sides, so a rewording cannot split them. */
    const picker = readFileSync(join(__dirname, '..', 'content', 'flow', 'libraryPicker.ts'), 'utf8');
    expect(picker).toMatch(/`\$\{LIBRARY_MISS\} "\$\{name\}"/);
    /* The old producer spelled the sentence out around the name. (A doc
       comment quoting the message is fine — it builds nothing.) */
    expect(picker).not.toMatch(/`nothing in the library matches "\$\{name\}"/);
  });
});
