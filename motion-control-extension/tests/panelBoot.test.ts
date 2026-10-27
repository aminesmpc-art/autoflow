/// <reference types="node" />
/**
 * "why he cant open ??? and its soo slow" — the panel was an empty dark box.
 * Nothing was drawn while saved videos and the project loaded, and a render
 * error unmounted everything, so slow and broken looked the same. It now says
 * it is opening, which step is slow, and what failed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Boundary } from '../src/Boundary';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('shows a render error and a reload button instead of an empty panel', async () => {
  const Broken = () => { throw new Error('saved project is unreadable'); };
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => root.render(createElement(Boundary, null, createElement(Broken))));
  quiet.mockRestore();
  expect(host.textContent).toContain('Motion could not open: saved project is unreadable');
  expect(host.querySelector('button')?.textContent).toBe('Reload panel');
});

it('draws the panel itself when nothing fails', async () => {
  await act(async () => root.render(createElement(Boundary, null, createElement('h1', null, 'Motion Control'))));
  expect(host.textContent).toBe('Motion Control');
});

it('says it is opening before any script runs, and which step is slow', () => {
  const html = readFileSync(join(__dirname, '..', 'sidepanel.html'), 'utf8');
  expect(html).toMatch(/<div id="root"><p class="boot" role="status">Opening Motion…<\/p><\/div>/);
  const index = readFileSync(join(__dirname, '..', 'src', 'index.tsx'), 'utf8');
  expect(index).toMatch(/Still opening Motion — reading \$\{step\}/);
  expect(index).toMatch(/render\(<Boundary><App \/><\/Boundary>\)/);
});
