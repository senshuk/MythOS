/**
 * Needs system — runs daily. Pure METABOLISM now: needs only *decay* here. The
 * income that used to be applied passively in this pass has moved into the `work`
 * action (resolve.ts), so earning a living is a *chosen* action every actor takes
 * under the same rule — the player included. Unmet needs feed the decider
 * (decide.ts), which is where hunger now *motivates* working. Emits no events.
 */
import { type World, NEED_KEYS } from '../engine/model';
import { fullActors, clamp } from '../engine/world';

export function needsDaily(world: World): void {
  for (const id of fullActors(world)) {
    const n = world.needs.get(id)!;
    n.food = clamp(n.food - 4, 0, 1000);
    n.safety = clamp(n.safety - 1, 0, 1000);
    n.belonging = clamp(n.belonging - 2, 0, 1000);
    for (const k of NEED_KEYS) n[k] = clamp(n[k], 0, 1000);
  }
}
