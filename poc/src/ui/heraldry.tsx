/**
 * Procedural heraldry: every House gets a deterministic shield — field division,
 * two tinctures and a charge — derived purely from its id and name, so the same
 * House always bears the same arms in every panel (and every session). The forms
 * are deliberately abstract (stars, crescents, towers, chevrons…) so they read in
 * any universe; a pack could later supply its own emblem grammar.
 */

// a small, saturated-but-muted palette that sits well on the Atlas theme
const TINCTURES = [
  '#8c3f3f', // murrey
  '#3f5e8c', // azure
  '#3f7a55', // vert
  '#8c6f3a', // or (old gold)
  '#6b4f86', // purpure
  '#365f66', // teal
  '#7a4a2e', // tenné
  '#4a4f5c', // sable-steel
];
const METALS = ['#d9cfae', '#c9ced9']; // parchment-gold · silver-grey

/** Deterministic 32-bit hash of the House's identity. */
function hashHouse(id: number, name: string): number {
  let h = (id + 1) * 2654435761;
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) * 16777619;
    h |= 0;
  }
  return h >>> 0;
}

/** Charges — simple line-art forms drawn in the metal, centred on (0,0), ~radius 10. */
const CHARGES: ((metal: string) => string)[] = [
  // mullet (star)
  (m) => `<path d="M0-10 L2.6-3.4 L9.6-3.2 L4 1.4 L6 8.2 L0 4.2 L-6 8.2 L-4 1.4 L-9.6-3.2 L-2.6-3.4 Z" fill="${m}"/>`,
  // crescent
  (m) => `<path d="M-6.5-4 A8.4 8.4 0 1 0 6.5-4 A6.6 6.6 0 1 1 -6.5-4 Z" fill="${m}"/>`,
  // annulet (ring)
  (m) => `<circle r="7.4" fill="none" stroke="${m}" stroke-width="2.6"/>`,
  // tower
  (m) => `<path d="M-6-9 H-2.6 V-6.6 H-1 V-9 H1 V-6.6 H2.6 V-9 H6 V-3 H4 V9 H-4 V-3 H-6 Z" fill="${m}"/>`,
  // lozenge
  (m) => `<path d="M0-9.4 L6.6 0 L0 9.4 L-6.6 0 Z" fill="${m}"/>`,
  // cross
  (m) => `<path d="M-2.2-9.5 H2.2 V-2.2 H9.5 V2.2 H2.2 V9.5 H-2.2 V2.2 H-9.5 V-2.2 H-2.2 Z" fill="${m}"/>`,
  // chevronels (two chevrons)
  (m) => `<path d="M-8 1 L0-6.4 L8 1 L8 4.6 L0-2.8 L-8 4.6 Z M-8 6.4 L0-1 L8 6.4 L8 10 L0 2.6 L-8 10 Z" fill="${m}"/>`,
  // roundel trio
  (m) => `<g fill="${m}"><circle cx="0" cy="-5" r="3.1"/><circle cx="-5" cy="4" r="3.1"/><circle cx="5" cy="4" r="3.1"/></g>`,
  // pheon (arrowhead)
  (m) => `<path d="M0-9 L7 5 L0 1.6 L-7 5 Z" fill="${m}"/>`,
  // increscent pair (horns)
  (m) => `<path d="M-8-6 C-3-8 3-8 8-6 C4-3.4 -4-3.4 -8-6 Z M-8 6 C-3 8 3 8 8 6 C4 3.4 -4 3.4 -8 6 Z" fill="${m}"/>`,
];

/** The heater-shield outline every coat is drawn inside. */
const SHIELD_PATH = 'M-13-15 H13 V-2 C13 8 7 14 0 17 C-7 14 -13 8 -13-2 Z';

/** Build the inner SVG markup for a House's arms (deterministic; no React state). */
function armsMarkup(id: number, name: string): string {
  const h = hashHouse(id, name);
  const t1 = TINCTURES[h % TINCTURES.length];
  const t2 = TINCTURES[(h >>> 3) % TINCTURES.length];
  const metal = METALS[(h >>> 6) % METALS.length];
  const division = (h >>> 8) % 4; // plain | per pale | per fess | per bend
  const charge = CHARGES[(h >>> 11) % CHARGES.length];
  const field =
    division === 0
      ? `<path d="${SHIELD_PATH}" fill="${t1}"/>`
      : division === 1
        ? `<path d="${SHIELD_PATH}" fill="${t1}"/><path d="M0-15 H13 V-2 C13 8 7 14 0 17 Z" fill="${t2}"/>`
        : division === 2
          ? `<path d="${SHIELD_PATH}" fill="${t1}"/><path d="M-13 1 H13 V-2 C13 8 7 14 0 17 C-7 14 -13 8 -13-2 Z" fill="${t2}"/>`
          : `<path d="${SHIELD_PATH}" fill="${t1}"/><path d="M-13-15 L13 11 C9 14.5 4.5 16 0 17 C-7 14 -13 8 -13-2 Z" fill="${t2}"/>`;
  return `${field}<g>${charge(metal)}</g><path d="${SHIELD_PATH}" fill="none" stroke="rgba(10,11,15,0.65)" stroke-width="1.4"/>`;
}

/** A House's coat of arms, at any size. Same House ⇒ same shield, everywhere. */
export function HouseShield({ id, name, size = 22, className, title }: { id: number; name: string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`shield${className ? ` ${className}` : ''}`}
      viewBox="-15 -17 30 36"
      width={size}
      height={size * 1.2}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <g dangerouslySetInnerHTML={{ __html: armsMarkup(id, name) }} />
    </svg>
  );
}
