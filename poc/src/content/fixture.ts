/**
 * Generic throwaway fixture content for the PoC.
 *
 * Deliberately abstract & original — invented species/professions/traits whose
 * only job is to exercise the SYSTEMS. In the real engine this whole file becomes
 * a data-driven Universe Pack; here it is hand-authored TS for speed.
 */
import { Rng } from '../engine/rng';
import type { Sex, Specialization, ResourceKey } from '../engine/model';

export interface Species {
  id: string;
  name: string;
  lifespan: number; // mean years
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
    onset: ['Ae', 'Sy', 'Th', 'El', 'Va', 'Ny', 'Lor', 'Cae'],
    nucleus: ['ri', 'la', 'we', 'no', 'ae', 'ly', 'sa'],
    coda: ['n', 'l', 'th', 'r', 's', 'ndor', 'wyn'],
  },
  {
    id: 'tamar',
    name: 'Tamar',
    lifespan: 72,
    onset: ['Bar', 'Hal', 'Dun', 'Ros', 'Mer', 'Gar', 'Wend', 'Tor'],
    nucleus: ['o', 'a', 'e', 'ic', 'um', 'ad'],
    coda: ['d', 'k', 'rin', 'son', 'wick', 'mund', 'ric'],
  },
  {
    id: 'grok',
    name: 'Grok',
    lifespan: 54,
    onset: ['Gr', 'Mok', 'Zar', 'Ugg', 'Brak', 'Sno', 'Dru', 'Kaz'],
    nucleus: ['o', 'u', 'a', 'og', 'uk', 'ar'],
    coda: ['g', 'k', 'z', 'nak', 'tuk', 'rok', 'mash'],
  },
];

export const FAMILY_ROOTS = [
  'Ash', 'Stone', 'Briar', 'Vale', 'Holt', 'Marsh', 'Fenn', 'Crow', 'Dunn',
  'Ironhand', 'Greycloak', 'Tallow', 'Hart', 'Weald', 'Thorn', 'Mire', 'Bram',
  'Oak', 'Hollow', 'Ridd', 'Garrow', 'Pike', 'Storr', 'Vane',
];

export const PROFESSIONS = [
  'farmer', 'smith', 'guard', 'trader', 'healer', 'hunter',
] as const;

export const TRAITS = [
  'kind', 'proud', 'hot-tempered', 'loyal', 'greedy', 'curious', 'devout', 'cruel',
] as const;

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

export function pickSex(rng: Rng): Sex {
  return rng.chance(0.5) ? 'm' : 'f';
}

export function pickTraits(rng: Rng): string[] {
  const count = rng.range(1, 3);
  const pool = [...TRAITS];
  const out: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    out.push(pool.splice(rng.int(pool.length), 1)[0]);
  }
  return out;
}

export function pickProfession(rng: Rng): string {
  return rng.pick(PROFESSIONS);
}

/** Founders skew toward working-age adults. */
export function pickFounderAge(rng: Rng): number {
  return rng.range(16, 55);
}

// ----------------------------------------------------------- economy ---------
// All per-capita-per-year. A settlement's specialization decides what it makes;
// everyone consumes the same basket, so specialists run surpluses & deficits that
// drive trade along the region graph.

export const SPECIALIZATIONS: Specialization[] = ['farming', 'mining', 'crafting', 'balanced'];

export const PRODUCTION: Record<Specialization, Record<ResourceKey, number>> = {
  farming: { food: 1.5, materials: 0.15, goods: 0.1 },
  mining: { food: 0.8, materials: 1.0, goods: 0.15 },
  crafting: { food: 0.85, materials: 0.5, goods: 0.8 },
  balanced: { food: 1.05, materials: 0.4, goods: 0.3 },
};

export const CONSUMPTION: Record<ResourceKey, number> = { food: 1.0, materials: 0.2, goods: 0.1 };

export const BASE_PRICE: Record<ResourceKey, number> = { food: 1, materials: 2, goods: 5 };

export function pickSpecialization(rng: Rng): Specialization {
  return SPECIALIZATIONS[rng.int(SPECIALIZATIONS.length)];
}
