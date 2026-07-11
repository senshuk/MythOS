/**
 * AMBITIONS — the MACHINERY of the player's self-chosen, long-horizon goal. Where an aspiration is
 * DERIVED and handed to the player each tick (see aspiration.ts, shared with NPCs), an ambition is
 * COMMITTED to: the player picks one and steers toward it over many weeks, and the world pushes back
 * emergently. The next step toward an ambition is surfaced as an ordinary Decision (decision.ts), so
 * pursuing it flows through the existing player-turn intent log — no new agency path.
 *
 * The safety story mirrors decisions, and is stated on PlayerAmbition (model.ts): an ambition is
 * player-facing STEERING state. It is serialized for continuity but is NOT read by any NPC decision
 * or RNG draw and is NOT part of the simulation hash, so committing to one cannot perturb the world.
 * It emits no shared events; the DEEDS that fulfil it (a marriage, a killing) already enter history
 * through the normal event system. This module only reads world state and writes `world.playerAmbition`.
 *
 * The engine owns the mechanism (offer, commit, abandon, review, build the view); WHICH ambitions
 * exist is PACK DATA (content/ambitions.ts), exactly like the aspiration ladder and the decision set.
 */
import { type World, type EntityId, type AmbitionOffer, type ActiveAmbitionView } from './model';
import { fullName } from './world';
import { AMBITIONS } from './pack';
import { tintDecision } from './conscience';

/** The ambitions worth offering this player right now, each derived from their real situation. */
export function offerableAmbitions(world: World, id: EntityId): AmbitionOffer[] {
  const out: AmbitionOffer[] = [];
  for (const def of AMBITIONS) {
    const off = def.offerable(world, id);
    if (!off) continue;
    out.push({
      id: def.id,
      label: def.label(world, id, off.target),
      hint: def.hint(world, id, off.target),
      target: off.target,
      targetName: off.target !== undefined ? fullName(world, off.target) : undefined,
    });
  }
  return out;
}

/**
 * Commit the player to an ambition. Validates that the pack still considers it offerable (so the UI
 * can't commit to something the situation no longer supports). Returns whether it took.
 */
export function chooseAmbition(world: World, id: EntityId, ambitionId: string, target?: EntityId): boolean {
  const def = AMBITIONS.find((d) => d.id === ambitionId);
  if (!def) return false;
  const off = def.offerable(world, id);
  if (!off) return false;
  world.playerAmbition = { id: ambitionId, target: target ?? off.target, chosenTick: world.tick };
  return true;
}

/** Relinquish the current ambition (the player chooses to just live, or to pick another). */
export function abandonAmbition(world: World): void {
  world.playerAmbition = undefined;
}

/**
 * Resolve the active ambition if it has been achieved or become impossible — marking it (a
 * player-facing state change only; no event, no RNG). Called from the worker after a turn/possess,
 * exactly like checkPlayerGoal — NEVER inside the deterministic tick loop. A no-op once resolved.
 */
export function reviewPlayerAmbition(world: World): void {
  const amb = world.playerAmbition;
  const id = world.playerId;
  if (!amb || amb.completedTick !== undefined || id === undefined) return;
  const def = AMBITIONS.find((d) => d.id === amb.id);
  if (!def) return;
  if (def.impossible?.(world, id, amb.target)) {
    amb.completedTick = world.tick;
    amb.outcome = 'thwarted';
  } else if (def.fulfilled(world, id, amb.target)) {
    amb.completedTick = world.tick;
    amb.outcome = 'fulfilled';
  }
}

/**
 * The player's ambition state for the snapshot (pure read): the committed ambition with its current
 * step and progress note, plus the ambitions on offer. While an ambition is active AND unresolved,
 * no others are offered (one at a time); once it resolves, fresh offers appear alongside its closing
 * outcome so the player is never left without direction.
 */
export function buildAmbitionView(
  world: World,
  id: EntityId,
): { ambition?: ActiveAmbitionView; offered: AmbitionOffer[] } {
  const amb = world.playerAmbition;
  if (amb) {
    const def = AMBITIONS.find((d) => d.id === amb.id);
    if (def) {
      const resolved = amb.completedTick !== undefined;
      const active: ActiveAmbitionView = {
        id: amb.id,
        label: def.label(world, id, amb.target),
        targetName: amb.target !== undefined ? fullName(world, amb.target) : undefined,
        note: def.note(world, id, amb.target),
        // the ambition's live step is a decision too — tint it by the player's nature (P3)
        step: resolved ? undefined : tintStep(world, id, def.nextStep(world, id, amb.target)),
        outcome: amb.outcome,
      };
      return { ambition: active, offered: resolved ? offerableAmbitions(world, id) : [] };
    }
  }
  return { offered: offerableAmbitions(world, id) };
}

/** Tint an ambition's live step by the player's nature (P3), tolerating a stepless turn. */
function tintStep(world: World, id: EntityId, step: ActiveAmbitionView['step']): ActiveAmbitionView['step'] {
  return step ? tintDecision(world, id, step) : undefined;
}
