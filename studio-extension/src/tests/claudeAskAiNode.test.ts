/**
 * @jest-environment jsdom
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, 'src', ...p), 'utf8');

const GEN_NODE = read('studio', 'nodes', 'GenerateNode.tsx');
const RUNNER = read('studio', 'engine', 'WorkflowRunner.ts');
const CLAUDE_CONTENT = read('content', 'claude', 'index.ts');

describe('Claude in Ask AI / GenerateNode', () => {
  it('includes claude and zai in the Platform select options', () => {
    expect(GEN_NODE).toMatch(/<option value="claude">Claude<\/option>/);
    expect(GEN_NODE).toMatch(/<option value="zai">Z\.AI<\/option>/);
  });

  it('locks Claude to text-only mode and hides image option for Claude', () => {
    expect(GEN_NODE).toMatch(/const isClaude = platform === 'claude';/);
    expect(GEN_NODE).toMatch(/const mediaType = isClaude \? 'text' : \(nodeData\.mediaType \|\| 'image'\);/);
    expect(GEN_NODE).toMatch(/\{!isClaude && <option value="image">Image<\/option>\}/);
  });

  it('automatically sets mediaType to text when Claude is selected', () => {
    expect(GEN_NODE).toMatch(/if \(newPlatform === 'claude'\) \{\s*updateNodeData\(id, \{ platform: 'claude', mediaType: 'text' \}\);/);
  });

  it('Claude content script rejects non-text media types and enforces text output', () => {
    expect(CLAUDE_CONTENT).toMatch(/if \(config\?\.mediaType && config\.mediaType !== 'text'\)/);
  });

  it('Claude content script starts a new chat on new conversation execution', () => {
    expect(CLAUDE_CONTENT).toMatch(/if \(config\?\.newChat !== 'never'\) await startNewChat\(\);/);
  });
});
