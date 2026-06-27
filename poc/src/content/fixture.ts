/**
 * Generic throwaway fixture content for the PoC.
 *
 * Deliberately abstract & original — invented species/professions/traits whose
 * only job is to exercise the SYSTEMS. In the real engine this whole file becomes
 * a data-driven Universe Pack; here it is hand-authored TS for speed.
 */
import { Rng } from '../engine/rng';
import { DAYS_PER_YEAR } from '../engine/model';
import type { Sex, ResourceKey, ThoughtSpec } from '../engine/model';
import { type Geography, fertilityAt, elevationAt, moistureAt, seaDist } from '../engine/geography';

/**
 * How a species reproduces — SPECIES DATA the engine dispatches on, so the sim does
 * not bake in one humanoid-mammalian model. Three modes the PoC exercises:
 *   - sexual: two complementary sexes; only the `bearer` sex gestates; needs a mate.
 *   - hermaphroditic: one sex; any two may pair-bond and EITHER may bear.
 *   - asexual: an individual reproduces ALONE (budding/spawning); no mate, no bond.
 * (Polygamy is acknowledged via `monogamous` but not yet implemented — the social
 * tie is still a single spouse; that refactor is a separate step.)
 */
export type ReproductionMode = 'sexual' | 'hermaphroditic' | 'asexual';

export interface Reproduction {
  mode: ReproductionMode;
  /** the sexes an individual may be ('sexual' needs ≥2; others typically one). */
  sexes: string[];
  /** sex that gestates (sexual mode). undefined => any individual can bear. */
  bearer?: string;
  /** does breeding happen inside an exclusive pair-bond? (asexual = false). */
  pairBonds: boolean;
  /** pair-bond exclusivity. (PoC is always monogamous; flag reserved for polygamy.) */
  monogamous: boolean;
  /** per-bearer yearly chance to produce a child, in the focused settlement. */
  fecundity: number;
}

export interface Species {
  id: string;
  name: string;
  lifespan: number; // mean years
  /**
   * Life-stage ages, in years. These are SPECIES DATA, not engine constants: the
   * simulation reads adulthood/elderhood/fertility from here so a long-lived and a
   * short-lived species mature, reproduce, and age on their OWN schedules instead
   * of a single hardcoded human calendar. (A pack could add a non-aging machine
   * species with elderhood far above its lifespan, etc.)
   */
  maturity: number; // age one becomes an adult (can work, wed, be counted as adult)
  elderhood: number; // age one becomes an elder
  fertileFrom: number; // youngest age that can bear/sire
  fertileTo: number; // oldest age that can bear/sire
  reproduction: Reproduction;
  /** the culture id a settlement of this species leans toward (it may diverge). */
  defaultCulture: string;
  /** Syllable banks for a tiny phonetic name grammar (Warsim-style). */
  onset: string[];
  nucleus: string[];
  coda: string[];
}

export const SPECIES: Species[] = [
  {
    id: 'vael',
    name: 'Vael',
    lifespan: 95,
    maturity: 20,
    elderhood: 68,
    fertileFrom: 20,
    fertileTo: 58,
    // The Vael have no sexes: any two may join, and either may bear. Lower fecundity
    // than a sexual species since ANY two can pair, so more couples form.
    reproduction: { mode: 'hermaphroditic', sexes: ['vael'], pairBonds: true, monogamous: true, fecundity: 0.15 },
    defaultCulture: 'sylvan',
    onset: ['Ae', 'Sy', 'Th', 'El', 'Va', 'Ny', 'Lor', 'Cae'],
    nucleus: ['ri', 'la', 'we', 'no', 'ae', 'ly', 'sa'],
    coda: ['n', 'l', 'th', 'r', 's', 'ndor', 'wyn'],
  },
  {
    id: 'tamar',
    name: 'Tamar',
    lifespan: 72,
    maturity: 16,
    elderhood: 54,
    fertileFrom: 16,
    fertileTo: 46,
    // The Tamar are sexual: two sexes, only the bearer ('f') gestates, mates required.
    reproduction: { mode: 'sexual', sexes: ['m', 'f'], bearer: 'f', pairBonds: true, monogamous: true, fecundity: 0.21 },
    defaultCulture: 'artisan',
    onset: ['Bar', 'Hal', 'Dun', 'Ros', 'Mer', 'Gar', 'Wend', 'Tor'],
    nucleus: ['o', 'a', 'e', 'ic', 'um', 'ad'],
    coda: ['d', 'k', 'rin', 'son', 'wick', 'mund', 'ric'],
  },
  {
    id: 'grok',
    name: 'Grok',
    lifespan: 54,
    maturity: 13,
    elderhood: 40,
    fertileFrom: 13,
    fertileTo: 34,
    // The Grok spawn their own brood: asexual, no mate and no pair-bond needed.
    // Much lower fecundity since EVERY fertile adult bears (not just bonded couples).
    reproduction: { mode: 'asexual', sexes: ['grok'], pairBonds: false, monogamous: false, fecundity: 0.06 },
    defaultCulture: 'martial',
    onset: ['Gr', 'Mok', 'Zar', 'Ugg', 'Brak', 'Sno', 'Dru', 'Kaz'],
    nucleus: ['o', 'u', 'a', 'og', 'uk', 'ar'],
    coda: ['g', 'k', 'z', 'nak', 'tuk', 'rok', 'mash'],
  },
];

