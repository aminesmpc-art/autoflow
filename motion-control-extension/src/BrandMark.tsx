/**
 * The Motion mark: two chevrons, drawn with the toolbar icon's own geometry.
 *
 * Copied from scripts/make-icons.cjs — chevrons(12, 104), the 104px tile the
 * 128 master was designed on — so the mark in the panel header and the icon
 * in Chrome's toolbar are the same drawing. tests/package.test.ts regenerates
 * it from the script and fails if the two ever part.
 */
import { BRAND_CHEVRONS } from './brandGeometry';
export { BRAND_CHEVRONS } from './brandGeometry';
const JOIN = 3.224;

export default function BrandMark() {
  return <svg viewBox="12 12 104 104" aria-hidden="true">
    {BRAND_CHEVRONS.map((points) => <polygon key={points} points={points} fill="currentColor"
      stroke="currentColor" strokeWidth={JOIN} strokeLinejoin="round" />)}
  </svg>;
}
