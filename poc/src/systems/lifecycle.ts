/**
 * Lifecycle system — runs yearly. Aging, natural death (age-curved), and births
 * to married couples. Births reference the marriage as their cause, so a child's
 * existence is traceable back through the courtship that produced the marriage.
 */
import { type World, type EntityId, DAYS_PER_YEAR } from '../engine/model';
import { fullActors, createActor, emit } from '../engine/world';
import { killActor } from './social';
import {
  speciesById,
  generateGiven,
  pickSex,
  pickTraits,
  pickProfession,
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

  // 2) births: iterate living married mothers (each couple counted once)
  const mothers: EntityId[] = [];
  for (const id of focused) {
    const lc = world.lifecycle.get(id)!;
    if (!lc.alive) continue; // may have died of old age above
    const idn = world.identity.get(id)!;
    if (idn.sex !== 'f') continue;
    const spouse = world.ties.get(id)!.spouse;
    if (spouse === undefined) continue;
    if (!world.lifecycle.get(spouse)!.alive) continue;
    if (lc.ageYears < 16 || lc.ageYears > 48) continue;
    mothers.push(id);
  }

  for (const mother of mothers) {
    if (!rng.chance(0.4)) continue;
    bear(world, mother);
  }
}

function bear(world: World, mother: EntityId): void {
  const father = world.ties.get(mother)!.spouse!;
  const rng = world.rng;
  const motherSpecies = world.identity.get(mother)!.speciesId;
  const fatherFamily = world.identity.get(father)!.family;

  const childId = createActor(world, {
    given: generateGiven(rng, motherSpecies),
    family: fatherFamily,
    sex: pickSex(rng),
    speciesId: motherSpecies,
    profession: pickProfession(rng), // grows up into a trade (PoC abstraction)
    traits: pickTraits(rng),
    ageYears: 0,
    parents: [mother, father],
  });

  world.ties.get(mother)!.children.push(childId);
  world.ties.get(father)!.children.push(childId);

  emit(world, 'born', [childId, mother, father], {});
}

export const LIFECYCLE_CADENCE_DAYS = DAYS_PER_YEAR;
