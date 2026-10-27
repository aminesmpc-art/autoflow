import type { Edge, Node } from '@xyflow/react';
import type { MotionJob } from './billing';
import { motionWork, type MotionMode, type MotionPieceRow } from '../../studio-extension/src/studio/ask/motionControl';
import { motionRangeKey, trimProblem, type MotionRange } from '../../studio-extension/src/studio/ask/motionRange';
import { clearMotionOutput, continuityInput, continuityRetryThrough } from '../../studio-extension/src/studio/ask/motionContinuity';
import { replacementLimit, usableReplacements, type MotionReplacement, type MotionTarget } from '../../studio-extension/src/studio/ask/motionTargets';

export const MOTION_ID = 'motion-workspace';
export interface MotionData extends Record<string, unknown>, MotionRange {
  type: 'motion'; label: string; motionMode: MotionMode; platform: string;
  wish: string; motionPreset: string; motionMuteAudio: boolean; motionAlternatives: boolean;
  motionContinuity?: boolean;
  /** "Keep exact lip sync": Omni and the director are told to copy the mouths from the video. */
  motionLipSync?: boolean;
  aspectRatio?: '9:16' | '16:9';
  sourceKey: string; sourceName: string; sourceSize: number; sourceDuration: number;
  subjectImage: string; subjectName: string; placeImage: string; placeName: string;
  motionPieces: MotionPieceRow[]; status: string; statusNote?: string; errorMessage?: string;
  configurationAtRun?: string; motionUploaded?: boolean; motionPreparedFrom?: string;
  motionJob?: MotionJob;
  /** "Find people & items": what the analysis engine saw, and for which video/range. */
  motionTargetList?: MotionTarget[]; motionTargetsFor?: string;
  /** The chosen ones, each with its new image; used instead of subjectImage. */
  motionReplacements?: MotionReplacement[];
  /** The "Replace people & items" card: Replace subject driven by the list instead of one subject image. */
  motionReplaceMany?: boolean;
}

/** Whether the list of chosen people & items is what this project replaces. */
export const replacingMany = (data: MotionData) => data.motionMode === 'swap' && data.motionReplaceMany === true;

/** The video and range a scan has to match to still be valid. */
export const targetsKey = (data: MotionData) => `${data.sourceKey}|${motionRangeKey(data) || ''}`;
export const defaults = (): MotionData => ({
  type: 'motion', label: 'Untitled motion', motionMode: 'move', platform: 'gemini',
  wish: '', motionPreset: 'custom', motionMuteAudio: false, motionAlternatives: false,
  motionContinuity: false, motionLipSync: false, aspectRatio: '9:16',
  sourceKey: '', sourceName: '', sourceSize: 0, sourceDuration: 0,
  subjectImage: '', subjectName: '', placeImage: '', placeName: '', motionPieces: [], status: 'idle',
});

