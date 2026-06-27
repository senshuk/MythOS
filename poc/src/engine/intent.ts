/**
 * An Intent is a serializable "this actor chose to do X" — the seam that lets the
 * player become one more producer of intents without any `if (isPlayer)` inside a
 * rule. Every actor's turn is two halves: DECIDE (produce an Intent — see
 * systems/decide.ts for the NPC producer) and RESOLVE (apply its effects — see
 * systems/resolve.ts, shared by every actor). Intents are plain data so they can be
 * recorded into a replay/input log and survive the worker boundary.
 *
 * `kind` is an OPEN string, not a closed enum: the engine resolves a few generic
 * social/economic verbs (idle / work / socialize / court / give / provoke), and a pack
 * can add its own (a Cyberpunk 'hack', a Star Trek 'hail') by supplying an affordance
 * and a resolver in content/actions.ts — the engine never needs to know them. `target`
 * is present for verbs directed at someone.
 */
import { type EntityId } from './model';

export interface Intent {
  kind: string;
  target?: EntityId;
}
