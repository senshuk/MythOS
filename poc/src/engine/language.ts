/**
 * Procedural PHILOLOGY (Stage 1 — phonology) — the GENERIC MECHANISM.
 *
 * The engine knows the SHAPE of a sound system and how to assemble names from one; it knows
 * NO specific sounds. A `PhonologyKit` — the palette + style of a universe's (or a culture's)
 * tongues — is PACK DATA (see content/languages): a Tolkien pack gives elves a soft kit and
 * dwarves a harsh one; a Star Trek pack pins Klingon's guttural inventory; ours leans its
 * creeds guttural and its wild folk flowing. Swap the kits and the same engine speaks any
 * universe. `makeLanguage(rng, kit)` samples a distinct tongue from a kit; `coinWord` builds
 * a name. Deterministic, never serialized (regenerated on load like the map).
 */
import { Rng, mixSeed } from './rng';

/** A pack-supplied sound palette + style: the VOICE a universe (or culture) speaks in. The
 *  engine samples a subset of each pool, so cultures sharing a kit sound related-but-distinct. */
export interface PhonologyKit {
  onsetsSingle: string[]; // pools the generator draws a subset from
  onsetsCluster: string[];
  vowelsSingle: string[];
  vowelsDiph: string[];
  codas: string[];
  onsetSingle: [number, number]; // how many of each to keep (subset-size range)
  onsetCluster: [number, number];
  vowelSingle: [number, number];
  vowelDiph: [number, number];
  coda: [number, number];
  codaChance: [number, number]; // %, rolled once per language (open vs clipped tongue)
  vowelStart: [number, number]; // %, chance a word opens on a bare vowel
  place: [number, number]; // settlement-name syllable count
  person: [number, number]; // surname syllable count
}

/** A generated tongue — a concrete phonology sampled from a kit. */
export interface Language {
  onsets: string[];
  nuclei: string[];
  codas: string[];
  codaChance: number;
  vowelStart: number;
  place: [number, number];
  person: [number, number];
}

function pickSubset(pool: readonly string[], rng: Rng, [min, max]: [number, number]): string[] {
  const n = Math.min(pool.length, rng.range(min, max));
  const bag = [...pool];
  const out: string[] = [];
  for (let i = 0; i < n && bag.length; i++) out.push(bag.splice(rng.int(bag.length), 1)[0]);
  return out;
}

/** Generate a tongue: a distinct selection from a kit's palette + a syllable style. */
export function makeLanguage(rng: Rng, kit: PhonologyKit): Language {
  return {
    onsets: [...pickSubset(kit.onsetsSingle, rng, kit.onsetSingle), ...pickSubset(kit.onsetsCluster, rng, kit.onsetCluster)],
    nuclei: [...pickSubset(kit.vowelsSingle, rng, kit.vowelSingle), ...pickSubset(kit.vowelsDiph, rng, kit.vowelDiph)],
    codas: pickSubset(kit.codas, rng, kit.coda),
    codaChance: rng.range(kit.codaChance[0], kit.codaChance[1]) / 100,
    vowelStart: rng.range(kit.vowelStart[0], kit.vowelStart[1]) / 100,
    place: kit.place,
    person: kit.person,
  };
}

const cache = new Map<string, Language>();
function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The (memoised) tongue for a key (a culture id) drawn from `kit`, deterministic from key +
 *  world seed. The PACK resolves which kit a culture speaks (content/languages.tongueFor). */
export function languageFor(key: string, seed: number, kit: PhonologyKit): Language {
  const ck = `${seed}:${key}`;
  let lang = cache.get(ck);
  if (!lang) {
    lang = makeLanguage(new Rng(mixSeed(seed, hashKey(key))), kit);
    cache.set(ck, lang);
  }
  return lang;
}

function polish(w: string): string {
  let s = w.replace(/(.)\1{2,}/g, '$1$1'); // no runs of 3+ identical letters
  s = s.replace(/([aeiou])\1/g, '$1'); // no doubled identical vowels at a seam
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Coin a word in a tongue: a settlement name ('place'), a surname ('person'), or a single
 *  morpheme ('root') — the building block of MEANINGFUL compound names, kept to one syllable
 *  so a two-root name stays short ("Korth" + "ul" = Korthul, not a mouthful). */
export function coinWord(lang: Language, rng: Rng, kind: 'place' | 'person' | 'root'): string {
  const [lo, hi] = kind === 'place' ? lang.place : kind === 'person' ? lang.person : [1, 1];
  const syllables = rng.range(lo, hi);
  let w = '';
  for (let i = 0; i < syllables; i++) {
    if (!(i === 0 && rng.chance(lang.vowelStart))) w += rng.pick(lang.onsets);
    w += rng.pick(lang.nuclei);
    const last = i === syllables - 1;
    if (rng.chance(lang.codaChance) && (last || rng.chance(0.4))) w += rng.pick(lang.codas);
  }
  return polish(w);
}
