/** @jest-environment node */
/// <reference types="node" />
/**
 * The switch behind `npm run build:test`, and what keeps that build out of the
 * Web Store: the real check unless the flag is set by build.cjs itself, a name
 * Chrome shows on every surface, and a packager that refuses it.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..');
const source = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

function config(flag?: string) {
  const before = process.env.MOTION_TEST_BUILD;
  if (flag === undefined) delete process.env.MOTION_TEST_BUILD; else process.env.MOTION_TEST_BUILD = flag;
  try {
    let loaded: any;
    jest.isolateModules(() => { loaded = require('../webpack.config.cjs'); });
    return loaded;
  } finally {
    if (before === undefined) delete process.env.MOTION_TEST_BUILD; else process.env.MOTION_TEST_BUILD = before;
  }
}
const defined = (c: any) => c.plugins.find((p: any) => p.constructor.name === 'DefinePlugin').definitions;
const manifestCopy = (c: any) => c.plugins.find((p: any) => p.constructor.name === 'CopyPlugin').patterns
  .find((p: any) => p.from === 'manifest.json');

test('a plain build keeps the subscription check and copies the manifest untouched', () => {
  const plain = config();
  expect(defined(plain).__MOTION_BILLING_CHECK__).toBe('true');
  expect(manifestCopy(plain).transform).toBeUndefined();
});

test('the test build turns the check off and renames itself, nothing else', () => {
  const test = config('1');
  expect(defined(test).__MOTION_BILLING_CHECK__).toBe('false');
  const built = JSON.parse(manifestCopy(test).transform(Buffer.from(JSON.stringify(source))));
  expect(built.name).toBe('AutoFlow Motion — TEST BUILD');
  expect(built.action.default_title).toBe('AutoFlow Motion — TEST BUILD');
  expect(built.description).toMatch(/subscription check is off.*Never upload/);
  expect(built.description.length).toBeLessThanOrEqual(132);
  /* Same permissions, scripts and version — it is the same extension. */
  const { name, description, action, ...rest } = built;
  const { name: _n, description: _d, action: sourceAction, ...sourceRest } = source;
  expect(rest).toEqual(sourceRest);
  expect({ ...action, default_title: sourceAction.default_title }).toEqual(sourceAction);
});

test('only build.cjs decides, so an inherited flag cannot make a plain build a test build', () => {
  const script = readFileSync(resolve(root, 'scripts/build.cjs'), 'utf8');
  expect(script).toMatch(/else delete process\.env\.MOTION_TEST_BUILD;/);
  expect(script.indexOf("process.env.MOTION_TEST_BUILD = '1'")).toBeLessThan(script.indexOf("require('../webpack.config.cjs')"));
  expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts['build:test']).toBe('node scripts/build.cjs --test');
});

test('the store packager refuses a test build before it zips anything', () => {
  const script = readFileSync(resolve(root, 'scripts/package-store.ps1'), 'utf8');
  /* By its name, and by its bundle — a hand-edited manifest does not pass. */
  for (const guard of ["if ($manifest.name -match 'TEST BUILD') { throw", ".Contains('Subscription check off')) { throw"]) {
    const at = script.indexOf(guard);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(script.indexOf('CreateFromDirectory'));
  }
});
