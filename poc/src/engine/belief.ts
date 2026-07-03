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
  return { stance: stanceFromConfidence(confidence), confidence };
}

/**
 * Map a confidence in [0,1] to a stance against the pack thresholds — the SINGLE place the
 * True / False / Unknown bands are defined. Any DERIVED belief (e.g. an organization's belief
 * reduced from its members) reuses this so the bands never drift between direct and derived.
 */
export function stanceFromConfidence(confidence: number): Stance {
  return confidence >= BELIEVE ? 'true' : confidence <= 1 - BELIEVE ? 'false' : 'unknown';
}

/** The per-claimant proposition backing a STATUS: "<claimant> currently fills <slot>". A status
 *  belief is a set of these ordinary beliefs (one per claimant), resolved by computeStatusBelief.
 *  The reserved `reigns:` assertion prefix is the key convention; it lives here because belief.ts
 *  owns how beliefs are keyed by assertion. */
export function slotAssertion(slot: string): string {
  return `reigns:${slot}`;
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

/**
 * PRODUCER — Testimony. `teller` conveys their stance on (subject, assertion) to `hearer` as
 * one piece of Evidence: polarity from the teller's stance, observationConfidence from how
 * CERTAIN the teller is in that stance, and `sourceTrust` SUPPLIED BY THE CALLER. Trust is a
 * policy the orchestration layer owns — it may derive from opinion (see `trustFromOpinion`),
 * rank, sensor fidelity, or attunement — so belief.ts never learns *why* a source is trusted,
 * only records evidence at the given trust (defaults to neutral 0.5). A teller who is Unknown
 * says nothing. Inert — no Event (v1); when telling becomes a first-class spoken Action it will
 * emit `told` per invariant 9.
 *
 * A false belief needs no "lie" mechanic: a teller sincerely convinced of a falsehood conveys
 * it, and a hearer who trusts a mistaken source comes to doubt (or believe) the truth.
 */
export function tellBelief(
  world: World,
  teller: EntityId,
  hearer: EntityId,
  subject: EntityId,
  assertion: string,
  sourceTrust = 0.5,
): void {
  const held = beliefOf(world, teller, subject, assertion);
  if (!held) return; // the teller holds no belief — nothing to say
  const { stance, confidence } = computeBelief(held, world.tick);
  if (stance === 'unknown') return; // "I don't know" is not testimony
  // the teller's certainty in the stance they actually hold (confidence is P(assertion true))
  const certainty = stance === 'true' ? confidence : 1 - confidence;
  acquireEvidence(world, hearer, subject, assertion, {
    kind: 'testimony',
    polarity: stance === 'true' ? 1 : -1,
    observationConfidence: certainty,
    sourceTrust,
    sinceTick: world.tick,
    cause: held.evidence[held.evidence.length - 1]?.cause, // trace back toward what the teller knows
  });
}

/**
 * PRODUCER — Conversation (Subjectivity 1C-local). When `teller` and `hearer` interact
 * socially, the teller passes ONE piece of news the hearer doesn't yet have: the first
 * proposition the teller holds a definite stance on (`true`/`false`) that the hearer holds NO
 * belief about. This spreads knowledge within a settlement using the existing social loop as
 * the medium — no new transport, storage, or assertions.
 *
 * Bounded by construction: a hearer is told a proposition only while they still know nothing
 * of it, so repeated conversations can't pile evidence up without end. Deterministic — the
 * first eligible belief in list order; no RNG. Inert like all belief formation (invariant 8).
 */
export function shareBelief(world: World, teller: EntityId, hearer: EntityId, sourceTrust = 0.5): void {
  const held = world.beliefs.get(teller);
  if (!held) return;
  for (const b of held) {
    if (computeBelief(b, world.tick).stance === 'unknown') continue; // nothing definite to pass on
    if (beliefOf(world, hearer, b.subject, b.assertion)) continue; // the hearer already has this news
    tellBelief(world, teller, hearer, b.subject, b.assertion, sourceTrust);
    return; // one piece of news per conversation
  }
}
