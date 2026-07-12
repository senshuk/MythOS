/**
 * The VOICE of this universe's tongues — PACK DATA. The engine (engine/language) knows how
 * to build and speak a language but knows NO sounds; this file supplies the phoneme palettes
 * and assigns each culture a voice. To make a Tolkien or Star Trek pack sound right, swap
 * this file alone: an elvish kit (soft liquids, open syllables), a Klingon kit (guttural
 * stops, hard codas), a Dovahzul kit — the engine is unchanged.
 */
import { type PhonologyKit, type Language, type SoundShift, languageFor, coinWord, compose, applyShifts } from '../engine/language';
import { type GeoFeature } from '../engine/geography';
import { Rng, mixSeed } from '../engine/rng';
import { biomeOf } from './biomes';
import { type Deity } from './fixture';

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
// temperate.
const CULTURE_VOICE: Record<string, PhonologyKit> = {
  martial: GUTTURAL,
  devout: GUTTURAL,
  sylvan: FLOWING,
  free: FLOWING,
  artisan: TEMPERATE,
};

// ---------------------------------------------------- language families ------
// Cultures DESCEND from proto-tongues: the martial and devout creeds both speak daughters of
// a proto-guttural; the sylvan and free folk of a proto-flowing; the artisan tongue is an
// isolate. A daughter does not coin its lexicon fresh — it INHERITS the proto's roots through
// its own small set of regular sound-changes (below), so two kin cultures' words for "iron"
// are audible COGNATES: colonization history you can hear. (The engine applies shifts;
// this file — the pack — owns the family tree and which sounds may shift.)
const FAMILY: Record<string, string> = {
  martial: '@proto-guttural',
  devout: '@proto-guttural',
  sylvan: '@proto-flowing',
  free: '@proto-flowing',
};
const PROTO_KIT: Record<string, PhonologyKit> = {
  '@proto-guttural': GUTTURAL,
  '@proto-flowing': FLOWING,
};
// the regular changes a daughter tongue may undergo (lenition, fortition, vowel shifts) —
// each culture draws 2–3, applied to EVERY inherited root, so the drift is systematic.
const SOUND_SHIFTS: SoundShift[] = [
  ['k', 'kh'], ['kh', 'g'], ['g', 'k'], ['t', 'th'], ['th', 'd'], ['d', 't'],
  ['b', 'v'], ['v', 'w'], ['s', 'sh'], ['sh', 's'], ['r', 'l'], ['l', 'r'], ['m', 'n'],
  ['a', 'e'], ['e', 'i'], ['o', 'u'], ['u', 'o'], ['i', 'y'], ['au', 'o'], ['ai', 'ei'],
];
const shiftCache = new Map<string, SoundShift[]>();
function shiftsFor(cultureId: string, seed: number): SoundShift[] {
  const ck = `${seed}:${cultureId}`;
  let shifts = shiftCache.get(ck);
  if (!shifts) {
    const rng = new Rng(mixSeed(seed, hashConcept(`${cultureId}@drift`)));
    const bag = [...SOUND_SHIFTS];
    shifts = [];
    const n = 2 + rng.int(2); // 2–3 regular changes per daughter tongue
    for (let i = 0; i < n && bag.length; i++) shifts.push(bag.splice(rng.int(bag.length), 1)[0]);
    shiftCache.set(ck, shifts);
  }
  return shifts;
}

export function kitFor(cultureId: string): PhonologyKit {
  return PROTO_KIT[cultureId] ?? CULTURE_VOICE[cultureId] ?? TEMPERATE;
}

/** The character of a culture's sound, as a word for the Tongues panel. */
export function voiceOf(cultureId: string): string {
  const kit = kitFor(cultureId);
  return kit === GUTTURAL ? 'guttural' : kit === FLOWING ? 'flowing' : 'temperate';
}

