/**
 * Emergent aspirations — the MACHINERY. An actor's current goal is a PURE FUNCTION of
 * its state, derived not stored, so it never desyncs and changes as the world changes
 * (find a partner → start a family → be remembered = the sense of progress). The same
 * derivation drives two things:
 *
 *   - the PLAYER sees it as their objective (a world with no goal loses the player), and
 *   - NPCs PURSUE it (decide.ts), turning the reactive social loop into character arcs.
 *     Player and NPC use the identical rule ("every character is equal").
 *
 * The engine here owns only the MECHANISM (evaluate the ladder, detect fulfilment). The
 * LADDER itself — which goals exist, their order, conditions, labels and which are
 * achievements — is PACK DATA (content/aspirations.ts), so a different universe supplies
 * a different set of wants without any engine change. Reusable social queries used by the
 * ladder live in engine/social.ts (kept separate to avoid an import cycle).
 */
import { type World, type EntityId, type Aspiration } from './model';
import { emit } from './world';
import { ASPIRATIONS, DEFAULT_ASPIRATION } from './pack';

/**
 * The actor's current aspiration: the first rung of the pack's ladder whose condition
 * holds. An actor mid-construction (missing components) gets the quiet default.
 */
export function currentAspiration(world: World, id: EntityId): Aspiration {
  if (!world.identity.has(id) || !world.lifecycle.has(id) || !world.ties.has(id) || !world.needs.has(id)) {
    return { ...DEFAULT_ASPIRATION };
  }
  for (const def of ASPIRATIONS) {
    if (!def.applies(world, id)) continue;
    const target = def.target?.(world, id);
    const action = def.action(target);
    return target !== undefined ? { kind: def.kind, target, action } : { kind: def.kind, action };
  }
  return { ...DEFAULT_ASPIRATION };
}

/** Did the player actually attain `prev` (vs merely shifting to a new goal)? Delegates
 *  to the pack rung's `fulfilled`; rungs without one are ongoing states, not achievements. */
function isFulfilled(world: World, id: EntityId, prev: { kind: string; target?: EntityId }): boolean {
  const def = ASPIRATIONS.find((d) => d.kind === prev.kind);
  return def?.fulfilled?.(world, id, prev.target) ?? false;
}

/**
 * Detect when the controlled actor fulfils its goal and emit a celebratory `goal_met`
 * event. Baselines silently on the first call after possession (so a fresh possession
 * never spuriously fires). Deterministic; player-only. The fresh goal then emerges on
 * its own, since aspirations are derived from state.
 */
export function checkPlayerGoal(world: World): void {
  const id = world.playerId;
  if (id === undefined || !world.identity.has(id) || !world.lifecycle.get(id)?.alive) {
    world.playerGoal = undefined;
    return;
  }
  const curr = currentAspiration(world, id);
  const prev = world.playerGoal;
  if (prev !== undefined && prev.kind !== curr.kind && isFulfilled(world, id, prev)) {
    emit(world, 'goal_met', [id], prev.target !== undefined ? { goal: prev.kind, target: prev.target } : { goal: prev.kind });
  }
  world.playerGoal = { kind: curr.kind, target: curr.target };
}

/** A player-facing one-line description of an aspiration (delegated to the pack rung). */
export function aspirationLabel(world: World, id: EntityId, asp: Aspiration): string {
  const def = ASPIRATIONS.find((d) => d.kind === asp.kind);
  return def ? def.label(world, id, asp.target) : asp.kind;
}
