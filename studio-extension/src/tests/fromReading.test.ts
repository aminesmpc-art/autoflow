/**
 * Using a server reading instead of asking a chat three more times.
 *
 * The claim worth defending: a quoted line is found by WORDS, never by string
 * equality, and a line that cannot be found returns null rather than a guess.
 *
 * That asymmetry is the whole point. A miss costs four model asks, because the
 * node falls back to locating from the audio exactly as it always did. A wrong
 * match cuts the wrong part of somebody's video and says nothing about it —
 * and on a chase video where "go go go" is shouted twenty times, wrong matches
 * are the easy mistake to make.
 */

import {
  bareWords,
  framingFromReading,
  canFrameFromReading,
  facesFromReading,
  locateFromReading,
  readingToTranscript,
  scenesDuring,
} from '../studio/clip/fromReading';
import type { VideoReading } from '../studio/clip/readingApi';

const reading = (over: Partial<VideoReading> = {}): VideoReading => ({
  durationSec: 240,
  language: 'en',
  summary: '',
  segments: [],
  scenes: [],
  faces: [],
  dropped: [],
  model: 'gemini-3.7-flash',
  ...over,
});

/** The real transcript, as phrases with the seconds they occupy. */
const MRBEAST = reading({
  segments: [
    { start: 60.0, end: 62.5, text: 'Okay, meet me at the market.' },
    { start: 83.1, end: 85.4, text: 'Look at these straw bales right here.' },
    { start: 85.6, end: 87.2, text: 'That looks a little suspicious.' },
    { start: 96.0, end: 97.1, text: 'Show us your hands!' },
    { start: 99.0, end: 100.2, text: 'Let me go! Let me go!' },
    {
      start: 104.0,
      end: 108.3,
      text: "Yeah, it's only been 10 minutes, and Darius has already been arrested.",
    },
    { start: 120.0, end: 122.0, text: 'I see so many cops, go!' },
  ],
});

/* ------------------------------------------------------------------ */

describe('reading words out of a quote', () => {
  it('strips what changes when a line is quoted back', () => {
    expect(bareWords('Look at these straw bales right here.')).toEqual(
      ['look', 'at', 'these', 'straw', 'bales', 'right', 'here'],
    );
    expect(bareWords("Yeah, it's only been 10 minutes!")).toEqual(
      ['yeah', 'it', 's', 'only', 'been', '10', 'minutes'],
    );
  });

  it('keeps letters from other alphabets', () => {
    expect(bareWords('¿Dónde está?')).toEqual(['dónde', 'está']);
  });
});

describe('the transcript a reading becomes', () => {
  it('makes one chunk per phrase, with its real seconds', () => {
    /* Not one chunk per four minutes. textNear slices a chunk PROPORTIONALLY
       to guess which words fall in a span, because a four-minute chunk has no
       internal timing. Phrases have real ones, so the guess disappears. */
    const t = readingToTranscript(MRBEAST);
    expect(t.chunks).toHaveLength(MRBEAST.segments.length);
    expect(t.chunks[1]).toMatchObject({ start: 83.1, end: 85.4 });
    expect(t.duration).toBe(240);
  });
});

