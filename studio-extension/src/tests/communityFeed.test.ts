/// <reference types="node" />
/**
 * The community feed "like Facebook" (2026-10-25). Studio-only, posts are JSON
 * only (no videos or images stored), live at once, reported by readers.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { postableWorkflow, outlineOf, MAX_POST_BYTES } from '../studio/community/postable';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');

const NODES = [
  { id: 'i', type: 'image', position: { x: 0, y: 0 }, data: { type: 'image', label: 'Me', imageData: 'data:image/png;base64,AAAA' } },
  { id: 'g', type: 'generate', position: { x: 300.4, y: 0 }, data: {
    type: 'generate', label: 'Clip', platform: 'flow', mediaType: 'video', model: 'Omni 1.1 Flash',
    status: 'done', resultUrl: 'data:video/mp4;base64,BBBB', previewUrl: 'blob:abc', statusNote: 'Done', sentPrompt: 'x',
  } },
  { id: 'm', type: 'motion', position: { x: 600, y: 0 }, data: {
    type: 'motion', label: 'Motion', motionPieces: [{ videoUrl: 'https://flow/x' }], subjectImage: 'vault:wf:1|image/png',
  } },
];
const EDGES = [{ id: 'e1', source: 'i', target: 'g', animated: true }, { id: 'e2', source: 'g', target: 'm' }, { id: 'e3', source: 'g', target: 'gone' }];

describe('what a post carries', () => {
  it('drops everything a run left: results, notes, pieces, and every inline file', () => {
    const { template } = postableWorkflow('Swap', NODES, EDGES, { includePhotos: false });
    const raw = JSON.stringify(template);
    expect(raw).not.toMatch(/data:|blob:|vault:/);
    const clip = template.nodes[1].data;
    expect(clip.status).toBe('idle');
    expect(clip.model).toBe('Omni 1.1 Flash');
    expect(clip).not.toHaveProperty('resultUrl');
    expect(clip).not.toHaveProperty('statusNote');
    expect(template.nodes[2].data).not.toHaveProperty('motionPieces');
    expect(template.edges[0]).toEqual({ id: 'e1', source: 'i', target: 'g' });
  });

  it('counts the author\'s photos and leaves them out unless asked', () => {
    const off = postableWorkflow('Swap', NODES, EDGES, { includePhotos: false });
    expect(off.photos).toBe(1);
    expect(off.template.nodes[0].data.imageData).toBe('');
    const on = postableWorkflow('Swap', NODES, EDGES, { includePhotos: true });
    expect(on.template.nodes[0].data.imageData).toBe('data:image/png;base64,AAAA');
    /* A Motion subject photo is not an image node's picture: never posted. */
    expect(on.template.nodes[2].data.subjectImage).toBe('');
  });

  it('flags a workflow over the size the server accepts', () => {
    const huge = [{ ...NODES[0], data: { type: 'image', label: 'Big', imageData: `data:image/png;base64,${'A'.repeat(MAX_POST_BYTES)}` } }];
    expect(postableWorkflow('Big', huge, [], { includePhotos: true }).tooBig).toBe(true);
    expect(postableWorkflow('Big', huge, [], { includePhotos: false }).tooBig).toBe(false);
  });

  it('has the fields the server and the gallery need', () => {
    const { template } = postableWorkflow('  ', NODES, EDGES, { includePhotos: false, description: 'How to' });
    expect(template).toMatchObject({ name: 'Untitled', description: 'How to', category: 'Community', nodeCount: 3 });
    expect(template.id).toMatch(/^post_/);
  });
});

describe('the mini map outline', () => {
  it('matches the server: kinds, places, and only edges between known nodes', () => {
    const out = outlineOf(NODES, [...EDGES, EDGES[0]]);
    expect(out.nodes.map((n) => n.type)).toEqual(['image', 'generate', 'motion']);
    expect(out.nodes[1]).toMatchObject({ platform: 'flow', media: 'video', x: 300 });
    expect(out.edges).toEqual([[0, 1], [1, 2]]);
  });
});

describe('where the feed lives', () => {
  it('is Studio\'s For You home, with the posting handoff', () => {
    /* It was a Community tab until 2026-10-29; forYouFeed.test.ts has the rest. */
    const gallery = read('studio', 'components', 'TemplateGallery.tsx');
    expect(gallery).toMatch(/onClick=\{\(\) => setCategory\(FOR_YOU\)\}/);
    expect(gallery).toMatch(/<CommunityFeed onUse=\{loadTemplate\} pending=\{pendingPost\} onPendingTaken=\{takePending\} stepped \/>/);
    expect(gallery).toMatch(/'af_pending_post', 'af_open_community'/);
  });

  it('the canvas has Post, and the side panel hands its builder output to Studio\'s form', () => {
    expect(read('studio', 'components', 'Canvas.tsx')).toMatch(/<CanvasPostButton \/>/);
    const panel = read('sidepanel', 'index.ts');
    expect(panel).toMatch(/af_pending_post: \{ name: template\?\.name \|\| 'Untitled'/);
    expect(panel).not.toMatch(/submitCommunityTemplate\(template, who/);
  });

  it('posts go live at once and the feed says so', () => {
    expect(read('studio', 'community', 'PostComposer.tsx')).toMatch(/Everyone using AutoFlow Studio will see this post\./);
    expect(read('studio', 'community', 'CommunityFeed.tsx')).toMatch(/Report post/);
  });
});
