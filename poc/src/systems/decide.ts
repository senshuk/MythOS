/**
 * The DECIDER — the NPC intent producer (the first half of an actor's turn). It
 * reads state + the settlement RNG and returns one Intent; all *effects* happen
 * later in the shared resolver (resolve.ts). This is the only place NPC "free
 * will" lives, so future AI depth (needs→goals, ambition, grudges driving choices)
 * lands here without touching resolution — and the player simply substitutes a
 * different producer for this same step.
 *
 * Needs now gate the choice: a hungry (or poor) actor *works* instead of
 * socializing — the first real needs→goal link. Otherwise the actor behaves as
 * before (socialize an acquaintance, else idle). Work replenishes the need
 * (resolve.ts), so actors settle into working only when they must and spending the
 * rest of their time on relationships — the source of marriages, feuds, and births.
 */
import { type World, type EntityId, ADULT_AGE } from '../engine/model';
import { type Intent } from '../engine/intent';

export function isAdult(world: World, id: EntityId): boolean {
  return world.lifecycle.get(id)!.ageYears >= ADULT_AGE;
}

/** Strongly prefer existing acquaintances so relationships actually DEEPEN into
 *  friendships/marriages (a bounded social circle), only occasionally meeting
 *  someone new. Without this, interactions spread thin and no bond matures. */
export function choosePartner(world: World, a: EntityId, adults: EntityId[]): EntityId | undefined {
  const known = world.rels.get(a)!;
  if (known.size > 0 && world.rng.chance(0.88)) {
    const ids = [...known.keys()].filter((id) => world.lifecycle.get(id)!.alive);
    if (ids.length) return ids[world.rng.int(ids.length)];
  }
  for (let tries = 0; tries < 4; tries++) {
    const cand = adults[world.rng.int(adults.length)];
    if (cand !== a && world.lifecycle.get(cand)!.alive) return cand;
  }
  return undefined;
}

/** Produce this NPC's intent for the turn. `adults` is the live adult pool (passed
 *  in so partner selection draws RNG identically to the original loop). */
export function decideActor(world: World, a: EntityId, adults: EntityId[]): Intent {
  // subsistence first: hunger (or poverty) motivates plying your profession.
  const needs = world.needs.get(a)!;
  if (needs.food < 300 || needs.wealth < 250) return { kind: 'work' };

  // otherwise be social, at the same activity rate as before
  if (!world.rng.chance(0.55)) return { kind: 'idle' };
  const b = choosePartner(world, a, adults);
  if (b === undefined) return { kind: 'idle' };
  return { kind: 'socialize', target: b };
}
