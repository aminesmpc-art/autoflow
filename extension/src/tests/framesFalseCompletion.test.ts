/**
 * "whats the problem with api her ???" — a Frames run, one prompt, and the
 * panel showing 1 ✅ / 100% / "All videos processed!" at 38s against a tile
 * on flow.google.com still climbing through 45%.
 *
 * The API was not wrong about whether media was present. It was wrong about
 * what the media was OF.
 *
 * A Frames generation uploads two images — a start frame and an end frame —
 * and the status record references both of them from the moment it is
 * submitted. They are ordinary signed flow-content.google URLs, exactly like
 * the finished video's. The completion test was:
 *
 *     let media = false;
 *     walkStrings(record, (s) => { if (isMediaUrl(s)) media = true; });
 *     if (media) return { state: 'completed', … };
 *
 * with MEDIA_HOST_HINTS carrying a note saying the signed content host was
 * included *because* ingredients come from it. So every image-to-video
 * generation announced itself finished before it had rendered anything, and
 * the run moved on: the tile Retry pass never fired, and the library scan
 * downloaded whatever was in the grid at 45%.
 *
 * Two halves of the same file already disagreed about this. mediaUrlOf
 * refuses /asb/ as "the grid thumbnail, not the file", and the download list
 * in automation.ts requires `cachedUrl.includes('/video/')` before it will
 * save a video. Only the completion test accepted anything.
 *
 * What decides now: what the URL is of, and whose it is.
 */

import { inferState, mediaKindOf, mediaUrlOf, mediaPathId, readStatuses } from '../content/flowBatch';
import { kindSatisfies } from '../content/apiHelper';

/* The three ids a status record leads with, in this order. */
const SCENE = '8a0059c8-2e06-4f7a-b3d1-9c4471aa0e18';
const PROJECT = 'f1f353d5-77aa-4e19-8b62-0d1c93bb7712';
const MEDIA = 'b14eade5-1d3f-4c62-9a0f-2e5581cc4471';

/**
 * All three, which is what attribution is tested against.
 *
 * NOT the media id alone. That was the first attempt here and the recorded
 * fixture in flowBatch.test.ts refuted it: on the real generation the
 * finished video came back signed under the SCENE id, ids[0], while the
 * record's media id was ids[2]. Which id signs an asset is a Flow detail;
 * that the asset is signed under one of the record's own is the part worth
 * depending on.
 */
const OWN_IDS = [SCENE, PROJECT, MEDIA];

/* The two uploaded frames, signed under their OWN ids — af_cb8fb1f7.jpg and
   af_a215bc74.jpg in the library screenshot. */
const START_FRAME = 'https://flow-content.google/image/3c1de0aa-55b4-4d70-8e21-9f7712aa4c05?Expires=1&Signature=x';
const END_FRAME = 'https://flow-content.google/image/7ab99120-4e15-4f88-91c2-6d0011ef2233?Expires=1&Signature=y';

/** The grid poster. Present as soon as there is anything to show. */
const POSTER = 'https://flow.google.com/asb/AB-nOUbdK7WIJIpPsBgS9lQ=mm,18,15';

/** The result. Signed under the SCENE id, as the recorded fixture shows. */
const FINISHED_VIDEO = `https://flow-content.google/video/${SCENE}?Expires=1&Signature=z`;

/**
 * A status record: three ids, then a metadata block leading with the
 * timestamp. Matches the shape recorded live in flowBatch.ts's header.
 */
const record = (...media: string[]) => [
  SCENE, PROJECT, MEDIA, 'CAE', null,
  [[1788575632, 79153000], 'lokas mora', null, [['veo_3_1_i2v_fast', 1, 0]], media, [6], 1],
] as unknown[];

describe('a Frames run in flight is not a finished one', () => {
  it('does not call the two uploaded frames a finished video', () => {
    /* The reported bug, exactly: submitted, nothing rendered, both input
       frames already in the record.

       The record IS reported completed here — two images are present and the
       parser does not know what the queue asked for. The refusal happens at
       the door in apiHelper, where it does: an image is not a video. That
       split is deliberate; see kindSatisfies. */
    const st = inferState(record(START_FRAME, END_FRAME), OWN_IDS);
    expect(st.mediaKind).toBe('image');
    expect(kindSatisfies(st.mediaKind, 'video')).toBe(false);
  });

  it('says the images are not this generation\'s own', () => {
    const st = inferState(record(START_FRAME, END_FRAME), OWN_IDS);
    expect(st.ownMedia).toBe(false);
  });

  it('does not call the grid poster a finished video either', () => {
    expect(inferState(record(POSTER), OWN_IDS).state).toBe('generating');
    expect(inferState(record(POSTER), OWN_IDS).rawStatus).toBe('THUMBNAIL_ONLY');
  });

  it('is not a finished video with frames AND a poster — the 45% state', () => {
    const st = inferState(record(START_FRAME, END_FRAME, POSTER), OWN_IDS);
    expect(kindSatisfies(st.mediaKind, 'video')).toBe(false);
  });

  it('completes the moment the generation\'s own video appears', () => {
    const st = inferState(record(START_FRAME, END_FRAME, POSTER, FINISHED_VIDEO), OWN_IDS);
    expect(st.state).toBe('completed');
    expect(st.mediaKind).toBe('video');
    expect(st.ownMedia).toBe(true);
  });
});

