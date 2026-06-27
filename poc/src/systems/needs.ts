/**
 * Needs system — runs daily. METABOLISM: each need drifts toward where the actor's
 * circumstances put it, so every need is a real two-way signal (not a bar that only
 * ever falls).
 *
 *   food      — falls with consumption; refilled by the `work` action (resolve.ts).
 *   wealth    — earned by `work`; bleeds slowly as cost-of-living.
 *   belonging — erodes with loneliness here; rebuilt by socializing (resolve.ts).
 *   safety    — drifts toward how stable the actor's settlement is.
 *   esteem    — drifts toward the actor's social standing (ties + marriage).
 *
 * Unmet needs feed the decider (decide.ts) and aspirations (aspiration.ts).
 */
import { type World, NEED_KEYS } from '../engine/model';
import { fullActors, relCount, clamp } from '../engine/world';

/** Move a value a fraction of the way toward a target (deterministic easing). */
function drift(v: number, target: number, rate: number): number {
  return v + (target - v) * rate;
}

export function needsDaily(world: World): void {
  const focused = world.focusedSettlementId;
  const stability = focused >= 0 ? world.settlements[focused]?.macro.stability ?? 0 : 0;
  const safetyTarget = clamp(500 + stability * 5, 0, 1000); // a stable home feels safe

  for (const id of fullActors(world)) {
    const n = world.needs.get(id)!;
    // consumption & cost-of-living
    n.food = clamp(n.food - 4, 0, 1000);
    n.wealth = clamp(n.wealth - 1, 0, 1000);
    n.belonging = clamp(n.belonging - 1, 0, 1000); // loneliness; socializing rebuilds it (resolve.ts)
    // circumstantial needs drift toward where the actor's life puts them
    n.safety = clamp(drift(n.safety, safetyTarget, 0.05), 0, 1000);
    const standing = clamp(250 + Math.min(relCount(world, id), 16) * 30 + (world.ties.get(id)!.spouse !== undefined ? 120 : 0), 0, 1000);
    n.esteem = clamp(drift(n.esteem, standing, 0.04), 0, 1000);
    for (const k of NEED_KEYS) n[k] = clamp(n[k], 0, 1000);
  }
}
