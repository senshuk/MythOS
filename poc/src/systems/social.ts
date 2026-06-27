/**
 * The "act" loop — runs weekly. This is where emergence lives, now expressed as
 * the intent seam: each living adult DECIDES an intent (decide.ts) and the shared
 * RESOLVER applies it (resolve.ts). Keeping a single interleaved pass (decide then
 * resolve, per actor, in id order) means RNG is consumed in exactly the order the
 * old fused loop used — so the NPC simulation is deterministic and unchanged.
 *
 * This is the seam the player plugs into: for the controlled actor we read the
 * intent from the player's input log instead of running decideActor, and resolve
 * it against the player's own RNG stream — "one rule set, two intent producers",
 * with no `if (isPlayer)` inside any rule (only this source selection).
 */
import { type World } from '../engine/model';
import { fullActors, isAlive } from '../engine/world';
import { takePlayerIntent } from '../engine/player';
import { isAdult, decideActor } from './decide';
import { resolveIntent, resolvePlayerIntent } from './resolve';

export function actWeekly(world: World): void {
  const adults = fullActors(world).filter((id) => isAdult(world, id));
  if (adults.length < 2) return;

  for (const a of adults) {
    if (!isAlive(world, a)) continue; // may have died in a brawl earlier this pass
    if (a === world.playerId) {
      // intent producer #2: the player. Resolved on the dedicated player stream.
      resolvePlayerIntent(world, a, takePlayerIntent(world));
    } else {
      // intent producer #1: the NPC decider, resolved on the settlement stream.
      resolveIntent(world, a, decideActor(world, a, adults), world.rng);
    }
  }
}
