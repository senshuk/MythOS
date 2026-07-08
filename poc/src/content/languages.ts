/**
 * The VOICE of this universe's tongues — PACK DATA. The engine (engine/language) knows how
 * to build and speak a language but knows NO sounds; this file supplies the phoneme palettes
 * and assigns each culture a voice. To make a Tolkien or Star Trek pack sound right, swap
 * this file alone: an elvish kit (soft liquids, open syllables), a Klingon kit (guttural
 * stops, hard codas), a Dovahzul kit — the engine is unchanged.
 */
import { type PhonologyKit, type Language, languageFor, coinWord } from '../engine/language';
import { type GeoFeature } from '../engine/geography';
import { Rng, mixSeed } from '../engine/rng';
import { biomeOf } from './biomes';

// GUTTURAL — hard stops, heavy codas, few vowels: a creed that sounds like iron.
const GUTTURAL: PhonologyKit = {
  onsetsSingle: ['b', 'd', 'g', 'k', 't', 'p', 'r', 'm', 'n', 'th', 'kh', 'z'],
  onsetsCluster: ['gr', 'kr', 'dr', 'tr', 'thr', 'st', 'sk'],
  vowelsSingle: ['a', 'o', 'u', 'e'],
  vowelsDiph: ['au', 'ou'],
  codas: ['k', 't', 'd', 'r', 'rk', 'rn', 'th', 'nd', 'st', 'ld', 'g'],
  onsetSingle: [5, 8],
  onsetCluster: [1, 3],
  vowelSingle: [3, 4],
  vowelDiph: [0, 1],
  coda: [4, 7],
  codaChance: [45, 75],
  vowelStart: [2, 12],
  place: [2, 3],
  person: [1, 2],
};

// FLOWING — liquids and nasals, open vowels, light codas: wild and mellifluous.
const FLOWING: PhonologyKit = {
  onsetsSingle: ['l', 'r', 'n', 'm', 'w', 'v', 's', 'th', 'sh', 'f', 'h', 'y'],
  onsetsCluster: ['br', 'vr', 'sl', 'bl', 'gl'],
  vowelsSingle: ['a', 'e', 'i', 'o', 'y'],
  vowelsDiph: ['ae', 'ei', 'ai', 'ia', 'io', 'ou'],
  codas: ['n', 'l', 'r', 's', 'th', 'm'],
  onsetSingle: [6, 9],
  onsetCluster: [0, 2],
  vowelSingle: [3, 5],
  vowelDiph: [1, 3],
  coda: [2, 5],
  codaChance: [18, 45],
  vowelStart: [12, 35],
  place: [2, 3],
  person: [2, 2],
};

// TEMPERATE — a balanced middle palette for the worldly makers.
const TEMPERATE: PhonologyKit = {
  onsetsSingle: ['b', 'd', 'g', 'k', 't', 'p', 'm', 'n', 'l', 'r', 's', 'v', 'f', 'h', 'w', 'th', 'sh'],
  onsetsCluster: ['kh', 'br', 'dr', 'gr', 'kr', 'tr', 'pr', 'st', 'sk', 'sl', 'thr', 'bl', 'gl'],
  vowelsSingle: ['a', 'e', 'i', 'o', 'u', 'y'],
  vowelsDiph: ['ae', 'ei', 'ai', 'au', 'ou', 'ia', 'io', 'ee'],
  codas: ['n', 'r', 'l', 's', 'm', 'th', 'k', 't', 'd', 'rn', 'rl', 'ld', 'nd', 'st', 'rk', 'ng'],
  onsetSingle: [6, 10],
  onsetCluster: [0, 3],
  vowelSingle: [3, 5],
  vowelDiph: [0, 2],
  coda: [3, 6],
  codaChance: [22, 60],
  vowelStart: [6, 26],
  place: [2, 2],
  person: [2, 2],
};

