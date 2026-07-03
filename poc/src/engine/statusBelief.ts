/**
 * STATUS BELIEF — a RESOLVER over competing beliefs, not a new kind of belief (Subjectivity
 * 1D-minimal; design/17 §9.7).
 *
 * Event beliefs (`computeBelief`) answer *"is proposition P believed?"* — monotonic, and `dead`
 * never has a rival. A STATUS is different: a slot with at most one filler (king-of-thuba,
 * owner-of-the-sword) whose claimants COMPETE. This module answers the orthogonal question
 * *"among all claimants for slot S, who currently wins?"* — an arg-max over the per-claimant
 * event beliefs. It NEVER touches `computeBelief`: each claimant's standing is an ordinary
 * belief; this is only the resolver on top (the Mark→many-reducers law — a new fold, not a new
 * primitive).
 *
 * The "one filler" competition lives in the PRODUCER (`learnCoronation`), never in the reducer:
 * a new coronation adds evidence FOR the new ruler and AGAINST the incumbent, so revision is
 * just ordinary evidence accumulation resolved by arg-max. `dead` must NOT use this — it has no
 * slot and no competitors. Events → computeBelief; statuses → computeStatusBelief.
 */
import { type World, type EntityId, type EventId, type StatusBelief } from './model';
import { acquireEvidence, computeBelief, stanceFromConfidence, slotAssertion } from './belief';

/** The status slot for "who rules settlement S" — one ruler office per settlement. The producer
 *  (perceiveCoronation) and any consumer (an orgStatusBeliefOf caller) agree on the slot via this. */
export function coronationSlot(settlementId: number): string {
  return `ruler:${settlementId}`;
}

/**
 * PRODUCER — a coronation the holder comes to believe: `newRuler` was installed in `slot`. The
 * holder gains supporting evidence for `newRuler` AND contradicting evidence against every OTHER
 * claimant they currently hold for that slot — because a slot has one filler, installing a
 * successor unseats the incumbent. This is where "competitive" lives; the reducer stays simple.
 * Inert like all belief formation (invariant 8) — no Event of its own.
 */
export function learnCoronation(
  world: World,
  holder: EntityId,
  newRuler: EntityId,
  slot: string,
  cause: EventId,
): void {
  const assertion = slotAssertion(slot);
  // a fresh coronation is evidence the prior claimants no longer reign
  for (const b of world.beliefs.get(holder) ?? []) {
    if (b.assertion !== assertion || b.subject === newRuler) continue;
    acquireEvidence(world, holder, b.subject, assertion, {
      kind: 'testimony', polarity: -1, observationConfidence: 1, sourceTrust: 1, sinceTick: world.tick, cause,
    });
  }
  // …and evidence that the new ruler now does
  acquireEvidence(world, holder, newRuler, assertion, {
    kind: 'testimony', polarity: 1, observationConfidence: 1, sourceTrust: 1, sinceTick: world.tick, cause,
  });
}

/**
 * RESOLVER — among all claimants the holder has heard of for `slot`, the one they most believe
 * currently reigns (arg-max confidence), or none if no claim is actually believed. Pure read;
 * deterministic (claimants scanned in stable order, strict `>` keeps the earliest on a tie).
 */
export function computeStatusBelief(world: World, holder: EntityId, slot: string): StatusBelief {
  const assertion = slotAssertion(slot);
  let occupant: EntityId | undefined;
  let best = 0;
  for (const b of world.beliefs.get(holder) ?? []) {
    if (b.assertion !== assertion) continue;
    const c = computeBelief(b, world.tick).confidence;
    if (c > best) {
      best = c;
      occupant = b.subject;
    }
  }
  // only a believed claim seats an occupant; a faded/contested one leaves the slot open.
  if (occupant !== undefined && stanceFromConfidence(best) !== 'true') occupant = undefined;
  return { occupant, confidence: best };
}