// --- Per-species life-stage accessors (the engine reads aging from species DATA) ---

/** Age at which a member of this species is an adult. */
export function maturityOf(speciesId: string): number {
  return speciesById(speciesId).maturity;
}
/** Age at which a member of this species becomes an elder. */
export function elderhoodOf(speciesId: string): number {
  return speciesById(speciesId).elderhood;
}
/** [youngest, oldest] age this species can reproduce. */
export function fertileWindowOf(speciesId: string): [number, number] {
  const s = speciesById(speciesId);
  return [s.fertileFrom, s.fertileTo];
}

export const FAMILY_ROOTS = [
  'Ash', 'Stone', 'Briar', 'Vale', 'Holt', 'Marsh', 'Fenn', 'Crow', 'Dunn',
  'Ironhand', 'Greycloak', 'Tallow', 'Hart', 'Weald', 'Thorn', 'Mire', 'Bram',
  'Oak', 'Hollow', 'Ridd', 'Garrow', 'Pike', 'Storr', 'Vane',
];

export interface Profession {
  id: string;
  income: number; // wealth produced per work action — the engine reads this generically
}

export const PROFESSIONS: Profession[] = [
  { id: 'farmer', income: 3 },
  { id: 'smith', income: 5 },
  { id: 'guard', income: 4 },
  { id: 'trader', income: 6 },
  { id: 'healer', income: 4 },
  { id: 'hunter', income: 4 },
];

export interface Trait {
  id: string;
  /**
   * Drive to seek power/standing (to rule a settlement). The engine reads this as
   * DATA — it never hardcodes which trait is "ambitious", so a pack can declare its
   * own ambitious traits (and to varying degrees) without touching engine code.
   */
  ambition: number;
}

export const TRAITS: Trait[] = [
  { id: 'kind', ambition: 0 },
  { id: 'proud', ambition: 1 },
  { id: 'hot-tempered', ambition: 0 },
  { id: 'loyal', ambition: 0 },
  { id: 'greedy', ambition: 0 },
  { id: 'curious', ambition: 0 },
  { id: 'devout', ambition: 0 },
  { id: 'cruel', ambition: 0 },
];

/** Wealth a profession yields per work action. Neutral fallback for unknown ids, so
 *  the engine never needs to know the pack's profession names. */
export function professionIncomeOf(id: string): number {
  return PROFESSIONS.find((p) => p.id === id)?.income ?? 3;
}

/** Summed ambition of an actor's traits — the urge to rule. Data-driven: ANY pack
 *  trait can contribute, not just one the engine knows by name. */
export function ambitionOf(traitIds: string[]): number {
  let sum = 0;
  for (const t of traitIds) sum += TRAITS.find((d) => d.id === t)?.ambition ?? 0;
  return sum;
}

/**
 * Trait affinity: how a pair of traits (one from each actor) nudges a social
 * interaction. Positive => they tend to get along; negative => they clash.
 * Only notable pairs listed; unlisted pairs are neutral (0).
 */
const TRAIT_AFFINITY: Record<string, number> = {
  'kind|kind': 2,
  'kind|cruel': -3,
  'kind|hot-tempered': -1,
  'loyal|loyal': 2,
  'loyal|kind': 1,
  'proud|proud': -2,
  'hot-tempered|hot-tempered': -3,
  'hot-tempered|proud': -2,
  'greedy|greedy': -2,
  'greedy|trader': 0,
  'cruel|cruel': -1,
  'cruel|loyal': -2,
  'devout|devout': 2,
  'devout|cruel': -2,
  'curious|curious': 1,
};

export function pairAffinity(traitsA: string[], traitsB: string[]): number {
  let sum = 0;
  for (const a of traitsA) {
    for (const b of traitsB) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      sum += TRAIT_AFFINITY[key] ?? 0;
    }
  }
  return sum;
}

