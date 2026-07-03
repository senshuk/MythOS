# Subjectivity 1A — Belief v1 (scope)

**Document type:** Implementation slice plan — the smallest Belief system that proves the Subjectivity layer.
**Companion documents:** `17-epistemics-adr.md` (the belief design this slices), `18-prime-movers.md` (objective vs. subjective), `11-simulation-ontology.md` (Mark), `15-execution-model.md` (invariants 8–10).
**Status:** Proposed. Ratify the scope fence before writing `belief.ts`.

---

## The single question

> **What is the smallest Belief system that proves the Subjectivity layer?**

Answer: actors holding **different beliefs about the same objective event**, derived from **different evidence**. Nothing more. If two actors diverge on one death, Subjectivity exists. Everything else is a later producer or consumer of Evidence — not a new subsystem.

## Goal

Prove divergence. One objective event, several actors, different holds on it. No UI, no rumors, no distortion.

## Scope fence

**In v1:**
- An actor can **witness** an event → gains supporting Evidence (inert, no emit).
- An actor can **receive testimony** → gains Evidence weighted by trust in the source.
- An actor holds **multiple pieces of Evidence** for a proposition.
- `computeBelief` derives a **stance** (`True` / `False` / `Unknown`) and a **confidence**.
- Beliefs are **revised** as new Evidence arrives (never replaced — `computeBelief` re-reads the stack).

**Explicitly NOT in v1** — each is a future *producer* or *consumer* of Evidence, never a new subsystem:
rumor distortion · lying-as-a-mechanic · documents · books · maps · propaganda · forgetting (beyond mark expiry) · organizations holding beliefs · player fog-of-war · conversation/dialogue · multi-value propositions (v1 is binary: the proposition is true or its negation is).

> The fraudster in the success test is **not** a lying subsystem. It is ordinary testimony whose assertion (`the king lives`) happens to contradict the truth. v1 needs no "lie" mechanic — a false belief is what a trusted source's contrary testimony *produces*.

## The minimal model

Belief is the **third consumer** of the `Mark` substrate (`mark.ts`), exactly as opinion and reputation are. `Evidence extends Mark`; the substrate is not reopened.

```ts
// model.ts
interface Evidence extends Mark {
  kind: 'witness' | 'testimony';   // v1's two producers; 'document' | 'inference' later
  polarity: 1 | -1;                // supports (+1) or contradicts (-1) the belief's assertion
  observationConfidence: number;   // [0,1] how direct/clear the sensing (a witness ≈ 1.0)
  sourceTrust: number;             // [0,1] how far the holder trusts the source (self = 1.0)
}

interface Belief {
  subject: EntityId;   // v1: the entity the proposition is about (the king)
  assertion: string;   // v1: a simple predicate ('dead')
  evidence: Evidence[];
  lastUpdated: number;
}

// world.ts
beliefs: Map<EntityId, Belief[]>;  // holder → their beliefs, keyed by (subject, assertion)

type Stance = 'true' | 'false' | 'unknown';
interface BeliefState { stance: Stance; confidence: number }
```

## The first (and only) reducer

```ts
// belief.ts — the third reducer, alongside computeOpinion and computeStanding
function computeBelief(belief: Belief, tick: number): BeliefState {
  let logOdds = 0;
  for (const e of activeMarks(belief.evidence, tick)) {     // ← substrate
    const weight = e.observationConfidence * e.sourceTrust; // [0,1] effective weight
    logOdds += e.polarity * STRENGTH * weight;              // STRENGTH: pack constant (~3)
  }
  const confidence = 1 / (1 + Math.exp(-logOdds));          // logistic → [0,1], 0.5 = no net evidence
  const stance: Stance =
    confidence >= BELIEVE      ? 'true'    :                // BELIEVE / DISBELIEVE: pack thresholds
    confidence <= 1 - BELIEVE  ? 'false'   :
                                 'unknown';
  return { stance, confidence };
}
```

