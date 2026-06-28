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
import { type World, type EntityId } from '../engine/model';
import { type Intent } from '../engine/intent';
import { currentAspiration } from '../engine/aspiration';
import { isAlive } from '../engine/world';
import { maturityOf, SUBSISTENCE_NEED, WEALTH_NEED } from '../content/fixture';

export function isAdult(world: World, id: EntityId): boolean {
  return world.lifecycle.get(id)!.ageYears >= maturityOf(world.identity.get(id)!.speciesId);
}

/** Strongly prefer existing acquaintances so relationships actually DEEPEN into
 *  friendships/marriages (a bounded social circle), only occasionally meeting
 *  someone new. Without this, interactions spread thin and no bond matures. */
export function choosePartner(world: World, a: EntityId, adults: EntityId[]): EntityId | undefined {
  const known = world.rels.get(a)!;
  if (known.size > 0 && world.rng.chance(0.88)) {
    // killActor prunes dead actors from all partners' rel maps, so every key here is alive.
    const ids = [...known.keys()];
    return ids[world.rng.int(ids.length)];
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
  if (needs[SUBSISTENCE_NEED] < 300 || needs[WEALTH_NEED] < 250) return { kind: 'work' };

  // pursue the current aspiration (pure function of state — character arcs).
  const asp = currentAspiration(world, a);
  if (asp.action === 'work') return { kind: 'work' }; // e.g. the ambitious build standing

  // social activity at the same rate as before; when active, pursue the goal's
  // subject if it has one, else fall back to deepening an existing bond.
  if (!world.rng.chance(0.55)) return { kind: 'idle' };
  if (asp.target !== undefined && isAlive(world, asp.target)) {
    // NPCs pursue gently via plain socializing (focus, not fervour) — aggressive
    // `court` is reserved for the player's deliberate choice, so NPC courtship
    // doesn't trivialize marriage and explode the population.
    return { kind: 'socialize', target: asp.target };
  }
  const b = choosePartner(world, a, adults);
  if (b === undefined) return { kind: 'idle' };
  return { kind: 'socialize', target: b };
}
