/**
 * An Intent is a serializable "this actor chose to do X" — the seam that lets the
 * player become one more producer of intents without any `if (isPlayer)` inside a
 * rule. Every actor's turn is now two halves: DECIDE (produce an Intent — see
 * systems/decide.ts for the NPC producer) and RESOLVE (apply its effects — see
 * systems/resolve.ts, shared by every actor). Intents are plain data so they can
 * later be recorded into a replay/input log and survive the worker boundary.
 *
 * v1 NPCs only ever emit `idle` / `socialize` (see decideActor); `work`, `court`,
 * `give`, and `provoke` exist for the forthcoming player-agency layer and for
 * richer NPC deciders later — all resolve through the same shared resolver.
 */
import { type EntityId } from './model';

export type Intent =
  | { kind: 'idle' } // do nothing this turn
  | { kind: 'work' } // ply your profession (income — see resolveWork)
  | { kind: 'socialize'; target: EntityId } // spend time with someone
  | { kind: 'court'; target: EntityId } // pursue a bond toward marriage (positivity-biased)
  | { kind: 'give'; target: EntityId } // a deliberate kindness
  | { kind: 'provoke'; target: EntityId }; // a deliberate slight
