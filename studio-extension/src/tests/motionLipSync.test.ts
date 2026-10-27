/// <reference types="node" />
/**
 * "Keep exact lip sync" (2026-10-19): the user asked for the video model to be
 * told to keep the lip sync — words only, no audio swap and no joined video.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { lipSyncLock, motionFinalPrompt } from '../studio/ask/motionGuidance';
import { motionAudioPrompt, motionBriefAsk, type MotionBrief } from '../studio/ask/motionControl';

const runner = readFileSync(join(__dirname, '..', 'studio/engine/WorkflowRunner.ts'), 'utf8');
const base = { prompt: 'Swap in the provided image.', mode: 'swap', muted: false, characters: 1, places: 0 };
const brief: MotionBrief = { mode: 'swap', wish: '', hasCharacter: true };

describe('Keep exact lip sync', () => {
  it('adds a LIP SYNC block right after the motion block, and nothing when off', () => {
    const on = motionFinalPrompt({ ...base, lipSync: true });
    expect(on).toContain(lipSyncLock(false));
    expect(on.indexOf('MOTION:')).toBeLessThan(on.indexOf('LIP SYNC:'));
    expect(on.indexOf('LIP SYNC:')).toBeLessThan(on.indexOf('REFERENCES:'));
    expect(motionFinalPrompt(base)).not.toContain('LIP SYNC:');
    expect(motionFinalPrompt({ ...base, lipSync: false })).toBe(motionFinalPrompt(base));
  });

  it('holds the mouths to the speech, in every mode', () => {
    expect(lipSyncLock(false)).toMatch(/in time with every syllable of the speech/);
    expect(lipSyncLock(false)).toMatch(/closed whenever the speaker is silent/);
    for (const mode of ['move', 'swap', 'restyle']) {
      expect(motionFinalPrompt({ ...base, mode, lipSync: true })).toContain('LIP SYNC:');
    }
  });

  it('with the audio removed, the override forbids the sound but not the mouths', () => {
    const silent = motionFinalPrompt({ ...base, muted: true, lipSync: true });
    expect(silent).toContain(lipSyncLock(true));
    expect(silent).toContain('Produce silent output.');
    expect(silent).not.toMatch(/Do not generate speech, dialogue, singing, or lip-sync/);
    expect(silent.indexOf('LIP SYNC:')).toBeLessThan(silent.indexOf('AUDIO OVERRIDE:'));
    /* Off, the silent override is word for word what it was. */
    expect(motionAudioPrompt('x', true)).toBe(motionAudioPrompt('x', true, false));
    expect(motionAudioPrompt('x', true)).toMatch(/Do not generate speech, dialogue, singing, or lip-sync/);
  });

  it('tells the director not to write about mouths or speech, and says nothing when off', () => {
    expect(motionBriefAsk({ ...brief, lipSync: true }, 2)).toMatch(/EXACT LIP SYNC IS ON\. Every mouth in the footage must move exactly as it does there/);
    expect(motionBriefAsk(brief, 2)).not.toContain('LIP SYNC');
    expect(motionBriefAsk({ ...brief, lipSync: false }, 2)).toBe(motionBriefAsk(brief, 2));
  });

  it('the run passes the switch to the brief and to every piece', () => {
    expect(runner).toContain("...(nodeData.motionLipSync === true ? { lipSync: true } : {}),");
    expect(runner).toContain('lipSync: nodeData.motionLipSync === true,');
  });
});
