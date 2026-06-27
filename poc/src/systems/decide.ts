/**
 * The DECIDER — the NPC intent producer (the first half of an actor's turn). It
 * reads state + the settlement RNG and returns one Intent; all *effects* happen
 * later in the shared resolver (resolve.ts). This is the only place NPC "free
 * will" lives, so future AI depth (needs→goals, ambition, grudges driving choices)
 * lands here without touching resolution — and the player simply substitutes a
 * different producer for this same step.
 *
 * v1 deliberately reproduces the old socialWeekly behaviour exactly (idle or
 * socialize), so this refactor is behaviour-preserving and the determinism hash is
 * unchanged. The needs→`work` motivation arrives in the next step alongside the
 * needs-system change (so income becomes a chosen action for everyone).
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
  if (!world.rng.chance(0.55)) return { kind: 'idle' };
  const b = choosePartner(world, a, adults);
  if (b === undefined) return { kind: 'idle' };
  return { kind: 'socialize', target: b };
}
