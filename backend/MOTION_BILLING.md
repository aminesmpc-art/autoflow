# Motion access through existing AutoFlow Pro

Updated October 2, 2026. **The separate $5 Motion subscription is superseded.** Motion now uses the existing AutoFlow `Profile.is_pro` entitlement, including expiry and cancellation. There is no new product, price, plan ID or webhook secret to configure. This code is local until explicitly deployed and verified.

## Access and limits

Updated October 2, 2026, at the owner's request: **Free 3 a day, Pro unlimited.**

- Any active AutoFlow account can use Motion. The extensions keep separate login sessions, but use the same server account.
- Free (including expired or cancelled Pro): **3 accepted Motion jobs per UTC day**. No monthly limit.
- Active Pro: **unlimited**. The entitlement reports `accessPlan: "pro"` with `daily.limit` and `daily.remaining` as `null`.
- Inactive accounts (email not verified) cannot generate: `account_inactive`, 403.
- A job is one press of Generate: a source video and its settings, all its pieces together. It is charged at admission, not on successful provider completion; no automatic refund for provider failure.
- Retries send the same saved UUID and SHA-256 fingerprint. They never use another job, even at the free limit.
- New source/settings require a new job. Motion's job ledger is separate from Studio's usage counters; shared Studio usage hooks are disabled in the standalone build.
- Legacy separate-Motion membership records are preserved, but are not an entitlement source and do not grant Pro or Motion access.

## Production configuration

Use the existing **web** service for `api.auto-flow.studio`, root `/backend`—not the extractor service.

- Keep existing `WHOP_WEBHOOK_SECRET` and the existing `/api/webhooks/whop` subscription configuration unchanged.
- `MOTION_BILLING_ENABLED=False` is a rollout switch, despite its historical name. After deployment, migration and access tests, set it to `True` to allow Pro users to reserve Motion jobs.
- `WHOP_MOTION_WEBHOOK_SECRET`, `WHOP_MOTION_PRODUCT_ID` and `WHOP_MOTION_PLAN_ID` are **not required**. Do not create a separate Motion plan.
- Preserve any existing Studio product allowlist. The Motion feature switch does not require a new one or disable the legacy Pro webhook.
- Add the exact store extension origin to `EXTRA_CORS_ORIGINS` alongside any existing entries. Configure its `https://<extension-id>.chromiumapp.org/` redirect on the existing Google OAuth client.

The already-created separate Whop Motion offering/webhook is not deleted automatically. Review whether it has buyers before disabling or archiving it. Do not silently cancel subscriptions or promise refunds. Legacy webhook code is retained for record compatibility, but its records no longer unlock this product.

## API

`GET /api/motion/entitlements` uses the existing JWT and returns `product: "motion"`, `accessPlan` (`"free"` or `"pro"`), `active`, `allowed`, `reason`, and `daily`/`monthly` allowances with UTC reset timestamps. A `limit` or `remaining` of `null` means no limit.

`POST /api/usage/motion-run` takes `{ "jobId": "<UUID>", "fingerprint": "<64 lowercase hex SHA-256>" }` using that same JWT:

- 201: new accepted job; `runId`, `duplicate: false`.
- 200: same existing job; same `runId`, `duplicate: true`.
- 400: malformed identity; 401: unauthenticated; 403: `account_inactive`.
- 409: job/fingerprint conflict; 429: daily or monthly limit; 503: feature disabled.

Admission responses include `accessPlan` (`"free"` or `"pro"`); the extension rejects any other value, including the old separate-plan contract. A 429 `motion_daily_limit` is the free allowance used up for the UTC day. A successful admission can leave zero remaining quota; do not apply a second new-job quota gate to that admitted job. JWT identity, not an email in the payload, selects the account. PostgreSQL serializes concurrent admissions by locking the user row.

This is server-side accounting for an official client, not tamper-proof provider execution: a modified browser extension could bypass its own client gate.

## Safe deployment

1. Back up the API database and review the exact deployment diff. The working tree contains unrelated changes; do not upload or push it blindly.
2. Deploy Motion routes/app and additive `motion.0001_initial` migration. Keep the rollout switch false. No destructive migration is needed.
3. Verify the actual Railway startup configuration. The existing `python start.py` runs migrations, initializes the cache table, collects static files and binds to `PORT`. The Docker default/Procfile starts Gunicorn directly; do not assume migrations ran.
4. Run the read-only check inside **web**:

   ```sh
   python manage.py check_motion_release --settings=config.settings.production --extension-id YOUR_STORE_EXTENSION_ID
   ```

   It checks PostgreSQL, existing Pro webhook secret presence, exact extension origin, routes and migration/tables without printing setting values or modifying records. It does not prove webhook delivery, payment status, OAuth or provider generation.
5. Enable the switch, repeat with `--require-enabled`, then test an existing Pro account, free account, expiry/revocation, duplicate retries and both quota limits. Verify Studio counters remain unchanged. Use dedicated authorized test accounts; do not change real customer plans for testing.
6. Test real signup/OAuth and one authorized provider generation using the store candidate. Finish the public privacy/support details and store assets before submission.

Rollback: disable `MOTION_BILLING_ENABLED`; preserve all usage records and the existing Pro webhook. No production change was performed as part of the local subscription-model update.

## Verified target and previous live observation

Owner-provided project `41d990d3-dfaf-434f-ad12-fd0dfce7894f`, environment `c9354f2b-7ec7-4a20-93d1-e85e7043d53e`, service `b9f50650-90a0-40c8-8459-86e51c98a277`.

On October 1, both Motion routes returned 404 and SSH confirmed no installed Motion app. The approved local Railway session works outside the sandbox. Recheck before deploying; that observation is not a current health guarantee.

## Local verification commands

```powershell
.\venv\Scripts\python.exe manage.py test apps.motion apps.webhooks apps.api --settings=config.settings.test --noinput
.\venv\Scripts\python.exe manage.py makemigrations --check --dry-run --settings=config.settings.test
.\venv\Scripts\ruff.exe check apps/motion
.\venv\Scripts\bandit.exe -r apps/motion -x apps/motion/tests.py,apps/motion/test_concurrency.py,apps/motion/test_release_checks.py -ll
```

Offline tests use SQLite and no external email; PostgreSQL concurrency tests skip there and must be run separately against an isolated disposable PostgreSQL database before release.
