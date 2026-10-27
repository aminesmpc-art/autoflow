# Studio connection test

Import `studio-connection-test.json` in Studio using **Import** in the gallery. It includes two 640x360 PNG test images of a red ball. No AI image generation or upload from your computer is needed to start.

Importing does not submit anything. **Run workflow submits three video generations** to your signed-in Flow account and uses the normal Studio allowance/provider credits. The workflow is configured for Veo 3.1 Fast, 16:9, Frames mode. Choose another supported video model if necessary.

The test checks:

1. **TEST 1 — Image to Start:** the left-hand ball image enters the first clip's S port.
2. **TEST 2 — Captured last frame:** after clip 1 completes, Last Frame should display its ending, not its opening thumbnail.
3. **TEST 3 — Start and End:** clip 2 should open on that captured ending and finish on the supplied right-hand ball image. Its S and E must not swap.
4. **TEST 4 — Direct video chain:** clip 2's result connects directly to clip 3's S; the captured ending is carried forward without an extra Last Frame node.

Before spending credits, you can test the canvas alone: switch clip 1 between Ingredients and Start & End frames. Its image wire should move to the correct visible input. Delete/reconnect that wire, then reconnect clip 2's result to clip 3's S. A second image dragged into an occupied S/E socket should explain that the slot is already filled.

Automated verification uses this same JSON: `npm run test:connections` imports it into the real canvas in an offline disposable browser, changes modes and performs mouse drags. It never presses Run. Unit tests separately verify frame order, equal Start/End images, and missing-input failures in both runners. Live provider rendering still needs a user-run check.