describe('finding a clip from the lines it runs between', () => {
  it('finds both ends and reports the span as exact', () => {
    const found = locateFromReading(
      MRBEAST,
      'Look at these straw bales right here.',
      "Yeah, it's only been 10 minutes, and Darius has already been arrested.",
    );
    expect(found).toEqual({ startSec: 83.1, endSec: 108.3, exact: true });
  });

  it('finds a line quoted back with different punctuation and case', () => {
    /* The survey quotes from the transcript it was shown, and quoting is not
       copying. String equality misses every one of these. */
    const found = locateFromReading(
      MRBEAST,
      'look at these straw bales right here',
      'yeah it s only been 10 minutes and darius has already been arrested',
    );
    expect(found?.startSec).toBe(83.1);
    expect(found?.exact).toBe(true);
  });

  it('finds a line that spans two phrases', () => {
    const found = locateFromReading(
      MRBEAST,
      'Look at these straw bales right here. That looks a little suspicious.',
      'I see so many cops, go!',
    );
    expect(found?.startSec).toBe(83.1);
    expect(found?.endSec).toBe(122.0);
  });

  it('refuses a line that is not in the video', () => {
    expect(
      locateFromReading(MRBEAST, 'We built a giant chocolate factory', 'Show us your hands!'),
    ).toBeNull();
  });

  it('refuses a quote too short to identify anything', () => {
    /* "Go" is shouted all through a chase. Matching on it would place the
       clip wherever the search happened to look first. */
    expect(locateFromReading(MRBEAST, 'go', 'Show us your hands!')).toBeNull();
    expect(locateFromReading(MRBEAST, 'let me go', 'I see so many cops, go!')).toBeNull();
  });

  it('never ends a clip before it starts', () => {
    /* The closing line here occurs EARLIER in the video than the opening one.
       Searching the whole transcript would find it and produce a negative
       clip; searching only after the hook cannot. */
    const found = locateFromReading(
      MRBEAST,
      'Yeah, it\'s only been 10 minutes, and Darius has already been arrested.',
      'Okay, meet me at the market.',
    );
    expect(found).not.toBeNull();
    expect(found!.endSec).toBeGreaterThan(found!.startSec);
    expect(found!.exact).toBe(false);      // the end was inferred, not found
  });

  it('keeps a measured start when only the end is missing', () => {
    /* One end measured beats both ends guessed — but it is reported as not
       exact, so the caller still locates rather than trusting the tail. */
    const found = locateFromReading(
      MRBEAST,
      'Look at these straw bales right here.',
      'and that is how we won the money',
    );
    expect(found?.startSec).toBe(83.1);
    expect(found?.exact).toBe(false);
  });

  it('returns null for a reading with no speech in it', () => {
    expect(locateFromReading(reading(), 'anything at all here', 'and here')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const SCENES = reading({
  scenes: [
    { start: 80, end: 90, description: 'straw bales', speaker_x: 0.46 },
    { start: 90, end: 100, description: 'an arrest', speaker_x: 0.38 },
    { start: 100, end: 110, description: 'a wide field', speaker_x: null },
    { start: 200, end: 210, description: 'much later', speaker_x: 0.9 },
  ],
});

describe('framing a clip from the scenes already described', () => {
  it('gives samples relative to the clip, not the video', () => {
    /* planReframe measures a clip's own timeline. Handing it absolute seconds
       would put every sample past the end of a thirty-second clip. */
    const faces = facesFromReading(SCENES, 83, 108);
    expect(faces.every((f) => f.t >= 0 && f.t <= 108 - 83)).toBe(true);
  });

  it('ignores scenes where nobody is speaking on camera', () => {
    const faces = facesFromReading(SCENES, 83, 108);
    expect(faces.map((f) => f.x)).toEqual([0.46, 0.38]);
  });

  it('ignores scenes outside the clip entirely', () => {
    const faces = facesFromReading(SCENES, 83, 108);
    expect(faces.some((f) => f.x === 0.9)).toBe(false);
  });

  it('samples the part of a scene the clip actually uses', () => {
    /* A scene running from before the cut to after it describes the whole
       clip, and its own midpoint can fall outside the clip. */
    const long = reading({
      scenes: [{ start: 0, end: 600, description: 'one long take', speaker_x: 0.5 }],
    });
    const faces = facesFromReading(long, 100, 130);
    expect(faces).toHaveLength(1);
    expect(faces[0].t).toBeCloseTo(15, 1);        // middle of the CLIP
  });

  it('returns them in time order', () => {
    const faces = facesFromReading(SCENES, 83, 108);
    expect(faces.map((f) => f.t)).toEqual([...faces.map((f) => f.t)].sort((a, b) => a - b));
  });

  it('refuses to frame from a single sample', () => {
    /* One sample is a fixed crop, which the frame-sampling ask would have
       done better. Two is the least that can describe movement. */
    // 83-86 touches only the straw-bales scene; 83-108 spans two.
    expect(canFrameFromReading(SCENES, 83, 86)).toBe(false);
    expect(canFrameFromReading(SCENES, 83, 108)).toBe(true);
  });

  it('refuses to frame when nothing was described', () => {
    expect(canFrameFromReading(reading(), 0, 30)).toBe(false);
  });
});

describe('scenes during a clip', () => {
  it('returns those that overlap it', () => {
    expect(scenesDuring(SCENES, 95, 105).map((s) => s.start)).toEqual([90, 100]);
  });
});


/* ------------------------------------------------------------------ */

describe('what the reading already knows about framing', () => {
  /* Three answers, not two. With two, a chart section cost one model call per
     clip to rediscover something the reading had already reported: the
     scenes were described, every speaker_x was null, and the cut sampled
     eight stills to be told there was no speaker. */

  it('tracks when the reading placed a speaker often enough', () => {
    const f = framingFromReading(SCENES, 83, 108);
    expect(f.kind).toBe('tracked');
    if (f.kind === 'tracked') expect(f.faces).toHaveLength(2);
  });

  it('asks when the reading gave no position, however well it covered the clip', () => {
    /* This used to answer NONE — "it looked and found nobody" — to save an ask
       on screen-recorded footage. Measured against the real endpoint, that
       reading of a null is simply false: ten stills of a woman talking
       straight to camera, encoded to forty seconds, came back with 8 scenes
       and 0 speaker positions, while the dedicated ask placed all ten
       correctly. A null means the reading did not answer, not that nobody is
       there — and treating it as an answer left every clip letterboxed on a
       blurred backdrop instead of cropped onto the speaker. */
    const charts = reading({
      scenes: [
        { start: 0, end: 30, description: 'a chart', speaker_x: null },
        { start: 30, end: 60, description: 'a whiteboard', speaker_x: null },
      ],
    });
    expect(framingFromReading(charts, 5, 55).kind).toBe('unknown');
  });

  it('says UNKNOWN when the reading does not describe that stretch', () => {
    /* Opposite situation, identical if you only count speaker positions. */
    const elsewhere = reading({
      scenes: [{ start: 600, end: 700, description: 'much later', speaker_x: 0.5 }],
    });
    expect(framingFromReading(elsewhere, 5, 55).kind).toBe('unknown');
  });

  it('asks rather than framing on a single position', () => {
    /* One sample is a fixed crop, and the frame-sampling ask returns eight.
       The ask is one HTTP request now, so there is nothing to save by
       settling for the worse answer. */
    const one = reading({
      scenes: [
        { start: 0, end: 40, description: 'a chart', speaker_x: null },
        { start: 40, end: 60, description: 'a face', speaker_x: 0.4 },
      ],
    });
    expect(framingFromReading(one, 5, 55).kind).toBe('unknown');
  });

  it('never claims nobody is on camera, because it cannot know that', () => {
    /* The regression this file now guards. Every shape of missing position —
       covered, uncovered, partial — must come out as "ask", never as an
       answer. */
    const shapes = [
      reading({ scenes: [{ start: 0, end: 60, description: 'a chart', speaker_x: null }] }),
      reading({ scenes: [{ start: 0, end: 60, description: 'a face', speaker_x: 0.4 }] }),
      reading({ scenes: [] }),
    ];
    for (const r of shapes) {
      expect(framingFromReading(r, 5, 55).kind).toBe('unknown');
    }
  });

  it('says UNKNOWN when there is no reading to speak of', () => {
    expect(framingFromReading(reading(), 0, 30).kind).toBe('unknown');
  });
});


describe('framing from the measured track', () => {
  /* The track is a face detector run over the video on the server, about twice
     a second. The scenes' own speaker_x is asked for instead of measured, and
     on real footage came back null for 8 of 8 scenes — which is what left every
     clip letterboxed instead of cropped onto the speaker. */

  const track = (points: Array<[number, number]>) =>
    reading({ faces: points.map(([t, x]) => ({ t, x })) });

  it('uses the track in preference to what the scenes claimed', () => {
    /* When both exist the measured one wins. They disagree here on purpose:
       0.2 from the scene, 0.8 from the detector. */
    const both = reading({
      faces: [{ t: 10, x: 0.8 }, { t: 11, x: 0.8 }, { t: 12, x: 0.8 }],
      scenes: [
        { start: 0, end: 15, description: 'a', speaker_x: 0.2 },
        { start: 15, end: 30, description: 'b', speaker_x: 0.2 },
      ],
    });
    const faces = facesFromReading(both, 5, 20);
    expect(faces.every((f) => f.x === 0.8)).toBe(true);
  });

  it('gives times relative to the clip, not to the video', () => {
    /* planReframe builds a crop path along the clip's own timeline. Absolute
       seconds here would put every keyframe past the end of a clip cut from
       ten minutes in, and the crop would never move. */
    const faces = facesFromReading(track([[100, 0.4], [100.5, 0.45], [101, 0.5]]), 100, 130);
    expect(faces.map((f) => f.t)).toEqual([0, 0.5, 1]);
  });

  it('takes only the samples inside the clip', () => {
    const faces = facesFromReading(
      track([[0, 0.1], [50, 0.5], [51, 0.55], [200, 0.9]]), 40, 60,
    );
    expect(faces.map((f) => f.x)).toEqual([0.5, 0.55]);
  });

  it('falls back to the scenes when nothing was tracked', () => {
    /* An older server sends scenes and no track. One coarse position per shot
       beats none. */
    const old = reading({
      faces: [],
      scenes: [
        { start: 0, end: 15, description: 'a', speaker_x: 0.3 },
        { start: 15, end: 30, description: 'b', speaker_x: 0.6 },
      ],
    });
    expect(facesFromReading(old, 0, 30).map((f) => f.x)).toEqual([0.3, 0.6]);
  });

  it('falls back rather than framing on a single tracked sample', () => {
    /* One sample cannot describe movement, and the scenes may have two. */
    const one = reading({
      faces: [{ t: 5, x: 0.9 }],
      scenes: [
        { start: 0, end: 15, description: 'a', speaker_x: 0.3 },
        { start: 15, end: 30, description: 'b', speaker_x: 0.6 },
      ],
    });
    expect(facesFromReading(one, 0, 30).map((f) => f.x)).toEqual([0.3, 0.6]);
  });

  it('tracks a clip the detector covered', () => {
    const f = framingFromReading(track([[10, 0.4], [10.5, 0.42], [11, 0.44]]), 5, 20);
    expect(f.kind).toBe('tracked');
    if (f.kind === 'tracked') expect(f.faces).toHaveLength(3);
  });

  it('asks when nothing was tracked and nothing was described', () => {
    /* An empty track means NOT MEASURED — this server cannot track faces, or
       the codec defeated it. Reading it as "nobody was on camera" is the bug
       that shipped once already. */
    expect(framingFromReading(reading({ faces: [] }), 0, 30).kind).toBe('unknown');
  });

  it('gives planReframe enough samples to follow someone who moves', () => {
    /* The point of the track. Eight guesses across thirty seconds produce a
       crop that jumps; two samples a second produce one that follows. */
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i++) points.push([100 + i * 0.5, 0.3 + i * 0.005]);
    const faces = facesFromReading(track(points), 100, 130);
    expect(faces.length).toBeGreaterThan(50);
    expect(faces[0].x).toBeLessThan(faces[faces.length - 1].x);
  });
});
