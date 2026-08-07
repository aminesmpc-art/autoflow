/* ============================================================
   Which still a finished clip hands to the clip after it.

   Reported from a real run: a Last Frame node showed the *opening* frame of
   the shot it was supposed to end. The cause was in the tile markup —

     <video src="..." preload="none">

   — so the element held no data, duration was NaN, the seek was pointless,
   and the capture fell back to the poster. For a Flow video tile the poster
   IS the first frame. Every link in a chain therefore handed the next clip
   the beginning of the previous shot, and the sequence quietly restarted
   instead of progressing, with a plausible-looking still on the canvas the
   whole time.
   ============================================================ */

import { pickReferenceStill } from '../content/flow/studioFrames';

const END = 'data:image/jpeg;base64,ENDFRAME';
const POSTER = 'data:image/jpeg;base64,POSTER';

describe('pickReferenceStill', () => {
  it('hands on the end frame when there is one', () => {
    expect(pickReferenceStill({ endFrame: END, posterStill: POSTER, isVideo: true })).toBe(END);
  });

  it('never substitutes the poster for a clip', () => {
    /* The regression. Returning POSTER here looks like a working handoff: the
       frame node shows a still, the next clip starts from it, and the chain
       restarts from the top of the previous shot with nothing to say so. */
    expect(pickReferenceStill({ endFrame: '', posterStill: POSTER, isVideo: true })).toBe('');
  });

  it('uses the poster for an image result, where it is the result', () => {
    expect(pickReferenceStill({ endFrame: '', posterStill: POSTER, isVideo: false })).toBe(POSTER);
  });

  it('treats an unspecified source as an image, the safe default', () => {
    // Only clips have an opening frame to confuse with an ending one.
    expect(pickReferenceStill({ endFrame: '', posterStill: POSTER })).toBe(POSTER);
  });

  it('returns nothing when there is nothing', () => {
    expect(pickReferenceStill({ endFrame: '', posterStill: '', isVideo: true })).toBe('');
    expect(pickReferenceStill({ endFrame: '', posterStill: '', isVideo: false })).toBe('');
  });

  it('prefers the end frame even when both are present', () => {
    // Preferring the poster would make the seek pointless — it is always there.
    expect(pickReferenceStill({ endFrame: END, posterStill: POSTER, isVideo: false })).toBe(END);
  });
});