Properties that make it correct-by-construction:
- **Derived, never stored** — mirrors `computeOpinion`. The Belief holds Evidence (reasons), not a number.
- **Order-independent & deterministic** — a plain sum of log-odds; no RNG, no wall-clock, recomputed from the stack. No `Math.random()`.
- **Accumulation, not a winner** — supporting Evidence pushes toward the assertion, contradicting away; equal-and-opposite → back to 0.5 → Unknown. This is "beliefs are revised, not replaced" (ADR §9.2) as arithmetic.
- **Unknown is the baseline** — no evidence ⇒ logOdds 0 ⇒ confidence 0.5 ⇒ Unknown. Ignorance is the default, not a special case.

## One funnel, many producers

Producers do not write the belief store directly. They build an `Evidence` and hand it to a single funnel:

```ts
// belief.ts — the ONE way evidence enters a belief. The reducer never learns where it came from.
acquireEvidence(world, holder, subject, assertion, evidence: Evidence): void
```

```
Observation ─┐
Testimony  ──┼─▶ Evidence ─▶ acquireEvidence() ─▶ world.beliefs ─▶ computeBelief()
Document   ──┘        (later)
```

The reducer is indifferent to provenance; the producers own it. This keeps the architecture symmetrical — every future source of knowledge (documents, inference, propaganda) is just another producer that ends in `acquireEvidence`, never a new path into the store. Producers are thin: `witnessBelief` and `tellBelief` construct an `Evidence` and call the funnel.

## The two producers — build one, stop, build one, stop

**Producer 1 — Witness** (piggybacks on existing perception; no new machinery). When the death event is witnessed, each witness gains `Evidence{ kind:'witness', polarity:+1, observationConfidence:1.0, sourceTrust:1.0, cause:eventId }` for `(king,'dead')`.

> **Architectural point your outline didn't name (but invariant 8 forces):** forming a belief from witnessing is an **inert read** — it writes `world.beliefs` but MUST NOT `emit()` an Event, exactly like `remember()` writes `world.memory` without emitting. If belief formation emitted, it would feed the Director and perturb seed-tuned drama — the precise leak Phase 2C taught us (invariant 8). Belief acquisition is never history.

**Producer 2 — Testimony.** `tellBelief(world, teller, hearer, subject, assertion)` reads the teller's stance and injects Evidence into the hearer: `polarity` from the teller's stance (skip if the teller is Unknown), `observationConfidence` from the teller's confidence, and `sourceTrust` **derived from the hearer's opinion of the teller** — reusing the emergent social graph rather than inventing a trust mechanic:

```ts
// pure read, no stored trust, no caching
sourceTrust = hasRelationship(hearer, teller)
  ? (clampOpinion(computeOpinion(getRel(hearer, teller), tick)) + 1000) / 2000  // [-1000,1000] → [0,1]
  : 0.5;                                                                          // no relationship → neutral
```

Properties this buys for free: people you like are more persuasive, people you distrust less so, strangers are neither saints nor liars (0.5), and trust networks differ per world — all from history already simulated. **No charisma, deception skill, priest authority, or culture modifiers in v1** — those are future *modifiers* of `sourceTrust`, not part of Belief v1.

v1 testimony is **inert** (no Event) — a direct evidence transfer. When telling later becomes a first-class spoken **Action** (Subjectivity 1B+, with distortion), it will emit `told` per invariant 9. That is a deliberate deferral, noted here so it is not a silent one.

## The test, written before the code

Two tests, matching the two producers. Assertions are on **stance and confidence ordering**, not exact floats — the floats in the ADR/your outline are illustrative; the *divergence* is the invariant.

