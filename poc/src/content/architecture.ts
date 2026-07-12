/**
 * The PACK's ARCHITECTURAL styles — DATA (design/28 §3). Each culture builds in its own
 * materials and silhouette, so a town of one people never shares a roofline with another's:
 * timber-and-thatch, stone-and-slate, flat-roofed adobe, conical wattle, dark shingle. The
 * ENGINE knows nothing of this; a sci-fi pack would swap these for domes, habs and crystal.
 *
 * A style is assigned deterministically per CULTURE (not per town), so every settlement of a
 * people reads the same and different peoples read apart — reinforcing "every culture is
 * different". The renderers (2D plan glyph, 3D fly-in) read the style to colour walls/roofs,
 * shape the roof, and add a chimney; wealth adds variety on top (grander homes, richer roofs).
 */

/** the ROOF a people raises — a pitched gable, a flat clay roof, or a conical thatch. */
export type RoofShape = 'gable' | 'flat' | 'conical';

export interface ArchStyle {
  id: string;
  /** a legible name, in the pack's voice — surfaced on hover ("built in timber and thatch"). */
  name: string;
  wall: [number, number, number]; // 0..1 RGB — daub, stone, adobe…
  roof: [number, number, number]; // 0..1 RGB — thatch, slate, clay…
  roofShape: RoofShape;
  /** does this people raise chimneys? (a hearth cue; flat/conical roofs often vent otherwise) */
  chimney: boolean;
}

export const ARCH_STYLES: ArchStyle[] = [
  { id: 'timber', name: 'timber and thatch', wall: [0.58, 0.46, 0.32], roof: [0.60, 0.47, 0.26], roofShape: 'gable', chimney: true },
  { id: 'stone', name: 'stone and slate', wall: [0.60, 0.59, 0.55], roof: [0.34, 0.37, 0.42], roofShape: 'gable', chimney: true },
  { id: 'adobe', name: 'adobe with flat clay roofs', wall: [0.77, 0.64, 0.47], roof: [0.70, 0.58, 0.42], roofShape: 'flat', chimney: false },
  { id: 'conical', name: 'wattle under conical thatch', wall: [0.68, 0.60, 0.46], roof: [0.56, 0.43, 0.24], roofShape: 'conical', chimney: false },
  { id: 'shingle', name: 'dark timber and shingle', wall: [0.44, 0.37, 0.30], roof: [0.43, 0.43, 0.41], roofShape: 'gable', chimney: true },
];

export const ARCH_BY_ID: Record<string, ArchStyle> = Object.fromEntries(ARCH_STYLES.map((s) => [s.id, s]));

/** FNV-1a over the cultureId — a stable per-culture pick (local copy so this pack module is
 *  self-contained; mirrors localmap's strHash so styles are deterministic across a world). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** the architectural style a CULTURE builds in — deterministic, so all its towns match and
 *  a foreign people's town reads apart at a glance (design/28 §3). */
export function archStyleFor(cultureId: string): ArchStyle {
  return ARCH_STYLES[hash(cultureId || 'default') % ARCH_STYLES.length];
}
