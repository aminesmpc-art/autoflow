# Clipping backend hardening

- [x] Add failing Django tests for an atomic, idempotent 1/day Free and 10/day Pro clipping quota.
- [x] Implement the clipping usage ledger, migration, service, authenticated API, and admin visibility.
- [x] Add failing extractor tests for required JWT auth, job ownership, quota consumption, and input limits.
- [x] Implement shared extractor auth plus fail-closed quota consumption and server-side media validation.
- [x] Replace process-local job state with a store abstraction, bounded execution, stale-job handling, and cancellation.
- [x] Harden model calls with timeouts/retries, explicit window coverage, correct MIME propagation, and bounded requests.
- [x] Update the extension contract for authenticated polling/cancellation and actionable quota errors.
- [x] Add capability/readiness diagnostics and update deployment configuration and documentation.
- [x] Run focused tests, full backend/extractor/extension tests, lint/type checks, and dependency validation.
