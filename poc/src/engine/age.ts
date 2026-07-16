/**
 * AGE — the epoch-transition mechanism (design/30 §4.6, invariant 17: "Rules cannot be
 * changed during a running simulation. Rule changes require a world reset or an explicit
 * epoch-transition event.") `world.rules` is otherwise read-only to every system in the
 * engine; this is the ONE function permitted to rewrite it, and it does so by emitting a
 * real, subjectless world-scale event — so "why did this become illegal?" always answers
 * "the [name] began, on year Y," never an invisible flag flip.
 *
 * Scoped to the single field `Rules` has today (`succession.claimsEnabled`) per design/30
 * v1.4's correction: this is new engine surface, kept to the smallest slice that proves an
 * Intent can go from legal to illegal across an Age boundary. It grows outward the same
 * way MODULES and Rules themselves are meant to — one more field, read by whichever new
 * consumer needs it — never a categorical taxonomy built ahead of a real use.
 */
import { type World, type EventId, type Rules } from './model';
import { emit } from './world';

/**
 * Transition the world into a new Age: rewrite the live Rules config wholesale (the same
 * discipline `setPack` uses for the pack itself) and emit the event that makes the change
 * legible. `name` is pack prose ("the Age of Kings has ended"); it carries no meaning to
 * the engine beyond being recorded on the event.
 */
export function transitionAge(world: World, name: string, rules: Rules): EventId {
  world.rules = rules;
  return emit(world, 'age_transition', [], {
    name,
    claimsEnabled: String(rules.succession.claimsEnabled),
  });
}
