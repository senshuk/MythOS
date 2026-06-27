/**
 * The "act" loop — runs weekly. This is where emergence lives, now expressed as
 * the intent seam: each living adult DECIDES an intent (decide.ts) and the shared
 * RESOLVER applies it (resolve.ts). Keeping a single interleaved pass (decide then
 * resolve, per actor, in id order) means RNG is consumed in exactly the order the
 * old fused loop used — so this refactor is behaviour-preserving and deterministic.
 *
 * This is the seam the player plugs into: a future player actor swaps its intent
 * *producer* (UI input instead of decideActor) while the resolver stays identical —
 * "one rule set, two intent producers", no `if (isPlayer)` in any rule.
 */
import { type World } from '../engine/model';
import { fullActors, isAlive } from '../engine/world';
import { isAdult, decideActor } from './decide';
import { resolveIntent } from './resolve';

export function actWeekly(world: World): void {
  const adults = fullActors(world).filter((id) => isAdult(world, id));
  if (adults.length < 2) return;

  for (const a of adults) {
    if (!isAlive(world, a)) continue; // may have died in a brawl earlier this pass
    resolveIntent(world, a, decideActor(world, a, adults));
  }
}
