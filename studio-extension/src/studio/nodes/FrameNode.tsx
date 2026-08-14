/* ============================================================
   FrameNode — the last frame of a clip, made visible.

   Chaining clips already worked, but the handoff was invisible: one clip
   quietly passed its final frame to the next and you could only infer whether
   it had by watching the result. This node puts that frame on the canvas.

   Two things it buys:
   - You can see what the next clip actually starts from, so a chain that has
     drifted is obvious rather than mysterious.
   - The frame becomes reusable. It can feed any node, not only the one
     directly after it — branch a scene off the end of a clip, or send the same
     ending into two different continuations.
   ============================================================ */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lightbox } from '../components/Lightbox';
import { useStudioStore } from '../store';

function FrameNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as any;
  const removeNode = useStudioStore((s) => s.removeNode);
  const duplicateNode = useStudioStore((s) => s.duplicateNode);
  const [zoomed, setZoomed] = useState(false);

  const frame: string = nodeData.frameUrl || '';
  /* The runner writes frameUrl on every run, empty string included, so an
     empty string that EXISTS means the capture was attempted and came back
     with nothing. Undefined means it has never run. */
  const ranEmpty = !frame && typeof nodeData.frameUrl === 'string';

  return (
    <div className={`fn-wrap sn-wrap--kind-frame ${selected ? 'fn-wrap--selected' : ''}`}>
      <div className="sn-actions">
        <button className="sn-actions__btn" onClick={() => duplicateNode(id)} title="Duplicate node">⧉</button>
        <button className="sn-actions__btn sn-actions__btn--danger" onClick={() => removeNode(id)} title="Delete node">🗑</button>
      </div>

      <div className="sn-label">
        <span className="sn-label__icon" aria-hidden="true">🎞</span>
        <span className="sn-label__text">{nodeData.label || 'Last Frame'}</span>
      </div>

      <div className="fn">
        <div className="fn-media">
          {frame ? (
            <img
              className="fn-media__img"
              src={frame}
              alt="Final frame of the clip above"
              onClick={() => setZoomed(true)}
              title="Click to view full size"
            />
          ) : (
            <div className={`fn-empty ${ranEmpty ? 'fn-empty--missed' : ''}`}>
              <span className="fn-empty__icon">{ranEmpty ? '⚠' : '⇥'}</span>
              {/* "Nothing here" and "tried, got nothing" looked identical, so a
                  clip that ran and failed to give up its last frame was
                  indistinguishable from a node nobody had wired yet — while
                  every node downstream failed for a reason this box knew. */}
              <small>
                {ranEmpty
                  ? 'The clip above ran but gave up no last frame. Anything chained from '
                    + 'here has no reference — see Diagnostics in the side panel.'
                  : 'Connect a video node — its last frame appears here after it runs'}
              </small>
            </div>
          )}
        </div>

        {frame && (
          <div className="fn-caption">Hands this frame to whatever it feeds</div>
        )}

        {/* Takes a finished clip on the left, passes its ending on as an image,
            so downstream nodes treat it exactly like an uploaded reference. */}
        <Handle type="target" position={Position.Left} id="image_ref" className="sn-port sn-port--image" style={{ top: '50%' }}>
          <span className="sn-port__glyph">🎬</span>
        </Handle>
        <Handle type="source" position={Position.Right} id="image" className="sn-port sn-port--image" style={{ top: '50%' }}>
          <span className="sn-port__glyph">🖼</span>
        </Handle>
      </div>

      {zoomed && frame && (
        <Lightbox src={frame} kind="image" alt="Final frame of the clip" onClose={() => setZoomed(false)} />
      )}
    </div>
  );
}

export const FrameNode = memo(FrameNodeComponent);