export function configuration(data: MotionData): string {
  const values = [data.sourceKey, data.motionMode, data.platform, data.wish, data.motionPreset,
    data.motionMuteAudio, data.motionAlternatives, data.subjectImage, data.placeImage];
  const range = motionRangeKey(data);
  if (range) values.push(range);
  if (data.motionContinuity) values.push('continuity-v1');
  /* Pushed only when on, so a project saved before the switch existed keeps
     the configuration — and the paid job — it already has. */
  if (data.motionLipSync) values.push('lipsync-v1');
  if (data.aspectRatio === '16:9') values.push('aspect:16:9');
  /* Which targets, with which images: a compact fingerprint rather than the
     images themselves, so the saved configuration stays small. */
  const replacements = replacingMany(data) ? usableReplacements(data.motionReplacements) : [];
  if (replacements.length) {
    values.push(`replace:${replacements.map(r => `${r.targetId}=${r.label}#${r.image ? `${r.image.length}:${r.image.slice(-48)}` : 'words'}${r.text ? `~${r.text}` : ''}`).join('|')}`);
  }
  return JSON.stringify(values);
}

export function graphFor(data: MotionData): { nodes: Node[]; edges: Edge[] } {
  /* Replacements belong to the "Replace people & items" card, which uses them
     instead of the subject image. Another card keeps them saved but unused. */
  const many = replacingMany(data);
  const nodes: Node[] = [{ id: MOTION_ID, type: 'motion', position: { x: 500, y: 0 },
    data: { ...data, ...(many ? {} : { motionReplacements: undefined }), enabled: true } }];
  const edges: Edge[] = [];
  for (const [id, image, port] of [['subject', many ? '' : data.subjectImage, 'image_ref'], ['place', data.placeImage, 'place_ref']]) {
    if (!image) continue;
    nodes.push({ id, type: 'image', position: { x: 0, y: port === 'image_ref' ? 0 : 400 }, data: { type: 'image', imageData: image } });
    edges.push({ id: `input-${id}`, source: id, target: MOTION_ID, sourceHandle: 'image', targetHandle: port });
  }
  return { nodes, edges };
}

export function preflight(data: MotionData, options: { sourceAvailable: boolean; uploadAllowed: boolean; retry: boolean; piece?: number }): string | null {
  if (data.aspectRatio && !['9:16', '16:9'].includes(data.aspectRatio)) return 'Choose Portrait 9:16 or Landscape 16:9 for the output format.';
  if (options.retry && data.configurationAtRun !== configuration(data)) return 'Settings or inputs changed. Start a new generation to apply them.';
  /* The same per-piece rules the runner resumes by (motionWork). A retry
     needs the video only if some piece still needs cutting, and the upload
     switch only if some piece still has to go into Flow — asking for either
     otherwise would refuse a retry for a step it is not going to run. */
  const prepared = options.retry && data.motionPreparedFrom === data.sourceKey && data.motionPieces.length > 0;
  const retryThrough = data.motionContinuity && options.piece ? continuityRetryThrough(data.motionPieces, options.piece) : options.piece;
  const scope = options.piece ? data.motionPieces.filter(p => p.index >= options.piece! && p.index <= retryThrough!).map(clearMotionOutput) : data.motionPieces;
  const work = motionWork({ onlyPiece: data.motionContinuity ? undefined : options.piece, legacyUploaded: data.motionUploaded === true });
  const muting = data.motionPieces.some(p => p.muteRequested && !p.audioMuted);
  const needsVideo = !prepared || scope.some(work.needsCut);
  const needsUpload = !prepared || scope.some(work.needsUpload) || muting;
  if (needsVideo && !options.sourceAvailable) return 'Add the source video before generating.';
  const rangeProblem = trimProblem(data.sourceDuration, data);
  if (rangeProblem) return rangeProblem;
  if (needsUpload && !options.uploadAllowed) return 'Enable video uploads below before generating.';
  if (muting && !options.sourceAvailable) return 'Add the original video again to remove audio from this piece.';
  const many = replacingMany(data);
  const replacing = many ? usableReplacements(data.motionReplacements) : [];
  if (data.motionMode === 'swap' && !many && !data.subjectImage) return 'Add a subject image for Replace subject.';
  if (many && !replacing.length) return 'Find people & items, then choose at least one to replace.';
  const images = replacing.filter(r => r.image).length;
  if (images) {
    const limit = replacementLimit(!!data.placeImage, data.motionContinuity === true);
    if (images > limit) return `Flow takes ${limit} replacement image(s) with these settings (5 images in all, counting the place image and the continuity frame). Remove ${images - limit}, or describe them in words instead.`;
  }
  if (data.motionMode === 'restyle' && !data.wish.trim()) return 'Describe the visual style you want.';
  if (!['gemini', 'chatgpt', 'claude'].includes(data.platform)) return 'Choose a supported analysis engine.';
  if (options.retry && options.piece && data.motionContinuity) {
    const row = data.motionPieces.find(p => p.index === options.piece);
    if (row) { try { continuityInput(data.motionPieces, row); } catch (error) { return String((error as Error).message); } }
  }
  return null;
}

export function recover(data: MotionData): MotionData {
  /* Projects from before the card existed kept their list under Replace subject. */
  const legacyMany = data.motionReplaceMany === undefined && data.motionMode === 'swap' && !!data.motionReplacements?.length;
  return { ...data, ...(legacyMany ? { motionReplaceMany: true } : {}), status: data.status === 'running' ? 'error' : data.status,
    statusNote: '', motionPieces: data.motionPieces.map(p => p.status === 'running'
      ? { ...p, status: 'error', errorMessage: 'Workspace closed during this piece. Check Flow before retrying.' } : p),
    ...(data.status === 'running' ? { errorMessage: 'This run was interrupted. Check Flow for an existing result before retrying.' } : {}),
  };
}
