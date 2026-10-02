import { readFileSync } from 'fs';
import { join } from 'path';

const node = readFileSync(join(__dirname, '../studio/nodes/MotionNode.tsx'), 'utf8');
const css = readFileSync(join(__dirname, '../studio/studio.css'), 'utf8');

describe('Motion Control presentation', () => {
  it('isolates previews from the absolute-positioned generic media class', () => {
    const preview = readFileSync(join(__dirname, '../studio/components/MotionPreview.tsx'), 'utf8');
    expect(node).not.toContain('sn-media__img');
    expect(preview).not.toContain('sn-media__img');
    expect(css).toMatch(/\.sn-motion__piece \.sn-motion__media\s*\{[^}]*position: static/);
    expect(preview).toContain('onError={() => setVideoFailed(true)}');
    expect(preview).toContain('onError={() => setPosterFailed(true)}');
    expect(preview).toContain('Reload preview');
    expect(preview).not.toContain('retry-node');
    expect(node).not.toContain('Too large to preview');
  });

  it('protects completed clips from accidental regeneration', () => {
    expect(node).toContain("window.confirm('Regenerate this completed clip?");
    expect(node).toContain("disabled={isRunning || p.status === 'running'}");
    expect(node).toContain('<summary>Review or edit prompt</summary>');
  });
  it('uses consistent motion and action icons', () => {
    for (const name of ['motion', 'copy', 'trash', 'retry']) {
      expect(node).toContain(`<Icon name="${name}"`);
    }
  });

  it('labels editable controls and keeps mode explanations associated', () => {
    expect(node).toContain('aria-label="Motion Control node name"');
    expect(node).toContain('aria-describedby={`motion-intent-${id}`}');
    expect(node).toContain('aria-label={`Prompt for piece ${p.index}`}');
    expect(node).toContain('<strong>Keeps</strong>');
    expect(node).toContain('<strong>Changes</strong>');
  });

  it('keeps the file input keyboard-accessible with a visible focus state', () => {
    expect(node).toContain('className={`sn-motion__upload nodrag');
    expect(node).toContain("aria-label={d.sourceName ? 'Replace source video' : 'Choose source video'}");
    expect(css).toContain('.sn-motion__upload:focus-within');
    expect(css).toMatch(/\.sn-motion__upload input\s*\{[^}]*opacity: 0/);
    expect(css).not.toMatch(/\.sn-motion__upload input\s*\{[^}]*display: none/);
  });

  it('preserves the workflow ports and handlers', () => {
    for (const port of ['text', 'video', 'image_ref']) expect(node).toContain(`id="${port}"`);
    expect(node).toContain('onFile(e.target.files?.[0] ?? null)');
    expect(node).toContain('retryPiece(p.index)');
    expect(node).toContain('allowUploads()');
  });
});
