# Fix: Upscaled Downloads (1080p / 4K) in AutoFlow

## Problem

The Library "Download" button always downloads **720p** (direct URL). For **1080p/4K**, Flow requires its native UI to trigger server-side upscaling:

```
Right-click tile → Download submenu → Pick resolution → Flow upscales → Downloads
```

## Flow's Download UI Structure (Radix UI)

When you right-click a video tile, Flow shows a context menu:

```
Add to Scene | Favorite | Download → | Reuse Prompt | Flag Output | Rename | Cut | Copy | Delete
```

**"Download" is a submenu trigger**, not a button:

```html
<div role="menuitem" aria-haspopup="menu" data-state="open">
  <i class="google-symbols">download</i>Download
</div>
```

Hovering/clicking it opens a **submenu** with resolution buttons:

```html
<button role="menuitem"><span>720p</span><span>Original Size</span></button>
<button role="menuitem"><span>1080p</span><span>Upscaled</span></button>
<button role="menuitem">
  <span>4K</span><span>Upscaled · 50 credits</span>
</button>
```

## Files to Modify

### 1. `src/content/scanner.ts` — `downloadAssetByMenu(locator, resolution?)`

Update this function to:

1. **Right-click the tile's INNER content** — target `span[data-state]`, `video`, or `img` elements. Do NOT right-click the outer `div[data-tile-id]` (shows a "Collection" menu instead of "Download")
2. **Verify the correct menu** by checking for a menuitem containing `<i class="google-symbols">download</i>`
3. **Open the Download submenu** — click the trigger + dispatch `pointermove` (Radix uses pointer events, not just mouse events)
4. **Pick resolution** — search submenu `<span>` children for "1080p", "4k", etc.

### 2. `src/content/index.ts` — `downloadSelected()`

- Accept `resolution` in the payload
- If resolution contains "720p" → use existing fast **direct URL** download
- Otherwise → use `downloadAssetByMenu(locator, resolution)` for **menu-based** download

### 3. `src/sidepanel/index.ts` — Download button handler

- Read `$('#setting-video-resolution').value`
- Pass it as `resolution` in the `DOWNLOAD_SELECTED` message payload

## Key Gotchas

> [!CAUTION]
> **Wrong right-click target**: Right-clicking `div[data-tile-id]` shows "Create Collection / Paste" menu. Must target inner `span[data-state]` or `video`/`img` elements.

> [!WARNING]
> **Merged icon text**: The Download menuitem's `textContent` is `"downloadDownload"` (icon text + label). The regex `\bdownload\b` will NOT match this because there's no word boundary between the two words. Use icon content matching instead.

> [!WARNING]
> **Submenu items not in DOM**: Resolution buttons (720p, 1080p, 4K) only exist in the DOM AFTER the Download submenu is opened. You must open the submenu first, THEN search for resolution options.

> [!TIP]
> **Radix submenu opening**: Radix UI opens submenus via `onPointerMove`, not just `mouseenter`. Dispatch both `mouseenter` and `pointermove` events on the Download trigger to reliably open the submenu.

## Resolution Matching

Extract the key part from the settings value, then match against `<span>` text:

| Settings Value    | Key to Match | Flow Span Text |
| ----------------- | ------------ | -------------- |
| `Original (720p)` | `720p`       | `720p`         |
| `1080p Upscaled`  | `1080p`      | `1080p`        |
| `4K`              | `4k`         | `4K`           |

## Verification

1. Set resolution to **1080p** in Settings
2. Scan the library, select a video
3. Click Download
4. Flow should show: _"Upscaling your video. This may take several minutes."_
5. Video downloads at 1080p after upscaling completes