describe('telling the record\'s own asset from one it references', () => {
  it('reads the id a signed URL is issued under', () => {
    expect(mediaPathId(FINISHED_VIDEO)).toBe(SCENE);
    expect(OWN_IDS).toContain(mediaPathId(FINISHED_VIDEO));
  });

  it('does not expect the result under the media id specifically', () => {
    /* The correction that made this file honest. An earlier version required
       mediaPathId(url) === ids[2] and would have read every finished video as
       still generating — a silent stall, worse than the bug it replaced. */
    expect(mediaPathId(FINISHED_VIDEO)).not.toBe(MEDIA);
    expect(inferState(record(FINISHED_VIDEO), OWN_IDS).state).toBe('completed');
  });

  it('rejects an asset signed under an id this record does not have', () => {
    expect(OWN_IDS).not.toContain(mediaPathId(START_FRAME));
  });

  it('reads no id from a poster, which carries none', () => {
    /* flowTiles says the same: an /asb/ token does not contain the media id.
       That is why a poster can never be attributed and never completes. */
    expect(mediaPathId(POSTER)).toBe('');
  });

  it('marks assets belonging to other generations as not ours', () => {
    expect(mediaKindOf(record(START_FRAME, END_FRAME), OWN_IDS))
      .toEqual({ kind: 'image', ownMedia: false });
  });

  it('never erases the kind it found, which would stall a run silently', () => {
    /* An earlier version reported 'none' here, on the assumption that a
       result is always signed under one of the record's own ids. That is
       measured for video and never measured for image; where it fails, the
       generation reads "generating" forever. Refusing on kind is a fact about
       the media and needs no such assumption. */
    expect(mediaKindOf(record(START_FRAME), OWN_IDS).kind).not.toBe('none');
  });

  it('falls back to kind when nothing in the record carries an id', () => {
    /* The escape hatch, and the reason it exists: if Flow ever changes how it
       signs URLs, the id test stops applying and kind alone decides. Without
       this every generation would read "generating" forever — a worse
       failure than the one being fixed, and a silent one. */
    const noIds = record('https://flow-content.google/video/short?Expires=1');
    expect(mediaKindOf(noIds, OWN_IDS).kind).toBe('video');
    expect(inferState(noIds, OWN_IDS).state).toBe('completed');
  });

  it('still reads a record when the caller has no id to compare against', () => {
    /* inferState is exported and called without an id elsewhere; kind alone
       must remain a sane answer. */
    expect(inferState(record(FINISHED_VIDEO)).state).toBe('completed');
    expect(inferState(record()).state).toBe('generating');
  });
});

describe('what gets downloaded', () => {
  it('does not hand back an uploaded start frame as the video', () => {
    /* Saved under P1_G1.mp4 and reported as a successful download. */
    expect(mediaUrlOf(record(START_FRAME, END_FRAME), OWN_IDS)).not.toBe(START_FRAME);
  });

  it('prefers the generation\'s own file over anything it references', () => {
    expect(mediaUrlOf(record(START_FRAME, FINISHED_VIDEO, END_FRAME), OWN_IDS))
      .toBe(FINISHED_VIDEO);
  });

  it('still refuses the poster', () => {
    expect(mediaUrlOf(record(POSTER), OWN_IDS)).toBe('');
  });
});

describe('the kind has to match what the queue asked for', () => {
  it('an image is not a video', () => {
    expect(kindSatisfies('image', 'video')).toBe(false);
    expect(kindSatisfies('video', 'image')).toBe(false);
  });

  it('a poster is neither', () => {
    expect(kindSatisfies('thumb', 'video')).toBe(false);
    expect(kindSatisfies('thumb', 'image')).toBe(false);
  });

  it('each kind satisfies its own queue', () => {
    expect(kindSatisfies('video', 'video')).toBe(true);
    expect(kindSatisfies('image', 'image')).toBe(true);
  });

  it('the old redirect satisfies both, being kind-agnostic', () => {
    /* labs.google resolved media.getMediaUrlRedirect to whatever the media
       turned out to be, and only issued it for one that existed. Refusing it
       would break the old site to fix a bug the old site does not have. */
    expect(kindSatisfies('legacy', 'video')).toBe(true);
    expect(kindSatisfies('legacy', 'image')).toBe(true);
  });

  it('an absent kind is not treated as a failure', () => {
    /* A status from the tRPC parser, or from an older interceptor still
       resident in the tab, carries no kind. Reading silence as "wrong kind"
       would stall those runs instead of correcting them. */
    expect(kindSatisfies(undefined, 'video')).toBe(true);
  });
});

describe('two records for one generation', () => {
  /* Flow describes the same media more than once in a response, and the
     descriptions disagree — one carries the file, another only references
     the inputs. */
  const envelope = (payload: unknown) => {
    const inner = JSON.stringify(payload);
    const chunk = JSON.stringify([['wrb.fr', 'ngNC2', inner, null, null, null, 'generic']]);
    return `)]}'\n\n${chunk.length}\n${chunk}\n`;
  };

  it('keeps the description carrying the generation\'s own file', () => {
    const both = readStatuses(envelope([
      record(START_FRAME, END_FRAME),
      record(START_FRAME, FINISHED_VIDEO),
    ]));
    expect(both).toHaveLength(1);
    expect(both[0].state).toBe('completed');
    expect(both[0].mediaUrl).toBe(FINISHED_VIDEO);
  });

  it('and does so whichever order they arrive in', () => {
    const reversed = readStatuses(envelope([
      record(START_FRAME, FINISHED_VIDEO),
      record(START_FRAME, END_FRAME),
    ]));
    expect(reversed[0].state).toBe('completed');
    expect(reversed[0].mediaUrl).toBe(FINISHED_VIDEO);
  });
});
