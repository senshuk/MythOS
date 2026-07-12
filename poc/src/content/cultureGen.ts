/**
 * Generate a world's CULTURE ROSTER — the creeds a seed's founding peoples carry — instead
 * of always the same 5. A pure function of `seed` alone (its own isolated RNG stream, see
 * engine/pack.ts's setCulturesForSeed): every downstream reader (precepts, religion, tongues,
 * toponymy) just asks CULTURES/DEITIES as before, unaware the roster is now generated.
 */
import { Rng, mixSeed } from '../engine/rng';
import { VALUES, type ValueAxis, type Culture, type Deity, type Precept, type StatePrecept } from './fixture';
import { deityName, pickAxisDescriptor } from './languages';

const NOUN_POOL = ['Creed', 'Way', 'Folk', 'Companies', 'Faith', 'Order', 'Circle', 'Covenant'];

// spans the hue wheel while staying legible on the dark "Atlas" map background; the first 5
// are the original hand-picked hues (kept for visual continuity where a roster reuses them).
const PALETTE = [
  '#e0685f', '#6cc08a', '#e0b25e', '#6fb6d6', '#b79be0',
  '#d68fc9', '#7fd6c4', '#d6a76f', '#8f9fd6', '#c9d68f',
  '#7fa8d6', '#c9909a', '#9ad68f', '#d6c17f',
];

// what a deity governs, in English, keyed by the culture's dominant axis — used for both the
// "sacred to: ... — {domain}" gloss and (via content/languages.deityName) is paired with the
// coined true name.
const AXIS_DOMAIN: Record<ValueAxis, string> = {
  war: 'war and honour',
  nature: 'growth and the living world',
  craft: 'craft and making',
  freedom: 'freedom and fortune',
  tradition: 'memory and tradition',
  honor: 'honour and renown',
};

// per-axis precept ARCHETYPES — the moral-rule shapes distilled from the 5 hand-authored
// cultures, one per possible dominant axis (deed kinds match content/fixture.ts's REPUTE_SPECS
// plus 'reconciliation'/'valor'). socialWeight is scaled per-culture by a small profile-driven
// jitter (see scalePrecepts) so magnitude varies without the SHAPE (what's sacred, what's
// tolerated) losing its coherence.
const AXIS_PRECEPTS: Record<ValueAxis, Precept[]> = {
  war: [
    { deed: 'bloodshed', socialWeight: 0.5 },
    { deed: 'violence', socialWeight: 0.35 },
    { deed: 'generosity', socialWeight: 0.9 },
    { deed: 'valor', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
  nature: [
    { deed: 'bloodshed', socialWeight: 2.4, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'violence', socialWeight: 1.8, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'generosity', socialWeight: 1.2, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'reconciliation', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'valor', witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
  craft: [
    { deed: 'bloodshed', socialWeight: 1.6, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'violence', socialWeight: 1.3, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'generosity', socialWeight: 1.2, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'reconciliation', witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
  freedom: [
    { deed: 'bloodshed', socialWeight: 0.7 },
    { deed: 'violence', socialWeight: 0.5 },
    { deed: 'generosity', socialWeight: 1.4, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'valor', witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
  tradition: [
    { deed: 'bloodshed', socialWeight: 2.8, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'violence', socialWeight: 1.4, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
    { deed: 'generosity', socialWeight: 1.5, sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'reconciliation', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'valor', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
  honor: [
    { deed: 'bloodshed', socialWeight: 1.1 },
    { deed: 'violence', socialWeight: 0.6 },
    { deed: 'generosity', socialWeight: 1.3, witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'reconciliation', witnessSelf: 'edified', commitSelf: 'righteous' },
    { deed: 'valor', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
  ],
};

// per-axis STATE precept (design/23 Stage 3) — the culture's judgement on a way of LIVING,
// reused verbatim from the 5 hand-authored cultures (war and honor share the warrior's-worth
// pair; the rest are 1:1 with the axis that originally drove them).
const AXIS_STATE_PRECEPTS: Record<ValueAxis, StatePrecept[]> = {
  war: [
    { id: 'renowned', self: 'at_peace', sacred: true, label: 'renown', holds: (s) => s.standing >= 220 },
    { id: 'nameless', self: 'disquiet', label: 'obscurity', holds: (s) => s.standing <= -180 },
  ],
  honor: [
    { id: 'renowned', self: 'at_peace', sacred: true, label: 'renown', holds: (s) => s.standing >= 220 },
    { id: 'nameless', self: 'disquiet', label: 'obscurity', holds: (s) => s.standing <= -180 },
  ],
  nature: [{ id: 'hoarding', self: 'disquiet', sacred: true, label: 'hoarding', holds: (s) => s.wealth >= 880 }],
  craft: [{ id: 'prosperous', self: 'at_peace', label: 'honest prosperity', holds: (s) => s.wealth >= 780 }],
  freedom: [{ id: 'beholden', self: 'disquiet', label: 'destitution', holds: (s) => s.wealth <= 130 }],
  tradition: [{ id: 'childless_elder', self: 'disquiet', sacred: true, label: 'a broken line', holds: (s) => s.isElder && s.children === 0 }],
};

function scalePrecepts(precepts: Precept[], factor: number): Precept[] {
  return precepts.map((p) => (p.socialWeight === undefined ? { ...p } : { ...p, socialWeight: Math.max(0.2, Math.min(3, p.socialWeight * factor)) }));
}

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Generate this world's founding creeds (3–6) — a pure function of `seed` alone, so a
 *  reloaded save regenerates the SAME roster it was created with (see engine/persistence.ts). */
export function generateCultures(seed: number): { cultures: Culture[]; deities: Deity[] } {
  const rng = new Rng(mixSeed(seed, 0xc07));
  const count = Math.min(VALUES.length, 3 + rng.int(4)); // 3..6 founding creeds
  const axes = shuffle(VALUES, rng).slice(0, count);
  const colors = shuffle(PALETTE, rng);
  const nouns = shuffle(NOUN_POOL, rng);

  const cultures: Culture[] = [];
  const deities: Deity[] = [];

  axes.forEach((dominant, i) => {
    const others = shuffle(
      VALUES.filter((a) => a !== dominant),
      rng,
    );
    const [secondary, opposedA, opposedB] = others;
    const values: Partial<Record<ValueAxis, number>> = {
      [dominant]: 30 + rng.int(15),
      [secondary]: 5 + rng.int(20),
      [opposedA]: -(5 + rng.int(20)),
      [opposedB]: -(5 + rng.int(20)),
    };

    const id = `c${i}`;
    const jitter = 0.85 + rng.next() * 0.3; // ±15% magnitude variety, without losing the shape
    const precepts = scalePrecepts(AXIS_PRECEPTS[dominant], jitter);
    const statePrecepts = AXIS_STATE_PRECEPTS[dominant].map((p) => ({ ...p }));

    const descriptor = pickAxisDescriptor(dominant, rng);
    const noun = nouns[i % nouns.length];
    const name = `the ${cap(descriptor.gloss)} ${noun}`;

    const deityId = `d${i}`;
    const domain = AXIS_DOMAIN[dominant];
    const { name: trueName } = deityName(seed, deityId, domain);

    cultures.push({
      id,
      name,
      color: colors[i % colors.length],
      patronDeityId: deityId,
      values,
      precepts,
      statePrecepts,
      dominantAxis: dominant,
    });
    deities.push({ id: deityId, name: trueName, domain });
  });

  return { cultures, deities };
}
