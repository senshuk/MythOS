/**
 * REACTIONS — the first CONSUMER of belief (Subjectivity 1B).
 *
 * This is where "Reality → Perception → Belief" becomes "… → Decision": an actor acts on
 * what it has come to BELIEVE, not on what objectively happened. The first (and only)
 * reaction wired is MOURNING — an actor who comes to believe a kinsman is dead mourns, once,
 * when they learn of it, while kin who haven't heard carry on. Two actors, one world,
 * different acts, because they know different things. That is Subjectivity becoming causality.
 *
 * THREE DISCIPLINES this phase must not breach:
 *
 *   1. Reactions ask BELIEF a question — via computeBelief — and NOTHING more. They must
 *      never read belief.evidence or its polarity. The reducer is the only API into belief,
 *      exactly as computeOpinion / computeStanding are the only APIs into their marks.
 *
 *   2. Reaction state lives HERE, never on the Belief. Belief is knowledge; reacting is
 *      behaviour (Belief ≠ Reaction, as Intent ≠ Action). `world.reactions` remembers which
 *      (actor, reaction, subject, assertion) have already fired, so a reaction is
 *      EDGE-triggered — it runs once, when a stance first crosses to believed — not every
 *      week the belief stays true.
 *
 *   3. Mourning is an ACTION taken upon a belief, so it emits (invariant 9). Belief FORMATION
 *      stays inert (invariant 8); only the reaction to a belief enters history.
 */
import { type World, type EntityId, type Belief } from './model';
import { isKin, emit } from './world';
import { computeBelief } from './belief';

/** Stable key: "this actor has already performed this reaction about this proposition." */
function reactionKey(actor: EntityId, kind: string, subject: EntityId, assertion: string): string {
  return `${actor}|${kind}|${subject}|${assertion}`;
}

/**
 * Weekly pass: let each actor act on what it now believes. For every belief an actor holds
 * TRUE and has not already acted on, dispatch the matching reaction. Deterministic —
 * computeBelief is pure, actors and beliefs are scanned in stable order, and no RNG is used.
 */
export function reactToBeliefs(world: World, actors: EntityId[]): void {
  for (const actor of actors) {
    const held = world.beliefs.get(actor);
    if (!held) continue;
    for (const belief of held) {
      if (computeBelief(belief, world.tick).stance === 'true') reactToBelief(world, actor, belief);
    }
  }
}

/**
 * Dispatch one actor's reaction to one believed proposition. This switch is the extension
 * point: `born → celebrate`, `succeeded → acclaim`, `killed-by-X → avenge` slot in here with
 * no reshaping of the surrounding machinery. v1 wires only mourning.
 */
export function reactToBelief(world: World, actor: EntityId, belief: Belief): void {
  switch (belief.assertion) {
    case 'dead':
      // you mourn kin you believe have died — once, when you come to believe it.
      if (isKin(world, actor, belief.subject)) mourn(world, actor, belief);
      break;
  }
}

function mourn(world: World, actor: EntityId, belief: Belief): void {
  const key = reactionKey(actor, 'mourn', belief.subject, belief.assertion);
  if (world.reactions.has(key)) return; // already mourned — reactions fire once, not weekly
  world.reactions.add(key);
  const who = world.names.get(belief.subject) ?? String(belief.subject);
  // trace the act back to the death it learned of: Reality → Belief → Decision → Act, legibly.
  const cause = belief.evidence[0]?.cause;
  emit(world, 'mourned', [actor], { who }, cause !== undefined ? [cause] : []);
}
