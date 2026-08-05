# Cloud-hosted workflow templates

**Status:** phases 1–3 built. Phase 4 (shared workflows) not started.
**Problem:** every new template means a rebuild, a Chrome Web Store review, and a
wait for users to update — to change prompt text and node positions.

---

## 1. Why this is allowed

MV3 bans **remotely hosted code**, not remotely hosted **data**. Chrome's docs
permit loading and caching "a remote configuration (for example a JSON file) at
runtime"; what is forbidden is fetching something that gets evaluated as logic.

Templates are declarative — node types, positions, prompt strings, edges. The
engine that interprets them stays in the bundle.

**The rule this imposes on us forever:** the template format must never gain a
field that is executed. No expressions, no scripts, no callbacks-as-strings. The
day a template can carry logic, this stops being a config fetch and becomes a
policy violation.

---

## 2. Authoring stays in this repo

The tempting design — templates in a Django admin form — is wrong. Nobody wants
to author a 14-node graph in a textarea, and it throws away `templates.test.ts`,
which has caught a real defect in nearly every template added so far.

Instead:

```
src/studio/templates/index.ts   ← still the source of truth, still TypeScript
        │
        │  npm run templates:publish
        ▼
   validate (the same checks the tests run)
        │
        ▼
   templates.json  ──POST──►  backend  ──GET──►  extension
```

Authoring keeps type safety and build-time validation. Publishing stops being a
store review and becomes a script. That is the whole win, and it costs nothing
we currently have.

---

## 3. Schema

```jsonc
{
  "schemaVersion": 1,
  "publishedAt": "2026-08-05T12:00:00Z",
  "templates": [
    {
      // ── everything the current Template interface has ──
      "id": "tpl_miniature_car",
      "name": "Miniature Car: Carve → Match Cut",
      "description": "...",
      "useCase": "...",
      "category": "Content",
      "difficulty": "Advanced",
      "nodeCount": 13,
      "thumbnail": "🚗",
      "nodes": [ /* ... */ ],
      "edges": [ /* ... */ ],

      // ── new, for cloud delivery ──
      "requiresNodeTypes": ["prompt", "generate", "frame"],
      "requiresPlatforms": ["flow"],
      "minExtensionVersion": "0.6.0",
      "thumbnailImage": "data:image/svg+xml;base64,...",
      "tier": "free",
      "disabled": false,
      "revision": 3
    }
  ]
}
```

### Why both `requiresNodeTypes` and `minExtensionVersion`

They catch different failures, and each is cheap.

`requiresNodeTypes` is **capability-based** and exact. `Canvas.tsx` already holds
the answer:

```ts
const nodeTypes = { prompt, image, generate, frame };
```

The extension can compare that map against the template's requirements and know
for certain whether it can render it. This is the one that matters most right
now: **Last Frame nodes shipped in v0.6.0**. Publish a template using
`type: 'frame'` today and anyone on v0.5.2 gets a node their bundle cannot draw.

`minExtensionVersion` is the **backstop** for everything that is not a node type
— a new duration value, a changed model name, an engine behaviour a template
depends on. Node types alone would not catch those.

`requiresPlatforms` covers the third case: a template with a Gemini node is
meaningless to a build that has no Gemini adapter.

### Artwork as data URIs, not URLs

Our card SVGs are ~2KB. Inlining them as data URIs:

- removes an entire class of loading failure (the `water-wipeout.svg` bug, but
  now over a network)
- needs no `img-src` CSP change
- costs one request instead of N

Remote image URLs would work, but they buy nothing here and add a failure mode.

---

## 4. Endpoint

```
GET /api/templates
Authorization: Bearer <token>   (optional)
If-None-Match: "<etag>"
```

- **304** when unchanged — the common case, and nearly free.
- **200** with the payload otherwise.
- Unauthenticated requests get free templates. This must work signed-out: a new
  install should see a gallery before it sees a login form.

### Pro gating

The server decides, and it must **strip `nodes` and `edges`** from Pro templates
for non-Pro callers — send the card metadata with `"locked": true` and empty
arrays. Sending the full graph and hiding it in the UI means the workflow is one
DevTools call away, which is not gating.

