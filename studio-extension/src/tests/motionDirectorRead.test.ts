/**
 * "The director replied with no JSON object" while the JSON answer sat on the
 * Gemini tab (reported 2026-10-19). The error now says what WAS read, so the
 * next one shows whether it was an earlier turn, half an answer or nothing.
 */
import { readMotionPrompt } from '../studio/ask/motionControl';

describe('a director reply with no JSON says what was read', () => {
  it('quotes the start of the text it got', () => {
    expect(() => readMotionPrompt('Understood.\n\nSend piece 1 when ready.', 1))
      .toThrow('Piece 1: the director replied with no JSON object. What was read: "Understood. Send piece 1 when ready."');
  });

  it('cuts a long one short', () => {
    expect(() => readMotionPrompt('x'.repeat(400), 2)).toThrow(/What was read: "x{140}…"$/);
  });

  it('says so when nothing was read', () => {
    expect(() => readMotionPrompt('   ', 3)).toThrow('Piece 3: the director replied with no JSON object. The reply read was empty.');
  });

  it('still reads a good reply', () => {
    expect(readMotionPrompt('{"prompt":"Apply the pose and motion from input video to the provided character.","why":"ok"}', 1).prompt)
      .toMatch(/^Apply the pose/);
  });
});
