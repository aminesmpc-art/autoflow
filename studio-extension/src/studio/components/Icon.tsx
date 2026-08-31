/**
 * The icon set.
 *
 * These were emoji. Emoji are not an icon set: they are font glyphs owned by
 * the platform, so they carry their own colour and cannot take the palette —
 * the rail's clapperboard and bolt stayed orange-yellow while every accent
 * around them went violet. They also change shape between Windows, macOS and
 * Android, so the one thing an icon set has to do — look like one set — is
 * the one thing emoji cannot do. They line up badly too, sitting on a text
 * baseline inside a flex row that wanted a centred box.
 *
 * So: one grid, one weight, one origin. Every icon is 24×24, drawn on the
 * same 1.75px stroke with round caps and joins, and inherits currentColor.
 * That last part is the point — the rail can now tint each icon with the node
 * family it adds (a prompt icon is --n-prompt green, an image icon is
 * --n-image blue), so the rail teaches the colour language the canvas uses,
 * instead of showing nine unrelated pictures.
 *
 * `play` is the only filled shape. It reads as a button rather than a
 * diagram, which is what it is.
 */

import React from 'react';

export type IconName =
  | 'prompt' | 'image' | 'clip' | 'bolt' | 'chat' | 'agent' | 'frame' | 'extend' | 'story'
  | 'play' | 'pause' | 'back' | 'upgrade' | 'import' | 'check' | 'alert' | 'dot';

/* Paths only. The wrapper owns size, stroke and colour so a new icon cannot
   quietly arrive at a different weight. */
const PATHS: Record<IconName, React.ReactNode> = {
  // A pencil: you write this one yourself.
  prompt: <><path d="M4 20l.9-4.2L15.6 5.1a2 2 0 0 1 2.9 0l.4.4a2 2 0 0 1 0 2.9L8.2 19.1 4 20z" /><path d="M14.5 6.5l3 3" /></>,
  // A still: frame, horizon, sun.
  image: <><rect x="3" y="5" width="18" height="14" rx="1.6" /><circle cx="8.5" cy="9.5" r="1.4" /><path d="M3.5 16.5l4.2-4a1.6 1.6 0 0 1 2.2 0l3.4 3.3M13.7 14.2l1.9-1.8a1.6 1.6 0 0 1 2.2 0l2.7 2.6" /></>,
  // A clapperboard: this one makes a clip.
  clip: <><path d="M3 9.6h18V19a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 19V9.6z" /><path d="M3.2 9.6l.9-3.8a1.2 1.2 0 0 1 1.4-.9l14.2 3a1.2 1.2 0 0 1 .9 1.4l-.1.3" /><path d="M8.8 5.2L7.4 9.4M14.2 6.3l-1.4 4.2" /></>,
  // Story / Director: script book / story flow
  story: <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5z" /><path d="M6 6h10M6 10h10M6 14h6" /></>,
  // Grok's mark is a bolt, and so is the speed of it.
  bolt: <path d="M13.2 2.8L5 13.6h5.6l-.8 7.6 8.2-10.8h-5.6l.8-7.6z" />,
  // Ask a chat model.
  chat: <path d="M20.5 11.8a7.7 7.7 0 0 1-11 7l-4.9 1.4 1.5-4.3a7.7 7.7 0 1 1 14.4-4.1z" />,
  // An agent runs on its own: a chip, not a face.
  agent: <><rect x="6.2" y="6.2" width="11.6" height="11.6" rx="2" /><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1" /><path d="M9.6 2.8v3.4M14.4 2.8v3.4M9.6 17.8v3.4M14.4 17.8v3.4M2.8 9.6h3.4M2.8 14.4h3.4M17.8 9.6h3.4M17.8 14.4h3.4" /></>,
  // Take the frame a clip ended on: crop marks around a play head.
  frame: <><path d="M4 7.6V5.4A1.4 1.4 0 0 1 5.4 4h2.2M16.4 4h2.2A1.4 1.4 0 0 1 20 5.4v2.2M20 16.4v2.2a1.4 1.4 0 0 1-1.4 1.4h-2.2M7.6 20H5.4A1.4 1.4 0 0 1 4 18.6v-2.2" /><path d="M10.2 9.4L15 12l-4.8 2.6z" /></>,
  // Keep going: the clip gets longer.
  extend: <><path d="M3 12h12.6M11.4 7.4L16 12l-4.6 4.6" /><path d="M20 5.2v13.6" /></>,
  play: <path d="M7.5 4.8L19 12 7.5 19.2z" fill="currentColor" stroke="none" />,
  pause: <><path d="M9 5v14M15 5v14" /></>,
  back: <><path d="M19.5 12H5M11 5.5L4.5 12l6.5 6.5" /></>,
  upgrade: <><path d="M12 19.5V5M5.8 11.2L12 5l6.2 6.2" /></>,
  import: <><path d="M12 3.5v10.8M7.8 10.2L12 14.4l4.2-4.2" /><path d="M4 16.6v2a1.4 1.4 0 0 0 1.4 1.4h13.2a1.4 1.4 0 0 0 1.4-1.4v-2" /></>,
  check: <path d="M4.5 12.6l4.9 4.9L19.6 7.2" />,
  alert: <><path d="M12 3.4l9.4 16.2H2.6L12 3.4z" /><path d="M12 9.6v4.6" /><path d="M12 17.4h.01" /></>,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
};

interface Props {
  name: IconName;
  /** Tints the icon with a node-family token. Rail and node headers use it. */
  kind?: 'prompt' | 'image' | 'video' | 'ask' | 'agent' | 'frame';
  className?: string;
  /** Decorative by default: the label beside it already says the word. */
  title?: string;
}

export function Icon({ name, kind, className, title }: Props) {
  return (
    <svg
      className={className}
      data-kind={kind}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
