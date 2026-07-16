/**
 * Generic throwaway fixture content for the PoC.
 *
 * Deliberately abstract & original — invented species/professions/traits whose
 * only job is to exercise the SYSTEMS. In the real engine this whole file becomes
 * a data-driven Universe Pack; here it is hand-authored TS for speed.
 */
import { Rng } from '../engine/rng';
import { DAYS_PER_YEAR } from '../engine/model';
import type { Sex, ResourceKey, ThoughtSpec, ReputeSpec, PerceptionFact, Worldview, IntentDef, ActionDef, InteractionDef, World, Settlement, Organization, Rules } from '../engine/model';
import { biomeOf } from './biomes';

// ------------------------------------------------------------ identity -------
/** This universe's identity — stamped into every save, so a world is only ever loaded
 *  under the pack that built it (a Tolkien save must not open under a sci-fi pack). */
export const PACK_ID: string = 'fantasy'; // typed wide — every pack supplies its OWN id
/** Bumped when this pack's DATA changes shape enough that old saves need care. */
export const PACK_VERSION: number = 1;
/** Which OPTIONAL engine systems this universe runs (CLAUDE.md: packs choose modules).
 *  Core systems — lifecycle, economy, organizations, the director — always run; these
 *  gate the genre-flavoured layers a universe may not want (a secular sci-fi pack turns
 *  religion off; a static-world pack turns vehicle travel off). */
export const MODULES = {
  religion: true, // faith bonds & friction, conversion/apostasy, state precepts
  factions: true, // creed factionalism: splits, civil wars, exile & return
  travel: true, // vehicle transit (mobile locations move with duration)
};

/** This universe's starting Rules — what reality permits at world creation. A fresh
 *  world's `world.rules` is seeded from this; it changes thereafter only via an Age's
 *  epoch-transition (engine/age.ts), never by editing this constant mid-simulation. */
export const RULES: Rules = {
  succession: { claimsEnabled: true }, // the Age of Claimants: a peaceful bid for a seat is legitimate
};

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
  /** the mutually-exclusive FAMILY this trait belongs to — pickTraits draws at most one
   *  trait per spectrum, so no soul is both 'kind' and 'cruel', and combinations stay
   *  coherent while remaining hugely varied. */
  spectrum: string;
  /**
   * Drive to seek power/standing (to rule a settlement). The engine reads this as
   * DATA — it never hardcodes which trait is "ambitious", so a pack can declare its
   * own ambitious traits (and to varying degrees) without touching engine code. Default 0.
   */
  ambition?: number;
  /** how this trait bends the person's cultural VALUE profile (per axis) — so a 'cruel'
   *  soul leans warlike, a 'gentle' one toward nature; a person can even oppose their kin. */
  values?: Partial<Record<ValueAxis, number>>;
  /** how this trait sets the person's individual TEMPERAMENT (per axis) — disposition that
   *  owes nothing to culture, so two devout farmers still differ in nerve, warmth, drive. */
  temperament?: Partial<Record<TemperamentAxis, number>>;
}

// Traits are organised into SPECTRA — mutually-exclusive families. An actor gets at most
// one trait from each, so personalities are coherent (never kind AND cruel) yet vary across
// many independent facets. Each trait bends VALUES (what they care about) and/or TEMPERAMENT
// (how they behave). Degrees within a spectrum give intensity (hot-tempered vs volcanic).
export const TRAITS: Trait[] = [
  // — temper: how readily they flare —
  { id: 'serene', spectrum: 'temper', values: { war: -5 }, temperament: { temper: -50 } },
  { id: 'hot-tempered', spectrum: 'temper', values: { war: 14, honor: -6 }, temperament: { temper: 48 } },
  { id: 'volcanic', spectrum: 'temper', values: { war: 22, honor: -12 }, temperament: { temper: 82 } },
  // — warmth: how they treat others —
  { id: 'cruel', spectrum: 'warmth', values: { war: 16, honor: -14, nature: -8 }, temperament: { warmth: -58 } },
  { id: 'cold', spectrum: 'warmth', temperament: { warmth: -42 } },
  { id: 'kind', spectrum: 'warmth', values: { honor: 12, war: -10, nature: 8 }, temperament: { warmth: 46 } },
  { id: 'gentle', spectrum: 'warmth', values: { nature: 16, war: -14, honor: 6 }, temperament: { warmth: 38 } },
  // — drive: appetite for work —
  { id: 'lazy', spectrum: 'drive', temperament: { drive: -48 } },
  { id: 'diligent', spectrum: 'drive', values: { craft: 12 }, temperament: { drive: 44 } },
  { id: 'driven', spectrum: 'drive', ambition: 1, values: { craft: 10 }, temperament: { drive: 72 } },
  // — bravery: nerve in the face of danger —
  { id: 'meek', spectrum: 'bravery', values: { war: -6 }, temperament: { boldness: -48 } },
  { id: 'bold', spectrum: 'bravery', ambition: 1, values: { war: 12, freedom: 12 }, temperament: { boldness: 52 } },
  { id: 'fearless', spectrum: 'bravery', values: { war: 10 }, temperament: { boldness: 82 } },
  // — honesty: how straight they deal —
  { id: 'honest', spectrum: 'honesty', values: { honor: 15 }, temperament: { warmth: 6 } },
  { id: 'greedy', spectrum: 'honesty', values: { craft: 12, honor: -12 }, temperament: { warmth: -6 } },
  { id: 'scheming', spectrum: 'honesty', values: { honor: -16 }, temperament: { warmth: -8, curiosity: 10 } },
  // — faith: stance toward the old ways —
  { id: 'devout', spectrum: 'faith', values: { tradition: 18, honor: 8 } },
  { id: 'skeptic', spectrum: 'faith', values: { tradition: -16 }, temperament: { curiosity: 14 } },
  // — mind: hunger to know —
  { id: 'incurious', spectrum: 'mind', values: { tradition: 8 }, temperament: { curiosity: -34 } },
  { id: 'curious', spectrum: 'mind', values: { freedom: 14, craft: 10, tradition: -10 }, temperament: { curiosity: 42 } },
  { id: 'wise', spectrum: 'mind', values: { tradition: 10, craft: 12, war: -8 }, temperament: { curiosity: 18, temper: -16 } },
  // — spirit: where their allegiance bends —
  { id: 'loyal', spectrum: 'spirit', values: { tradition: 16, honor: 8 }, temperament: { sociability: 8 } },
  { id: 'proud', spectrum: 'spirit', ambition: 1, values: { honor: 18, freedom: -6 }, temperament: { sociability: -6 } },
  { id: 'restless', spectrum: 'spirit', values: { freedom: 18, tradition: -14 }, temperament: { drive: 8 } },
  { id: 'stoic', spectrum: 'spirit', values: { honor: 12, freedom: -10 }, temperament: { temper: -22 } },
  // — social: appetite for company —
  { id: 'shy', spectrum: 'social', temperament: { sociability: -48 } },
  { id: 'gregarious', spectrum: 'social', temperament: { sociability: 50, warmth: 10 } },
];

/** The mutually-exclusive trait families, in declaration order (deterministic). */
export const TRAIT_SPECTRA: string[] = [...new Set(TRAITS.map((t) => t.spectrum))];

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

/** The engine-level CATEGORY this pack files political organizations under. The engine
 *  treats Organization.category as an open string; this keeps the category PACK DATA. */
export const ORG_CATEGORY_POLITICAL = 'political';

/** Display label for the POLITY a settlement of each government kind hosts — pack data, so
 *  a sci-fi pack reads the same governments as 'Federation'/'Collective'. Keyed by
 *  government id; leaderless 'freefolk' hosts no polity, so it is absent. */
export const POLITY_LABELS: Record<string, string> = {
  monarchy: 'Kingdom',
  chiefdom: 'Tribe',
  council: 'Republic',
  theocracy: 'Holy Order',
};

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

// TEMPERAMENT is the OTHER half of personality: how a soul behaves, independent of what
// their culture taught them to value. Two devout farmers share values yet one is a bold,
// hot-blooded loner and the other a warm, idle gossip. These axes are universal (they fit
// elves or a starship crew alike) and purely individual — culture does NOT set them.
export const TEMPERAMENTS = ['boldness', 'temper', 'warmth', 'drive', 'sociability', 'curiosity'] as const;
export type TemperamentAxis = (typeof TEMPERAMENTS)[number];

/** A whole personality: cultural VALUES (what they care about) + individual TEMPERAMENT
 *  (how they behave). Built once at birth (see world.createActor) and read everywhere. */
export interface Personality {
  values: Record<ValueAxis, number>;
  temperament: Record<TemperamentAxis, number>;
}

// ------------------------------------------------------------- religion -------
// Each culture is organised around a PATRON DEITY — the divine source whose
// domain mirrors the culture's highest value. Deities are pack data and engine-
// agnostic; the engine only cares about ids. A pack may add, rename, or remove
// deities without touching a single line of engine code.

export interface Deity {
  id: string;
  name: string; // display: 'the Rootmother', 'the Iron Father' …
  domain: string; // what they govern: 'growth and the living world' …
}

