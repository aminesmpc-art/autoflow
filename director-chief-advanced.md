# Director Chief continuity and recovery

- [x] Add validated target contracts with explicit state handoffs and voice budgets.
- [x] Prepare all Director prompts and review them together before media dispatch.
- [x] Save versioned planning checkpoints; invalidate when the brief or wiring changes.
- [x] Reuse completed media only when its prompt, settings and references still match.
- [x] Show review state and resume/reset controls; verify integration and builds.

Decision: keep orchestration in the existing runner and persist JSON checkpoints on nodes. The Chief prepares child prompts before releasing the normal topological media run. Semantic review is model-assisted; schema, ownership and dialogue budgets are deterministic. No new backend is needed.

Verification: TypeScript passes. Ten focused suites / 376 tests pass, including real runner dispatch ordering, failed review blocking, targeted group repair, changed-brief invalidation, fresh-runner recovery, media reuse and voice-change invalidation. Extension and web bundles build (extension has bundle-size warnings). Tests use mocked AI transport, not a paid live generation. Jest required forceExit because existing runner/store timers remain active.

Use the existing wrong-room-challenge-workflow.json after reloading the rebuilt extension. Run or Resume production checks the saved input signature before reuse. Clear plan asks for confirmation and resets planning without deleting generated media. Storage failures warn on the Chief. Blob-only results are not reused across sessions; saved remote result URLs can expire. This is prompt review, not visual inspection or a guarantee of identical rendered characters. Billing rules are unchanged.