```ts
// belief.test.ts — 1A.1: witness divergence (proves Subjectivity with ONE producer)
it('two actors derive different beliefs from the same objective death', () => {
  const w = fixtureWorld();
  const kingDies = emit(w, 'died', [king], {}, []);
  witnessBelief(w, alice, king, 'dead', kingDies);   // Alice saw it
  // Bob saw nothing.
  expect(computeBelief(beliefOf(w, alice, king, 'dead'), w.tick).stance).toBe('true');
  expect(beliefOf(w, bob, king, 'dead')).toBeUndefined();          // Bob has no belief → Unknown
});

// 1A.2: testimony + contradiction (the fraudster)
it('testimony spreads belief with attenuated confidence; contradiction returns it to Unknown', () => {
  const w = fixtureWorld();
  const kingDies = emit(w, 'died', [king], {}, []);
  witnessBelief(w, alice, king, 'dead', kingDies);
  tellBelief(w, alice, bob, king, 'dead');           // Alice tells Bob

  const A = computeBelief(beliefOf(w, alice, king, 'dead'), w.tick);
  const B = computeBelief(beliefOf(w, bob, king, 'dead'), w.tick);
  expect(A.stance).toBe('true');
  expect(B.stance).toBe('true');
  expect(B.confidence).toBeLessThan(A.confidence);   // secondhand < firsthand
  expect(beliefOf(w, charlie, king, 'dead')).toBeUndefined();       // Charlie: Unknown

  tellBelief(w, fraudster, bob, king, 'alive');       // contrary testimony Bob trusts ~equally
  expect(computeBelief(beliefOf(w, bob, king, 'dead'), w.tick).stance).toBe('unknown');
});
```

## Two commits — one capability each

Following the 2A/2B/2C rhythm (each commit proved exactly one new capability), Belief v1 lands as two commits, not one:

- **Commit A — "Belief exists."** `Evidence extends Mark`, `BeliefState`, `computeBelief`, `acquireEvidence`, the **witness** producer, and test **1A.1** only. Proves: *different actors now inhabit different subjective realities.* This is the architectural milestone — Subjectivity exists.
- **Commit B — "Belief spreads."** The **testimony** producer (`tellBelief` + opinion-derived `sourceTrust`), contradiction, and test **1A.2** (the fraudster). Proves: *subjective realities can propagate and change.* A distinct capability from A.

Bisecting the history years from now yields two clean conceptual milestones — *Subjectivity exists* and *Subjectivity propagates* — rather than one tangled feature.

## Definition of done

1A.1 green (Commit A) = **Subjectivity is proven.** Then *stop* — do not add a third producer. 1A.2 green (Commit B) = testimony works and a false belief is representable. Then *stop again* and ask: what is the next producer of Evidence? (Documents, most likely — testimony-at-rest.) Build exactly one.

---

## Subjectivity 1B — the first consumer (shipped)

Belief v1 (above) is a producer of knowledge. 1B is the first **consumer**: the pattern is

```
Belief ──▶ Reaction        (NOT: Belief ──▶ special-case mourning)
```

`reactToBeliefs` (weekly) asks `computeBelief` and dispatches on the belief's assertion. Adding future reactions never touches Belief itself — only the dispatch table and (later) the assertion vocabulary grow:

```
dead      → mourn        (shipped)
born      → celebrate
married   → congratulate
crowned   → acclaim
killed-by → avenge
heresy    → denounce
```

Two disciplines make this durable: **reactions ask `computeBelief`, never inspect `Evidence`** (the reducer is the only API into belief), and **reaction state lives in `world.reactions`, never on the `Belief`** (belief is knowledge; reacting is behaviour — Belief ≠ Reaction, as Intent ≠ Action). Reactions are edge-triggered (fire once, when a stance first crosses to believed).

### Temporary asymmetry (a known inconsistency — not the desired model)

In 1B, **emotional** reactions became subjective (you mourn when you *learn*) while **social/legal** state stays objective — `killActor` still severs bonds and widows at the instant of death, before anyone knows. This is intentional: it proves the Belief→Decision pipeline **without** making relationships epistemic. A future **Epistemic Relationships** phase may migrate individual systems (widowhood, inheritance, membership) behind belief, one at a time. Until then, "relationships are objective" is not *how MythOS works* — it is how MythOS works *until that phase*.

### The progression this establishes

Each step adds a producer, a reaction, or an assertion — **never a change to Belief itself**. That separation is the point:

