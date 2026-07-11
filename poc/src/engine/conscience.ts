/**
 * CONSCIENCE (design/26 P3) — choices wear the player's character. A decision option
 * may carry a `conscience` weight on its intent: the VALUE it enacts (`axis`) and its
 * direction (`dir`). This module reads the player's OWN value profile and:
 *
 *   - TINTS the option at snapshot time — marking it aligned with a strong conviction,
 *     or against one (pure presentation; attached to the DecisionView, never stored);
 *   - LAYS a conscience self-thought at resolution — pride for acting true to a
 *     strongly-held value, guilt for betraying it (reusing the exact precept→mood
 *     machinery, addSelfThought, that already carries the creed's conscience).
 *
 * A soul with no strong feeling on the axis feels nothing either way — the tint and the
 * thought both appear ONLY when the player holds the value strongly, so two different
 * characters play the same dilemma differently, derived, not scripted.
 */
import { type World, type EntityId, type DecisionView } from './model';
import { type Intent } from './intent';
import { personalityOf } from './social';
import { addSelfThought } from './mood';
import { valueWord, type ValueAxis } from './pack';

/** |value| at which a conviction is strong enough to be felt (values run −100..100). */
const STRONG = 35;

/** How the player's nature sits with an option's conscience weight, or undefined when the
 *  option carries none / the player holds the value too weakly to feel it. */
function readNature(world: World, playerId: EntityId, c: Intent['conscience']): { word: string; against: boolean } | undefined {
  if (!c) return undefined;
  const held = personalityOf(world, playerId).values[c.axis as ValueAxis] ?? 0;
  if (Math.abs(held) < STRONG) return undefined;
  const heldDir = held > 0 ? 1 : -1;
  // the option's own character (what it enacts), plus whether that betrays the conviction
  return { word: valueWord(c.axis as ValueAxis, c.dir > 0), against: heldDir !== c.dir };
}

/** Mark each option of a decision with how it sits against the player's nature (P3).
 *  Mutates the freshly-built DecisionView (not shared state) and returns it. */
export function tintDecision(world: World, playerId: EntityId, view: DecisionView): DecisionView {
  for (const opt of view.options) {
    const n = readNature(world, playerId, opt.intent.conscience);
    if (n) opt.nature = n;
  }
  return view;
}

/** Lay the conscience self-thought for a resolved player choice (P3): true_to_self when
 *  the act accorded with a strong conviction, against_nature when it betrayed one. A no-op
 *  for untagged intents and for a player who holds the value weakly. */
export function applyConscience(world: World, playerId: EntityId, intent: Intent): void {
  const n = readNature(world, playerId, intent.conscience);
  if (!n) return;
  addSelfThought(world, playerId, n.against ? 'against_nature' : 'true_to_self');
}
