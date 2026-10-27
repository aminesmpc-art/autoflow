/**
 * Every Upgrade button opened the plans page. From there a buyer had to sign
 * in to the website again, or paid under another address — and the webhook
 * matches a purchase to an account by email, so Pro went to a brand-new
 * account while Motion stayed on Free. The buttons now open checkout for the
 * signed-in account, tagged with which button it was.
 */
import { comparePlansUrl, PRO_PRICE, untilReset, upgradeUrl } from '../src/billing';

describe('the upgrade link', () => {
  it('opens checkout for this account, with the email out of every request', () => {
    const url = new URL(upgradeUrl('Buyer@Example.com ', 'limit'));
    expect(url.origin + url.pathname).toBe('https://www.auto-flow.studio/checkout');
    expect(url.hash).toBe('#email=buyer%40example.com');
    expect(url.search).not.toMatch(/example/);
  });

  it('says which button was pressed, for the website\'s analytics', () => {
    const params = new URL(upgradeUrl('a@b.co', 'after_clip')).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      utm_source: 'motion', utm_medium: 'extension', utm_campaign: 'pro_upgrade', utm_content: 'after_clip',
    });
  });

  it('still opens checkout without an email, which then asks to sign in', () => {
    expect(upgradeUrl(undefined, 'top_bar')).toBe('https://www.auto-flow.studio/checkout?utm_source=motion'
      + '&utm_medium=extension&utm_campaign=pro_upgrade&utm_content=top_bar');
    expect(upgradeUrl('  ', 'top_bar')).not.toContain('#');
  });

  it('compares plans on the plans page, tagged the same way', () => {
    expect(comparePlansUrl()).toBe('https://www.auto-flow.studio/pricing?utm_source=motion'
      + '&utm_medium=extension&utm_campaign=pro_upgrade&utm_content=compare');
  });

  it('names the price checkout charges', () => {
    expect(PRO_PRICE).toBe('$10/month');
  });
});

describe('the countdown to more free jobs', () => {
  const midnight = '2026-10-07T00:00:00+00:00';
  const at = (iso: string) => Date.parse(iso);

  it('counts hours and minutes to midnight UTC', () => {
    expect(untilReset(midnight, at('2026-10-06T18:48:00Z'))).toBe('5h 12m');
    expect(untilReset(midnight, at('2026-10-06T22:00:00Z'))).toBe('2h 0m');
  });

  it('rounds the last minutes up rather than showing zero', () => {
    expect(untilReset(midnight, at('2026-10-06T23:01:00Z'))).toBe('59m');
    expect(untilReset(midnight, at('2026-10-06T23:59:30Z'))).toBe('1m');
  });

  it('says nothing once the time has passed or is unknown', () => {
    expect(untilReset(midnight, at('2026-10-07T00:00:00Z'))).toBe('');
    expect(untilReset('', at('2026-10-06T18:00:00Z'))).toBe('');
    expect(untilReset(undefined)).toBe('');
  });
});