// Which voice each culture speaks. Harsh creeds are guttural, wild/free folk flowing, makers
// temperate. Two cultures sharing a kit sound RELATED but distinct — a hint of the language
// families a later stage will model.
const CULTURE_VOICE: Record<string, PhonologyKit> = {
  martial: GUTTURAL,
  devout: GUTTURAL,
  sylvan: FLOWING,
  free: FLOWING,
  artisan: TEMPERATE,
};

export function kitFor(cultureId: string): PhonologyKit {
  return CULTURE_VOICE[cultureId] ?? TEMPERATE;
}

/** The tongue a culture speaks in this world — its kit, sampled into a distinct language
 *  (memoised, deterministic from culture + world seed). Callers name settlements/lineages
 *  with this via engine/language.coinWord. */
export function tongueFor(cultureId: string, seed: number): Language {
  return languageFor(cultureId, seed, kitFor(cultureId));
}

// ----------------------------------------------------- meaningful names ------
// A settlement's name MEANS something: a descriptor + a place-kind, each a root WORD in the
// people's tongue (so "iron" is always the same root for the Iron Creed, and its towns share
// a vocabulary you can learn). The place-kind reflects the LAND, so a name tells you about the
// site. Concepts (and their English glosses) are pack data; a sci-fi pack would swap them.

interface Concept {
  id: string;
  gloss: string;
}
const DESCRIPTORS: Concept[] = [
  { id: 'iron', gloss: 'iron' }, { id: 'grey', gloss: 'grey' }, { id: 'high', gloss: 'high' },
  { id: 'deep', gloss: 'deep' }, { id: 'old', gloss: 'old' }, { id: 'far', gloss: 'far' },
  { id: 'cold', gloss: 'cold' }, { id: 'bright', gloss: 'bright' }, { id: 'dark', gloss: 'dark' },
  { id: 'swift', gloss: 'swift' }, { id: 'red', gloss: 'red' }, { id: 'gold', gloss: 'golden' },
  { id: 'white', gloss: 'white' }, { id: 'black', gloss: 'black' }, { id: 'lost', gloss: 'lost' },
  { id: 'holy', gloss: 'hallowed' }, { id: 'stone', gloss: 'stone' }, { id: 'green', gloss: 'green' },
];
// place-kinds, grouped by the land that suits them (a coast gets a haven, a peak a hold…).
const KIND_COAST: Concept[] = [{ id: 'haven', gloss: 'haven' }, { id: 'port', gloss: 'port' }, { id: 'strand', gloss: 'strand' }];
const KIND_WOOD: Concept[] = [{ id: 'wood', gloss: 'wood' }, { id: 'grove', gloss: 'grove' }, { id: 'holt', gloss: 'holt' }];
const KIND_PEAK: Concept[] = [{ id: 'hold', gloss: 'hold' }, { id: 'peak', gloss: 'peak' }, { id: 'crag', gloss: 'crag' }];
const KIND_MARSH: Concept[] = [{ id: 'mere', gloss: 'mere' }, { id: 'marsh', gloss: 'marsh' }, { id: 'fen', gloss: 'fen' }];
const KIND_DRY: Concept[] = [{ id: 'waste', gloss: 'waste' }, { id: 'reach', gloss: 'reach' }, { id: 'span', gloss: 'span' }];
const KIND_OPEN: Concept[] = [{ id: 'field', gloss: 'field' }, { id: 'march', gloss: 'march' }, { id: 'down', gloss: 'down' }];
const KIND_WATER: Concept[] = [{ id: 'ford', gloss: 'ford' }, { id: 'mere', gloss: 'mere' }, { id: 'water', gloss: 'water' }];
const KIND_ANY: Concept[] = [{ id: 'town', gloss: 'town' }, { id: 'gate', gloss: 'gate' }, { id: 'vale', gloss: 'vale' }, { id: 'watch', gloss: 'watch' }];

