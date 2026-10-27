import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  portrait: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM10 18h4',
  landscape: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM5 15l4-4 4 4 3-3 3 3',
  motion: 'M4 5h6l4 7-4 7H4l4-7-4-7Zm10 0h4l4 7-4 7h-4',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  link: 'm10 13 4-4m-5-2 2-2a4 4 0 0 1 6 6l-2 2m-6-2-2 2a4 4 0 0 0 6 6l2-2',
  video: 'M3 5h13v14H3V5Zm13 5 5-3v10l-5-3',
  image: 'M3 3h18v18H3V3Zm0 13 6-6 5 5 3-3 4 4M15 7h.01',
  play: 'm8 4 12 8-12 8V4Z',
  check: 'm5 12 4 4L19 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 4v16M4 12h16',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  retry: 'M3 10a9 9 0 1 1 2 9M3 4v6h6',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 5 0 0 1 16 0v3',
  users: 'M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-1a6 4 0 0 1 12 0v1M15 5a3 3 0 0 1 0 6M18 14.5a5 4 0 0 1 3 4.5v1',
  place: 'M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13ZM9 9h6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  stop: 'M5 5h14v14H5V5Z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm6.5 11 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z',
  external: 'M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5v.01',
  alert: 'M12 9v4m0 4v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
  minimize: 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5',
};
export default function Icon({ name, style }: { name: string; style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] || paths.motion} /></svg>;
}
