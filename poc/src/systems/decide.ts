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
import { maybeBreak } from '../engine/mood';
import { computeOpinion } from '../engine/opinion';
import { personalityOf } from '../engine/social';
import { bindingForbids, bindingUrge } from '../engine/binding';
import { maturityOf, SUBSISTENCE_NEED, WEALTH_NEED, GIFT_WEALTH_FLOOR, giveInclination } from '../engine/pack';

/** The living soul this actor holds dearest — the warmest of their bonds (spouse, friend,
 *  or kin they are closest to). A pure scan (no RNG), so a gift goes to someone who
 *  matters. Undefined if they have no warm bond to give to. */
function dearestBond(world: World, a: EntityId): EntityId | undefined {
  let best: EntityId | undefined;
  let bestOp = 120; // a real fondness, not a passing acquaintance
  for (const [other, edge] of world.rels.get(a) ?? []) {
    if (!world.lifecycle.get(other)?.alive) continue;
    const op = computeOpinion(edge, world.tick);
    if (op > bestOp || (op === bestOp && (best === undefined || other < best))) {
      bestOp = op;
      best = other;
    }
  }
  return best;
}

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
  // a collapsed mood preempts free will: the mind may force this week's act (mood.ts).
  // Drawn from the settlement stream — the same stream this producer's other choices use.
  const broke = maybeBreak(world, a, world.rng);
  if (broke) return broke;
  return decideCourse(world, a, adults);
}

/** The decider MINUS the break check — the course a sound mind sets. The player's
 *  AUTOPILOT (design/26 P1) uses this directly: their break was already rolled on the
 *  player stream, and an undirected week is then lived by this same policy as anyone. */
export function decideCourse(world: World, a: EntityId, adults: EntityId[]): Intent {
  // subsistence first: hunger (or poverty) motivates plying your profession.
  const needs = world.needs.get(a)!;
  if (needs[SUBSISTENCE_NEED] < 300 || needs[WEALTH_NEED] < 250) return { kind: 'work' };

  // pursue the current aspiration (pure function of state — character arcs).
  const asp = currentAspiration(world, a);
  if (asp.action === 'work') return { kind: 'work' }; // e.g. the ambitious build standing

  // social activity at the same rate as before; when active, pursue the goal's
  // subject if it has one, else fall back to deepening an existing bond.
  if (!world.rng.chance(0.55)) return { kind: 'idle' };

  // A BINDING'S URGE (design/36): a sworn avenger whose quarry walks these same streets
  // feels the pull to face them. The binding only surfaces the pull — this policy, and
  // these dice, decide whether today is the day. Draw-free for the unbound (bindingUrge
  // reads, never rolls), so every unsworn soul's stream is byte-identical.
  const urge = bindingUrge(world, a);
  if (urge && world.rng.chance(0.3)) return urge.intent;

  // GENEROSITY — the everyday virtue (design/23 Stage 2). A warm soul with real surplus
  // sometimes gives to someone they cherish rather than merely chatting; the gift spends
  // their wealth (resolveGift), so it self-limits. This is what makes the creed's virtue
  // conscience (edified/righteous) a regular part of life, not just a rare noble deed.
  if (needs[WEALTH_NEED] > GIFT_WEALTH_FLOOR) {
    const warmth = personalityOf(world, a).temperament.warmth ?? 0;
    if (world.rng.chance(giveInclination(warmth))) {
      const dear = dearestBond(world, a);
      // the FORBID half of a binding: no gift for the sworn quarry (fall through to talk)
      if (dear !== undefined && !bindingForbids(world, a, { kind: 'give', target: dear })) {
        return { kind: 'give', target: dear };
      }
    }
  }

  if (asp.target !== undefined && isAlive(world, asp.target) && !bindingForbids(world, a, { kind: 'socialize', target: asp.target })) {
    // NPCs pursue gently via plain socializing (focus, not fervour) — aggressive
    // `court` is reserved for the player's deliberate choice, so NPC courtship
    // doesn't trivialize marriage and explode the population.
    return { kind: 'socialize', target: asp.target };
  }
  const b = choosePartner(world, a, adults);
  if (b === undefined) return { kind: 'idle' };
  // an oath bounds the will at the last gate too: no warmth toward the sworn quarry
  if (bindingForbids(world, a, { kind: 'socialize', target: b })) return { kind: 'idle' };
  return { kind: 'socialize', target: b };
}