/** Which kinds of place-name suit this site's LAND (coast, forest, peak, marsh, …). */
function kindsForLand(attributes: Record<string, number>): Concept[] {
  if ((attributes.coast ?? 0) > 0.55) return KIND_COAST;
  const biome = biomeOf(attributes).id;
  if (biome === 'alpine' || (attributes.elevation ?? 0) > 0.66) return KIND_PEAK;
  if (biome === 'wetland') return KIND_MARSH;
  if (biome === 'taiga' || biome === 'temperate_forest' || biome === 'jungle') return KIND_WOOD;
  if (biome === 'desert' || biome === 'tundra') return KIND_DRY;
  if ((attributes.freshWater ?? 0) > 0.6) return KIND_WATER;
  if (biome === 'grassland' || biome === 'steppe' || biome === 'savanna') return KIND_OPEN;
  return KIND_ANY;
}

// a root WORD for a concept in a culture's tongue — STABLE per (culture, concept, world), so
// the same meaning always sounds the same within a people. Memoised; lowercased for compounding.
const lexCache = new Map<string, string>();
export function lexeme(cultureId: string, seed: number, conceptId: string): string {
  const ck = `${seed}:${cultureId}:${conceptId}`;
  let root = lexCache.get(ck);
  if (root === undefined) {
    root = coinWord(tongueFor(cultureId, seed), new Rng(mixSeed(seed, hashConcept(ck))), 'root').toLowerCase();
    lexCache.set(ck, root);
  }
  return root;
}
function hashConcept(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ----------------------------------------------------- geographic features ----
// The land was named before any of this world's living cultures arose: seas, ranges and
// great rivers carry names in the OLD TONGUE — one dead language per world, sampled from
// the temperate kit under its own key. (RimWorld names its world features; MythOS names
// them philologically.) Deterministic per (world seed, feature index) — no world RNG.
const FEATURE_KINDS: Record<GeoFeature['kind'], Concept[]> = {
  sea: [{ id: 'sea', gloss: 'sea' }, { id: 'deep', gloss: 'deep' }, { id: 'gulf', gloss: 'gulf' }],
  lake: [{ id: 'mere', gloss: 'mere' }, { id: 'tarn', gloss: 'tarn' }, { id: 'lake', gloss: 'lake' }],
  range: [{ id: 'spine', gloss: 'spine' }, { id: 'peaks', gloss: 'peaks' }, { id: 'teeth', gloss: 'teeth' }],
  river: [{ id: 'run', gloss: 'run' }, { id: 'river', gloss: 'river' }, { id: 'flow', gloss: 'flow' }],
};
const OLD_TONGUE = '@old-tongue'; // a culture-id that no culture uses (its own stable voice)

/** Name a geographic feature in the world's dead OLD TONGUE, with its meaning
 *  ("Skarnald — the cold deep"). Stable for the world's lifetime. */
export function featureName(seed: number, feature: GeoFeature): { name: string; meaning: string } {
  const rng = new Rng(mixSeed(seed, 0xfea7 + feature.index * 131));
  const desc = rng.pick(DESCRIPTORS);
  const kind = rng.pick(FEATURE_KINDS[feature.kind]);
  const joined = (lexeme(OLD_TONGUE, seed, desc.id) + lexeme(OLD_TONGUE, seed, kind.id))
    .replace(/(.)\1{2,}/g, '$1$1');
  const name = joined.charAt(0).toUpperCase() + joined.slice(1);
  return { name, meaning: `the ${desc.gloss} ${kind.gloss}` };
}

/** Coin a settlement's name AND its meaning, in the founding people's tongue: a descriptor +
 *  a land-fitting place-kind, each a root in that tongue. `rng` (the worldgen stream) only
 *  picks WHICH concepts; the roots themselves are stable, so a people's towns share a lexicon. */
export function placeName(
  cultureId: string,
  seed: number,
  attributes: Record<string, number>,
  rng: Rng,
): { name: string; meaning: string } {
  const desc = rng.pick(DESCRIPTORS);
  const kind = rng.pick(kindsForLand(attributes));
  const joined = (lexeme(cultureId, seed, desc.id) + lexeme(cultureId, seed, kind.id))
    .replace(/(.)\1{2,}/g, '$1$1'); // soften an awkward seam (e.g. ...thth...)
  const name = joined.charAt(0).toUpperCase() + joined.slice(1);
  return { name, meaning: `the ${desc.gloss} ${kind.gloss}` };
}
