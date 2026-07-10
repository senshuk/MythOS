/**
 * AEON REACH — the PROOF pack (agnosticism Phase E).
 *
 * A deliberately CONTRARIAN universe whose one job is to catch fantasy assumptions the
 * engine might silently hold. Everywhere the fantasy pack leans one way, this leans the
 * other: ONE species (not three) that is ASEXUAL and short-lived (no marriage, no
 * two-parent families), TWO amoral cultures with NO precepts, NO faith (secular — the
 * religion and faction modules are off), ONE elected government. If the engine runs
 * this world end-to-end (worldgen → years → save/load, deterministic), the pack
 * boundary is real.
 *
 * AUTHORING LESSON (learned here, remember it for Tolkien/Trek): a pack is not a
 * spread-merge of another pack's functions — the fantasy accessors CLOSE OVER the
 * fantasy tables (its cultureById finds in its CULTURES), so a pack that brings its own
 * data must also bring the accessors bound to that data. Pure MECHANISM (thought/mood/
 * need tables, intents, actions, narrative grammar, biomes, tongues machinery) is
 * safely reusable; everything touching SPECIES/CULTURES/GOVERNMENTS/DEITIES is
 * reimplemented below over aeon data.
 */
import { Rng } from '../engine/rng';
import { FANTASY_PACK, type UniversePack } from '../engine/pack';
import type { Sex } from '../engine/model';
import type { Species, Culture, Deity, Government, SuccessionMode, ValueAxis, Precept } from './fixture';
import { VALUES, TRAITS, reputeSpec } from './fixture';

// ------------------------------------------------------------ identity -------
const PACK_ID = 'aeon';
const PACK_VERSION = 1;
const MODULES = {
  religion: false, // a secular universe: no faith bonds, no conversion, no creed judgement
  factions: false, // no creed factionalism, civil wars or exile
  travel: true,
};

// ------------------------------------------------------------- species -------
// ONE species, asexual: every unit buds alone. No pair bonds → the engine's courtship,
// marriage and two-parent paths must all quietly stand down.
const SPECIES: Species[] = [
  {
    id: 'syntid',
    name: 'Syntid',
    lifespan: 45,
    maturity: 3, // units come online fast
    elderhood: 34,
    fertileFrom: 3,
    fertileTo: 38,
    reproduction: { mode: 'asexual', sexes: ['unit'], pairBonds: false, monogamous: false, fecundity: 0.08 },
    defaultCulture: 'combine',
    onset: ['Ax', 'Vek', 'Syn', 'Od', 'Kel'], // legacy banks (unused since cultural given names)
    nucleus: ['a', 'e', 'o', 'ix'],
    coda: ['n', 'x', 'd', 'r'],
  },
];
const speciesById = (id: string): Species => SPECIES.find((s) => s.id === id)!;
const maturityOf = (id: string): number => speciesById(id).maturity;
const elderhoodOf = (id: string): number => speciesById(id).elderhood;
const fertileWindowOf = (id: string): [number, number] => {
  const s = speciesById(id);
  return [s.fertileFrom, s.fertileTo];
};
const pickSex = (rng: Rng, id: string): Sex => {
  const sexes = speciesById(id).reproduction.sexes;
  if (sexes.length === 2) return rng.chance(0.5) ? sexes[0] : sexes[1];
  if (sexes.length === 1) return sexes[0];
  return sexes[rng.int(sexes.length)];
};
const pairBondsFor = (id: string): boolean => speciesById(id).reproduction.pairBonds;
const isAsexual = (id: string): boolean => speciesById(id).reproduction.mode === 'asexual';
const fecundityOf = (id: string): number => speciesById(id).reproduction.fecundity;
const macroFertilityOf = (id: string): number => speciesById(id).reproduction.macroFertility ?? 1;
const monogamousOf = (id: string): boolean => speciesById(id).reproduction.monogamous;
const canBear = (id: string, sex: string): boolean => {
  const r = speciesById(id).reproduction;
  if (r.mode === 'sexual') return r.bearer === undefined || sex === r.bearer;
  return true;
};
const unionViable = (spA: string, sexA: string, spB: string, sexB: string): boolean => {
  const ra = speciesById(spA).reproduction;
  const rb = speciesById(spB).reproduction;
  if (!ra.pairBonds || !rb.pairBonds) return false;
  if (!canBear(spA, sexA) && !canBear(spB, sexB)) return false;
  if (ra.mode === 'sexual' || rb.mode === 'sexual') return sexA !== sexB;
  return true;
};

