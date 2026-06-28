/**
 * The VOICE of this universe's tongues — PACK DATA. The engine (engine/language) knows how
 * to build and speak a language but knows NO sounds; this file supplies the phoneme palettes
 * and assigns each culture a voice. To make a Tolkien or Star Trek pack sound right, swap
 * this file alone: an elvish kit (soft liquids, open syllables), a Klingon kit (guttural
 * stops, hard codas), a Dovahzul kit — the engine is unchanged.
 */
import { type PhonologyKit, type Language, languageFor } from '../engine/language';

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
