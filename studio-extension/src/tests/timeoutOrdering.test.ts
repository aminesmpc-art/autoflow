/* Every layer that waits on a slower layer must outlast it.

   This fault has now appeared three times:

   1. The runner gave up on a video at 10 minutes while the content script
      tracked the tile for 20.
   2. The Studio poller allowed 60s for the engine to submit, while
      clickGenerate alone may spend 60s waiting for Flow to re-enable the
      button after processing an uploaded image. Any node with a reference
      image failed having done nothing wrong.
   3. The poller watched a tile for a flat 20 minutes, longer than the runner
      allows an image — so a slow image was failed by the runner with a vague
      message while the poller was still watching it succeed.

   Two rules, and the numbers live here so changing one without the other
   breaks a test rather than a user's run:

   - The INNER layer must give up first. It knows which tile, which step, and
     can say so; the outer layer can only report that nothing came back.
   - No supervising wait may be shorter than the worst case of the work it
     supervises.
*/

/** WorkflowRunner — outer, per media type. */
const RUNNER = {
  video: 22 * 60_000,
  image: 8 * 60_000,
  text: 3 * 60_000,
};

/** Content scripts — inner. */
const CONTENT = {
  flowVideoWatch: 1200 * 1000, // pollStudioCompletion, video
  flowImageWatch: 360 * 1000,  // pollStudioCompletion, image
  chatgptImage: 6 * 60_000,
  chatgptText: 90 * 1000,
  /* Spent BEFORE the question is asked, out of the same outer budget — a
     ChatGPT node wired to a reference uploads first, then waits for the
     answer. Counting only one of the two is how the text node ended up with
     150s of work under a 120s supervisor. */
  chatgptUpload: 45 * 1000,
};

/** Steps the engine may spend BEFORE it can report "submitted". */
const PRE_SUBMIT = {
  clickGenerateButtonWait: 60_000, // waits for Flow to re-enable the button
  settingsAndUpload: 60_000,       // media switch retries, panel retries, upload
};

/** The poller's own limits for phase 1. */
const PHASE_1 = {
  stall: 90_000,
  absolute: 6 * 60_000,
};

describe('inner layers give up before outer layers', () => {
  it('flow video: content script before runner', () => {
    expect(CONTENT.flowVideoWatch).toBeLessThan(RUNNER.video);
  });

  it('flow image: content script before runner', () => {
    // The regression: this was 20 minutes against the runner's 8.
    expect(CONTENT.flowImageWatch).toBeLessThan(RUNNER.image);
  });

  it('chatgpt image: content script before runner', () => {
    expect(CONTENT.chatgptImage).toBeLessThan(RUNNER.image);
  });

  it('chatgpt text: content script before runner', () => {
    expect(CONTENT.chatgptText).toBeLessThan(RUNNER.text);
  });

  it('chatgpt text: upload AND reply together still fit', () => {
    // The regression: adding a 60s upload wait left 90s of reply under a
    // 120s runner budget, so the supervisor expired mid-answer and blamed
    // the model for a slow upload.
    expect(CONTENT.chatgptUpload + CONTENT.chatgptText).toBeLessThan(RUNNER.text);
  });

  it('chatgpt image: upload AND generation together still fit', () => {
    expect(CONTENT.chatgptUpload + CONTENT.chatgptImage).toBeLessThan(RUNNER.image);
  });
});

describe('phase 1 outlasts the work it supervises', () => {
  const worstCase = PRE_SUBMIT.clickGenerateButtonWait + PRE_SUBMIT.settingsAndUpload;

  it('absolute limit exceeds the engine pre-submit worst case', () => {
    // The regression: 60s against a 60s button wait alone.
    expect(PHASE_1.absolute).toBeGreaterThan(worstCase);
  });

  it('stall window exceeds the longest single step', () => {
    // A step is allowed to sit still for as long as its own wait, or a healthy
    // engine gets called hung.
    expect(PHASE_1.stall).toBeGreaterThan(PRE_SUBMIT.clickGenerateButtonWait);
  });

  it('phase 1 still finishes well inside the runner budget', () => {
    // Otherwise the runner reports the failure and the useful message is lost.
    expect(PHASE_1.absolute).toBeLessThan(RUNNER.image);
  });
});