// ----------------------------------------------------------- government ------
// How a polity's leadership transfers — SPECIES-agnostic DATA the engine dispatches
// on, so the simulation isn't hardwired to a single hereditary ruler. Succession
// modes the engine understands: hereditary (rule until death, then an heir/successor),
// elected (a leader serves a term, then a new one is chosen — no dynasty), and none
// (leaderless: a hive or free folk with no ruler at all).

export type SuccessionMode = 'hereditary' | 'elected' | 'none';

export interface Government {
  id: string;
  /** what the leader is called ('Lord', 'Speaker'…); empty for a leaderless polity. */
  title: string;
  succession: SuccessionMode;
  /** elected only: years a leader serves before a new one is chosen. */
  termYears?: number;
}

export const GOVERNMENTS: Government[] = [
  { id: 'monarchy', title: 'Lord', succession: 'hereditary' },
  { id: 'chiefdom', title: 'Chief', succession: 'hereditary' },
  { id: 'council', title: 'Speaker', succession: 'elected', termYears: 12 },
  { id: 'theocracy', title: 'High Priest', succession: 'elected', termYears: 20 },
  { id: 'freefolk', title: '', succession: 'none' },
];

export function governmentById(id: string): Government {
  return GOVERNMENTS.find((g) => g.id === id) ?? GOVERNMENTS[0];
}
export function pickGovernment(rng: Rng): string {
  return rng.pick(GOVERNMENTS).id;
}
export function successionOf(id: string): SuccessionMode {
  return governmentById(id).succession;
}
export function leaderTitleOf(id: string): string {
  return governmentById(id).title;
}
/** Does this government have a single leader at all (i.e. not leaderless)? */
export function hasLeader(id: string): boolean {
  return governmentById(id).succession !== 'none';
}
/** How long a fresh leader holds office before succession: a term (elected) or a
 *  natural reign until death (hereditary), expressed as a year span from `rng`. */
export function reignSpan(id: string, rng: Rng): number {
  const g = governmentById(id);
  return g.succession === 'elected' && g.termYears !== undefined ? g.termYears : rng.range(15, 45);
}

// ----------------------------------------------------------- culture ---------
// What a people HOLDS DEAR — a weighted profile over value axes (DF-style, −50..50).
// Two cultures' VALUE DISTANCE is what makes their settlements drift toward friendship
// or hostility, so wars have REASONS (opposed values) instead of dice. Culture is pack
// DATA, agnostic to species; each species merely has a DEFAULT its settlements lean to.

export const VALUES = ['honor', 'war', 'tradition', 'freedom', 'nature', 'craft'] as const;
export type ValueAxis = (typeof VALUES)[number];

export interface Culture {
  id: string;
  name: string;
  /** esteem (−50..50) for each value axis; omitted axes are 0 (indifferent). */
  values: Partial<Record<ValueAxis, number>>;
}

export const CULTURES: Culture[] = [
  { id: 'martial', name: 'the Iron Creed', values: { war: 40, honor: 30, tradition: 10, freedom: -10, nature: -20 } },
  { id: 'sylvan', name: 'the Green Way', values: { nature: 40, freedom: 25, craft: 10, war: -25, tradition: -10 } },
  { id: 'artisan', name: 'the Maker Folk', values: { craft: 40, tradition: 25, honor: 10, war: -15, freedom: -5 } },
  { id: 'free', name: 'the Free Companies', values: { freedom: 40, craft: 10, nature: 10, honor: -10, tradition: -25 } },
  { id: 'devout', name: 'the Old Faith', values: { tradition: 40, honor: 25, war: 5, nature: -5, freedom: -25 } },
];

export function cultureById(id: string): Culture {
  return CULTURES.find((c) => c.id === id) ?? CULTURES[0];
}

/** A settlement's culture is seeded from its species' default, but may diverge — so a
 *  people tends toward one creed while colonies and frontier towns drift to others. */
export function pickCulture(rng: Rng, speciesId: string): string {
  const def = speciesById(speciesId).defaultCulture;
  return rng.chance(0.7) ? def : CULTURES[rng.int(CULTURES.length)].id;
}

const valueOf = (c: Culture, axis: ValueAxis): number => c.values[axis] ?? 0;

/** Mean absolute difference across value axes (≈0 identical … ≈80 utterly opposed). */
export function culturalDistance(aId: string, bId: string): number {
  const a = cultureById(aId);
  const b = cultureById(bId);
  let sum = 0;
  for (const axis of VALUES) sum += Math.abs(valueOf(a, axis) - valueOf(b, axis));
  return sum / VALUES.length;
}

