# Studio 1.5.2 — connection and frame verification

The supplied store review reports failed wires, images not attaching to Start, and videos not connecting to each other. It does not include the reviewer's workflow, browser state or logs; it cannot establish their exact cause.

## Reproduced current-code failures

- Generate changed its rendered input/output handles without refreshing React Flow's internal connection bounds. Component regressions reproduced the missing refresh on Ingredients → Frames and media → text transitions.
- Changing media type/platform could remove S/E handles while leaving wires attached to those now-hidden ports. Wire movement is now centralized in the store and also preserves correctly named slots when importing partly migrated workflows.
- Both runners flattened missing frame inputs, allowing an End image to become Start or an unresolved connected End to be dropped. Each named slot is now validated independently, with one source per slot and Start required.
- The adapter handled all inline images before tile references, which reversed mixed Start/End pairs. Ordered `frameReferences` now survive the bridge. Equal Start/End pictures remain two frame slots; ordinary ingredients still deduplicate.
- Invalid wire drops were blocked before `onConnect` could explain them. The connection-end path now gives the reason, and wiring notices have no unrelated Upgrade button. Hover enlargement preserves the handle's positioning transform.

## Test artifact

`test-workflows/studio-connection-test.json` contains two deterministic PNGs, three written prompts, three Frames video nodes and a Last Frame node. It covers an image → Start, a visible captured ending, Start + End, and a direct video-result → next Start connection. Importing does not run anything. Running submits three normal provider video generations.

## Verification

The offline real-canvas test imports this exact JSON, switches modes, performs image/video mouse drags, rejects an occupied Start socket and checks for page errors. No paid generation or provider request is made. Local type checking and production build pass (existing bundle-size warnings); the cached offline dependency audit reports no vulnerabilities. Full-suite/package results are recorded below when complete.

Live Flow upload/rendering and the original reviewer's precise workflow remain unverified. Reload Studio and refresh provider tabs after installing the new build.
