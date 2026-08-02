/* The rule that decides what one clip hands the next.

   This exists because getting the order backwards is silent: the chain still
   runs, every clip just starts from the same opening frame. The first version
   of this shipped that way — the poster was always present, so the end-frame
   capture never won.
*/
import { pickReferenceStill } from '../content/studioFrames';

const END = 'data:image/jpeg;base64,END_FRAME';
const POSTER = 'data:image/jpeg;base64,POSTER';

describe('pickReferenceStill', () => {
  it('hands on the end frame, never the poster, when both exist', () => {
    // The regression that matters: a video tile always has a poster, so if the
    // poster could win the seek would be pointless and chains would not advance.
    expect(pickReferenceStill({ endFrame: END, posterStill: POSTER })).toBe(END);
  });

  it('falls back to the poster when the frame could not be captured', () => {
    // Tainted canvas, unseekable video — a poster beats handing on nothing.
    expect(pickReferenceStill({ endFrame: '', posterStill: POSTER })).toBe(POSTER);
  });

  it('uses the still for image results, which have no end frame', () => {
    expect(pickReferenceStill({ endFrame: '', posterStill: POSTER })).toBe(POSTER);
  });

  it('returns empty when there is nothing to hand on', () => {
    // The runner then falls back to referencing the tile by id.
    expect(pickReferenceStill({ endFrame: '', posterStill: '' })).toBe('');
  });
});