export let DEITIES: Deity[] = [
  { id: 'iron_father', name: 'the Iron Father', domain: 'war and honour' },
  { id: 'rootmother', name: 'the Rootmother', domain: 'growth and the living world' },
  { id: 'forge_spirit', name: 'the Forge Spirit', domain: 'craft and making' },
  { id: 'windwalker', name: 'the Windwalker', domain: 'freedom and fortune' },
  { id: 'ancestors', name: 'the Ancestors', domain: 'memory and tradition' },
];

export function deityById(id: string): Deity {
  return DEITIES.find((d) => d.id === id) ?? DEITIES[0];
}

// -----------------------------------------------------------------------------

/**
 * A PRECEPT — a creed's moral rule about a kind of deed (design/23, the RimWorld
 * Ideoligion lesson). It subsumes the old `ethics` multiplier: `socialWeight` still
 * scales standing damage and witness-opinion (so perception is unchanged), but a precept
 * ALSO carries the conscience — the SELF-thoughts a witness (`witnessSelf`) or the doer
 * (`commitSelf`) feels, which feed MOOD (engine/mood.ts). `sacred` precepts are felt only
 * by the faithful; civic ones by everyone of the culture. Pure PACK DATA.
 */
export interface Precept {
  deed: string; // a REPUTE_SPECS kind ('bloodshed' / 'violence' / 'generosity' / …)
  /** severity multiplier for standing & witness-opinion (>1 abhorred, <1 tolerated). The
   *  old `ethics` value verbatim — omit ⇒ 1.0 (neutral). One source of truth for ethics. */
  socialWeight?: number;
  /** felt only by adherents (world.faith = the culture's patron); civic (default) by all. */
  sacred?: boolean;
  /** the self-thought (SELF_THOUGHT_SPECS kind) an OBSERVER of this deed feels — its
   *  magnitude comes from the spec, so per-culture data stays a single word. → mood. */
  witnessSelf?: string;
  /** the DOER's conscience: the self-thought committing this deed lays on them. → mood. */
  commitSelf?: string;
}

/**
 * A snapshot of how an actor is LIVING — the pure primitives a state precept judges. The
 * engine gathers it (importing the standing reducer etc.); the pack's `holds` predicate is
 * pure over these, so pack data never imports an engine module (the INTENT_DEFS pattern).
 */
export interface ActorLifeState {
  wealth: number; // WEALTH_NEED satisfaction (0 destitute … 1000 wealthy)
  standing: number; // public renown (− notorious … + renowned)
  ageYears: number;
  children: number;
  wed: boolean;
  isElder: boolean;
}

/**
 * A STATE PRECEPT — the creed's judgement on a way of LIVING (design/23 Stage 3), as
 * opposed to a single deed. Evaluated yearly; while `holds`, it lays an ongoing self-thought
 * (`self`) on the actor's mood. `sacred` ones weigh only on the faithful. This is how a
 * warrior takes quiet pride in their renown, or a childless devout elder carries a disquiet.
 */
export interface StatePrecept {
  id: string;
  self: string; // SELF_THOUGHT_SPECS kind emitted while the state holds (at_peace / disquiet)
  sacred?: boolean;
  /** a short noun phrase for the UI ('renown', 'hoarding', 'a broken line'). */
  label: string;
  holds: (s: ActorLifeState) => boolean;
}

export interface Culture {
  id: string;
  name: string;
  /** the culture's map/legend colour — presentation, but PACK data (a universe knows
   *  its factions' banners; the engine and UI stay colour-blind). */
  color: string;
  /** The deity whose domain mirrors this culture's highest value. */
  patronDeityId: string;
  /** esteem (−50..50) for each value axis; omitted axes are 0 (indifferent). */
  values: Partial<Record<ValueAxis, number>>;
  /** the creed's moral rules — what it abhors and reveres, and how those deeds land on
   *  a witness's and a doer's conscience. Subsumes the old `ethics` map (design/23). */
  precepts?: Precept[];
  /** the creed's judgement on ways of LIVING (design/23 Stage 3) — evaluated yearly. */
  statePrecepts?: StatePrecept[];
  /** the value axis this culture is BUILT around (content/cultureGen.ts stamps this on every
   *  generated culture); content/languages.ts derives a culture's voice, kinship and toponym
   *  descriptors from it instead of switching on a fixed id. Absent on the static fallback
   *  roster below (it's never actually used once a world generates its own). */
  dominantAxis?: ValueAxis;
}

