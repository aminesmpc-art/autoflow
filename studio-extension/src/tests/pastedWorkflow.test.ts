/**
 * Pasting a finished workflow into the Build box.
 *
 * That box asks for a chat reply and expects the builder's step format. Paste
 * an exported .json workflow into it and readPlan says "no steps array", which
 * the panel reported as:
 *
 *     "That reply could not be turned into a workflow"
 *
 * about a file that IS one. It is the least helpful thing the box can say, and
 * the two shapes are trivially distinguishable — a plan has "steps", a
 * workflow has "nodes" and "edges", which is exactly what importWorkflow
 * checks for on the gallery side.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'sidepanel', 'index.ts'), 'utf8');

describe('telling a workflow from a plan', () => {
  it('recognises one by the same two arrays the importer checks', () => {
    const fn = SRC.slice(SRC.indexOf('function readWorkflow'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/Array\.isArray\(raw\.nodes\)/);
    expect(body).toMatch(/Array\.isArray\(raw\.edges\)/);
  });

  it('refuses an empty one, which would open a blank canvas', () => {
    const fn = SRC.slice(SRC.indexOf('function readWorkflow'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/!raw\.nodes\.length/);
  });

  it('gives it a name, because the panel prints one on success', () => {
    const fn = SRC.slice(SRC.indexOf('function readWorkflow'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/Pasted workflow/);
  });

  it('is tried only after a plan fails to parse', () => {
    /* A plan is what the box is for. Checking for a workflow first would let a
       plan that happens to carry a nodes array skip compilation entirely. */
    const fn = SRC.slice(SRC.indexOf('function evaluateReply'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body.indexOf('readPlan(text)')).toBeLessThan(body.indexOf('readWorkflow(text)'));
  });

  it('still reports the plan problem when it is neither', () => {
    const fn = SRC.slice(SRC.indexOf('function evaluateReply'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/return \{ plan: null, template: null, quality: \[\], problems: \[\], problem \}/);
  });
});

describe('the workflow shipped for the Adidas test', () => {
  const wf = JSON.parse(readFileSync(
    join(__dirname, '..', '..', '..', 'adidas_gamecourt2_two_ads.json'), 'utf8'));

  it('is the shape the box now accepts', () => {
    expect(Array.isArray(wf.nodes)).toBe(true);
    expect(Array.isArray(wf.edges)).toBe(true);
    expect(wf.nodes.length).toBeGreaterThan(0);
  });

  it('is NOT the shape a plan has, which is why it was refused', () => {
    expect(wf.steps).toBeUndefined();
  });
});
