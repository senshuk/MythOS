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
import { type World, type EntityId, type EventId, type Evidence, type Belief, type BeliefState, type Stance, DAYS_PER_YEAR } from './model';
import { type Reason, activeMarks, indexBy } from './mark';
import { DRIFT_CHANCE, DRIFT_HOPS, DRIFT_YEARS, driftSpecsFor } from './pack';
import { mixSeed } from './rng';
import { getEvent } from './world';

/** Evidence strength: scales effective weight [0,1] into log-odds. Pack data (a v1 constant). */
const STRENGTH = 3;
/** Confidence at/above which a stance is held TRUE (and ≤ 1−BELIEVE ⇒ FALSE). Pack data. */
const BELIEVE = 0.66;

/** How each evidence kind reads to a person — the engine's own vocabulary (kinds are a fixed
 *  EvidenceKind union in model.ts, not pack data), matching the one hardcoded row mood.ts already
 *  allows itself (temperament's "a bright/heavy nature"). Keyed by LABEL KEY, not strictly by
 *  kind: a retelling that changed the story is still `testimony`, but it must not read like an
 *  ordinary one — see `labelKeyOf`. */
const EVIDENCE_LABELS: Record<string, string> = {
  witness: 'saw it happen',
  testimony: 'told by another',
  retelling: 'told as a tale that had changed',
};

/** Which explanation row a piece of evidence belongs in. Evidence delivered by a retelling that
 *  DRIFTED reads differently from plain testimony, though its `kind` is the same — so a holder
 *  can see that part of what they "know" arrived as a story, not as news. */
function labelKeyOf(e: Evidence): string {
  return e.driftedFrom !== undefined ? 'retelling' : e.kind;
}

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

/** The human-readable reasons behind a belief, strongest first (for the UI) — the belief-layer
 *  sibling of opinionReasons/standingReasons/moodReasons, satisfying design/17-epistemics-adr.md
 *  §8's law that an inspector must ship with the primitive. Evidence is grouped by kind and
 *  weighted the same way computeBelief weighs it, so the rows explain that number exactly. */
export function beliefReasons(belief: Belief, tick: number, limit = 6): Reason[] {
  const byKind = indexBy(activeMarks(belief.evidence, tick), labelKeyOf);
  const rows: Reason[] = [];
  for (const [kind, arr] of byKind) {
    let total = 0;
    for (const e of arr) total += e.polarity * STRENGTH * e.observationConfidence * e.sourceTrust;
    const label = EVIDENCE_LABELS[kind] ?? kind;
    rows.push({ label: arr.length > 1 ? `${label} (×${arr.length})` : label, value: Math.round(total * 100) });
  }
  rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return rows.slice(0, limit);
}

/**
 * The retellings that CHANGED this story, most-recent-hop first — the Legend Drift half of the
 * belief layer's explanation surface (design/30 §4.1's "the full evidence chain stays
 * inspectable"). Returns the same `Reason[]` every other *Reasons function does, so the UI
 * renders it through the shared ReasonsList and nothing bespoke is needed: `value` is the hop at
 * which the story changed, and the label names what it changed FROM.
 *
 * Empty for a belief that arrived intact — most beliefs. A holder can therefore always ask "why
 * do I believe this particular version?" and be told exactly where the tale turned.
 */
