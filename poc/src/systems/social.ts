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
import { type World, type EntityId } from '../engine/model';
import { isAlive } from '../engine/world';
import { takePlayerIntent } from '../engine/player';
import { maybeBreak } from '../engine/mood';
import { Rng } from '../engine/rng';
import { isAdult, decideActor, decideCourse } from './decide';
import { resolveIntent, resolvePlayerIntent } from './resolve';

export function actWeekly(world: World, actors: EntityId[]): void {
  const adults: EntityId[] = [];
  for (const id of actors) {
    if (isAdult(world, id)) adults.push(id);
  }
  if (adults.length < 2) return;

  for (const a of adults) {
    if (!isAlive(world, a)) continue; // may have died in a brawl earlier this pass
    if (a === world.playerId) {
      // intent producer #2: the player. The SAME break rule preempts their chosen
      // intent (a broken mind takes the turn from anyone — no player exemption),
      // drawn from the player's own stream so NPC randomness is untouched.
      const prng = new Rng(world.playerRngState);
      const broke = maybeBreak(world, a, prng);
      world.playerRngState = prng.state;
      const scheduled = takePlayerIntent(world);
      if (broke ?? scheduled) {
        resolvePlayerIntent(world, a, (broke ?? scheduled)!);
      } else {
        // AUTOPILOT (design/26 P1): an UNDIRECTED week is lived by the same course
        // and the same streams as every other soul — the character keeps living
        // (works when hungry, deepens bonds, pursues their aspiration) and the
        // player INTERVENES. Streaming years no longer mean years of idling.
        resolveIntent(world, a, decideCourse(world, a, adults), world.rng);
      }
    } else {
      // intent producer #1: the NPC decider, resolved on the settlement stream.
      resolveIntent(world, a, decideActor(world, a, adults), world.rng);
    }
  }
}
