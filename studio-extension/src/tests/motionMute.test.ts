/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { motionAudioPrompt } from '../studio/ask/motionControl';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const runner = read('studio/engine/WorkflowRunner.ts');
/* The whole method, bounded by the next one — not a fixed character count,
   which any growth in the method silently pushes its later code out of. */
const motionAt = runner.indexOf('private async executeMotionNode');
const motion = runner.slice(motionAt, runner.indexOf('private async askAgent(', motionAt));
const node = read('studio/nodes/MotionNode.tsx');

describe('Motion source audio removal', () => {
  it('leaves normal generation prompts unchanged', () => {
    expect(motionAudioPrompt('Keep the voice.', false)).toBe('Keep the voice.');
  });
  it('overrides speech directions only for silent uploads', () => {
    expect(motionAudioPrompt('Keep the voice.', true)).toContain('any earlier audio instructions do not apply');
    expect(motionAudioPrompt('Keep the voice.', true)).toContain('Produce silent output.');
  });
  it('removes actual audio tracks rather than muting the player', () => {
    /* A fresh piece takes the node's choice; a resumed piece is re-cut the
       way it was first cut, so its library name and its audio still agree. */
    expect(motion).toContain('const silent = nodeData.motionMuteAudio === true');
    expect(motion).toContain('audioMuted: silent');
    expect(motion).toContain('silent: row.audioMuted === true');
    expect(motion).toContain('startSec: row.startSec, endSec: row.endSec, silent: true');
    expect(read('studio/media/cut.ts')).toMatch(/audio: silent\s*\? \{ discard: true \}/);
  });
  it('uploads a distinct silent ingredient before marking it muted', () => {
    const retry = motion.slice(motion.indexOf('if (row.muteRequested && !row.audioMuted)'));
    expect(retry).toContain('`${label}-silent-${Date.now()}`');
    expect(retry.indexOf('if (!uploaded?.ok) throw')).toBeLessThan(retry.indexOf('row.audioMuted = true'));
    expect(retry.indexOf('row.audioMuted = true')).toBeLessThan(retry.indexOf('this.awaitBridge'));
    expect(retry).toContain('row.muteRequested = false');
    expect(retry).toContain('if (!original) throw');
    expect(retry).toContain('if (!uploadReady) throw');
  });
  it('skips other pieces for a targeted silent retry', () => {
    expect(node).toContain('motionRetryPiece: p.index');
    expect(motion).toContain('if (retryPieceOnly && (row.index < retryPieceOnly || row.index > throughPiece))');
    expect(motion).toContain("if (row.status === 'done' && (row.videoUrl || row.tileId))");
    expect(motion).toContain('motionRetryPiece: undefined');
  });
  it('preserves pieces when the same original file is selected again', () => {
    const start = node.indexOf('if (key === d.sourceKey)');
    expect(start).toBeGreaterThan(-1);
    expect(node.slice(start, start + 170)).toContain('return;');
    expect(node).toContain('Audio is not restored afterward.');
  });
});
