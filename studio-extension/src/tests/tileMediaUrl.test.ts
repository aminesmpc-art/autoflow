/**
 * @jest-environment jsdom
 */

/* ============================================================
   "the image was generated but its not showing"

   And the clip wired under it: "error of no image".

   The node was green. The generation was fine — the picture was sitting in
   Flow. What the node carried was no preview and no reference, because the
   media URL came back as an empty string:

     let bestArea = 0;
     ...
     if (area > bestArea) { bestArea = area; bestSrc = src; }

   Area is here to choose BETWEEN candidates. With the floor at 0 it also
   decided whether there was an answer at all — and every image on a tile the
   virtual list has scrolled away from measures exactly 0x0. The one eligible
   image never beat the floor, so this returned '', buildStudioStills('')
   returned nothing, and the node reported success with nothing in it.

   jsdom lays nothing out, so every rect here is 0x0 by default. That is not
   a limitation of these tests — it is the exact condition being tested.
   ============================================================ */

/// <reference types="node" />

import { findLargestImgSrc } from '../content/flow/tileState';

const SRC_A = 'https://flow.google.com/asb/AB-nOUa4wjw5zl4UkmV6z75u1WMpA0TVWnGhFZUpvY';
const SRC_B = 'https://flow.google.com/asb/ZZ-nOUqqqq5zl4UkmV6z75u1WMpA0TVWnGhFZUpvY';

beforeEach(() => { document.body.innerHTML = ''; });

/** Give one element a measurable box; everything else stays 0x0. */
function size(el: Element, w: number, h: number): void {
  (el as any).getBoundingClientRect = () => ({
    width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0,
    toJSON: () => ({}),
  });
}

describe('a tile that is off screen still has media on it', () => {
  it('returns the image even when nothing has been laid out', () => {
    /* The reported bug. Every rect is 0x0 here, as it is for a recycled row
       in Flow's virtual list. */
    document.body.innerHTML = `<flow-image-tile><img src="${SRC_A}"></flow-image-tile>`;
    expect(findLargestImgSrc(document.querySelector('flow-image-tile')!)).toBe(SRC_A);
  });

  it('still prefers the larger image when they can be measured', () => {
    /* The behaviour the area comparison exists for, unchanged. */
    document.body.innerHTML =
      `<flow-image-tile><img src="${SRC_A}"><img src="${SRC_B}"></flow-image-tile>`;
    const [a, b] = Array.from(document.querySelectorAll('img'));
    size(a, 40, 40);
    size(b, 400, 400);
    expect(findLargestImgSrc(document.querySelector('flow-image-tile')!)).toBe(SRC_B);
  });

  it('takes the first when none of them can be', () => {
    /* Arbitrary, and the honest kind: with no layout there is nothing to
       choose on, and one of the tile's own images is a far better answer than
       none. */
    document.body.innerHTML =
      `<flow-image-tile><img src="${SRC_A}"><img src="${SRC_B}"></flow-image-tile>`;
    expect(findLargestImgSrc(document.querySelector('flow-image-tile')!)).toBe(SRC_A);
  });

  it('never returns an ingredient, even when it is the only image with a box', () => {
    /* The input pictures the user supplied. Handing one back as the result is
       the older bug this function already guards against, and relaxing the
       area floor must not reopen it. */
    document.body.innerHTML = `
      <flow-video-tile>
        <div class="ingredients-list"><img src="https://example.test/input.jpg"></div>
        <div class="batch-tiles-section"><img src="${SRC_A}"></div>
      </flow-video-tile>`;
    size(document.querySelector('.ingredients-list img')!, 200, 200);
    expect(findLargestImgSrc(document.querySelector('flow-video-tile')!)).toBe(SRC_A);
  });

  it('answers empty when the tile genuinely has no result image', () => {
    /* A tile still generating. '' is correct here and the caller handles it —
       what it must not be is the answer for a tile that has one. */
    document.body.innerHTML =
      '<flow-video-tile><div class="progress">47%</div></flow-video-tile>';
    expect(findLargestImgSrc(document.querySelector('flow-video-tile')!)).toBe('');
  });

  it('ignores a tiny inline data URL, laid out or not', () => {
    document.body.innerHTML =
      `<flow-image-tile><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></flow-image-tile>`;
    expect(findLargestImgSrc(document.querySelector('flow-image-tile')!)).toBe('');
  });
});
