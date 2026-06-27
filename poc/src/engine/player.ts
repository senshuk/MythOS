/**
 * Player control rails. Possession is just "set world.playerId" — there is no
 * player-specific simulation code; the act loop (systems/social.ts) simply reads
 * the player's intent from the input log instead of running the NPC decider, and
 * the resolver (systems/resolve.ts) runs the player's chosen action against the
 * dedicated player RNG stream. Everything else is identical to an NPC.
 *
 * Intents are scheduled into `world.playerInputs` keyed by the tick they apply on.
 * That log IS the player's contribution to world state — replaying it reproduces
 * the world exactly. (The live worker control loop that stamps a buffered UI
 * intent with the correct tick is a separate, later step; these primitives are
 * what it will build on, and what the determinism tests drive directly.)
 */
import { type World, type EntityId } from './model';
import { type Intent } from './intent';

/** Take control of an actor. The actor keeps obeying every normal rule. */
export function possess(world: World, actorId: EntityId): void {
  world.playerId = actorId;
}

/** Relinquish control; the actor reverts to NPC decision-making. */
export function release(world: World): void {
  world.playerId = undefined;
}

/** Schedule the player's intent for a given tick (appends to the replay log). */
export function schedulePlayerIntent(world: World, tick: number, intent: Intent): void {
  world.playerInputs.push({ tick, intent });
}

/**
 * The player's intent for the current tick, or `idle` if none is scheduled. Pure
 * read (no mutation), so replay from the same log is deterministic. Scans from the
 * end so the most recently scheduled intent for a tick wins; O(n) is fine for the
 * PoC (a production engine would index by tick).
 */
export function takePlayerIntent(world: World): Intent {
  for (let i = world.playerInputs.length - 1; i >= 0; i--) {
    if (world.playerInputs[i].tick === world.tick) return world.playerInputs[i].intent;
  }
  return { kind: 'idle' };
}