// ------------------------------------------------------------- cultures ------
// TWO cultures, both amoral: NO precepts, NO state precepts — every optional moral
// path in the engine must tolerate their absence. Opposed values so wars still have
// reasons (craft-order vs raider-freedom).
const CULTURES: Culture[] = [
  {
    id: 'combine',
    name: 'the Combine',
    color: '#7fd4c1',
    patronDeityId: 'core_mind',
    values: { craft: 40, tradition: 25, war: -20, freedom: -15 },
  },
  {
    id: 'swarm',
    name: 'the Swarm',
    color: '#d47f9e',
    patronDeityId: 'core_mind',
    values: { freedom: 40, war: 25, craft: -10, tradition: -30 },
  },
];
const cultureById = (id: string): Culture => CULTURES.find((c) => c.id === id) ?? CULTURES[0];
const valueOf = (c: Culture, axis: ValueAxis): number => c.values[axis] ?? 0;
const culturalDistance = (aId: string, bId: string): number => {
  const a = cultureById(aId);
  const b = cultureById(bId);
  let sum = 0;
  for (const axis of VALUES) sum += Math.abs(valueOf(a, axis) - valueOf(b, axis));
  return sum / VALUES.length;
};
const mostOpposedValue = (aId: string, bId: string): ValueAxis => {
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
};
const pickCulture = (rng: Rng, speciesId: string): string => {
  const def = speciesById(speciesId).defaultCulture;
  return rng.chance(0.7) ? def : CULTURES[rng.int(CULTURES.length)].id;
};
const valueProfile = (cultureId: string, traitIds: string[], rng: Rng): Record<ValueAxis, number> => {
  // same law as the fantasy pack (culture base + trait shifts + personal jitter), bound
  // to AEON cultures; traits are reused mechanism, so their shifts come from the shared table.
  const base = cultureById(cultureId).values;
  const p = {} as Record<ValueAxis, number>;
  for (const axis of VALUES) {
    let v = base[axis] ?? 0;
    for (const t of traitIds) {
      const shift = TRAITS.find((d) => d.id === t)?.values?.[axis];
      if (shift !== undefined) v += shift;
    }
    v += rng.range(-12, 12);
    p[axis] = Math.max(-50, Math.min(50, v));
  }
  return p;
};
const preceptFor = (cultureId: string, deedKind: string): Precept | undefined =>
  cultureById(cultureId).precepts?.find((p) => p.deed === deedKind);
const ethicsWeightFor = (cultureId: string, deedKind: string): number => preceptFor(cultureId, deedKind)?.socialWeight ?? 1.0;
const ethicsTaboos = (cultureId: string): string[] =>
  (cultureById(cultureId).precepts ?? []).filter((p) => (p.socialWeight ?? 0) >= 1.5).map((p) => reputeSpec(p.deed).label);
const creedOf = (cultureId: string): { reveres: string[]; abhors: string[] } => {
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
};

// -------------------------------------------------------------- deities ------
// One token mind, never worshipped: religion is OFF and nobody is born faithful.
const DEITIES: Deity[] = [{ id: 'core_mind', name: 'the Core Mind', domain: 'computation and continuity' }];
const deityById = (id: string): Deity => DEITIES.find((d) => d.id === id) ?? DEITIES[0];
const patronDeityOf = (cultureId: string): Deity => deityById(cultureById(cultureId).patronDeityId);
const faithProbability = (): number => 0; // secular: faith is never seeded

// ----------------------------------------------------------- government ------
// ONE government, elected. No hereditary lines — dynasties must still work (Houses can
// exist without crowns), and succession is term-driven.
const GOVERNMENTS: Government[] = [{ id: 'directorate', title: 'Director', succession: 'elected' as SuccessionMode, termYears: 12 }];
const POLITY_LABELS: Record<string, string> = { directorate: 'Directorate' };
const governmentById = (id: string): Government => GOVERNMENTS.find((g) => g.id === id) ?? GOVERNMENTS[0];
const pickGovernment = (rng: Rng): string => rng.pick(GOVERNMENTS).id;
const successionOf = (id: string): SuccessionMode => governmentById(id).succession;
const leaderTitleOf = (id: string): string => governmentById(id).title;
const hasLeader = (id: string): boolean => governmentById(id).succession !== 'none';
const reignSpan = (id: string, rng: Rng): number => {
  const g = governmentById(id);
  return g.succession === 'elected' && g.termYears !== undefined ? g.termYears : rng.range(15, 45);
};

/** The Aeon Reach universe: contrarian data + its accessors, over the shared mechanism
 *  (thoughts, mood, needs, intents, actions, biomes, tongues machinery, narrative). */
export const AEON_PACK: UniversePack = {
  ...FANTASY_PACK,
  PACK_ID,
  PACK_VERSION,
  MODULES,
  SPECIES,
  speciesById,
  maturityOf,
  elderhoodOf,
  fertileWindowOf,
  pickSex,
  pairBondsFor,
  isAsexual,
  fecundityOf,
  macroFertilityOf,
  monogamousOf,
  canBear,
  unionViable,
  CULTURES,
  cultureById,
  culturalDistance,
  mostOpposedValue,
  pickCulture,
  valueProfile,
  preceptFor,
  ethicsWeightFor,
  ethicsTaboos,
  creedOf,
  DEITIES,
  deityById,
  patronDeityOf,
  faithProbability,
  GOVERNMENTS,
  POLITY_LABELS,
  governmentById,
  pickGovernment,
  successionOf,
  leaderTitleOf,
  hasLeader,
  reignSpan,
};
