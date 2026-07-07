/**
 * DECISIONS — the MACHINERY that turns a flat action menu into turning points. A decision is a
 * framed choice the world puts to the player right now; each option is an ordinary Intent, so
 * choosing one flows through the existing player-turn input log (systems/social.ts →
 * systems/resolve.ts) with NO special code path. That is the whole safety story:
 *
 *   - ZERO new world state. Decisions are DERIVED at snapshot time (like tensions/aspirations),
 *     never stored and never serialized. A reactive decision keys off events of the past week and
 *     ages out by itself; a standing one persists only while its state holds.
 *   - ZERO determinism risk. `evaluateDecisions` is a pure read (no emit, no mutation) called only
 *     while building the presentation snapshot, which is not part of the hashed simulation. Picking
 *     an option is just `playerTurn(intent)` — already the sole, replayable seam.
 *
 * The engine owns only the MECHANISM here: gather every pack def's current choices, rank by
 * urgency, cap. WHICH situations exist — and how they read — is PACK DATA (content/decisions.ts),
 * exactly like PLAYER_ACTIONS and the aspiration ladder. A sci-fi pack supplies different decisions
 * without touching this file.
 */
import { type World, type EntityId, type DecisionView } from './model';
import { DECISIONS } from '../content/decisions';

/** How many decisions to surface at once — bound the player's attention (CLAUDE.md legibility:
 *  "a living world is overwhelming; bound the player's attention so depth is felt, not drowned"). */
const MAX_DECISIONS = 3;

/**
 * The framed choices facing the controlled actor this week, most-pressing first. Pure read: it
 * evaluates every pack decision def against current state and returns the top few by urgency.
 * Returns [] when no one is possessed or nothing is pressing.
 */
export function evaluateDecisions(world: World, playerId: EntityId): DecisionView[] {
  const all: DecisionView[] = [];
  for (const def of DECISIONS) {
    for (const d of def.evaluate(world, playerId)) all.push(d);
  }
  // sort by urgency desc (ties keep def order, which is authoring priority)
  all.sort((a, b) => b.urgency - a.urgency);
  // one card per person: a decision id encodes its counterpart after the colon (`feud:5`); if a
  // fresh insult and a standing feud both name entity 5, keep only the more urgent (already first).
  const seen = new Set<string>();
  const out: DecisionView[] = [];
  for (const d of all) {
    const counterpart = d.id.slice(d.id.indexOf(':') + 1);
    if (seen.has(counterpart)) continue;
    seen.add(counterpart);
    out.push(d);
    if (out.length >= MAX_DECISIONS) break;
  }
  return out;
}
