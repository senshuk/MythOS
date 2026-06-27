/**
 * Lifecycle system — runs yearly. Aging, natural death (age-curved), and births.
 * Reproduction follows each species' DATA (fixture.ts `Reproduction`): sexual species
 * bear within a pair-bond (only the bearer sex), hermaphroditic ones likewise but
 * either partner may bear, and asexual ones bear ALONE with no mate. No hardcoded
 * 'f'-mother / two-parent assumption.
 */
import { type World, type EntityId, DAYS_PER_YEAR } from '../engine/model';
import { fullActors, createActor, emit } from '../engine/world';
import { killActor } from '../engine/world';
import {
  speciesById,
  generateGiven,
  pickSex,
  pickTraits,
  pickProfession,
  fertileWindowOf,
  canBear,
  isAsexual,
  fecundityOf,
} from '../content/fixture';

export function deathProbability(age: number, lifespan: number): number {
  const r = age / lifespan;
  // tiny baseline + steep rise as age approaches lifespan; most die in a
  // believable old-age band so the population can sustain itself.
  return Math.min(0.55, 0.0015 + Math.pow(r, 7) * 0.22);
}

export function lifecycleYearly(world: World): void {
  const rng = world.rng;

  const focused = fullActors(world); // only the focused settlement is full-fidelity

  // 1) age everyone, then roll natural death
  for (const id of focused) {
    const lc = world.lifecycle.get(id)!;
    lc.ageYears += 1;
    const sp = speciesById(world.identity.get(id)!.speciesId);
    if (rng.chance(deathProbability(lc.ageYears, sp.lifespan))) {
      killActor(world, id, world.tick, 'died', [], []);
    }
  }

  // 2) births: collect this year's BEARERS (each child has exactly one bearer).
  //    pair-bonding species bear within a marriage (one designated bearer per couple);
  //    asexual species bear alone. Determined per species DATA, not a hardcoded sex.
  const bearers: EntityId[] = [];
  for (const id of focused) {
    const lc = world.lifecycle.get(id)!;
    if (!lc.alive) continue; // may have died of old age above
    const idn = world.identity.get(id)!;
    if (!canBear(idn.speciesId, idn.sex)) continue;
    const [fertileFrom, fertileTo] = fertileWindowOf(idn.speciesId);
    if (lc.ageYears < fertileFrom || lc.ageYears > fertileTo) continue;

    if (isAsexual(idn.speciesId)) {
      bearers.push(id); // reproduces alone — no mate required
      continue;
    }
    // pair-bonding: needs a living spouse, and exactly ONE partner bears per couple.
    const spouse = world.ties.get(id)!.spouse;
    if (spouse === undefined) continue;
    const sp = world.lifecycle.get(spouse)!;
    if (!sp.alive) continue;
    // if the spouse can ALSO bear (hermaphroditic couple), the lower id bears, so the
    // couple is counted once.
    const spi = world.identity.get(spouse)!;
    if (canBear(spi.speciesId, spi.sex) && spouse < id) continue;
    bearers.push(id);
  }

  // Per-bearer yearly birth chance comes from the species (fecundity) — tuned per
  // species so each reproduction mode lands near replacement in the focused settlement.
  for (const bearer of bearers) {
    if (!rng.chance(fecundityOf(world.identity.get(bearer)!.speciesId))) continue;
    bear(world, bearer);
  }
}

function bear(world: World, bearer: EntityId): void {
  const rng = world.rng;
  const idn = world.identity.get(bearer)!;
  const species = idn.speciesId;
  const mate = world.ties.get(bearer)!.spouse; // undefined for asexual (solo) births
  const parents = mate !== undefined ? [bearer, mate] : [bearer];

  const childId = createActor(world, {
    given: generateGiven(rng, species),
    family: idn.family, // the child takes the bearer's family (no patrilineal assumption)
    sex: pickSex(rng, species),
    speciesId: species,
    profession: pickProfession(rng), // grows up into a trade (PoC abstraction)
    traits: pickTraits(rng),
    ageYears: 0,
    parents,
  });

  world.ties.get(bearer)!.children.push(childId);
  if (mate !== undefined) world.ties.get(mate)!.children.push(childId);

  emit(world, 'born', mate !== undefined ? [childId, bearer, mate] : [childId, bearer], {});
}

export const LIFECYCLE_CADENCE_DAYS = DAYS_PER_YEAR;
