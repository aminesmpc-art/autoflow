/**
 * The size a plain cut is scaled to so its shorter side fits `maxShortSide`,
 * or null when it already does. Never scales up. Even on both sides, because
 * H.264 at 4:2:0 will not encode an odd width or height.
 *
 * Its own file, without cut.ts's imports, so it can be tested without loading
 * a media library that only runs in a browser.
 */
export function shrinkToShortSide(
  width: number, height: number, maxShortSide: number,
): { width: number; height: number } | null {
  const short = Math.min(width, height);
  if (!(short > 0) || !(maxShortSide > 0) || short <= maxShortSide) return null;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const scale = maxShortSide / short;
  return { width: even(width * scale), height: even(height * scale) };
}
