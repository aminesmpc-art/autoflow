/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8');

const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
const GEMINI_CONTENT = read('content', 'gemini', 'index.ts');

describe('Ask AI & Story image references', () => {
  it('collects reference images from the Ask AI / Story node itself as well as downstream targets', () => {
    expect(RUNNER).toMatch(/private storyReferences\(nodeId: string, targets: ShotTarget\[\], edges: Edge\[\], max = 4\): string\[\]/);
    expect(RUNNER).toMatch(/const allNodeIds = \[nodeId, \.\.\.targets\.map\(\(t\) => t\.id\)\];/);
  });

  it('passes nodeId into storyReferences in executeStoryboardAsk', () => {
    expect(RUNNER).toMatch(/const refs = this\.storyReferences\(nodeId, targets, edges\);/);
  });

  it('Gemini revealFileInput checks button and role=button with broad matching', () => {
    expect(GEMINI_CONTENT).toMatch(/document\.querySelectorAll<HTMLElement>\('button, \[role="button"\]'\)/);
    expect(GEMINI_CONTENT).toMatch(/\/add\|upload\|attach\|image\|photo\|file\|plus\/i\.test\(label\)/);
  });
});
