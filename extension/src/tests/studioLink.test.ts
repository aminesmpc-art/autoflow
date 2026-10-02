/**
 * The Studio card opens the Studio EXTENSION, not the copy bundled here.
 *
 * AutoFlow ships its own studio.html, and the card used to open that. It now
 * opens the separately published AutoFlow Studio extension, whose id is fixed
 * by its Web Store listing.
 *
 * ── Why the installed check is a ping ─────────────────────────────────────
 *
 * The obvious check — open the window, then read the tab to see where it
 * landed — does not work here. chrome.tabs.get only fills in `url` for an
 * extension holding the "tabs" permission, which AutoFlow does not request,
 * and which Chrome describes to users as "Read your browsing history". So the
 * check would have reported "not installed" every time and sent everyone to
 * the store, including people who had Studio open.
 *
 * Messaging a known extension id needs no permission and fails cleanly when
 * nothing is listening, so that is what decides it. Studio answers through
 * onMessageExternal, and its manifest names AutoFlow's id so that nothing
 * else can reach that listener.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

const WORKER = read('../background/service-worker.ts');
const MANIFEST = JSON.parse(read('../../manifest.json'));
const STUDIO_MANIFEST = JSON.parse(read('../../../studio-extension/manifest.json'));
const STORE_LISTING = read('../../../studio-extension/STORE-LISTING.md');

/** The published Studio id, as recorded in its store listing. */
const STUDIO_ID = 'knodokbipcajhdpafplmlljbaamgfkao';

describe('the id the card points at', () => {
  it('is the one the store listing records', () => {
    /* One id, two files. If the listing is ever re-issued under a new id,
       this fails rather than silently opening nothing. */
    expect(STORE_LISTING).toContain(STUDIO_ID);
    expect(WORKER).toContain(STUDIO_ID);
  });

  it('opens the extension, not the bundled copy', () => {
    expect(WORKER).toMatch(/chrome-extension:\/\/\$\{STUDIO_EXTENSION_ID\}\/studio\.html/);
    expect(WORKER).not.toMatch(/const studioUrl = chrome\.runtime\.getURL\('studio\.html'\)/);
  });

  it('sends people to the store when Studio is absent', () => {
    expect(WORKER).toMatch(/chromewebstore\.google\.com\/detail\//);
    expect(WORKER).toMatch(/installed: false/);
  });
});

describe('deciding whether Studio is there', () => {
  it('asks by message, not by reading the tab', () => {
    expect(WORKER).toMatch(/AUTOFLOW_PING/);
    expect(WORKER).toMatch(/studioInstalled/);
  });

  it('does not request the tabs permission to do it', () => {
    /* Chrome shows "tabs" to users as "Read your browsing history" — a
       heavier ask than the feature is worth, and the reason this is a ping. */
    expect(MANIFEST.permissions || []).not.toContain('tabs');
    expect(MANIFEST.permissions || []).not.toContain('management');
  });

  it('reads lastError, so Chrome does not log it as unchecked', () => {
    expect(WORKER).toMatch(/chrome\.runtime\.lastError/);
  });

  it('gives up rather than hanging the click', () => {
    /* A missing extension never calls the callback at all. */
    expect(WORKER).toMatch(/setTimeout\(\(\) => done\(false\)/);
  });

  it('survives not being allowed to look for an open window', () => {
    /* Filtering tabs by URL also needs "tabs"; that lookup may throw or come
       back empty, and neither is a reason to refuse to open Studio. */
    const focus = WORKER.slice(WORKER.indexOf("case 'OPEN_STUDIO'"));
    expect(focus).toMatch(/try \{\s*existingTabs = await chrome\.tabs\.query/);
  });
});

describe('the Studio side of the handshake', () => {
  it('accepts messages from AutoFlow, and only AutoFlow', () => {
    const ids = STUDIO_MANIFEST.externally_connectable?.ids || [];
    expect(ids).toEqual(['egplmjhmcicjkojopeoaohofckgeoipc']);
  });

  it('names AutoFlow by the id AutoFlow actually ships under', () => {
    /* Taken from AutoFlow's own store link in its panel — a different id here
       would mean the ping is never delivered and Studio looks uninstalled. */
    const panel = read('../../sidepanel.html');
    expect(panel).toContain(STUDIO_MANIFEST.externally_connectable.ids[0]);
  });

  it('answers the ping', () => {
    const studioWorker = read('../../../studio-extension/src/background/service-worker.ts');
    expect(studioWorker).toMatch(/onMessageExternal/);
    expect(studioWorker).toMatch(/AUTOFLOW_PING/);
  });
});