// The static roster below is the pack's COLD-START DEFAULT — the value `CULTURES`/`DEITIES`
// hold before any world exists. Every real `createWorld` call (engine/sim.ts) overwrites both
// via `setCultures` with a roster generated fresh per seed (content/cultureGen.ts) — a world's
// creeds are no longer always these same 5. Kept as a fallback so the pack has SOMETHING
// coherent bound at module load (tests that import fixture.ts directly, tooling, etc).
export let CULTURES: Culture[] = [
  {
    id: 'martial', name: 'the Iron Creed', color: '#e0685f',
    patronDeityId: 'iron_father',
    values: { war: 40, honor: 30, tradition: 10, freedom: -10, nature: -20 },
    // warriors: killing in conflict is expected — bloodshed barely stings standing and
    // pricks no conscience; brawling is normal; giving is fine but not a sacred virtue.
    // Their SACRED virtue is VALOR — courage before the Iron Father stirs every warrior's
    // heart; they are unmoved by peacemaking (a fight left unfinished).
    precepts: [
      { deed: 'bloodshed', socialWeight: 0.5 },
      { deed: 'violence', socialWeight: 0.35 },
      { deed: 'generosity', socialWeight: 0.9 },
      { deed: 'valor', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
    ],
    // a warrior's worth is their NAME: high renown is a quiet, sacred pride; to be scorned
    // and nameless is a warrior's disquiet. (This is how the Iron Creed's spare conscience
    // still touches its souls — through the standing they live and die by.)
    statePrecepts: [
      { id: 'renowned', self: 'at_peace', sacred: true, label: 'renown', holds: (s) => s.standing >= 220 },
      { id: 'nameless', self: 'disquiet', label: 'obscurity', holds: (s) => s.standing <= -180 },
    ],
  },
  {
    id: 'sylvan', name: 'the Green Way', color: '#6cc08a',
    patronDeityId: 'rootmother',
    values: { nature: 40, freedom: 25, craft: 10, war: -25, tradition: -10 },
    // peace-keepers: killing PROFANES the living world (sacred outrage; the killer is
    // wracked); even brawling draws wide civic censure; giving edifies the community; and
    // laying down a feud — PEACEMAKING — is their SACRED virtue, the healing of a rift.
    precepts: [
      { deed: 'bloodshed', socialWeight: 2.4, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'violence', socialWeight: 1.8, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'generosity', socialWeight: 1.2, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'reconciliation', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'valor', witnessSelf: 'edified', commitSelf: 'righteous' }, // civic — courage that shields life
    ],
    // a communal creed: to sit on great personal wealth while the grove is shared is a
    // sacred unease (hoarding offends the Green Way).
    statePrecepts: [{ id: 'hoarding', self: 'disquiet', sacred: true, label: 'hoarding', holds: (s) => s.wealth >= 880 }],
  },
  {
    id: 'artisan', name: 'the Maker Folk', color: '#e0b25e',
    patronDeityId: 'forge_spirit',
    values: { craft: 40, tradition: 25, honor: 10, war: -15, freedom: -5 },
    // civic builders: violence disrupts ORDER (civic wrong, not divine — felt by all,
    // faithful or not); generosity oils the trade network and earns quiet pride; a feud
    // healed restores the order they prize (civic virtue).
    precepts: [
      { deed: 'bloodshed', socialWeight: 1.6, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'violence', socialWeight: 1.3, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'generosity', socialWeight: 1.2, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'reconciliation', witnessSelf: 'edified', commitSelf: 'righteous' },
    ],
    // makers at peace with the fruits of their craft: an honest prosperity is a quiet
    // contentment (civic — the well-built life the Maker Folk prize).
    statePrecepts: [{ id: 'prosperous', self: 'at_peace', label: 'honest prosperity', holds: (s) => s.wealth >= 780 }],
  },
  {
    id: 'free', name: 'the Free Companies', color: '#6fb6d6',
    patronDeityId: 'windwalker',
    values: { freedom: 40, craft: 10, nature: 10, honor: -10, tradition: -25 },
    // mercenaries: pragmatic about violence (no conscience toll); generosity is rare and
    // genuinely admired in a world where you keep what you can; and raw courage against a
    // beast wins a free companion's respect (civic virtue).
    precepts: [
      { deed: 'bloodshed', socialWeight: 0.7 },
      { deed: 'violence', socialWeight: 0.5 },
      { deed: 'generosity', socialWeight: 1.4, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'valor', witnessSelf: 'edified', commitSelf: 'righteous' },
    ],
    // free folk prize self-reliance: to be destitute is to have lost your independence —
    // a quiet civic shame among the companies.
    statePrecepts: [{ id: 'beholden', self: 'disquiet', label: 'destitution', holds: (s) => s.wealth <= 130 }],
  },
  {
    id: 'devout', name: 'the Old Faith', color: '#b79be0',
    patronDeityId: 'ancestors',
    values: { tradition: 40, honor: 25, war: 5, nature: -5, freedom: -25 },
    // sacred law governs life: killing is a profound PROFANITY, brawling stains one's
    // honour before the divine, and almsgiving is a holy duty — all sacred, so the
    // faithful feel them keenly and the fallen-away do not. The Old Faith reveres MANY
    // virtues: peace made and courage shown are both holy before the Ancestors.
    precepts: [
      { deed: 'bloodshed', socialWeight: 2.8, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'violence', socialWeight: 1.4, sacred: true, witnessSelf: 'moral_outrage', commitSelf: 'guilt' },
      { deed: 'generosity', socialWeight: 1.5, sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'reconciliation', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
      { deed: 'valor', sacred: true, witnessSelf: 'edified', commitSelf: 'righteous' },
    ],
    // the unbroken line is a holy duty: an elder who leaves no children carries a sacred
    // sorrow before the Ancestors.
    statePrecepts: [{ id: 'childless_elder', self: 'disquiet', sacred: true, label: 'a broken line', holds: (s) => s.isElder && s.children === 0 }],
  },
];

export function cultureById(id: string): Culture {
  return CULTURES.find((c) => c.id === id) ?? CULTURES[0];
}

/** Replace the active culture/deity roster — called once per world-seed by the engine's pack
 *  layer (engine/pack.ts's setCulturesForSeed) so every helper in this file (cultureById,
 *  patronDeityOf, culturalDistance, ...) resolves against the world's OWN generated creeds. */
export function setCultures(cultures: Culture[], deities: Deity[]): void {
  CULTURES = cultures;
  DEITIES = deities;
}

/** The patron deity of a culture — the divine source whose domain mirrors the
 *  culture's highest value. Used by perception to name religious condemnations. */
export function patronDeityOf(cultureId: string): Deity {
  return deityById(cultureById(cultureId).patronDeityId);
}

/** Probability an actor born into this culture will hold religious faith.
 *  The `devout` trait pushes it toward certainty; without it most still follow
 *  their people's patron but a minority are quietly irreligious. */
export function faithProbability(traitIds: string[]): number {
  return traitIds.includes('devout') ? 0.9 : 0.6;
}

/** The creed's precept about a given deed kind, if it has one. */
export function preceptFor(cultureId: string, deedKind: string): Precept | undefined {
  return cultureById(cultureId).precepts?.find((p) => p.deed === deedKind);
}

/** How much this culture amplifies (>1) or tolerates (<1) a deed of the given kind.
 *  1.0 = neutral (no precept). Derived from the precept's socialWeight — one source of
 *  truth — so perception.ts scales standing/witness-thought exactly as before. */
export function ethicsWeightFor(cultureId: string, deedKind: string): number {
  return preceptFor(cultureId, deedKind)?.socialWeight ?? 1.0;
}

// ----------------------------------------------------------- factions ---------
// When a community is internally divided the two wings of the contested value axis
// are NAMED. Names are pack data: a table maps each axis to a [highName, lowName]
// pair so a different universe can swap them (sci-fi: 'Hawkish / Dovish', etc.).

const FACTION_NAMES: Record<string, [string, string]> = {
  war:       ['the Swords',  'the Shields'],
  tradition: ['the Old Way', 'the New Way'],
  honor:     ['the Sworn',   'the Free'],
  freedom:   ['the Unbowed', 'the Ordered'],
  nature:    ['the Wild',    'the Tamed'],
  craft:     ['the Guild',   'the Common'],
};

/** [highName, lowName] for the contested value axis — the two wings of the split. */
export function factionNames(axis: string): [string, string] {
  return (FACTION_NAMES[axis] as [string, string]) ?? ['the High', 'the Low'];
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

/** Build one actor's TEMPERAMENT from their traits + a wide personal deviation. There is
 *  NO cultural baseline — disposition is the individual half of a personality, so it spreads
 *  people out even within one creed. */
export function temperamentProfile(traitIds: string[], rng: Rng): Record<TemperamentAxis, number> {
  const p = {} as Record<TemperamentAxis, number>;
  for (const axis of TEMPERAMENTS) {
    let v = 0;
    for (const t of traitIds) {
      const shift = TRAITS.find((d) => d.id === t)?.temperament?.[axis];
      if (shift !== undefined) v += shift;
    }
    v += rng.range(-35, 35);
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

/** How two TEMPERAMENTS get on, beyond shared values: warmth lifts any encounter, two
 *  hot tempers grate hardest, sociable folk engage more warmly. Kept gentle so disposition
 *  colours relationships without overwhelming who-values-what. */
export function temperamentAffinity(
  a: Record<TemperamentAxis, number>,
  b: Record<TemperamentAxis, number>,
): number {
  const warm = ((a.warmth ?? 0) + (b.warmth ?? 0)) / 70; // both warm ≈ +2.8, both cold ≈ −2.8
  const clash = -(Math.max(0, a.temper ?? 0) * Math.max(0, b.temper ?? 0)) / 3500; // both volcanic ≈ −1.9
  const social = ((a.sociability ?? 0) + (b.sociability ?? 0)) / 220; // both gregarious ≈ +0.9
  return warm + clash + social;
}

/** The strongest leanings in a personality, as universe-specific adjectives — the legible
 *  face the player reads in the inspector. Disposition first (how they come across), then
 *  their defining value: "hot-blooded, solitary, honourable". */
const VALUE_WORDS: Record<ValueAxis, [string, string]> = {
  honor: ['honourable', 'dishonourable'],
  war: ['warlike', 'peaceable'],
  tradition: ['traditional', 'free-thinking'],
  freedom: ['freedom-loving', 'dutiful'],
  nature: ['wild at heart', 'worldly'],
  craft: ['industrious', 'unworldly'],
};
const TEMPERAMENT_WORDS: Record<TemperamentAxis, [string, string]> = {
  boldness: ['bold', 'timid'],
  temper: ['hot-blooded', 'serene'],
  warmth: ['warm', 'cold'],
  drive: ['driven', 'indolent'],
  sociability: ['gregarious', 'solitary'],
  curiosity: ['inquisitive', 'incurious'],
};
/** The adjective for one pole of a value axis — 'honor'+ → "honourable", − → "dishonourable".
 *  Lets the UI name the conviction an option enacts (design/26 P3). Pack data: a different
 *  universe words its values differently. */
export function valueWord(axis: ValueAxis, positive: boolean): string {
  return VALUE_WORDS[axis][positive ? 0 : 1];
}

export function natureOf(p: Personality): string {
  const top = <K extends string>(
    axes: readonly K[],
    vals: Record<K, number>,
    words: Record<K, [string, string]>,
    thresh: number,
    n: number,
  ) =>
    axes
      .map((axis) => ({ axis, v: vals[axis] ?? 0 }))
      .filter((r) => Math.abs(r.v) >= thresh)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .slice(0, n)
      .map((r) => words[r.axis][r.v >= 0 ? 0 : 1]);
  const disposition = top(TEMPERAMENTS, p.temperament, TEMPERAMENT_WORDS, 32, 2);
  const value = top(VALUES, p.values, VALUE_WORDS, 28, 1);
  const words = [...disposition, ...value];
  return words.length ? words.join(', ') : 'unremarkable';
}

// --------------------------------------------- organizational reasoning -------
// PACK VOCABULARY for Phase 2C. The engine (engine/orgReason.ts) runs the pipeline
// Perception → Worldview → Intent; everything universe-specific lives here:
//   - WORLDVIEW axes and how they read from this pack's member VALUES,
//   - the candidate INTENTS and their scoring rules (as inspectable weighted factors),
//   - EVALUATOR_VERSION, stamped on each decision so old saves still explain themselves.
// A sci-fi pack swaps these out; the engine is unchanged.

/** Bumped whenever the scoring rules below change, so a decision records which ruleset
 *  produced it (an old save still explains itself: "produced under evaluator vN"). */
export const EVALUATOR_VERSION = 1;

/** This pack's worldview axes — an organization's derived disposition. */
export const WORLDVIEW_AXES = ['expansionist', 'isolationist', 'mercantile', 'militaristic', 'religious', 'scholarly'] as const;
export type WorldviewAxisId = (typeof WORLDVIEW_AXES)[number];

/** How each worldview axis reads from the member VALUE means — a linear blend. The engine
 *  computes the value means across (living) members; this maps them to worldview. */
const WORLDVIEW_WEIGHTS: Record<WorldviewAxisId, Partial<Record<ValueAxis, number>>> = {
  expansionist: { war: 0.6, freedom: 0.4 },
  isolationist: { tradition: 0.6, freedom: -0.4 },
  mercantile: { craft: 1.0 },
  militaristic: { war: 1.0 },
  religious: { tradition: 0.5, honor: 0.5 },
  scholarly: { craft: 0.5, nature: 0.5 },
};

/** Derive a worldview from member value means (each value axis in −100..100). */
export function worldviewFromValues(valueMean: Record<ValueAxis, number>): Worldview {
  const wv: Worldview = {};
  for (const axis of WORLDVIEW_AXES) {
    let s = 0;
    const weights = WORLDVIEW_WEIGHTS[axis];
    for (const v of VALUES) s += (weights[v] ?? 0) * (valueMean[v] ?? 0);
    wv[axis] = Math.round(s) + 0; // + 0 collapses -0 → 0 so in-memory == JSON round-trip
  }
  return wv;
}

/** The strongest worldview leanings, as labels — the legible face for the inspector. */
const WORLDVIEW_WORDS: Record<WorldviewAxisId, string> = {
  expansionist: 'expansionist',
  isolationist: 'isolationist',
  mercantile: 'mercantile',
  militaristic: 'militaristic',
  religious: 'devout',
  scholarly: 'scholarly',
};
export function worldviewReading(wv: Worldview): string {
  const leanings = WORLDVIEW_AXES.map((a) => ({ a, v: wv[a] ?? 0 }))
    .filter((r) => r.v >= 20)
    .sort((x, y) => y.v - x.v)
    .slice(0, 3)
    .map((r) => WORLDVIEW_WORDS[r.a]);
  return leanings.length ? leanings.join(', ') : 'undefined';
}

// scoring helpers: read a perception fact / worldview axis by stable id (0 if absent).
const fv = (p: PerceptionFact[], id: string): number => p.find((f) => f.id === id)?.value ?? 0;
const wvv = (w: Worldview, id: string): number => w[id] ?? 0;
const r = Math.round;

/**
 * The candidate INTENTS an organization may form, each scored as inspectable weighted
 * factors. A score function reads ONLY perception + worldview + the org's own record —
 * never the World (the signature enforces it). The factors SUM to the intent's score; the
 * engine picks the highest and records the whole justification. `remain_neutral` carries a
 * gentle baseline so a quiet org always has a default posture.
 */
export const INTENTS: IntentDef[] = [
  {
    id: 'remain_neutral', displayName: 'Remain Neutral', category: 'posture',
    description: 'Hold steady and tend to internal affairs.',
    score: (p, w) => [
      { id: 'isolationist_lean', group: 'disposition', value: r(wvv(w, 'isolationist') * 0.2) },
      { id: 'internal_calm', group: 'internal', value: r(Math.max(0, fv(p, 'stability')) * 0.1) },
      { id: 'baseline', group: 'baseline', value: 8 },
    ],
  },
  {
    id: 'expand', displayName: 'Expand', category: 'outward',
    description: 'Seek new territory or influence beyond the current borders.',
    score: (p, w) => [
      { id: 'expansionist_lean', group: 'disposition', value: r(wvv(w, 'expansionist') * 0.3) },
      { id: 'neighbour_weakness', group: 'military', value: r(fv(p, 'neighbor_weakness') * 0.3) },
      { id: 'food_surplus', group: 'economy', value: r(Math.max(0, fv(p, 'food_security') - 50) * 0.3) },
      // a polity in a succession CRISIS does not campaign abroad (0 unless recognition is contested;
      // absent fact ⇒ neutral 50 ⇒ no penalty, so an unrecognized aggregate polity is never cautious)
      { id: 'succession_crisis', group: 'internal', value: r(Math.min(0, (p.find((f) => f.id === 'succession_settled')?.value ?? 50) - 50) * 0.4) },
    ],
  },
  {
    id: 'prepare_war', displayName: 'Prepare for War', category: 'military',
    description: 'Mobilise against a perceived threat.',
    score: (p, w) => [
      { id: 'militaristic_lean', group: 'disposition', value: r(wvv(w, 'militaristic') * 0.3) },
      { id: 'border_raids', group: 'military', value: r(fv(p, 'border_raids') * 10) },
      { id: 'border_hostility', group: 'military', value: r(fv(p, 'border_hostility') * 0.2) },
      // a contested succession turns a polity inward — it will not mobilise abroad while the throne
      // is disputed (0 unless recognition is contested; absent fact ⇒ neutral 50 ⇒ no penalty)
      { id: 'succession_crisis', group: 'internal', value: r(Math.min(0, (p.find((f) => f.id === 'succession_settled')?.value ?? 50) - 50) * 0.4) },
    ],
  },
  {
    id: 'protect_border', displayName: 'Protect the Border', category: 'military',
    description: 'Shore up defences without seeking conflict.',
    score: (p) => [
      { id: 'border_hostility', group: 'military', value: r(fv(p, 'border_hostility') * 0.3) },
      { id: 'border_raids', group: 'military', value: r(fv(p, 'border_raids') * 6) },
      { id: 'instability', group: 'internal', value: r(Math.max(0, -fv(p, 'stability')) * 0.1) },
    ],
  },
  {
    id: 'trade', displayName: 'Pursue Trade', category: 'economy',
    description: 'Grow through commerce with neighbours.',
    score: (p, w) => [
      { id: 'mercantile_lean', group: 'disposition', value: r(wvv(w, 'mercantile') * 0.35) },
      { id: 'provision', group: 'economy', value: r(fv(p, 'food_security') * 0.15) },
      { id: 'peaceful_borders', group: 'military', value: r(Math.max(0, 20 - fv(p, 'border_hostility')) * 0.1) },
    ],
  },
  {
    id: 'recruit', displayName: 'Recruit', category: 'internal',
    description: 'Grow the ranks — drawing in members and strength.',
    score: (p, w) => [
      { id: 'militaristic_lean', group: 'disposition', value: r(wvv(w, 'militaristic') * 0.2) },
      { id: 'border_hostility', group: 'military', value: r(fv(p, 'border_hostility') * 0.15) },
      { id: 'population_base', group: 'internal', value: r(Math.min(40, fv(p, 'own_strength') * 0.1)) },
    ],
  },
];

export function intentById(id: string): IntentDef | undefined {
  return INTENTS.find((d) => d.id === id);
}
/** Display label for an intent id (falls back to the id). */
export function intentLabel(id: string): string {
  return intentById(id)?.displayName ?? id;
}

// ----------------------------------------------- organizational execution -----
// PACK VOCABULARY for Phase 2D. The engine (engine/orgAction.ts) runs the pipeline
// intent → action → feasibility → outcome → effects → history. Everything universe-
// specific lives here: the operational measures an org tracks, the candidate ACTIONS
// (each a pure resolver returning effect DESCRIPTORS), and which intent maps to which
// action. Actions change the ORGANISATION, never geography (a 2D charter rule).

/** The operational measures an organization tracks — the org analogue of actor needs. */
export const OPERATIONAL_KEYS = ['strength', 'readiness', 'morale'] as const;
/** Baseline operational condition seeded at an org's founding (clamped [0,100]). */
export function baselineOperational(): Record<string, number> {
  return { strength: 20, readiness: 20, morale: 50 };
}

// read-only helpers over world state (the pack only READS + describes; the engine mutates)
const actSeat = (world: World, seatId: number | undefined): Settlement | undefined =>
  (seatId === undefined ? undefined : world.settlements[seatId]);
const foodYears = (s: Settlement): number => (s.econ.stock[SUBSISTENCE_RESOURCE] ?? 0) / Math.max(s.macro.population, 1);
// the org's own funds (2C: OrgResources) — actions are bounded by what the tithe has
// actually collected (read directly off the map; the engine's applyEffects mutates it).
const orgFunds = (world: World, org: Organization): number => world.orgTreasury.get(org.id) ?? 0;

/** Neighbours of a seat in the region graph, as [otherSettlement, edge]. */
function seatNeighbours(world: World, seatId: number): { other: Settlement; relation: number }[] {
  const out: { other: Settlement; relation: number }[] = [];
  for (const e of world.edges) {
    const other = e.a === seatId ? e.b : e.b === seatId ? e.a : undefined;
    if (other === undefined) continue;
    const os = world.settlements[other];
    if (os && os.ruinedYear === undefined) out.push({ other: os, relation: e.relation });
  }
  return out;
}

/**
 * The candidate ACTIONS an organization can execute — bounded, reversible, org-only. Each
 * `resolve` is PURE: it returns a success/failure outcome plus effect DESCRIPTORS; the
 * engine's applyEffects performs the mutation and emits the event. Effects touch the org's
 * operational stats, its seat's existing economy/demographics, adjacent edges, or its
 * reputation — never geography.
 */
export const ACTIONS: ActionDef[] = [
  {
    id: 'recruit', displayName: 'Recruit', description: 'Raise levies to swell the org’s strength.',
    feasible: (world, org) => {
      const s = actSeat(world, org.seatId);
      if (!s) return { ok: false, reason: 'no seat' };
      if (foodYears(s) < 2) return { ok: false, reason: 'too little food to raise levies' };
      return orgFunds(world, org) >= 20 ? { ok: true } : { ok: false, reason: 'the treasury cannot pay the levies' };
    },
    resolve: (world, org) => {
      const s = actSeat(world, org.seatId)!;
      const levies = Math.max(1, Math.round(Math.max(s.macro.population, 1) * 0.02));
      return {
        success: true,
        effects: [ { target: 'stat', key: 'strength', delta: 8 }, { target: 'treasury', delta: -20 } ],
        summary: `raised ${levies} levies`,
        eventType: 'org_recruited', eventData: { org: org.name, levies },
      };
    },
  },
  {
    id: 'fortify', displayName: 'Fortify', description: 'Strengthen defences against a perceived threat.',
    feasible: (world, org) => {
      const s = actSeat(world, org.seatId);
      if (!s) return { ok: false, reason: 'no seat' };
      return orgFunds(world, org) >= 25 ? { ok: true } : { ok: false, reason: 'the treasury cannot fund defences' };
    },
    resolve: (_world, org) => ({
      success: true,
      effects: [ { target: 'stat', key: 'readiness', delta: 10 }, { target: 'treasury', delta: -25 } ],
      summary: 'strengthened its defences',
      eventType: 'org_fortified', eventData: { org: org.name },
    }),
  },
  {
    id: 'patrol', displayName: 'Patrol', description: 'Set patrols on the marches to steady the border.',
    feasible: (world, org) => (org.seatId !== undefined && seatNeighbours(world, org.seatId).length > 0
      ? { ok: true } : { ok: false, reason: 'no borders to patrol' }),
    resolve: (world, org) => {
      const ns = seatNeighbours(world, org.seatId!);
      const worst = ns.reduce((a, b) => (b.relation < a.relation ? b : a));
      return {
        success: true,
        effects: [ { target: 'stat', key: 'readiness', delta: 6 }, { target: 'relation', neighbourId: worst.other.id, delta: 2 } ],
        summary: 'set patrols on the marches',
        eventType: 'org_patrol', eventData: { org: org.name },
      };
    },
  },
  {
    id: 'trade', displayName: 'Trade', description: 'Open commerce with a friendly neighbour.',
    feasible: (world, org) => {
      if (org.seatId === undefined) return { ok: false, reason: 'no seat' };
      return seatNeighbours(world, org.seatId).some((n) => n.relation >= 0)
        ? { ok: true } : { ok: false, reason: 'no neighbour to trade with' };
    },
    resolve: (world, org) => {
      const best = seatNeighbours(world, org.seatId!).filter((n) => n.relation >= 0).reduce((a, b) => (b.relation > a.relation ? b : a));
      return {
        success: true,
        effects: [ { target: 'wealth', delta: 30 }, { target: 'relation', neighbourId: best.other.id, delta: 5 } ],
        summary: `opened a trade pact with ${best.other.name}`,
        eventType: 'org_trade_pact', eventData: { org: org.name, with: best.other.name },
      };
    },
  },
  {
    id: 'hold_festival', displayName: 'Hold a Festival', description: 'Spend on a public festival to lift morale and renown.',
    feasible: (world, org) => {
      const s = actSeat(world, org.seatId);
      if (!s) return { ok: false, reason: 'no seat' };
      return orgFunds(world, org) >= 20 && foodYears(s) >= 1.5 ? { ok: true } : { ok: false, reason: 'too lean a year to feast' };
    },
    resolve: (_world, org) => ({
      success: true,
      effects: [
        { target: 'stat', key: 'morale', delta: 12 },
        { target: 'stability', delta: 4 },
        { target: 'treasury', delta: -20 },
        { target: 'reputation', kind: 'generosity' }, // a festival is public munificence
      ],
      summary: 'held a great festival',
      eventType: 'org_festival', eventData: { org: org.name },
    }),
  },
];

export function actionById(id: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** Which action each current intent triggers — the (trivial, for now) intent → action map.
 *  A richer "plan" layer may later decompose one intent into several actions. Note expand
 *  maps to a bounded recruit (real expansion is geography — deferred to a later milestone). */
export const INTENT_TO_ACTION: Record<string, string> = {
  recruit: 'recruit',
  expand: 'recruit',
  prepare_war: 'fortify',
  protect_border: 'patrol',
  trade: 'trade',
  remain_neutral: 'hold_festival',
};

// ----------------------------------------------- organizational interaction ---
// PACK VOCABULARY for Phase 2E. The engine (engine/orgInteraction.ts) runs one pipeline —
// proposal → evaluation → outcome — and understands nothing else: it does not know what an
// "alliance" or a "tribute" IS. These defs supply that meaning. `propose`/`outcome` follow
// the ActionDef precedent (read to describe, never mutate); `evaluate` is signature-bounded
// (recipient's own perception/worldview/stance only — design/16 principle 3).

/** Engine-level tuning for the interaction pipeline (cooldowns, standing-thought kinds). */
export const ORG_INTERACTION = {
  cooldownYears: 5, // years between an org's interactions (diplomacy is deliberate)
  agreementYears: 20, // how long a sealed pact stands before it lapses
  acceptThought: 'accord', // org-scale thought sown on the pair when a proposal is accepted
  refuseThought: 'spurned', // ...and when it is refused (a wound between the courts)
};

// helpers over world state (read-only, like the ACTIONS helpers above)
const relationBetween = (world: World, aSeat: number | undefined, bSeat: number | undefined): number => {
  if (aSeat === undefined || bSeat === undefined) return 0;
  for (const e of world.edges) {
    if ((e.a === aSeat && e.b === bSeat) || (e.a === bSeat && e.b === aSeat)) return e.relation;
  }
  return 0;
};
const seatPop = (world: World, org: Organization): number =>
  org.seatId === undefined ? 0 : world.settlements[org.seatId]?.macro.population ?? 0;
const hasPact = (world: World, kind: string, a: Organization, b: Organization): boolean => {
  const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return world.orgAgreements.some((g) => g.kind === kind && g.a === x && g.b === y && g.expiresTick > world.tick);
};

export const INTERACTIONS: InteractionDef[] = [
  {
    id: 'trade_agreement', displayName: 'Trade Agreement',
    description: 'Propose favoured commerce with a friendly neighbour.',
    propose: (world, from, candidates) => {
      // the friendliest neighbour not already under pact — commerce follows warmth
      let best: Organization | undefined;
      let bestRel = -1;
      for (const c of candidates) {
        if (hasPact(world, 'trade_agreement', from, c)) continue;
        const rel = relationBetween(world, from.seatId, c.seatId);
        if (rel >= 0 && rel > bestRel) { bestRel = rel; best = c; }
      }
      return best ? { to: best.id, terms: { years: ORG_INTERACTION.agreementYears } } : undefined;
    },
    evaluate: (p, w, stance, _terms, _from) => [
      { id: 'mercantile_lean', group: 'disposition', value: Math.round((w.mercantile ?? 0) * 0.3) },
      { id: 'institutional_stance', group: 'relations', value: Math.round(stance * 0.15) },
      { id: 'provision', group: 'economy', value: Math.round((p.find((f) => f.id === 'food_security')?.value ?? 0) * 0.1) },
      { id: 'openness', group: 'baseline', value: 5 },
    ],
    outcome: (_world, from, to, terms, accepted) => accepted
      ? {
          accepted,
          effects: to.seatId !== undefined ? [{ party: 'from' as const, effect: { target: 'relation' as const, neighbourId: to.seatId, delta: 6 } }] : [],
          agreement: { kind: 'trade_agreement', years: Number(terms.years) },
          summaryFrom: `sealed a trade agreement with the ${to.name}`,
          summaryTo: `sealed a trade agreement with the ${from.name}`,
          eventType: 'pact_sealed', eventData: { kind: 'trade', a: from.name, b: to.name },
        }
      : {
          accepted,
          effects: [],
          summaryFrom: `saw its trade overture spurned by the ${to.name}`,
          summaryTo: `declined a trade overture from the ${from.name}`,
          eventType: 'pact_refused', eventData: { kind: 'trade', a: from.name, b: to.name },
        },
  },
  {
    id: 'non_aggression', displayName: 'Non-Aggression Pact',
    description: 'Offer peace along a hostile border.',
    propose: (world, from, candidates) => {
      // the MOST hostile neighbour not already under pact — peace is offered where war looms
      let worst: Organization | undefined;
      let worstRel = 0;
      for (const c of candidates) {
        if (hasPact(world, 'non_aggression', from, c)) continue;
        const rel = relationBetween(world, from.seatId, c.seatId);
        if (rel < worstRel) { worstRel = rel; worst = c; }
      }
      return worst ? { to: worst.id, terms: { years: ORG_INTERACTION.agreementYears } } : undefined;
    },
    evaluate: (p, w, stance, _terms, _from) => [
      { id: 'isolationist_lean', group: 'disposition', value: Math.round((w.isolationist ?? 0) * 0.2) },
      { id: 'militaristic_pride', group: 'disposition', value: Math.round(-(w.militaristic ?? 0) * 0.25) },
      { id: 'battered_borders', group: 'military', value: (p.find((f) => f.id === 'border_raids')?.value ?? 0) * 8 },
      { id: 'institutional_stance', group: 'relations', value: Math.round(stance * 0.1) },
      { id: 'war_weariness', group: 'baseline', value: 6 },
    ],
    outcome: (_world, from, to, terms, accepted) => accepted
      ? {
          accepted,
          effects: to.seatId !== undefined ? [{ party: 'from' as const, effect: { target: 'relation' as const, neighbourId: to.seatId, delta: 8 } }] : [],
          agreement: { kind: 'non_aggression', years: Number(terms.years) },
          summaryFrom: `swore peace with the ${to.name}`,
          summaryTo: `swore peace with the ${from.name}`,
          eventType: 'pact_sealed', eventData: { kind: 'peace', a: from.name, b: to.name },
        }
      : {
          accepted,
          effects: [],
          summaryFrom: `had its offer of peace thrown back by the ${to.name}`,
          summaryTo: `refused to swear peace with the ${from.name}`,
          eventType: 'pact_refused', eventData: { kind: 'peace', a: from.name, b: to.name },
        },
  },
  {
    id: 'demand_tribute', displayName: 'Demand Tribute',
    description: 'Extract payment from a weaker neighbour under threat.',
    propose: (world, from, candidates) => {
      // the weakest markedly-smaller neighbour — extraction follows expansion pressure
      const own = seatPop(world, from);
      let prey: Organization | undefined;
      let preyPop = Infinity;
      for (const c of candidates) {
        const pop = seatPop(world, c);
        if (pop > 0 && pop < own * 0.7 && pop < preyPop && !hasPact(world, 'non_aggression', from, c)) {
          preyPop = pop;
          prey = c;
        }
      }
      if (!prey) return undefined;
      const hoard = world.orgTreasury.get(prey.id) ?? 0;
      const amount = Math.max(15, Math.round(hoard * 0.3));
      return { to: prey.id, terms: { amount, menace: own } };
    },
    evaluate: (p, w, stance, terms, _from) => {
      const own = p.find((f) => f.id === 'own_strength')?.value ?? 0;
      const menace = Number(terms.menace);
      return [
        // fear: the shadow the demander casts, RELATIVE to one's own strength
        { id: 'fear', group: 'military', value: Math.round(((menace - own) / Math.max(menace + own, 1)) * 60) },
        { id: 'militaristic_pride', group: 'disposition', value: Math.round(-(w.militaristic ?? 0) * 0.3) },
        { id: 'institutional_stance', group: 'relations', value: Math.round(stance * 0.05) },
        { id: 'indignity', group: 'baseline', value: -12 }, // nobody pays gladly
      ];
    },
    outcome: (_world, from, to, terms, accepted) => {
      const amount = Number(terms.amount);
      return accepted
        ? {
            accepted,
            effects: [
              { party: 'to' as const, effect: { target: 'treasury' as const, delta: -amount } },
              { party: 'from' as const, effect: { target: 'treasury' as const, delta: amount } },
            ],
            summaryFrom: `exacted tribute of ${amount} from the ${to.name}`,
            summaryTo: `paid tribute of ${amount} to the ${from.name}`,
            eventType: 'tribute_paid', eventData: { a: from.name, b: to.name, amount },
          }
        : {
            accepted,
            effects: to.seatId !== undefined ? [{ party: 'from' as const, effect: { target: 'relation' as const, neighbourId: to.seatId, delta: -6 } }] : [],
            summaryFrom: `saw its demand for tribute defied by the ${to.name}`,
            summaryTo: `defied the ${from.name}'s demand for tribute`,
            eventType: 'tribute_refused', eventData: { a: from.name, b: to.name, amount },
          };
    },
  },
  {
    id: 'alliance', displayName: 'Alliance',
    description: 'Bind two courts in mutual defense — an attack on one draws in the other.',
    propose: (world, from, candidates) => {
      // a friend warm enough to bleed for — a higher bar than mere trade; not already allied
      let best: Organization | undefined;
      let bestRel = 40;
      for (const c of candidates) {
        if (hasPact(world, 'alliance', from, c)) continue;
        const rel = relationBetween(world, from.seatId, c.seatId);
        if (rel > bestRel) { bestRel = rel; best = c; }
      }
      return best ? { to: best.id, terms: { years: ORG_INTERACTION.agreementYears } } : undefined;
    },
    evaluate: (p, w, stance, _terms, _from) => [
      // an alliance is a bond of warmth AND a shield — sought most where one is threatened
      { id: 'kinship', group: 'relations', value: Math.round(stance * 0.2) },
      { id: 'militaristic_lean', group: 'disposition', value: Math.round((w.militaristic ?? 0) * 0.2) },
      { id: 'under_threat', group: 'military', value: (p.find((f) => f.id === 'border_raids')?.value ?? 0) * 6 },
      { id: 'entanglement', group: 'baseline', value: -8 }, // a shield is also a burden — someone else's wars become yours
    ],
    outcome: (_world, from, to, terms, accepted) => accepted
      ? {
          accepted,
          effects: to.seatId !== undefined ? [{ party: 'from' as const, effect: { target: 'relation' as const, neighbourId: to.seatId, delta: 10 } }] : [],
          agreement: { kind: 'alliance', years: Number(terms.years) },
          summaryFrom: `forged an alliance with the ${to.name}`,
          summaryTo: `forged an alliance with the ${from.name}`,
          eventType: 'pact_sealed', eventData: { kind: 'alliance', a: from.name, b: to.name },
        }
      : {
          accepted,
          effects: [],
          summaryFrom: `was rebuffed in seeking an alliance with the ${to.name}`,
          summaryTo: `turned aside an alliance with the ${from.name}`,
          eventType: 'pact_refused', eventData: { kind: 'alliance', a: from.name, b: to.name },
        },
  },
];

/** Which interaction each current intent inclines an org toward. Absent intents interact
 *  with nobody (a neutral or recruiting org keeps to itself); war stays deferred. */
export const INTENT_TO_INTERACTION: Record<string, string> = {
  trade: 'trade_agreement',
  protect_border: 'non_aggression',
  expand: 'demand_tribute',
  prepare_war: 'alliance', // a polity readying for war rallies its friends first
};

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id)!;
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
  // pick a handful of FACETS — at most one trait per spectrum, so the result is coherent
  // (never kind AND cruel) yet drawn from an enormous combinatorial space.
  const spectra = [...TRAIT_SPECTRA];
  const count = rng.range(3, 5);
  const out: string[] = [];
  for (let i = 0; i < count && spectra.length; i++) {
    const sp = spectra.splice(rng.int(spectra.length), 1)[0];
    const options = TRAITS.filter((t) => t.spectrum === sp);
    out.push(options[rng.int(options.length)].id);
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

/** The location-type label this pack uses for its populated, simulated places. The engine
 *  treats Location.locationType as an open string; a sci-fi pack could found 'colony' or
 *  'station' places. Defining it here keeps the type label PACK DATA, not an engine literal. */
export const SETTLEMENT_LOCATION_TYPE = 'settlement';

/** Default travel speed in substrate-distance units per tick (1 tick = 1 day here). The
 *  engine computes transit duration = distance / speed; speed is PACK DATA (a sci-fi pack's
 *  warp drive is far faster). Callers may override per journey/vehicle. */
export const TRAVEL_SPEED = 6;
/** How many ticks a single hazard adds to a journey when it strikes (pack-tunable). */
export const HAZARD_DELAY_TICKS = 2;

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
  // soil quality varies WITHIN a biome — rich pockets and thin ground (RimWorld's Rich
  // Soil ~140% vs Sand ~70%), read from the fertility field we already have. Centred so
  // the biome baseline is the mean: ~0.75× on the poorest ground, ~1.25× on the richest.
  const soil = 0.75 + (a.fertility ?? 0.5) * 0.5;
  return {
    food: Math.max(0.2, b.yields.food * soil + (coastal ? 0.55 : 0) + fresh * 0.18),
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
  // dread of someone whose violence you WITNESSED (perception.ts). Strong, slow to
  // fade, lightly stacking — seeing a neighbour shed blood turns wariness into enmity.
  feared: { base: -90, durationTicks: 7 * DAYS_PER_YEAR, stackLimit: 4, mult: 0.85, label: 'feared their violence' },
  // admiration for someone whose public generosity you WITNESSED — the positive twin of
  // `feared`. Warms onlookers toward a renowned giver (can ripen into friendship).
  admired: { base: 80, durationTicks: 6 * DAYS_PER_YEAR, stackLimit: 4, mult: 0.85, label: 'admired their generosity' },
  // AUDIENCE verdicts (design/26 P2) — how a ruling at the seat lands on its parties.
  // A judged truce is strong and slow to fade (it must lift a feud's weight for a
  // while); favor warms the winner to the judge; a wrong verdict is long resented.
  judgment_truce: { base: 260, durationTicks: 5 * DAYS_PER_YEAR, stackLimit: 2, mult: 0.85, label: 'a truce imposed at the seat' },
  judgment_favor: { base: 120, durationTicks: 5 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.85, label: 'judged fairly at the seat' },
  judgment_wrong: { base: -150, durationTicks: 6 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.85, label: 'wronged by a judgment' },
  // moral revulsion: witnessed a deed the community considers a cultural profanity
  // (ethics weight ≥ 2.0). Stronger and more durable than mere dread — this is not
  // just fear of a violent person but outrage at a transgression against shared belief.
  tabooHorror: { base: -180, durationTicks: 10 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.9, label: 'witnessed a cultural profanity' },
  // religion: co-religionists gradually warm to each other; the opposing side creates friction.
  faithBond: { base: 80, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.65, label: 'shares your faith' },
  faithFriction: { base: -30, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 2, mult: 0.6, label: 'follows a different creed' },
  // factionalism: opposing-faction members grate on each other politically.
  factionRivalry: { base: -45, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 3, mult: 0.65, label: 'stands against your faction' },
  // ---- ORGANIZATION-scale thoughts (Phase 2C, OrgRelationships) ----
  // Polities reuse the same thought machinery on their (symmetric) relationship edges:
  // an institution's grudges and trust decay and stack exactly like a person's, just on
  // generational timescales. `raided`/`wartorn` mark blood spilled BETWEEN two polities
  // (the edge is shared, so the wound poisons the pair); `goodTrade` builds trust.
  raided: { base: -120, durationTicks: 25 * DAYS_PER_YEAR, stackLimit: 5, mult: 0.9, label: 'blood between our peoples (a raid)' },
  wartorn: { base: -90, durationTicks: 20 * DAYS_PER_YEAR, stackLimit: 4, mult: 0.85, label: 'met in open battle' },
  goodTrade: { base: 25, durationTicks: 6 * DAYS_PER_YEAR, stackLimit: 8, mult: 0.9, label: 'a flourishing trade' },
  // negotiation residue (2E): a sealed accord warms the pair; a spurned proposal wounds it.
  accord: { base: 60, durationTicks: 15 * DAYS_PER_YEAR, stackLimit: 4, mult: 0.85, label: 'an accord between our courts' },
  spurned: { base: -45, durationTicks: 10 * DAYS_PER_YEAR, stackLimit: 4, mult: 0.85, label: 'a proposal thrown back' },
};

// Neutral fallback so an unknown / pack-added kind without a spec never crashes the engine.
const NEUTRAL_THOUGHT: ThoughtSpec = { base: 0, stackLimit: 1, mult: 1, label: 'a feeling' };

export function thoughtSpec(kind: string): ThoughtSpec {
  return THOUGHT_SPECS[kind] ?? NEUTRAL_THOUGHT;
}

// ---- mood: how an actor's OWN life feels (engine/mood.ts reads these) ----
// SELF-THOUGHTS reuse the exact Mark+ThoughtSpec machinery of opinion-thoughts, but are
// held about one's OWN life rather than about another person: grief, joy, humiliation.
// Their diminishing sum (plus the needs of the moment and the actor's temperament) is
// MOOD. PACK DATA like THOUGHT_SPECS: a stoic universe mourns briefly, a haunted one
// never stops.
export const SELF_THOUGHT_SPECS: Record<string, ThoughtSpec> = {
  grief_spouse: { base: -180, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 2, mult: 0.7, label: 'mourning a spouse' },
  grief_kin: { base: -110, durationTicks: Math.round(1.5 * DAYS_PER_YEAR), stackLimit: 3, mult: 0.7, label: 'mourning kin' },
  insulted: { base: -35, durationTicks: 90, stackLimit: 5, mult: 0.75, label: 'was slighted' },
  heartened: { base: 30, durationTicks: 90, stackLimit: 5, mult: 0.75, label: 'a kindness received' },
  newly_wed: { base: 120, durationTicks: DAYS_PER_YEAR, stackLimit: 1, mult: 1, label: 'newly wed' },
  child_born: { base: 80, durationTicks: DAYS_PER_YEAR, stackLimit: 3, mult: 0.8, label: 'a child born' },
  // communal gatherings (design/27 §4). `mourned` is a small POSITIVE — the comfort of
  // shared grief and closure at a funeral; the bereavement itself is grief_kin/grief_spouse.
  mourned: { base: 40, durationTicks: Math.round(0.75 * DAYS_PER_YEAR), stackLimit: 3, mult: 0.8, label: 'mourned at a funeral' },
  feasted: { base: 60, durationTicks: Math.round(0.6 * DAYS_PER_YEAR), stackLimit: 3, mult: 0.8, label: 'shared in a celebration' },
  brawl_shock: { base: -60, durationTicks: 150, stackLimit: 3, mult: 0.75, label: 'shaken by a brawl' },
  fearful_times: { base: -70, durationTicks: DAYS_PER_YEAR, stackLimit: 2, mult: 0.7, label: 'living through fearful times' },
  good_times: { base: 55, durationTicks: DAYS_PER_YEAR, stackLimit: 2, mult: 0.7, label: 'living through good times' },
  // the strange peace after a mental break — RimWorld's catharsis. It is what stops a
  // broken soul breaking again every week: the break itself buys back some mood.
  catharsis: { base: 90, durationTicks: 60, stackLimit: 1, mult: 1, label: 'a weight lifted' },
  // ---- MORAL self-thoughts (the conscience — emitted by PRECEPTS, design/23) ----
  // Belief made felt: seeing or doing a deed your creed judges moves your OWN mood, not
  // just your opinion of the doer. moral_outrage/edified are what a WITNESS feels; guilt/
  // righteous are the DOER's conscience. Tuned to the compressed mood band — strong enough
  // to darken a devout soul toward a break under a run of profanity, gentle enough that one
  // witnessed scuffle doesn't shatter the town.
  moral_outrage: { base: -55, durationTicks: 150, stackLimit: 4, mult: 0.7, label: 'witnessed a wrong against your creed' },
  edified: { base: 30, durationTicks: 120, stackLimit: 4, mult: 0.7, label: 'saw your creed upheld' },
  guilt: { base: -85, durationTicks: Math.round(1.5 * DAYS_PER_YEAR), stackLimit: 3, mult: 0.7, label: 'the weight of what you did' },
  righteous: { base: 45, durationTicks: DAYS_PER_YEAR, stackLimit: 3, mult: 0.75, label: 'lived by your creed' },
  // STATE precepts (design/23 Stage 3): the ongoing mood of how you LIVE, not a single deed.
  // Renewed each year while the life-state holds (stackLimit 1 ⇒ a steady background weight),
  // fading within ~2 years once you leave it. `at_peace` = a life your creed blesses; `disquiet`
  // = a life at odds with it.
  at_peace: { base: 40, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 1, mult: 1, label: 'at peace with your creed' },
  disquiet: { base: -50, durationTicks: 2 * DAYS_PER_YEAR, stackLimit: 1, mult: 1, label: 'a life at odds with your creed' },
  // CONSCIENCE OF CHOICE (design/26 P3): the weight of a deliberate choice that accorded
  // with — or betrayed — a value the soul holds strongly. Twin of the deed conscience
  // above, but sprung from a CHOICE rather than a witnessed deed. Betrayal bites harder
  // and lingers longer than accord lifts (the same loss-aversion shape as guilt/righteous).
  true_to_self: { base: 45, durationTicks: DAYS_PER_YEAR, stackLimit: 3, mult: 0.75, label: 'true to your own nature' },
  against_nature: { base: -80, durationTicks: Math.round(1.5 * DAYS_PER_YEAR), stackLimit: 3, mult: 0.7, label: 'you went against your own nature' },
};

export function selfThoughtSpec(kind: string): ThoughtSpec {
  return SELF_THOUGHT_SPECS[kind] ?? NEUTRAL_THOUGHT;
}

// How much each NEED colours mood, as a situational (derived, never stored) thought.
// The band factors map the five NEED_FEELS bands onto a share of the weight: an empty
// need weighs on the soul far more than a full one lifts it (loss aversion).
export const MOOD_NEED_WEIGHTS: Record<string, number> = {
  food: 90,
  wealth: 40,
  safety: 60,
  esteem: 50,
  belonging: 70,
};
export const MOOD_NEED_BAND_FACTOR: [number, number, number, number, number] = [-1, -0.45, 0, 0.15, 0.3];

/** The dispositional mood baseline — some souls simply run brighter. Warm people carry
 *  more cheer, the hot-tempered simmer, the bold shrug more off. (Temperament axes are
 *  roughly −100..100, so the baseline lands in about ±60.) */
export function moodBaseline(temperament: Record<string, number>): number {
  return (temperament.warmth ?? 0) * 0.45 - (temperament.temper ?? 0) * 0.35 + (temperament.boldness ?? 0) * 0.1;
}

/** Mood as a lived word, same five-band pattern as NEED_FEELS (0=empty … 4=full). */
export const MOOD_FEELS: [string, string, string, string, string] = [
  'At breaking point',
  'Miserable',
  'Steady',
  'Content',
  'Bright',
];

// ---- mental breaks: what a mind does when mood collapses ----
// When mood falls below the actor's threshold, each week risks a BREAK: the mind
// forces an action the actor would not choose. Which break is temperament-weighted
// data — the hot-tempered lash out, the shy withdraw, the aimless drown their sorrows.
export interface BreakSpec {
  id: string; // becomes Intent kind 'break' mode + event flavour
  label: string; // rendered in prose ("lashed out at …")
  weight: number; // base likelihood weight
  /** additive weight per temperament axis (weight + Σ axis*factor, floored at 0). */
  temperament?: Partial<Record<TemperamentAxis, number>>;
}
export const BREAKS: BreakSpec[] = [
  { id: 'lash_out', label: 'lashed out', weight: 10, temperament: { temper: 0.28, warmth: -0.08 } },
  { id: 'withdraw', label: 'withdrew from the world', weight: 10, temperament: { sociability: -0.16, boldness: -0.08 } },
  { id: 'binge', label: 'drowned their sorrows', weight: 8, temperament: { drive: -0.1 } },
];

/** Mood below this risks a weekly break — shifted by temperament: the volcanic snap
 *  while merely weary, the serene endure the depths. Clamped so no one is unbreakable. */
export function breakThreshold(temperament: Record<string, number>): number {
  const t = 250 + (temperament.temper ?? 0) * 0.5 - (temperament.warmth ?? 0) * 0.2;
  return t < 120 ? 120 : t > 380 ? 380 : t;
}
/** Weekly break chance scales from 0 (at the threshold) to this (at mood 0). */
export const BREAK_CHANCE_MAX = 0.35;
/** How the mind pays for a binge (wealth drained per episode). */
export const BINGE_COST = 90;

// ---- generosity as an everyday act (design/23 Stage 2) ----
/** What a gift costs the giver (wealth) — a real sacrifice, so giving spends down surplus
 *  and self-limits. One rule set: the player's `give` pays the same. */
export const GIFT_COST = 110;
/** A well-provided soul only gives from real surplus (wealth need above this). */
export const GIFT_WEALTH_FLOOR = 750;
/** Base yearly-ish inclination to give when flush, plus a warmth lean (warm hearts give
 *  more). Clamped so even the coldest rarely gives and the warmest doesn't flood the town. */
export function giveInclination(warmth: number): number {
  const p = 0.05 + warmth * 0.0011;
  return p < 0.01 ? 0.01 : p > 0.16 ? 0.16 : p;
}

// ---- reputation: what each kind of deed does to public standing ----
// How a deed marks an actor's standing with the whole community (value, decay, and
// any opinion it sows in each witness). PACK DATA, like THOUGHT_SPECS: a harsher
// culture might brand a killer for life (permanent), a gentler one forgive in a
// generation. `base` is the standing delta; `witnessThought` (if any) is the opinion
// each witness forms toward the actor, fed into the normal thought/feud machinery.
export const REPUTE_SPECS: Record<string, ReputeSpec> = {
  // a killing: heavy, lasting notoriety; witnesses are personally shaken — each forms a
  // dread of the killer (witnessThought) that can curdle into a feud (escalates).
  bloodshed: {
    base: -160,
    durationTicks: 12 * DAYS_PER_YEAR,
    witnessThought: { kind: 'feared', value: -150, escalates: true },
    label: 'shed blood',
  },
  // a non-lethal brawl: lesser, shorter notoriety, but NO personal enmity — a scuffle
  // colours how the town regards you without making lasting enemies of every onlooker
  // (no witnessThought ⇒ standing-only, so a common brawl doesn't reshape the graph).
  violence: { base: -60, durationTicks: 8 * DAYS_PER_YEAR, label: 'came to blows' },
  // a public act of generosity: renown, and onlookers warm to the giver (the positive
  // twin of bloodshed — a deed that EARNS standing rather than spends it).
  generosity: {
    base: 90,
    durationTicks: 8 * DAYS_PER_YEAR,
    witnessThought: { kind: 'admired', value: 80 },
    label: 'gave openly',
  },
  // rose to lead: taking a settlement's seat is a public elevation — lasting renown
  // (granted directly, town-wide; no per-witness thought needed).
  ascension: { base: 130, durationTicks: 15 * DAYS_PER_YEAR, label: 'rose to lead' },
  // valour: standing against a beast that fell on the town — a remembered, heroic deed.
  valor: { base: 110, durationTicks: 10 * DAYS_PER_YEAR, label: 'stood against the beast' },
  // peacemaking: ending one's OWN feud in public reconciliation earns quiet renown, and
  // onlookers think the better of you for it.
  reconciliation: {
    base: 70,
    durationTicks: 6 * DAYS_PER_YEAR,
    witnessThought: { kind: 'admired', value: 55 },
    label: 'made peace',
  },
  // ---- ORGANIZATION-scale deeds (Phase 2C, OrgReputation) ----
  // Orgs share the reputation map (same id space), so an institution's standing is the
  // same witnessed-mark machinery — just with generational durations: what a polity does
  // is remembered far longer than what one soul does.
  org_aggression: { base: -70, durationTicks: 20 * DAYS_PER_YEAR, label: 'raided a neighbour' },
  org_conquest: { base: -150, durationTicks: 40 * DAYS_PER_YEAR, label: 'razed a rival city' },
};

// Neutral fallback so an unknown / pack-added kind never crashes the engine.
const NEUTRAL_REPUTE: ReputeSpec = { base: 0, label: 'a deed' };

export function reputeSpec(kind: string): ReputeSpec {
  return REPUTE_SPECS[kind] ?? NEUTRAL_REPUTE;
}

/** Deed labels this culture especially abhors (precept weight ≥ 1.5) — used by the
 *  view layer to surface what a settlement's people hold as sacred/forbidden. Preserves
 *  the precept declaration order, so the output matches the pre-precept behaviour. */
export function ethicsTaboos(cultureId: string): string[] {
  return (cultureById(cultureId).precepts ?? [])
    .filter((p) => (p.socialWeight ?? 0) >= 1.5)
    .map((p) => reputeSpec(p.deed).label);
}

/**
 * The creed's MORAL CHARACTER made legible (design/23 Stage 3): the deeds and ways of
 * living it holds virtuous (`reveres`) or sinful (`abhors`), for the settlement panel. A
 * virtue is a precept that lays pride (righteous / at_peace); a sin, one that lays a
 * burden (guilt / disquiet). Deed labels come from REPUTE_SPECS; life labels from the
 * state precept. So each people reads as a distinct moral outlook, not a stat block.
 */
export function creedOf(cultureId: string): { reveres: string[]; abhors: string[] } {
  const c = cultureById(cultureId);
  const deeds = c.precepts ?? [];
  const lives = c.statePrecepts ?? [];
  return {
    reveres: [
      ...deeds.filter((p) => p.commitSelf === 'righteous').map((p) => reputeSpec(p.deed).label),
      ...lives.filter((p) => p.self === 'at_peace').map((p) => p.label),
    ],
    abhors: [
      ...deeds.filter((p) => p.commitSelf === 'guilt').map((p) => reputeSpec(p.deed).label),
      ...lives.filter((p) => p.self === 'disquiet').map((p) => p.label),
    ],
  };
}

// ---- how public standing colours daily life (the consequences of reputation) ----
// PACK DATA: a status-obsessed culture would crank these; an egalitarian one soften
// them. Standing runs ~ −1000..1000 (reputation.ts). The engine reads these and never
// hardcodes the weights.
export const REPUTATION_EFFECTS = {
  reception: 0.0004, // pPos shift per standing point in a social encounter (warm welcome / cold shoulder)
  esteem: 0.35, // how much standing folds into the esteem-need target (renown feels good; notoriety gnaws)
  courtship: 0.35, // opinion-equivalent appeal shift per standing point when sizing up a match
};

// ---- organizations: the treasury (Phase 2C: OrgResources) ----
// PACK DATA. How a polity funds itself: the yearly TITHE is a real TRANSFER from the
// seat's economy (never minted) into the org treasury (engine/organization.ts
// orgTitheYearly). The treasury is what the ACTION layer spends — an ActionDef's
// 'treasury' effects debit it — so a heavier-handed pack raises the tithe and gets a
// more active state; a laissez-faire one zeroes it and polities stay poor and passive.
export const ORG_ECONOMY = {
  titheRate: 0.05, // fraction of the seat's wealth the polity draws each year
};

// ---- who inherits a settlement's seat (the renown→opportunity loop) ----
// PACK DATA. An heir's "prominence" weighs AMBITION (do they want it) and RENOWN (public
// standing) together; community TIES then break ties. So a celebrated commoner can now be
// raised to lead — closing the loop (build renown → become leader → ascension renown) —
// yet with NOBODY renowned (standing 0, the common case) prominence is just ambition and
// the choice is exactly the old ambition-first, ties-tiebreak order.
export const HEIR_WEIGHTS = { ambition: 100, renown: 0.3 };

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

// How each need FEELS from the inside, across five bands (empty→full). Pure pack flavour:
// the engine stores a number; presentation translates it into lived experience, per need.
// A pack renaming or adding needs supplies its own words; a need with no entry shows a
// generic band word. (design/21 — "translate systems into lived experience".)
export const NEED_FEELS: Record<string, [string, string, string, string, string]> = {
  food: ['Starving', 'Hungry', 'Fed', 'Well fed', 'Sated'],
  wealth: ['Destitute', 'Poor', 'Getting by', 'Comfortable', 'Wealthy'],
  safety: ['In danger', 'Uneasy', 'Secure', 'Safe', 'Untroubled'],
  esteem: ['Scorned', 'Overlooked', 'Regarded', 'Respected', 'Renowned'],
  belonging: ['Alone', 'Lonely', 'Among others', 'Cared for', 'Beloved'],
};
export const NEED_FEELS_GENERIC: [string, string, string, string, string] =
  ['Empty', 'Low', 'Steady', 'Good', 'Full'];

// A single pressing need, folded into the Current Situation as a narrative beat instead of a meter
// (design/21 §5 — "narrative beats labels"). LOW fires when a drive is starving; HIGH is an earned,
// encouraging note. Pack flavour: a need with no sentence simply stays silent.
export const NEED_BEAT_LOW: Record<string, string> = {
  food: 'Hunger is beginning to gnaw at you.',
  wealth: 'Your purse is running dangerously light.',
  safety: 'You no longer feel safe where you live.',
  esteem: 'You feel overlooked by those around you.',
  belonging: 'A loneliness has settled over you.',
};
export const NEED_BEAT_HIGH: Record<string, string> = {
  esteem: 'People are beginning to know your name.',
  belonging: 'You feel truly at home among your people.',
  wealth: 'You want for nothing that coin can buy.',
};