- **1A — Belief exists.** (witness + testimony producers) ✓
- **1B — Belief causes one reaction.** (mourning) ✓
- **1C-local — Belief spreads by conversation.** ✓ (`shareBelief` wired into `resolveInteract`; a kinsman who missed a death can learn of it in a conversation and then mourn — conversation is now causal, not cosmetic)
- **1C-distal — Belief spreads across the map.** (carriers on the travel system, so kingdoms live on different timelines)
- **1D — Belief gains richer assertions.** (`killed-by`, ownership, location, …)
- **2 — Systems consume beliefs.** (crime, politics, diplomacy, succession react to what they believe)

This avoids solving "knowledge" all at once: the belief primitive is fixed; the world's use of it grows outward.

## Where subjectivity may live — the LOD law (and what it means for 1C-distal)

The dramatic time-delay stories (a village celebrates a ruler who died in the capital; a frontier fights a war the capital already ended) seem to need *aggregate* settlements to hold beliefs. They do not — and shouldn't. The governing law, now in the ontology (`11` §Mark):

> **Subjectivity exists only where agency exists.** An Actor holds beliefs; an Organization *derives* them from its members; an aggregate settlement holds none.

So the first question for 1C-distal is **not** "who *believes*?" but **"who *receives* the testimony?"** — and the answer is always an agent (a resident actor, or an organization through its members), never the aggregate:

```
capital death → carrier travels → a resident/governor receives → acquireEvidence → member belief
                                                                        ↓
                                                              orgBeliefOf (derived) → org reasoning
```

**Organizations derive belief, they never own it** — `orgBeliefOf` (shipped, in `orgReason.ts`) reduces member beliefs to an institutional stance, exactly as `worldviewOf` reduces member values to a worldview. The institution comes to know as its people do (one member knowing barely moves it; broad awareness makes it true). An org with no simulated members holds no belief — Unknown. No new epistemic source of truth; no exception to LOD.

This is the first collective **belief** reducer, and the second collective reducer of any kind (after `worldviewOf`). They share a law — *individual minds are first-class; collective minds are always derived* (ontology `11` §Mark) — so member fears → collective fear, member morale → collective morale, etc. will take the same shape. The general concept (collective cognition) is real but stays unnamed until a second belief-consumer forces it: **write the reducer, don't add the field.**

**Evidence has carriers.** Don't model testimony as a bare payload — model **Evidence as something a carrier transports**, and let the *existing* transport system move carriers with latency (`travel.ts` already models transit-with-duration). On arrival, the carrier calls `acquireEvidence`. The carrier set is a Universe Pack seam — the engine stays ignorant of fantasy vs. sci-fi:

```
Evidence ← carrier ∈ { witness · messenger · letter · caravan · priest · sensor · vision · … }
```

This is where time-delayed causality enters for free: `acquireEvidence` fires at the carrier's **arrival** tick, not the event tick. News travels slower than events, and the divergence is a consequence of transport, not special story logic.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-03 | Initial slice plan. Fences Belief v1 to the smallest scope that proves Subjectivity: `Evidence extends Mark`, `computeBelief` (log-odds accumulation → stance + confidence, Unknown as baseline), two producers built one-at-a-time (witness, then testimony), belief formation inert per invariant 8, v1 testimony inert with `told`-emits deferred to 1B. Test written before code; assertions on stance + confidence ordering, not floats. |
| 1.1 | 2026-07-03 | Added the shipped **Subjectivity 1B** (first consumer): the `Belief → Reaction` pattern, mourning as the first reaction, the two boundary disciplines, the **temporary asymmetry** documented as a known inconsistency (emotional-subjective / social-legal-objective) pending an Epistemic Relationships phase, and the 1A→1B→1C→1D→2 progression (grow producers/reactions/assertions, never Belief itself). |
| 1.2 | 2026-07-03 | Added the **LOD law** for 1C-distal: *subjectivity exists only where agency exists* (ontology `11` §Mark) — aggregate settlements never believe; the question is "who receives testimony?", answered by an agent. Shipped **`orgBeliefOf`** (organizations derive belief from members, own no evidence stack — the epistemic twin of `worldviewOf`; `stanceFromConfidence` extracted so direct and derived beliefs share one threshold). Framed **Evidence as carrier-transported** (carriers are a Universe Pack seam; `acquireEvidence` fires at arrival tick → time-delay for free). |