/** The value axis the two cultures disagree on most — the *reason* in a clash. */
export function mostOpposedValue(aId: string, bId: string): ValueAxis {
  const a = cultureById(aId);
  const b = cultureById(bId);
  let worst: ValueAxis = VALUES[0];
  let gap = -1;
  for (const axis of VALUES) {
    const d = Math.abs(valueOf(a, axis) - valueOf(b, axis));
    if (d > gap) {
      gap = d;
      worst = axis;
    }
  }
  return worst;
}

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id)!;
}

export function generateGiven(rng: Rng, speciesId: string): string {
  const sp = speciesById(speciesId);
  const parts = [rng.pick(sp.onset), rng.pick(sp.nucleus)];
  if (rng.chance(0.45)) parts.push(rng.pick(sp.nucleus));
  parts.push(rng.pick(sp.coda));
  return parts.join('');
}

export function generateFamily(rng: Rng): string {
  return rng.pick(FAMILY_ROOTS);
}

export function pickSex(rng: Rng, speciesId: string): Sex {
  const sexes = speciesById(speciesId).reproduction.sexes;
  // preserve the exact 2-sex coin-flip draw, so sexual species are byte-unchanged
  if (sexes.length === 2) return rng.chance(0.5) ? sexes[0] : sexes[1];
  if (sexes.length === 1) return sexes[0];
  return sexes[rng.int(sexes.length)];
}

// --- Reproduction accessors (the engine dispatches on species DATA, never on a
//     hardcoded 'm'/'f' or two-parent assumption) ---

/** Does this species form pair-bonds (marriages) to reproduce? Asexual ones don't. */
export function pairBondsFor(speciesId: string): boolean {
  return speciesById(speciesId).reproduction.pairBonds;
}
/** Does this species reproduce alone (no mate)? */
export function isAsexual(speciesId: string): boolean {
  return speciesById(speciesId).reproduction.mode === 'asexual';
}
/** Per-bearer yearly chance of a child. */
export function fecundityOf(speciesId: string): number {
  return speciesById(speciesId).reproduction.fecundity;
}
/** Can an individual of this species/sex gestate offspring? */
export function canBear(speciesId: string, sex: string): boolean {
  const r = speciesById(speciesId).reproduction;
  if (r.mode === 'sexual') return r.bearer === undefined || sex === r.bearer;
  return true; // hermaphroditic & asexual: any individual can bear
}
/**
 * Could A and B form a reproductively viable pair-bond (for courtship & weddings)?
 * Asexual species don't pair-bond to breed; a union needs at least one bearer; and
 * if EITHER party is strictly sexual the pairing must be different-sex.
 */
export function unionViable(spA: string, sexA: string, spB: string, sexB: string): boolean {
  const ra = speciesById(spA).reproduction;
  const rb = speciesById(spB).reproduction;
  if (!ra.pairBonds || !rb.pairBonds) return false;
  if (!canBear(spA, sexA) && !canBear(spB, sexB)) return false;
  if (ra.mode === 'sexual' || rb.mode === 'sexual') return sexA !== sexB;
  return true;
}

export function pickTraits(rng: Rng): string[] {
  const count = rng.range(1, 3);
  const pool = [...TRAITS];
  const out: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    out.push(pool.splice(rng.int(pool.length), 1)[0].id);
  }
  return out;
}

export function pickProfession(rng: Rng): string {
  return rng.pick(PROFESSIONS).id;
}

/** Founders skew toward working-age adults. */
export function pickFounderAge(rng: Rng): number {
  return rng.range(16, 55);
}

// ----------------------------------------------------------- economy ---------
// All per-capita-per-year. A settlement's specialization decides what it makes;
// everyone consumes the same basket, so specialists run surpluses & deficits that
// drive trade along the region graph.
//
// RESOURCES is the pack's resource VECTOR — the engine's economy operates over it
// generically (produce/consume/price/trade), so a sci-fi pack could swap in
// {energy, data, alloys}. Two resources carry an engine ROLE, named here so the
// engine never hardcodes 'food'/'goods': the SUBSISTENCE staple (its depletion
// causes famine) and the PREMIUM trade good (the main source of accrued wealth).

export const RESOURCES: string[] = ['food', 'materials', 'goods'];
export const SUBSISTENCE_RESOURCE = 'food'; // running out of this starves a settlement
export const PREMIUM_RESOURCE = 'goods'; // the high-value good whose production builds wealth

export const CONSUMPTION: Record<ResourceKey, number> = { food: 1.0, materials: 0.2, goods: 0.1 };

