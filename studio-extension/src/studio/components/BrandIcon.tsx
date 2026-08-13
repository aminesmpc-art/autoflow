/**
 * The real marks of the platforms this extension drives.
 *
 * Separate from Icon.tsx on purpose. Those are ours: one grid, one stroke
 * weight, tinted with whatever the surface needs. These are not ours — they
 * are other companies' trademarks, each with its own geometry, viewBox and
 * colour, and normalising them into our stroke set would make them wrong.
 * A brand mark is either the mark or it is a drawing of the mark.
 *
 * So the geometry is not written here. It is generated from the actual files
 * in assets/brands/, which were downloaded from the vendors and from
 * Wikimedia Commons. Regenerate with scripts/brandMarks.py.
 *
 * `mono` draws a mark in currentColor, for rows where five saturated logos
 * would shout over the words next to them.
 */

import React from 'react';
import { BRAND_MARKS, type BrandName } from './brandMarks';

export type { BrandName };

interface Props {
  name: BrandName;
  className?: string;
  /** Draw in currentColor instead of the brand's own colour. */
  mono?: boolean;
  /** Give it a name for assistive tech. Decorative when the label is beside it. */
  title?: string;
}

export function BrandIcon({ name, className, mono, title }: Props) {
  const mark = BRAND_MARKS[name];
  if (!mark) return null;
  return (
    <svg
      className={className}
      viewBox={mark.viewBox}
      fill={mono ? 'currentColor' : mark.color}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      /* Build-time constants read off disk by the generator — no user or
         network input reaches this. */
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + mark.body }}
    />
  );
}
