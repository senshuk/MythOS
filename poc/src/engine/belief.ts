/**
 * BELIEF — the subjective layer (Subjectivity 1A; design/19, ADR design/17).
 *
 * What an actor holds true about the world, DERIVED from a stack of Evidence — the third
 * consumer of the Mark substrate (mark.ts), beside opinion (sentiment) and reputation
 * (standing). A Belief may be FALSE: it asserts what the holder thinks, not what the
 * objective Event log records. This is the layer that lets two actors inhabit different
 * realities of the same event.
 *
 * INVARIANT 8 (execution-model): forming or updating a belief is an INERT read — it writes
 * world.beliefs but MUST NOT emit() an Event, exactly as remember() writes world.memory
 * without emitting. Belief is never history; only acting on a belief can be.
 *
 * Evidence enters through ONE funnel — acquireEvidence. Producers (witness now; testimony,
 * documents later) build an Evidence and hand it in. The reducer never learns where it came
 * from; provenance is the producer's concern, not the belief's.
 */
import { type World, type EntityId, type EventId, type Evidence, type Belief, type BeliefState, type Stance } from './model';
import { activeMarks } from './mark';

/** Evidence strength: scales effective weight [0,1] into log-odds. Pack data (a v1 constant). */
const STRENGTH = 3;
/** Confidence at/above which a stance is held TRUE (and ≤ 1−BELIEVE ⇒ FALSE). Pack data. */
const BELIEVE = 0.66;

/** The holder's belief about (subject, assertion), or undefined if they hold none. */
export function beliefOf(
  world: World,
  holder: EntityId,
  subject: EntityId,
  assertion: string,
): Belief | undefined {
  return world.beliefs.get(holder)?.find((b) => b.subject === subject && b.assertion === assertion);
}

/**
 * THE FUNNEL. Add one piece of Evidence to a holder's belief about (subject, assertion),
 * creating the belief on first evidence. This is the ONLY way evidence enters the store —
 * the reducer is indifferent to which producer called it. INERT: writes state, emits nothing.
 */
export function acquireEvidence(
  world: World,
  holder: EntityId,
  subject: EntityId,
  assertion: string,
  evidence: Evidence,
): void {
  let held = world.beliefs.get(holder);
  if (!held) {
    held = [];
    world.beliefs.set(holder, held);
  }
  let belief = held.find((b) => b.subject === subject && b.assertion === assertion);
  if (!belief) {
    belief = { subject, assertion, evidence: [], lastUpdated: world.tick };
    held.push(belief);
  }
  belief.evidence.push(evidence);
  belief.lastUpdated = world.tick;
}

/**
 * Effective belief: accumulate the active evidence as log-odds (Bayesian-in-spirit, so it is
 * order-independent and deterministic), then read off a confidence and a stance. Supporting
 * evidence pushes toward the assertion, contradicting away; equal-and-opposite returns to
 * Unknown. Derived on demand — confidence is never stored, exactly like computeOpinion and
 * computeStanding. No RNG, no wall-clock.
 */
export function computeBelief(belief: Belief, tick: number): BeliefState {
  let logOdds = 0;
  for (const e of activeMarks(belief.evidence, tick)) {
    const weight = e.observationConfidence * e.sourceTrust; // [0,1] effective weight
    logOdds += e.polarity * STRENGTH * weight;
  }
  const confidence = 1 / (1 + Math.exp(-logOdds)); // logistic → [0,1]; 0.5 = no net evidence
  const stance: Stance = confidence >= BELIEVE ? 'true' : confidence <= 1 - BELIEVE ? 'false' : 'unknown';
  return { stance, confidence };
}

/**
 * PRODUCER — Witness. An actor who directly saw `eventId` forms firsthand evidence FOR
 * `assertion` about `subject`: observationConfidence 1.0 (own eyes), sourceTrust 1.0 (self).
 * Inert — no Event. Piggybacks on perception's existing witness selection; a witness who
 * saw a death simply comes to believe the death.
 */
export function witnessBelief(
  world: World,
  witness: EntityId,
  subject: EntityId,
  assertion: string,
  eventId: EventId,
): void {
  acquireEvidence(world, witness, subject, assertion, {
    kind: 'witness',
    polarity: 1,
    observationConfidence: 1.0,
    sourceTrust: 1.0,
    sinceTick: world.tick,
    cause: eventId,
  });
}