export const BASE_PRICE: Record<ResourceKey, number> = { food: 1, materials: 2, goods: 5 };

/**
 * Production is LOCATION-DEPENDENT — what a settlement makes comes from the LAND around
 * it, not a random roll. The terrain→resource mapping is PACK data (a sci-fi pack maps
 * its own terrain to its own resources): fertile soil & coasts → food (farms, fishing);
 * hills & forest → materials (ore, stone, timber); coasts & forest → trade goods.
 */
export function terrainYields(geo: Geography, x: number, y: number): Record<ResourceKey, number> {
  const fert = fertilityAt(geo, x, y);
  const elev = elevationAt(geo, x, y);
  const moist = moistureAt(geo, x, y);
  const coastal = seaDist(geo, x, y) <= 3;
  const forest = moist > 0.55 && elev > 0.42 && elev < 0.72;
  const hills = elev > 0.6;
  return {
    // food averages BELOW the per-capita demand, so poor/dry inland sites run a deficit
    // (famine-prone unless fed by trade) while fertile coasts run a thriving surplus.
    food: Math.max(0.2, 0.4 + fert * 1.2 + (coastal ? 0.34 : 0)),
    materials: Math.max(0.05, 0.12 + (hills ? (elev - 0.6) * 2.3 : 0) + (forest ? 0.55 : 0)),
    goods: Math.max(0.05, 0.1 + (coastal ? 0.55 : 0) + (forest ? 0.18 : 0) + fert * 0.1),
  };
}

/** A short label for what the land makes here (display only). */
export function specializationFromTerrain(geo: Geography, x: number, y: number): string {
  const elev = elevationAt(geo, x, y);
  const moist = moistureAt(geo, x, y);
  const fert = fertilityAt(geo, x, y);
  if (seaDist(geo, x, y) <= 3) return fert > 0.5 ? 'fishing & farms' : 'fishing & trade';
  if (elev > 0.66) return 'mining';
  if (moist > 0.55 && elev > 0.45) return 'forestry';
  if (fert > 0.5) return 'farming';
  return 'mixed';
}

// ---- relationships: what each kind of thought is worth ----
// How each kind of opinion-thought behaves (value, decay, stacking, inspector label).
// PACK DATA: a colder universe could weaken bonds and lengthen grudges, or add its own
// kinds. The engine's social systems emit the structural kinds below; opinion.ts reads
// these specs and never hardcodes a value.
export const THOUGHT_SPECS: Record<string, ThoughtSpec> = {
  bonded: { base: 30, durationTicks: 4 * DAYS_PER_YEAR, stackLimit: 25, mult: 0.95, label: 'spent good time together' },
  quarrelled: { base: -24, durationTicks: 3 * DAYS_PER_YEAR, stackLimit: 25, mult: 0.95, label: 'quarrelled' },
  kindness: { base: 90, durationTicks: 8 * DAYS_PER_YEAR, stackLimit: 6, mult: 0.88, label: 'a kindness' },
  slighted: { base: -85, durationTicks: 6 * DAYS_PER_YEAR, stackLimit: 6, mult: 0.88, label: 'a slight' },
  wed: { base: 650, stackLimit: 1, mult: 1, label: 'married' },
  griefShared: { base: 130, durationTicks: 4 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.8, label: 'shared a loss' },
};

// Neutral fallback so an unknown / pack-added kind without a spec never crashes the engine.
const NEUTRAL_THOUGHT: ThoughtSpec = { base: 0, stackLimit: 1, mult: 1, label: 'a feeling' };

export function thoughtSpec(kind: string): ThoughtSpec {
  return THOUGHT_SPECS[kind] ?? NEUTRAL_THOUGHT;
}

// ----------------------------------------------------------- needs -----------
// An actor's drives. NEEDS is the pack's need VECTOR (the engine stores & decays it
// generically); five of them carry an engine ROLE — named here so the engine reads
// needs by role, never by a literal id like 'food'. A pack could rename them (a
// machine's SUBSISTENCE_NEED might be 'power') or add inert flavour needs.

export const NEEDS: string[] = ['food', 'wealth', 'safety', 'esteem', 'belonging'];
export const SUBSISTENCE_NEED = 'food'; // metabolism drains it; work refills it; hunger drives survival
export const WEALTH_NEED = 'wealth'; // earned by work, bleeds as cost-of-living; want drives ambition
export const SOCIAL_NEED = 'belonging'; // loneliness erodes it; socializing rebuilds it
export const SAFETY_NEED = 'safety'; // drifts toward how stable the home settlement is
export const ESTEEM_NEED = 'esteem'; // drifts toward the actor's social standing