export function driftReasons(belief: Belief, tick: number, limit = 6): Reason[] {
  const rows = new Map<string, Reason>(); // one row per turning point, however many mouths carried it
  for (const e of activeMarks(belief.evidence, tick)) {
    if (e.driftedFrom === undefined) continue;
    const hop = e.driftedAt ?? e.hops ?? 0;
    const label = `at retelling ${hop}, "${e.driftedFrom}" became "${belief.assertion}"`;
    rows.set(label, { label, value: hop });
  }
  return [...rows.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/** The per-claimant proposition backing a STATUS: "<claimant> currently fills <slot>". A status
 *  belief is a set of these ordinary beliefs (one per claimant), resolved by computeStatusBelief.
 *  The reserved `reigns:` assertion prefix is the key convention; it lives here because belief.ts
 *  owns how beliefs are keyed by assertion. */
export function slotAssertion(slot: string): string {
  return `reigns:${slot}`;
}

/** The status slot for "who rules settlement S" — one ruler office per settlement. Producers
 *  (perceiveCoronation) and consumers (the legitimacy perception fact) agree on the slot via this. */
export function coronationSlot(settlementId: number): string {
  return `ruler:${settlementId}`;
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
    hops: 0, // firsthand: no one stands between this actor and what happened
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
  const { hops, cause } = originOf(held, world.tick);
  acquireEvidence(world, hearer, subject, assertion, {
    kind: 'testimony',
    polarity: stance === 'true' ? 1 : -1,
    observationConfidence: certainty,
    sourceTrust,
    sinceTick: world.tick,
    cause, // trace back toward what the teller knows
    hops: hops + 1, // one more mouth between the hearer and the event (Legend Drift reads this)
  });
}

// ------------------------------------------------- LEGEND DRIFT (design/30 §4.1) ---
// Closes design/17 §9.6's open fork — "what mutates when a testimony is retold?" — with the
// narrowest answer that is still true to how legends form: the ASSERTION mutates, and only
// once a story has travelled far enough (hops) or long enough (years) from what happened.
// Confidence and trust already attenuate per hop (tellBelief); drift is the second thing, not
// a replacement for the first.
//
// THE LAW (design/30 §4.1, same discipline as venue selection — design/24 §8 law 2): the draw
// is a PURE HASH of the retelling chain — never world.rng, never world.tick. A rumour's
// distortion is therefore exactly as reproducible as clean history: same seed + same chain of
// tellers ⇒ the same distorted legend, every run. A teller also always tells THEIR version the
// same way (the hash keys on the teller, not the hearer), which is what makes a drifted story
// spread as one coherent tale rather than dissolving into noise.

/** Separates a drifted assertion from the proposition it is a version of: `dead#cursed`.
 *  Deliberately NOT ':' — that separator is already spoken for by `slotAssertion`'s
 *  `reigns:<slot>` convention, and status beliefs must never be mistaken for drifted ones. */
const DRIFT_SEP = '#';
/** Salts, so the "does it drift?" gate and the "into what?" draw are uncorrelated. */
const GATE_SALT = 0xd21f;
const DRAW_SALT = 0x1eaf;

/** The proposition a (possibly drifted) assertion is a version OF: `dead#cursed` → `dead`. */
export function baseAssertion(assertion: string): string {
  const i = assertion.indexOf(DRIFT_SEP);
  return i < 0 ? assertion : assertion.slice(0, i);
}

/** The version an assertion carries, or undefined if it is the plain, undrifted proposition. */
export function driftVariant(assertion: string): string | undefined {
  const i = assertion.indexOf(DRIFT_SEP);
  return i < 0 ? undefined : assertion.slice(i + 1);
}

/** The holder's CLOSEST link to what happened: the fewest-hops active evidence, and the event it
 *  traces back to. A belief is only as distant from the truth as its best source. */
function originOf(belief: Belief, tick: number): { hops: number; cause: EventId | undefined } {
  let best: Evidence | undefined;
  for (const e of activeMarks(belief.evidence, tick)) {
    if (!best || (e.hops ?? 0) < (best.hops ?? 0)) best = e;
  }
  return { hops: best?.hops ?? 0, cause: best?.cause };
}

/** Where the version a belief holds was INVENTED, if it is a drifted one — carried on the
 *  evidence, so any holder of a legend can name the retelling it turned at, not just whoever
 *  happened to turn it. Undefined for a story that arrived as it happened. */
function provenanceOf(belief: Belief, tick: number): { driftedFrom: string; driftedAt: number } | undefined {
  for (const e of activeMarks(belief.evidence, tick)) {
    if (e.driftedFrom !== undefined) return { driftedFrom: e.driftedFrom, driftedAt: e.driftedAt ?? e.hops ?? 0 };
  }
  return undefined;
}

/** Has this story travelled far enough to distort? Either threshold suffices: a long chain of
 *  mouths, OR a long time carried. A source event swept from history is judged on hops alone. */
function mayDrift(world: World, toldHops: number, cause: EventId | undefined): boolean {
  if (toldHops >= DRIFT_HOPS) return true;
  if (cause === undefined) return false;
  const ev = getEvent(world, cause);
  if (!ev) return false;
  return Math.floor(world.tick / DAYS_PER_YEAR) - ev.year >= DRIFT_YEARS;
}

/**
 * What `teller` would say if asked about (subject, assertion) — the assertion they'd actually
 * utter, which past the drift threshold may not be the one they hold. Undefined when they'd say
 * nothing at all (they hold no belief, or hold no definite stance).
 *
 * PURE: computes, writes nothing. `retell` uses it to decide what to hand over, and `shareBelief`
 * uses it to check whether the hearer has already heard *that version* — which is what keeps the
 * conversation loop bounded now that one belief can be told as several different stories.
 */
export function retoldAssertion(
  world: World,
  teller: EntityId,
  subject: EntityId,
  assertion: string,
): string | undefined {
  const held = beliefOf(world, teller, subject, assertion);
  return held ? retoldFrom(world, teller, held) : undefined;
}

/** `retoldAssertion` for a belief the caller already has in hand — the shape the producers and the
 *  conversation loop actually want, so a single telling reduces the evidence stack once instead of
 *  re-finding and re-reducing the same belief at every step. */
function retoldFrom(world: World, teller: EntityId, held: Belief): string | undefined {
  const { stance } = computeBelief(held, world.tick);
  if (stance === 'unknown') return undefined; // "I don't know" is not testimony
  // Only an AFFIRMED tale grows in the telling. A denial ("he is not dead") has no story to
  // embellish, and drifting it would assert a nonsense negative ("he was not cursed").
  if (stance !== 'true') return held.assertion;

  const { hops, cause } = originOf(held, world.tick);
  const toldHops = hops + 1;
  if (!mayDrift(world, toldHops, cause)) return held.assertion;

  const base = baseAssertion(held.assertion);
  const specs = driftSpecsFor(base);
  if (specs.length === 0) return held.assertion; // this universe tells this proposition straight

  // pure hash on the retelling chain — (seed, source event, teller, depth). No rng, no tick.
  const chain = mixSeed(world.seed, cause ?? 0, teller, toldHops);
  if ((mixSeed(chain, GATE_SALT) % 1000) / 1000 >= DRIFT_CHANCE) return held.assertion; // told faithfully
  const spec = specs[mixSeed(chain, DRAW_SALT) % specs.length];
  return `${base}${DRIFT_SEP}${spec.id}`;
}

/**
 * PRODUCER — Retelling (Legend Drift; design/30 §4.1). Testimony's older, less reliable sibling:
 * `teller` conveys their stance to `hearer` exactly as `tellBelief` does — but a story far enough
 * from its source may arrive as a DIFFERENT assertion than the one the teller holds.
 *
 * Below the pack's thresholds this is precisely `tellBelief` plus hop-counting: nothing drifts
 * while an event is close at hand. Past them, the hearer may come to believe `dead#cursed` where
 * the teller only ever said `dead` — a proposition of its own, which can then be retold, drift
 * again, and be contradicted by someone who was actually there. That is the whole mechanism; the
 * evidence stack does the rest.
 *
 * Inert (invariant 8): writes belief, emits no Event. Legible: the delivered evidence records
 * both its distance from the source (`hops`) and, if this retelling changed the story, what it
 * changed FROM (`driftedFrom`) — see `driftReasons`.
 */
export function retell(
  world: World,
  teller: EntityId,
  hearer: EntityId,
  subject: EntityId,
  assertion: string,
  sourceTrust = 0.5,
): void {
  const held = beliefOf(world, teller, subject, assertion);
  if (!held) return; // the teller holds no belief — nothing to say
  const told = retoldFrom(world, teller, held);
  if (told === undefined) return; // …or holds no definite stance on it
  const { stance, confidence } = computeBelief(held, world.tick);
  const certainty = stance === 'true' ? confidence : 1 - confidence;
  const { hops, cause } = originOf(held, world.tick);
  // Where this version came from: THIS retelling if it is the one that turned the tale, else the
  // provenance the teller's own version carries — so the record of where a legend was born
  // travels with it instead of staying behind with whoever invented it.
  const drift =
    told !== assertion
      ? { driftedFrom: assertion, driftedAt: hops + 1 }
      : provenanceOf(held, world.tick);
  acquireEvidence(world, hearer, subject, told, {
    kind: 'testimony',
    polarity: stance === 'true' ? 1 : -1,
    observationConfidence: certainty,
    sourceTrust,
    sinceTick: world.tick,
    cause, // still traces back toward the original event, drifted or not
    hops: hops + 1,
    ...(drift ?? {}),
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
 *
 * Goes through `retell`, so an old or well-travelled story may change as it passes (Legend
 * Drift, design/30 §4.1) — the existing social loop is the medium for legends exactly as it is
 * for news, with no new transport. The bound survives because the hearer is checked against the
 * version they'd actually be TOLD (`retoldAssertion`), not the one the teller holds: a teller
 * whose tale has drifted tells that same drifted tale every time, so it still lands only once.
 */
export function shareBelief(world: World, teller: EntityId, hearer: EntityId, sourceTrust = 0.5): void {
  const held = world.beliefs.get(teller);
  if (!held) return;
  for (const b of held) {
    const told = retoldFrom(world, teller, b); // undefined ⇒ nothing definite to pass on
    if (told === undefined) continue;
    if (beliefOf(world, hearer, b.subject, told)) continue; // the hearer already has this news
    retell(world, teller, hearer, b.subject, b.assertion, sourceTrust);
    return; // one piece of news per conversation
  }
}
