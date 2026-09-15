/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { compilePlan } from '../studio/builder/plan';
import { BUILTIN_TEMPLATES } from '../studio/templates/index';
import { validateTemplate } from '../studio/templates/validate';

const tpl: any = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl_wrong_room_challenge');

describe('Wrong Room Challenge template', () => {
  it('also ships as a JSON plan the Build reply box can compile', () => {
    const plan = JSON.parse(readFileSync(
      join(__dirname, '..', '..', '..', 'wrong-room-challenge-builder-plan.json'),
      'utf8',
    ));
    const built = compilePlan(plan, { id: 'test_wrong_room_import' });
    expect(built.problems).toEqual([]);
    expect(built.template).toBeTruthy();
    expect(built.template?.nodes.filter((n: any) => n.data?.mediaType === 'video'))
      .toHaveLength(10);
  });

  it('ships a valid 10-scene image and video workflow', () => {
    expect(tpl).toBeTruthy();
    expect(validateTemplate(tpl)).toEqual([]);
    expect(tpl.nodes).toHaveLength(tpl.nodeCount);
    expect(tpl.nodes.filter((n: any) => n.type === 'chief')).toHaveLength(1);
    expect(tpl.nodes.filter((n: any) => n.type === 'story')).toHaveLength(3);
    expect(tpl.nodes.filter((n: any) => n.data?.mediaType === 'image')).toHaveLength(11);
    expect(tpl.nodes.filter((n: any) => n.data?.mediaType === 'video')).toHaveLength(10);
  });

  it('routes the brief through one Chief that controls all three Directors', () => {
    expect(tpl.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'brief', target: 'director_chief', targetHandle: 'text' }),
      expect.objectContaining({ source: 'director_chief', target: 'board_director', targetHandle: 'text' }),
      expect.objectContaining({ source: 'director_chief', target: 'director_1_5', targetHandle: 'text' }),
      expect.objectContaining({ source: 'director_chief', target: 'director_6_10', targetHandle: 'text' }),
    ]));
    expect(tpl.edges.filter((e: any) => (
      e.source === 'brief' && ['board_director', 'director_1_5', 'director_6_10'].includes(e.target)
    ))).toHaveLength(0);
  });

  it('configures every clip for a four-second vertical Flow generation', () => {
    const clips = tpl.nodes.filter((n: any) => n.data?.mediaType === 'video');
    for (const clip of clips) {
      expect(clip.data).toMatchObject({
        platform: 'flow', model: 'Veo 3.1 - Fast', aspectRatio: '9:16',
        duration: '4s', creationType: 'ingredients',
      });
    }
  });

  it('locks every scene to the master board and every clip to its scene still', () => {
    for (let n = 1; n <= 10; n += 1) {
      expect(tpl.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'continuity_board', target: `scene_${n}`, targetHandle: 'image_ref' }),
        expect.objectContaining({ source: `scene_${n}`, target: `clip_${n}`, targetHandle: 'image_ref' }),
      ]));
    }
  });

  it('gives each generated asset exactly one Director prompt', () => {
    const generated = tpl.nodes.filter((n: any) => n.type === 'generate');
    for (const node of generated) {
      const writers = tpl.edges.filter((e: any) => e.target === node.id && e.targetHandle === 'text');
      expect({ node: node.id, writers: writers.length }).toEqual({ node: node.id, writers: 1 });
    }
  });

  it('uses original identities and schedules one short voice line per scene', () => {
    const brief = tpl.nodes.find((n: any) => n.id === 'brief').data.text as string;
    expect(brief).toMatch(/Captain Riko/);
    expect(brief).toMatch(/Scene 10:.*Required narrator words/s);
    expect(brief).not.toMatch(/Ronaldo|Messi|Neymar|IShowSpeed|Georgina|Roblox|Minecraft|LEGO/i);
  });

  it('keeps the image board silent and both scene Directors on timed cinematic audio', () => {
    const directors = tpl.nodes.filter((n: any) => n.type === 'story');
    const board = directors.find((n: any) => n.id === 'board_director');
    expect(board.data).toMatchObject({ audioMode: 'none', timedBeats: false });

    for (const director of directors.filter((n: any) => n.id !== 'board_director')) {
      expect(director.data).toMatchObject({
        cameraProgression: 'fixed', visualPreset: 'cgi3d', audioMode: 'cinematic', timedBeats: true,
      });
      expect(director.data.rules).toEqual(expect.arrayContaining(['fixedCamera', 'samePerson']));
    }
  });
});
