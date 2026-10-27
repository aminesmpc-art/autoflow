/// <reference types="node" />
/* "Keep exact lip sync" (2026-10-19): a switch that tells Omni and the director
   to keep the mouths as in the video. Off by default; words only. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { configuration, defaults } from '../src/model';

const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');

test('off by default, and off keeps every saved configuration — and its paid job — as it was', () => {
  const data = defaults();
  expect(data.motionLipSync).toBe(false);
  expect(configuration({ ...data, motionLipSync: undefined })).toBe(configuration(data));
  expect(configuration({ ...data, motionLipSync: true })).not.toBe(configuration(data));
  expect(configuration({ ...data, motionLipSync: true })).toContain('lipsync-v1');
});

test('the panel has the switch beside Remove source audio, and explains the two together', () => {
  expect(app).toContain('<strong>Keep exact lip sync</strong>');
  expect(app).toContain('checked={data.motionLipSync === true} disabled={locked} onChange={e => patch({ motionLipSync: e.target.checked })}');
  expect(app.indexOf('Keep exact lip sync')).toBeLessThan(app.indexOf('Remove source audio'));
  expect(app).toMatch(/\{data\.motionLipSync && data\.motionMuteAudio && <p className="hint settings__note">/);
});
