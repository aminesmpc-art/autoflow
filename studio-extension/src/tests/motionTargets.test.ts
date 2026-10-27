/// <reference types="node" />
/**
 * "Same videos, we want to change 2 characters, or 1 character and the item."
 *
 * Replace mode can now replace chosen people and items: the analysis engine
 * lists what it sees, the user gives up to four of them new images, and Omni
 * is told in fixed words which image replaces which. Everything else stays.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_REPLACEMENTS, motionTargetsAsk, readMotionTargets, replacementGuidance, replacementLimit, replacementRoles, usableReplacements,
  type MotionReplacement,
} from '../studio/ask/motionTargets';
import { motionFinalPrompt } from '../studio/ask/motionGuidance';
import { motionBriefAsk, motionPieceAsk, type MotionBrief, type MotionPiece } from '../studio/ask/motionControl';

const IMG = 'data:image/png;base64,AAAA';
const two: MotionReplacement[] = [
  { targetId: 't1', kind: 'person', label: 'woman on the left, black top', image: IMG },
  { targetId: 't3', kind: 'item', label: 'plate of bread', image: IMG },
];

describe('the scan', () => {
  it('asks for people and the objects they use, with telling labels and when they appear, as JSON', () => {
    const ask = motionTargetsAsk();
    expect(ask).toMatch(/List the people, and the distinct objects/);
    expect(ask).toMatch(/Do not guess names, ages or identities/);
    expect(ask).toMatch(/"targets":\[\{"kind":"person"/);
  });

  it('reads the list: people first, kinds normalised, duplicates dropped, ids in order', () => {
    const reply = 'Here you go:\n```json\n{"targets":['
      + '{"kind":"object","label":"plate of bread","when":"0:00-0:06"},'
      + '{"kind":"person","label":"woman on the left, black top","when":"whole video"},'
      + '{"kind":"Person","label":"Woman on the left, black top"},'
      + '{"kind":"person","label":"man on the right, grey hoodie"}]}\n```';
    expect(readMotionTargets(reply)).toEqual([
      { id: 't1', kind: 'person', label: 'woman on the left, black top', when: 'whole video' },
      { id: 't2', kind: 'person', label: 'man on the right, grey hoodie' },
      { id: 't3', kind: 'item', label: 'plate of bread', when: '0:00-0:06' },
    ]);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'person', label: `person ${i}` }));
    expect(readMotionTargets(JSON.stringify({ targets: many }))).toHaveLength(8);
  });

  it('says so when nothing came back', () => {
    expect(() => readMotionTargets('I could not see anyone.')).toThrow(/did not list anyone or anything/);
  });
});

describe('how many fit', () => {
  it('leaves room in Omni\'s five images for the place and the continuity frame', () => {
    expect(MAX_REPLACEMENTS).toBe(4);
    expect(replacementLimit(false, false)).toBe(4);
    expect(replacementLimit(true, false)).toBe(4);
    expect(replacementLimit(false, true)).toBe(4);
    expect(replacementLimit(true, true)).toBe(3);
  });
});

describe('what each model is told', () => {
  it('Omni gets the image-to-target mapping in fixed words, and keeps everything else', () => {
    expect(replacementRoles(two, 0)).toBe(
      'REFERENCES: Image 1 replaces woman on the left, black top. Image 2 replaces plate of bread. '
      + 'Each replacement takes the target\'s position, movement, timing and contact with everything around it. '
      + 'Keep every other person and object exactly as in the input video. Keep the environment from the input video. '
      + 'The input video still decides the motion, the timing and the camera.');
    expect(replacementRoles(two, 1)).toMatch(/Image 3 is the setting/);
  });

  describe('words instead of an image, or with one', () => {
    const mixed: MotionReplacement[] = [
      { targetId: 't1', kind: 'person', label: 'woman on the left', image: IMG, text: 'wearing a red dress' },
      { targetId: 't2', kind: 'person', label: 'man on the right', text: 'an old wizard with a long beard' },
      { targetId: 't3', kind: 'item', label: 'plate of bread', image: IMG },
    ];

    it('numbers only the images, and tells Omni what the words-only one becomes', () => {
      expect(replacementRoles(mixed, 1)).toBe(
        'REFERENCES: Image 1 replaces woman on the left: wearing a red dress. '
        + 'Replace man on the right with an old wizard with a long beard. Image 2 replaces plate of bread. '
        + 'Each replacement takes the target\'s position, movement, timing and contact with everything around it. '
        + 'Keep every other person and object exactly as in the input video. '
        + 'Image 3 is the setting: place everyone in it, matching its light, scale, perspective and contact shadows. '
        + 'The input video still decides the motion, the timing and the camera.');
    });

    it('says REPLACEMENTS, not REFERENCES, when nothing is an image', () => {
      expect(replacementRoles([mixed[1]], 0)).toMatch(/^REPLACEMENTS: Replace man on the right with an old wizard with a long beard\./);
    });

    it('lets the director describe a words-only one, in the user\'s words, and nothing more for an image', () => {
      const g = replacementGuidance(mixed, 0);
      expect(g).toMatch(/Image 1 replaces woman on the left \(a person\): name it only as "the person from image 1", and add, in exactly these words, what changes about it: "wearing a red dress"\./);
      expect(g).toMatch(/man on the right \(a person\) is replaced by: "an old wizard with a long beard"\. There is no image for it: describe it in exactly these words, the same way in every piece\./);
      expect(g).toMatch(/Image 2 replaces plate of bread \(an object\)/);
      expect(replacementGuidance([mixed[1]], 0)).not.toMatch(/The images are attached/);
    });

    it('keeps only the ones that say what to replace with, tidied', () => {
      expect(usableReplacements([
        { targetId: 'a', kind: 'person', label: 'x', text: '  an   old wizard ' },
        { targetId: 'b', kind: 'person', label: 'y' },
        { targetId: 'c', kind: 'item', label: 'z', image: 'https://not-a-data-url', text: '' },
        { targetId: 'd', kind: 'item', label: '', text: 'no label' },
        null,
      ])).toEqual([{ targetId: 'a', kind: 'person', label: 'x', text: 'an old wizard' }]);
      expect(usableReplacements('nope')).toEqual([]);
    });
  });

  it('the director gets one pointer per image and is told not to describe them', () => {
    const g = replacementGuidance(two, 0);
    expect(g).toMatch(/Image 1 replaces woman on the left, black top \(a person\): name it only as "the person from image 1"\./);
    expect(g).toMatch(/Image 2 replaces plate of bread \(an object\): name it only as "the object from image 2"\./);
    expect(g).toMatch(/do NOT describe the appearance of a replacement that has an image/);
    expect(g).toMatch(/If a target is not visible in a piece, do not mention it/);
  });

  it('the final prompt uses the mapping instead of the one-character roles', () => {
    const out = motionFinalPrompt({ prompt: 'Keep the motion.', mode: 'swap', muted: false, characters: 2, places: 0, replacements: two });
    expect(out).toContain('Image 1 replaces woman on the left, black top.');
    expect(out).not.toMatch(/is the character who performs the motion/);
    const single = motionFinalPrompt({ prompt: 'Keep the motion.', mode: 'swap', muted: false, characters: 1, places: 0 });
    expect(single).toMatch(/is the character who performs the motion/);
  });

  it('the brief and each piece ask stop asking for the one-character wording', () => {
    const brief: MotionBrief = { mode: 'swap', wish: '', hasCharacter: true, referenceRules: replacementGuidance(two, 0), replacements: 2 };
    const piece = { index: 1, of: 2, startSec: 0, endSec: 9, seconds: 9, cutsSpeech: false } as MotionPiece;
    expect(motionBriefAsk(brief, 2)).toMatch(/The chosen people and objects are listed in REPLACEMENTS above/);
    expect(motionBriefAsk(brief, 2)).toMatch(/One described in words: use those words for it, the same way every time/);
    expect(motionBriefAsk(brief, 2)).not.toMatch(/refer to it as "the provided image"/);
    expect(motionPieceAsk(brief, piece)).toMatch(/each replacement with an image named ONLY by its pointer/);
    expect(motionPieceAsk(brief, piece)).toMatch(/each one without an image in the user's words for it/);
    expect(motionPieceAsk(brief, piece)).not.toMatch(/the subject named ONLY as "the provided character from this image"/);
  });
});

describe('the run', () => {
  const RUNNER = readFileSync(join(__dirname, '..', 'studio', 'engine', 'WorkflowRunner.ts'), 'utf8');
  const body = RUNNER.slice(RUNNER.indexOf('private async executeMotionNode'), RUNNER.indexOf('private async askAgent('));

  it('scans before any of the job\'s guards, and generates nothing', () => {
    const scan = body.indexOf('if (nodeData.motionScanTargets === true) {');
    expect(scan).toBeGreaterThan(-1);
    expect(scan).toBeLessThan(body.indexOf("throw new Error('Clip continuity changed."));
    expect(scan).toBeLessThan(body.indexOf('const uploadReady') > -1 ? body.indexOf('const uploadReady') : body.indexOf('let uploadReady'));
    const branch = body.slice(scan, body.indexOf('return { text: `Found', scan));
    expect(branch).toMatch(/this\.askAgent\(nodeId, chatPlatform\(nodeData\.platform\), motionTargetsAsk\(\), true, \[clip\]\)/);
    expect(branch).not.toMatch(/awaitBridge|uploadToFlow|executeNode/);
  });

  it('uses replacements only in Replace mode, first among the images, within the limit', () => {
    expect(body).toMatch(/const replacements: MotionReplacement\[\] = mode === 'swap' \? usableReplacements\(nodeData\.motionReplacements\) : \[\];/);
    expect(body).toMatch(/const images = replacements\.flatMap\(\(r\) => \(r\.image \? \[r\.image\] : \[\]\)\);/);
    expect(body).toMatch(/character\.length = 0;\s*character\.push\(\.\.\.images\);/);
    expect(body).toMatch(/if \(images\.length > limit\) \{/);
    expect(body).toMatch(/replacements: replacements\.length \? replacements : undefined,/);
    expect(body).toMatch(/\.\.\.\(replacements\.length \? \{ replacements: replacements\.length \} : \{\}\),/);
  });
});
