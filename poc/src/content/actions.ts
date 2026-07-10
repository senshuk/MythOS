/**
 * The PACK's ACTION vocabulary — the verbs an actor (player or NPC) can choose, as
 * DATA. The engine resolves a few GENERIC social/economic verbs as core mechanism
 * (idle/work/socialize/court/give/provoke live in systems/resolve.ts), but two things
 * are universe-facing and belong here:
 *
 *   - PLAYER_ACTIONS: the affordances offered to the player (label, hint, whether the
 *     verb needs a target). A pack relabels 'Court' → 'Pursue', drops verbs, or adds
 *     its own.
 *   - resolveExtraAction: resolution for any kind the engine's core resolver doesn't
 *     know — a Cyberpunk 'hack', a Star Trek 'hail'. The engine's resolveIntent falls
 *     through to this for unknown kinds, so a pack adds a verb WITHOUT an engine change.
 *
 * This fixture pack ships only the generic verbs and no extras (resolveExtraAction is a
 * no-op); it exists to keep the action vocabulary out of the engine.
 */
import { type World, type EntityId, type PlayerActionView } from '../engine/model';
import { type Intent } from '../engine/intent';
import { Rng } from '../engine/rng';
import { pressClaim } from '../engine/figures';

/** The actions offered to the player this turn. (NPC choice is in systems/decide.ts.) */
export const PLAYER_ACTIONS: PlayerActionView[] = [
  { kind: 'work', label: 'Work', hint: 'ply your profession (feeds you)', needsTarget: false },
  { kind: 'socialize', label: 'Socialize', hint: 'spend time with someone', needsTarget: true },
  { kind: 'court', label: 'Court', hint: 'pursue a bond toward marriage', needsTarget: true },
  { kind: 'give', label: 'Give', hint: 'a deliberate kindness', needsTarget: true },
  { kind: 'provoke', label: 'Provoke', hint: 'a deliberate slight', needsTarget: true },
  { kind: 'idle', label: 'Rest', hint: 'let the week pass', needsTarget: false },
];

/** A resolver for a pack-specific verb: apply its effects, drawing randomness from `rng`. */
export type ActionResolver = (world: World, actor: EntityId, target: EntityId | undefined, rng: Rng) => void;

/**
 * Registry of pack-specific verbs the engine's core resolver doesn't know. The fixture
 * ships none; a real pack registers e.g. EXTRA_ACTIONS['hack'] = (world, actor, …) => {…},
 * calling engine mechanism (world.ts / opinion.ts) for the effects.
 *
 * `press_claim` is the exception this pack does ship: a proactive bid for the settlement's seat.
 * It carries no target (you claim your OWN home's seat) and routes into the succession machinery
 * (engine/figures.ts pressClaim) — the first player LEVER on the grand systems the sim runs.
 */
export const EXTRA_ACTIONS: Record<string, ActionResolver> = {
  press_claim: (world, actor, _target, rng) => pressClaim(world, actor, rng),
};

/** Engine entry point: resolve an unknown verb via the pack registry (no-op if absent). */
export function resolveExtraAction(world: World, actor: EntityId, intent: Intent, rng: Rng): void {
  EXTRA_ACTIONS[intent.kind]?.(world, actor, intent.target, rng);
}
