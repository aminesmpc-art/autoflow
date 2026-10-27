/// <reference types="node" />
/**
 * Which Upgrade button sells?
 *
 * Every Studio Upgrade button already opened checkout for the signed-in
 * account, but nothing said which button it came from, so the website's
 * analytics could not tell the top bar from the run-limit notice. Each button
 * now names itself in UTM tags — the same tags AutoFlow Motion uses, with
 * utm_source=studio — and the email stays in the fragment, which no request
 * carries.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// @ts-ignore — the module reads chrome.storage only when called.
global.chrome = { storage: { local: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } } } as any;

import { checkoutUrl } from '../shared/api';

describe('the checkout address', () => {
  it('names the button in the query and keeps the email in the fragment', () => {
    const url = new URL(checkoutUrl('buyer@example.com', 'limit'));
    expect(url.origin + url.pathname).toBe('https://www.auto-flow.studio/checkout');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'studio', utm_medium: 'extension', utm_campaign: 'pro_upgrade', utm_content: 'limit',
    });
    expect(url.hash).toBe('#email=buyer%40example.com');
    expect(url.search).not.toMatch(/example/);
  });

  it('is the plain checkout when no button is named', () => {
    expect(checkoutUrl('a@b.co')).toBe('https://www.auto-flow.studio/checkout#email=a%40b.co');
    expect(checkoutUrl(null)).toBe('https://www.auto-flow.studio/checkout');
  });

  it('still names the button when signed out', () => {
    expect(checkoutUrl(null, 'templates')).toBe('https://www.auto-flow.studio/checkout?utm_source=studio'
      + '&utm_medium=extension&utm_campaign=pro_upgrade&utm_content=templates');
  });
});

describe('every Studio Upgrade button names itself', () => {
  const src = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

  it('the canvas top bar and its run-limit notice', () => {
    const canvas = src('studio', 'components', 'Canvas.tsx');
    expect(canvas).toMatch(/openUpgrade\('top_bar'\)/);
    expect(canvas).toMatch(/openUpgrade\('limit'\)/);
  });

  it('a locked Pro template', () => {
    expect(src('studio', 'components', 'TemplateGallery.tsx')).toMatch(/getUpgradeTarget\('templates'\)/);
  });

  it('the side panel\'s Pro page', () => {
    expect(src('sidepanel', 'index.ts')).toMatch(/getUpgradeUrl\('sidepanel'\)/);
  });
});
