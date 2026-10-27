/// <reference types="node" />
import { readFileSync } from 'fs';
import { resolve } from 'path';

const loader = require('../scripts/panel-only-loader.cjs');
const shared = resolve(__dirname, '../../studio-extension/src');

test('standalone worker replaces only the Studio window opener', () => {
  const resourcePath = resolve(shared, 'background/service-worker.ts');
  const source = readFileSync(resourcePath, 'utf8');
  const result = loader.call({ resourcePath }, source);
  expect(result).toContain('openPanelOnActionClick: true');
  expect(result).toContain('AutoFlow Motion runs in the side panel');
  expect(result).not.toContain("chrome.windows.create({ url: STUDIO_URL");
  expect(result).not.toContain('chrome.tabs.create({ url: STUDIO_URL');
  expect(result).toContain("msg?.type === 'DEBUG_UPLOAD_TO_FLOW'");
  expect(readFileSync(resourcePath, 'utf8')).toEqual(source);
});

test('standalone Flow adapter has no floating Open Studio button', () => {
  const resourcePath = resolve(shared, 'content/flow/index.ts');
  const result = loader.call({ resourcePath }, readFileSync(resourcePath, 'utf8'));
  expect(result).toContain('const injectStudioButton = () => {}');
  expect(result).not.toContain('af-open-studio-btn');
});

test('shared launch changes require an explicit build review', () => {
  expect(() => loader.call({ resourcePath: '/background/service-worker.ts' }, 'const changed = true;')).toThrow(/expected one launch hook/);
});
