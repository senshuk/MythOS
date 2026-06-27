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
import { biomeOf } from './biomes';

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
  /** multiplier on the AGGREGATE (macro-tier) birth rate; default 1. A people that does
   *  not reproduce — a manufactured construct / android society — sets 0; a fast-breeding
   *  one sets >1. Lets a pack express populations the fixed human birth rate can't. */
  macroFertility?: number;
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
  /** how this trait shifts the person's VALUE profile away from their culture's baseline
   *  (per axis) — so a 'cruel' soul leans warlike, a 'gentle' one toward nature, giving
   *  every individual a distinct character that may even oppose their own people. */
  values?: Partial<Record<ValueAxis, number>>;
}

export const TRAITS: Trait[] = [
  { id: 'kind', ambition: 0, values: { honor: 12, war: -10, nature: 8 } },
  { id: 'proud', ambition: 1, values: { honor: 18, freedom: -6 } },
  { id: 'hot-tempered', ambition: 0, values: { war: 14, honor: -6 } },
  { id: 'loyal', ambition: 0, values: { tradition: 16, honor: 8 } },
  { id: 'greedy', ambition: 0, values: { craft: 12, honor: -12 } },
  { id: 'curious', ambition: 0, values: { freedom: 14, craft: 10, tradition: -10 } },
  { id: 'devout', ambition: 0, values: { tradition: 18, honor: 8 } },
  { id: 'cruel', ambition: 0, values: { war: 16, honor: -14, nature: -8 } },
  { id: 'gentle', ambition: 0, values: { nature: 16, war: -14, honor: 6 } },
  { id: 'bold', ambition: 1, values: { war: 12, freedom: 12 } },
  { id: 'wise', ambition: 0, values: { tradition: 10, craft: 12, war: -8 } },
  { id: 'restless', ambition: 0, values: { freedom: 18, tradition: -14 } },
  { id: 'stoic', ambition: 0, values: { honor: 12, freedom: -10 } },
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

// ------------------------------------------------------- personality ---------
// An INDIVIDUAL's values: their culture's baseline, bent by their traits, plus a
// personal deviation — so two souls of the same people still differ, and some drift
// far enough to oppose their own kin. The engine seeds `rng` per-actor (stable), then
// reads this profile to drive who bonds with whom and who reaches for power.

/** Build one actor's value profile from their culture + traits + a seeded deviation. */
export function valueProfile(cultureId: string, traitIds: string[], rng: Rng): Record<ValueAxis, number> {
  const base = cultureById(cultureId).values;
  const p = {} as Record<ValueAxis, number>;
  for (const axis of VALUES) {
    let v = base[axis] ?? 0;
    for (const t of traitIds) {
      const shift = TRAITS.find((d) => d.id === t)?.values?.[axis];
      if (shift !== undefined) v += shift;
    }
    v += rng.range(-22, 22);
    p[axis] = v < -100 ? -100 : v > 100 ? 100 : v;
  }
  return p;
}

/** How two value profiles relate: positive when like-minded, negative when opposed —
 *  fed into social affinity so kindred spirits bond and clashing worldviews grate. */
export function valueAlignment(a: Record<ValueAxis, number>, b: Record<ValueAxis, number>): number {
  let dist = 0;
  for (const axis of VALUES) dist += Math.abs((a[axis] ?? 0) - (b[axis] ?? 0));
  dist /= VALUES.length; // ~0 (identical) … ~120 (utterly opposed)
  return (32 - dist) / 11; // kindred ≈ +2 … opposed ≈ -8
}

/** The two strongest leanings in a profile, as universe-specific adjectives — the
 *  legible face of a personality the player reads in the inspector. */
const VALUE_WORDS: Record<ValueAxis, [string, string]> = {
  honor: ['honourable', 'dishonourable'],
  war: ['warlike', 'peaceable'],
  tradition: ['traditional', 'free-thinking'],
  freedom: ['freedom-loving', 'dutiful'],
  nature: ['wild at heart', 'worldly'],
  craft: ['industrious', 'unworldly'],
};
export function natureOf(p: Record<ValueAxis, number>): string {
  const ranked = VALUES.map((axis) => ({ axis, v: p[axis] ?? 0 })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const words = ranked
    .filter((r) => Math.abs(r.v) >= 25)
    .slice(0, 2)
    .map((r) => VALUE_WORDS[r.axis][r.v >= 0 ? 0 : 1]);
  return words.length ? words.join(', ') : 'even-tempered';
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
/** Multiplier on a settlement's AGGREGATE birth rate, from species data. Default 1 (an
 *  ordinary reproducing people); 0 = a population that does not breed at all. */
export function macroFertilityOf(speciesId: string): number {
  return speciesById(speciesId).reproduction.macroFertility ?? 1;
}
/** Does this species pair-bond EXCLUSIVELY (one spouse at a time)? false => polygamy. */
export function monogamousOf(speciesId: string): boolean {
  return speciesById(speciesId).reproduction.monogamous;
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
export function terrainYields(a: Record<string, number>): Record<ResourceKey, number> {
  // the BIOME sets the baseline (a grassland farms, a desert mines, a jungle is lush);
  // the SEA adds fishing, and fresh water lifts farming a touch. So what a place makes is
  // its climate, not just a fertility number — and a desert world really is harsh.
  const b = biomeOf(a);
  const coastal = (a.coast ?? 0) > 0.6;
  const fresh = a.freshWater ?? 0;
  return {
    food: Math.max(0.2, b.yields.food + (coastal ? 0.55 : 0) + fresh * 0.18),
    materials: Math.max(0.05, b.yields.materials),
    goods: Math.max(0.05, b.yields.goods + (coastal ? 0.5 : 0)),
  };
}

/** A short label for what a place makes (display only) — from its biome (+ fishing). */
export function specializationFromTerrain(a: Record<string, number>): string {
  if ((a.coast ?? 0) > 0.6) return `fishing & ${biomeOf(a).craft}`;
  return biomeOf(a).craft;
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
