/**
 * @jest-environment jsdom
 */

/**
 * The Pro page in the panel.
 *
 * The footer CTA used to open the checkout directly, which asks for money
 * before saying what it buys — a button reading "3 left" is a warning, not an
 * offer. It opens this page now, and this page does the handing off.
 *
 * A page rather than a fourth tab. The panel has three tabs that each do
 * something; spending one permanently on selling makes it the tab nobody
 * reads, which is the same reasoning that keeps the footer button hidden
 * until the ceiling is close.
 *
 * And it explains rather than transacts. Payment happens on the checkout
 * page, where the embedded provider and the account email belong. An
 * extension panel is the wrong place to be typing card details into whatever
 * it is dressed up as, so there is a test below that says so.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const DIST = join(__dirname, '../../dist');
const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');

function mountPanel(): void {
  document.head.innerHTML = '';
  const doc = new DOMParser().parseFromString(
    readFileSync(join(DIST, 'sidepanel.html'), 'utf8'), 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  const style = document.createElement('style');
  style.textContent = readFileSync(join(DIST, 'sidepanel.css'), 'utf8');
  document.head.append(style);
}

describe('a page, not a fourth tab', () => {
  beforeEach(mountPanel);

  it('exists as a view and ships hidden', () => {
    const v = document.getElementById('view-pro') as HTMLElement;
    expect(v).not.toBeNull();
    expect(v.hidden).toBe(true);
    expect(getComputedStyle(v).display).toBe('none');
  });

  it('has no nav tab of its own', () => {
    /* Three tabs that each do something. A fourth that sells would be the
       one nobody reads. */
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.sp-nav__tab'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.dataset.view)).not.toContain('pro');
  });

  it('is hidden and shown by the same machinery as the rest', () => {
    expect(SRC).toMatch(/for \(const id of \['build', 'templates', 'run', 'pro'\] as PanelView\[\]\)/);
  });

  it('goes back where it came from', () => {
    /* Not to Build. Somebody who hit the ceiling in the Library should land
       back in the Library. */
    expect(SRC).toMatch(/let viewBeforePro: PanelView = 'build';/);
    expect(SRC).toMatch(/if \(view === 'pro'\) \{[\s\S]{0,320}viewBeforePro = current/);
    expect(SRC).toMatch(/proBack\.addEventListener\('click', \(\) => showView\(viewBeforePro\)\)/);
  });
});

describe('it explains before it asks', () => {
  beforeEach(mountPanel);

  it('the footer CTA opens the page rather than the checkout', () => {
    /* It used to open the payment form. A button reading "3 left" is a
       warning; sending that straight to a card form asks for money before
       saying what it buys. */
    expect(SRC).toMatch(/upBtn\.addEventListener\('click', \(\) => showView\('pro'\)\)/);
  });

  it('says where the reader actually stands', () => {
    /* "You have used all ten" is a different sentence from "unlimited runs",
       and only one of them is about them. */
    expect(SRC).toMatch(/You have used all \$\{limit\} free workflow runs this month/);
    expect(SRC).toMatch(/You have \$\{left\} of \$\{limit\} free workflow runs left/);
  });

  it('does not pitch Pro to somebody on Pro', () => {
    expect(SRC).toMatch(/You are on Pro\. Everything below is already active\./);
  });

  it('names both products, the way the website does', () => {
    const groups = Array.from(document.querySelectorAll('#view-pro .sp-pro__group'))
      .map((e) => e.textContent || '');
    expect(groups.some((g) => /studio/i.test(g))).toBe(true);
    expect(groups.some((g) => /flow/i.test(g))).toBe(true);
  });

  it('shows the price the checkout will charge', () => {
    expect(document.querySelector('#view-pro .sp-pro__price')!.textContent)
      .toMatch(/\$9\.99/);
    expect(document.getElementById('pro-go')!.textContent).toMatch(/\$9\.99/);
  });
});

describe('it hands off, it does not transact', () => {
  beforeEach(mountPanel);

  it('collects no payment detail of any kind', () => {
    /* The guard that matters. An extension panel is the wrong place for card
       numbers however convincing it looks, so there is nothing here to type
       one into. */
    const view = document.getElementById('view-pro')!;
    expect(view.querySelectorAll('input, form, iframe')).toHaveLength(0);
    expect(view.textContent).not.toMatch(/card number|cvv|expiry|billing address/i);
  });

  it('opens the real checkout, with the email the webhook needs', () => {
    /* getUpgradeUrl puts the account email in the URL fragment, which is what
       lets the membership attach to the right account. */
    expect(SRC).toMatch(/proGo\.addEventListener[\s\S]{0,400}await getUpgradeUrl\(\)/);
    expect(SRC).toMatch(/chrome\.tabs\.create\(\{ url: url \|\| 'https:\/\/www\.auto-flow\.studio\/checkout' \}\)/);
  });

  it('says out loud that it opens a tab', () => {
    expect(document.querySelector('#view-pro .sp-pro__note')!.textContent)
      .toMatch(/new tab/i);
  });

  it('does not leave the button dead if the tab will not open', () => {
    const fn = SRC.slice(SRC.indexOf("const proGo = document.getElementById('pro-go')"));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/catch \{[^}]*\}/);
    expect(body).toMatch(/proGo\.disabled = false;/);
  });
});