/** The culture ids that share this culture's mother tongue (empty = an isolate). */
export function kinOf(cultureId: string): string[] {
  const proto = FAMILY[cultureId];
  if (!proto) return [];
  return Object.keys(FAMILY).filter((c) => c !== cultureId && FAMILY[c] === proto);
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
// A culture's descriptors lean toward its CHARACTER, so its towns' meanings sound like its
// people — a martial creed's iron and blood, a sylvan folk's green and fair. (Falls back to the
// neutral pool for any culture without a leaning.) Pack data; a sci-fi pack would swap them.
const DESC_CULTURE: Record<string, Concept[]> = {
  martial: [{ id: 'iron', gloss: 'iron' }, { id: 'grim', gloss: 'grim' }, { id: 'red', gloss: 'red' }, { id: 'war', gloss: 'war' }, { id: 'black', gloss: 'black' }, { id: 'high', gloss: 'high' }, { id: 'blood', gloss: 'blood' }],
  devout: [{ id: 'holy', gloss: 'hallowed' }, { id: 'grey', gloss: 'grey' }, { id: 'high', gloss: 'high' }, { id: 'old', gloss: 'elder' }, { id: 'white', gloss: 'white' }, { id: 'bright', gloss: 'bright' }, { id: 'still', gloss: 'still' }],
  sylvan: [{ id: 'green', gloss: 'green' }, { id: 'fair', gloss: 'fair' }, { id: 'wild', gloss: 'wild' }, { id: 'deep', gloss: 'deep' }, { id: 'bright', gloss: 'bright' }, { id: 'dawn', gloss: 'dawn' }, { id: 'silver', gloss: 'silver' }],
  free: [{ id: 'far', gloss: 'far' }, { id: 'swift', gloss: 'swift' }, { id: 'lost', gloss: 'lost' }, { id: 'wind', gloss: 'wind' }, { id: 'gold', gloss: 'golden' }, { id: 'free', gloss: 'free' }, { id: 'wide', gloss: 'wide' }],
  artisan: [{ id: 'gold', gloss: 'golden' }, { id: 'stone', gloss: 'stone' }, { id: 'bright', gloss: 'bright' }, { id: 'high', gloss: 'high' }, { id: 'deep', gloss: 'deep' }, { id: 'iron', gloss: 'iron' }, { id: 'fair', gloss: 'fair' }],
};
function descriptorsFor(cultureId: string): Concept[] {
  return DESC_CULTURE[cultureId] ?? DESCRIPTORS;
}
// grammatical morphemes — coined as stable roots like any other, so a tongue's locative
// ("-place-of") and its people-suffix recur across its names as a learnable, audible signature.
const LOC: Concept = { id: '@loc', gloss: 'stead' }; // a settlement/locative suffix
const PPL: Concept = { id: '@ppl', gloss: 'folk' }; // a people/demonym suffix
const SELF: Concept = { id: '@self', gloss: 'self' }; // a culture's endonym root
// place-kinds, grouped by the land that suits them (a coast gets a haven, a peak a hold…).
// Wide pools — real maps repeat -ton and -by, but they also have quays, tors, crofts and fells.
const KIND_COAST: Concept[] = [
  { id: 'haven', gloss: 'haven' }, { id: 'port', gloss: 'port' }, { id: 'strand', gloss: 'strand' },
  { id: 'cove', gloss: 'cove' }, { id: 'bay', gloss: 'bay' }, { id: 'point', gloss: 'point' },
  { id: 'sands', gloss: 'sands' }, { id: 'cliff', gloss: 'cliff' }, { id: 'quay', gloss: 'quay' },
];
const KIND_WOOD: Concept[] = [
  { id: 'wood', gloss: 'wood' }, { id: 'grove', gloss: 'grove' }, { id: 'holt', gloss: 'holt' },
  { id: 'glade', gloss: 'glade' }, { id: 'shaw', gloss: 'shaw' }, { id: 'thicket', gloss: 'thicket' },
];
const KIND_PEAK: Concept[] = [
  { id: 'hold', gloss: 'hold' }, { id: 'peak', gloss: 'peak' }, { id: 'crag', gloss: 'crag' },
  { id: 'tor', gloss: 'tor' }, { id: 'pass', gloss: 'pass' }, { id: 'cairn', gloss: 'cairn' },
  { id: 'fell', gloss: 'fell' },
];
const KIND_MARSH: Concept[] = [
  { id: 'mere', gloss: 'mere' }, { id: 'marsh', gloss: 'marsh' }, { id: 'fen', gloss: 'fen' },
  { id: 'carr', gloss: 'carr' }, { id: 'sedge', gloss: 'sedge' },
];
const KIND_DRY: Concept[] = [
  { id: 'waste', gloss: 'waste' }, { id: 'reach', gloss: 'reach' }, { id: 'span', gloss: 'span' },
  { id: 'dunes', gloss: 'dunes' }, { id: 'pan', gloss: 'pan' }, { id: 'rock', gloss: 'rock' },
];
const KIND_OPEN: Concept[] = [
  { id: 'field', gloss: 'field' }, { id: 'march', gloss: 'march' }, { id: 'down', gloss: 'down' },
  { id: 'meadow', gloss: 'meadow' }, { id: 'heath', gloss: 'heath' }, { id: 'croft', gloss: 'croft' },
  { id: 'wold', gloss: 'wold' },
];
const KIND_WATER: Concept[] = [
  { id: 'ford', gloss: 'ford' }, { id: 'mere', gloss: 'mere' }, { id: 'water', gloss: 'water' },
  { id: 'bridge', gloss: 'bridge' }, { id: 'well', gloss: 'well' }, { id: 'springs', gloss: 'springs' },
  { id: 'mill', gloss: 'mill' }, { id: 'pool', gloss: 'pool' },
];
const KIND_ANY: Concept[] = [
  { id: 'town', gloss: 'town' }, { id: 'gate', gloss: 'gate' }, { id: 'vale', gloss: 'vale' },
  { id: 'watch', gloss: 'watch' }, { id: 'market', gloss: 'market' }, { id: 'cross', gloss: 'cross' },
  { id: 'hall', gloss: 'hall' }, { id: 'mound', gloss: 'mound' },
];

/** Which kinds of place-name suit this site's LAND — a WEIGHTED merge, not a single pool:
 *  a wooded coast can yield a cove OR a holt, with the dominant terrain weighted heavier
 *  (duplicated entries = weight). Geography shapes the odds; it doesn't dictate one answer. */
function kindsForLand(attributes: Record<string, number>): Concept[] {
  const pool: Concept[] = [...KIND_ANY];
  const heavy = (kinds: Concept[]) => pool.push(...kinds, ...kinds); // dominant terrain: 2×
  if ((attributes.coast ?? 0) > 0.55) heavy(KIND_COAST);
  else if ((attributes.coast ?? 0) > 0.3) pool.push(...KIND_COAST);
  if ((attributes.freshWater ?? 0) > 0.6) heavy(KIND_WATER);
  else if ((attributes.freshWater ?? 0) > 0.35) pool.push(...KIND_WATER);
  const biome = biomeOf(attributes).id;
  if (biome === 'alpine' || (attributes.elevation ?? 0) > 0.66) heavy(KIND_PEAK);
  else if ((attributes.elevation ?? 0) > 0.5) pool.push(...KIND_PEAK);
  if (biome === 'wetland') heavy(KIND_MARSH);
  if (biome === 'taiga' || biome === 'temperate_forest' || biome === 'jungle') heavy(KIND_WOOD);
  if (biome === 'desert' || biome === 'tundra') heavy(KIND_DRY);
  if (biome === 'grassland' || biome === 'steppe' || biome === 'savanna') heavy(KIND_OPEN);
  return pool;
}

// how a settlement can relate to a NAMED feature it sits beside — the hydronym pattern
// (Exmouth = the mouth of the Exe; the feature's name is older than the town's tongue).
const FEAT_RELATION: Record<GeoFeature['kind'], Concept[]> = {
  river: [
    { id: 'mouth', gloss: 'mouth of the' }, { id: 'ford', gloss: 'ford on the' },
    { id: 'bank', gloss: 'bank of the' }, { id: 'bend', gloss: 'bend of the' },
    { id: 'bridge', gloss: 'bridge over the' },
  ],
  lake: [
    { id: 'shore', gloss: 'shore of the' }, { id: 'gate', gloss: 'gate of the' },
    { id: 'strand', gloss: 'strand of the' },
  ],
  sea: [
    { id: 'strand', gloss: 'strand of the' }, { id: 'gate', gloss: 'gate of the' },
    { id: 'watch', gloss: 'watch on the' }, { id: 'haven', gloss: 'haven on the' },
  ],
  range: [
    { id: 'foot', gloss: 'foot of the' }, { id: 'gate', gloss: 'gate of the' },
    { id: 'pass', gloss: 'pass of the' }, { id: 'shade', gloss: 'shade of the' },
  ],
};
// a founding people may dedicate their first city to their patron deity — the settlement's
// own tongue coins a root for the deity (like any other lexeme, so a kin culture sharing the
// same god would still say it in ITS own cognate word) and wraps it in a devotional relation.
const SACRED_RELATION: Concept[] = [
  { id: 'temple', gloss: 'temple of' }, { id: 'shrine', gloss: 'shrine of' },
  { id: 'seat', gloss: 'seat of' }, { id: 'hearth', gloss: 'hearth of' },
];
const NEW: Concept = { id: 'new', gloss: 'new' };
const DIRS: Record<string, Concept> = {
  north: { id: 'north', gloss: 'north' }, south: { id: 'south', gloss: 'south' },
  east: { id: 'east', gloss: 'east' }, west: { id: 'west', gloss: 'west' },
};

// a root WORD for a concept in a culture's tongue — STABLE per (culture, concept, world), so
// the same meaning always sounds the same within a people. Memoised; lowercased for compounding.
// A culture with an ANCESTOR (see FAMILY) does not coin the root fresh: it INHERITS the
// proto-tongue's root through its own regular sound-changes — so kin cultures hold COGNATES
// ("korth" / "khorth" for iron), while an isolate coins its own.
const lexCache = new Map<string, string>();
export function lexeme(cultureId: string, seed: number, conceptId: string): string {
  const ck = `${seed}:${cultureId}:${conceptId}`;
  let root = lexCache.get(ck);
  if (root === undefined) {
    const proto = FAMILY[cultureId];
    root = proto
      ? applyShifts(lexeme(proto, seed, conceptId), shiftsFor(cultureId, seed))
      : coinWord(tongueFor(cultureId, seed), new Rng(mixSeed(seed, hashConcept(ck))), 'root').toLowerCase();
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
  const name = compose(tongueFor(OLD_TONGUE, seed), [lexeme(OLD_TONGUE, seed, desc.id), lexeme(OLD_TONGUE, seed, kind.id)]);
  return { name, meaning: `the ${desc.gloss} ${kind.gloss}` };
}

// ----------------------------------------------------------- public venues ----
// A tavern is named in its OWN people's tongue ("Voskhara — 'the bright hearth'"),
// like towns and features — deterministic per (world, salt), no world RNG.
const VENUE_CONCEPTS: Concept[] = [
  { id: 'hearth', gloss: 'hearth' },
  { id: 'hall', gloss: 'hall' },
  { id: 'rest', gloss: 'rest' },
  { id: 'cup', gloss: 'cup' },
];

/** Name a public VENUE in its people's own tongue, with its meaning. Stable per
 *  (world seed, salt) — the same tavern always answers to the same name. */
export function venueName(cultureId: string, seed: number, salt: number): { name: string; meaning: string } {
  const rng = new Rng(mixSeed(seed, 0x7a3e, salt));
  const desc = rng.pick(DESCRIPTORS);
  const kind = rng.pick(VENUE_CONCEPTS);
  const name = compose(tongueFor(cultureId, seed), [lexeme(cultureId, seed, desc.id), lexeme(cultureId, seed, kind.id)]);
  return { name, meaning: `the ${desc.gloss} ${kind.gloss}` };
}

/** A curated sample of concepts for the Tongues panel — enough of a lexicon to LEARN a
 *  people's words and recognise them in town names, without dumping the whole table. */
export const LEXICON_SAMPLE: { id: string; gloss: string }[] = [
  { id: 'iron', gloss: 'iron' }, { id: 'high', gloss: 'high' }, { id: 'old', gloss: 'old' },
  { id: 'deep', gloss: 'deep' }, { id: 'bright', gloss: 'bright' }, { id: 'stone', gloss: 'stone' },
  { id: 'haven', gloss: 'haven' }, { id: 'ford', gloss: 'ford' }, { id: 'wood', gloss: 'wood' },
  { id: 'hold', gloss: 'hold' }, { id: '@loc', gloss: 'stead (settlement)' }, { id: '@ppl', gloss: 'folk (people)' },
];

/** The people's own name for themselves — a stable endonym root + the tongue's people-suffix
 *  ("the Korthun"). Deterministic per (culture, world); the suffix recurs across kin tongues. */
export function peopleName(cultureId: string, seed: number): string {
  const lang = tongueFor(cultureId, seed);
  return compose(lang, [lexeme(cultureId, seed, SELF.id), lexeme(cultureId, seed, PPL.id)]);
}

/** A person's GIVEN name, coined in their CULTURE's tongue — naming follows culture, not
 *  biology, so an assimilated individual takes their new people's names. */
export function givenName(cultureId: string, seed: number, rng: Rng): string {
  return coinWord(tongueFor(cultureId, seed), rng, 'given');
}

// heraldic nouns for House epithets — the second half of a lineage name ("the Iron HAND").
const HOUSE_NOUNS: Concept[] = [
  { id: 'hand', gloss: 'hand' }, { id: 'heart', gloss: 'heart' }, { id: 'blade', gloss: 'blade' },
  { id: 'oath', gloss: 'oath' }, { id: 'crown', gloss: 'crown' }, { id: 'banner', gloss: 'banner' },
  { id: 'watch', gloss: 'watch' }, { id: 'shield', gloss: 'shield' }, { id: 'spear', gloss: 'spear' },
  { id: 'stone', gloss: 'stone' }, { id: 'thorn', gloss: 'thorn' }, { id: 'gate', gloss: 'gate' },
  { id: 'wolf', gloss: 'wolf' }, { id: 'raven', gloss: 'raven' }, { id: 'stag', gloss: 'stag' },
  { id: 'star', gloss: 'star' },
];

/** A House/lineage name AND its meaning — a heraldic epithet in the founders' tongue
 *  ("Korthan — the Iron Hand"), built from the SAME stable roots as their homeland's names, so
 *  a House shares words with the towns around it. `rng` (the worldgen stream) picks which
 *  descriptor + noun; the roots are stable. */
export function houseName(cultureId: string, seed: number, rng: Rng): { name: string; meaning: string } {
  const desc = rng.pick(descriptorsFor(cultureId));
  const noun = rng.pick(HOUSE_NOUNS);
  return {
    name: compose(tongueFor(cultureId, seed), [lexeme(cultureId, seed, desc.id), lexeme(cultureId, seed, noun.id)]),
    meaning: `the ${desc.gloss} ${noun.gloss}`,
  };
}

/** What a new settlement KNOWS about its situation — the raw material real place-names are
 *  made of. A named landmark nearby lets the town take the feature's (old-tongue) name, the
 *  way Exmouth takes the Exe's; a mother settlement lets a colony commemorate or orient. */
export interface PlaceContext {
  /** the named geographic feature the site sits beside, if any. */
  landmark?: { name: string; kind: GeoFeature['kind'] };
  /** for a daughter colony: the mother settlement and the new site's offset from it. */
  parent?: { name: string; dx: number; dy: number };
  /** the founding people's patron deity, if this site may become a holy city (origins only). */
  deity?: Deity;
}

/** Coin a settlement's name AND its meaning in the founding people's tongue, the way real
 *  toponyms were made — from what the founders KNEW: the landmark they settled beside
 *  ("the mouth of the Skarnald", hydronym pattern), the mother city they left ("new Kordul",
 *  "north Kordul"), the founder themselves ("Ereth's ford", "home of Ereth's folk"), or the
 *  look of the land ("the iron haven", "the grey stead"). `rng` (the worldgen stream) picks
 *  the template + WHICH concepts; the roots are stable, so a people's towns still share a
 *  learnable lexicon. Descriptors lean to the culture's character. */
export function placeName(
  cultureId: string,
  seed: number,
  attributes: Record<string, number>,
  rng: Rng,
  ctx?: PlaceContext,
): { name: string; meaning: string } {
  const lang = tongueFor(cultureId, seed);
  const descs = descriptorsFor(cultureId);
  const lex = (id: string) => lexeme(cultureId, seed, id);

  // weighted templates, only those whose raw material exists (deterministic walk)
  const templates: [string, number][] = [];
  if (ctx?.landmark) templates.push(['feature', 26]);
  if (ctx?.parent) templates.push(['colonial', 16]);
  if (ctx?.deity) templates.push(['sacred', 20]);
  templates.push(['compound', 22], ['locative', 12], ['possessive', 12], ['founderkin', 12]);
  let total = 0;
  for (const [, w] of templates) total += w;
  let roll = rng.int(total);
  let pick = templates[templates.length - 1][0];
  for (const [t, w] of templates) {
    if (roll < w) { pick = t; break; }
    roll -= w;
  }

  switch (pick) {
    case 'feature': {
      // HYDRONYM — the town borrows the landmark's (old-tongue) name + how it sits on it:
      // "Skarnaldun — the mouth of the Skarnald". The land's dead name lives on in the town's.
      const f = ctx!.landmark!;
      const rel = rng.pick(FEAT_RELATION[f.kind]);
      return { name: compose(lang, [f.name.toLowerCase(), lex(rel.id)]), meaning: `the ${rel.gloss} ${f.name}` };
    }
    case 'sacred': {
      // DEVOTIONAL — the founders name their new home for the god they carried with them
      // ("Skarat — the temple of the Iron Father"); the deity's own root is a lexeme like
      // any other, so a kin culture sharing this god would still say it in ITS own cognate.
      const deity = ctx!.deity!;
      const rel = rng.pick(SACRED_RELATION);
      return { name: compose(lang, [lex(`deity:${deity.id}`), lex(rel.id)]), meaning: `${rel.gloss} ${deity.name}` };
    }
    case 'colonial': {
      // TRANSFER — a colony commemorates its mother city ("new Kordul") or orients by her
      // ("north Kordul"), from the ACTUAL direction the colonists marched.
      const p = ctx!.parent!;
      const dir = Math.abs(p.dx) > Math.abs(p.dy) ? (p.dx > 0 ? DIRS.east : DIRS.west) : (p.dy > 0 ? DIRS.south : DIRS.north);
      const mark = rng.chance(0.45) ? NEW : dir;
      return { name: compose(lang, [lex(mark.id), p.name.toLowerCase()]), meaning: `${mark.gloss} ${p.name}` };
    }
    case 'locative': {
      // LOCATIVE — descriptor + the tongue's settlement suffix ("the grey stead"); the suffix
      // is one stable morpheme, so it recurs across this people's towns like -ton or -by.
      const desc = rng.pick(descs);
      return { name: compose(lang, [lex(desc.id), lex(LOC.id)]), meaning: `the ${desc.gloss} ${LOC.gloss}` };
    }
    case 'possessive': {
      // POSSESSIVE — a founder's name + a land-kind ("Ereth's ford"); the founder is coined
      // afresh for this town (the worldgen stream), the kind stays stable.
      const founder = coinWord(lang, rng, 'given');
      const kind = rng.pick(kindsForLand(attributes));
      return { name: compose(lang, [founder.toLowerCase(), lex(kind.id)]), meaning: `${founder}'s ${kind.gloss}` };
    }
    case 'founderkin': {
      // FOUNDER-KIN — the -ingham pattern: founder + people-suffix + settlement suffix,
      // "home of Ereth's folk". The tongue's @ppl/@loc morphemes recur, audibly.
      const founder = coinWord(lang, rng, 'given');
      return { name: compose(lang, [founder.toLowerCase(), lex(PPL.id), lex(LOC.id)]), meaning: `home of ${founder}'s folk` };
    }
    default: {
      // COMPOUND — descriptor + land-kind ("the iron haven")
      const desc = rng.pick(descs);
      const kind = rng.pick(kindsForLand(attributes));
      return { name: compose(lang, [lex(desc.id), lex(kind.id)]), meaning: `the ${desc.gloss} ${kind.gloss}` };
    }
  }
}