A locked card that shows what it does and prompts to upgrade is a conversion
surface, not a limitation.

### Storage on the backend

A single row with a `JSONField` holding the published payload, plus its ETag.
The publish script overwrites it. No per-template models, no admin forms for
graph editing, no migration every time the schema grows a field.

---

## 5. Loader

```
Studio opens
  │
  ├─ read chrome.storage.local  ──► render immediately (may be stale; fine)
  │     └─ empty? ──► BUILTIN_TEMPLATES bundled in the extension
  │
  └─ background fetch (ETag)
        ├─ 304 ─────────────► nothing to do
        ├─ 200 ─────────────► validate → filter by capability → cache → re-render
        └─ network error ───► keep what is showing, log once
```

Three rules, all learned the hard way elsewhere in this codebase:

1. **The gallery never blocks on the network.** Cache-first, always.
2. **The bundled set is the floor.** A fresh install with the API down still has
   workflows. This is also the offline story.
3. **Failure is silent to the user and loud in the console.** A missing cloud
   template should look like a slightly shorter gallery, not an error page.

---

## 6. Validation moves, it does not disappear

`templates.test.ts` currently validates at build time. Cloud templates would
bypass it entirely — so the checks move into a shared function:

```
validateTemplate(tpl) → string[]   // empty = valid
        │
        ├── called by templates.test.ts   (build time, all bundled templates)
        ├── called by templates:publish   (before anything is published)
        └── called by the loader          (runtime, every fetched template)
```

One implementation, three callers, so the rules cannot drift apart.

It already knows what to check — every one of these caught a real bug:

- ids unique; every edge points at a node that exists
- handles exist on the node type they connect to (`result` vs `image` — a wrong
  one is an edge React Flow silently drops)
- `nodeCount` matches reality
- every generate node has a prompt connected
- every frame node has exactly one video upstream
- no prompt text addressed to the user (the "↑ change this line" bug)

**Reject per template, never per payload.** One malformed template must not
empty the gallery.

---

## 7. Rollout

Phased so that the risky part is observable before it matters.

| Phase | What ships | How we know it works |
|---|---|---|
| 1 ✅ | Loader, cache, bundled fallback — serving **the same templates already bundled** | Gallery is identical. Console says whether it rendered from cache, network or bundle. A no-op that proves the pipeline. |
| 2 ✅ | `templates:publish` script; backend endpoint | It appears without a store update. A v0.5.2 build does **not** see it — the capability gate works. |
| 3 ✅ | Pro gating | Non-Pro receives no `nodes` array for a Pro template. Verified in the network tab, not the UI. |
| 4 | *(not started)* shared / user-submitted workflows | — |

Phase 1 is deliberately boring. If it goes wrong, nothing changes for anyone.

### Safety

- **Kill switch:** `"disabled": true` on a template hides it everywhere, next fetch.
- **Rollback:** if a payload fails validation wholesale, keep serving the cache.
- **The safety net we give up:** store review is slow, but it is review. A bad
  `templates.json` reaches every user in seconds with no gate. That is precisely
  why §6 matters more here than it did as a test.

---

## 8. What this does not solve

Still needs a store update:

- new node types (a `frame`-style addition)
- engine or runner changes
- new platform adapters (the Gemini work)
- manifest, permissions, CSP

Cloud templates free us from shipping for **prompt and layout changes only** —
which, going by the last dozen commits, is most of what we actually do.

---

## 9. Open questions

- **Publish auth.** The script needs a credential the backend trusts. An admin
  token in an env var is the obvious answer; it must never reach the extension.
- **Does the bundled set stay in sync?** Simplest is to bundle whatever the last
  publish contained, so a fresh install is current on day one and only drifts
  until its first fetch.
- **Do we version the gallery UI against `schemaVersion`?** An older extension
  meeting `schemaVersion: 2` should ignore the payload and keep its cache rather
  than guess. Cheap to add now, impossible to retrofit.
