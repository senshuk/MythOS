/**
 * Needs system — runs daily. Cheap, emits no events. Needs drift based on the
 * actor's profession (a crude proxy for "doing their job meets some needs") and
 * decay over time. In a fuller engine, unmet needs would feed the goal planner;
 * here they colour social behaviour and keep the door open for that loop.
 */
import { type World, NEED_KEYS } from '../engine/model';
import { fullActors, clamp } from '../engine/world';

const PROFESSION_INCOME: Record<string, number> = {
  farmer: 3,
  smith: 5,
  guard: 4,
  trader: 6,
  healer: 4,
  hunter: 4,
};

export function needsDaily(world: World): void {
  for (const id of fullActors(world)) {
    const n = world.needs.get(id)!;
    const prof = world.profession.get(id)!;
    // daily decay
    n.food = clamp(n.food - 6, 0, 1000);
    n.safety = clamp(n.safety - 1, 0, 1000);
    n.belonging = clamp(n.belonging - 2, 0, 1000);
    // work satisfies food & wealth a little
    n.food = clamp(n.food + 7, 0, 1000);
    n.wealth = clamp(n.wealth + (PROFESSION_INCOME[prof] ?? 3) - 3, 0, 1000);
    for (const k of NEED_KEYS) n[k] = clamp(n[k], 0, 1000);
  }
}
