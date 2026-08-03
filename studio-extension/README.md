# AutoFlow Studio (standalone)

Node workflows driving **Google Veo (Flow)**, **ChatGPT** and **Grok** from one
canvas, on the same AutoFlow account.

See `../STUDIO_SPLIT_PLAN.md` for the migration plan and decisions.

## State

| Milestone | |
|---|---|
| 0 · Grok selector audit | done — findings in the plan |
| 1 · Skeleton (workspace, manifest, build) | **in progress** |
| 2 · Flow engine copied | not started |
| 3 · Studio UI moved | not started |
| 4 · Auth + limits | not started |
| 5 · Page-ownership guard | not started |
| 6 · Drift check | **done early** — it guards everything after it |
| 7 · ChatGPT adapter | not started |
| 8 · Grok adapter | not started |
| 9 · Store listing | not started |

Nothing runs yet. The entry points named in `webpack.config.js` land in
milestone 2.

## Drift check

The engines here are copies. `engine-sync.json` records the hash of each
upstream file at the moment its copy was reviewed:

```
npm run check:drift              # fails when upstream moved
npm run check:drift -- --accept  # record, AFTER porting the change
```

grok-auto was copied without this and went three months and fifteen selector
fixes stale while still shipping a checkout bug. Run it before every release.

## Permissions

Deliberately smaller than the AutoFlow extension — 6 permissions, 4 hosts.
`sidePanel`, `downloads`, `webRequest` and `notifications` are not needed here.
Adding any back should require a reason.
