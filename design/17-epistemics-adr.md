# ADR — Epistemics (the Belief Layer)

**Document type:** Architecture Decision Record — the design of subjective knowledge.
**Companion documents:** `11-simulation-ontology.md`, `15-execution-model.md` (invariants 8 & 9), `14-component-model.md`.
**Status:** Shipped through 1D + distal (news frontier). §12 (the v1 implementation slice) and §13 (distal propagation) were originally separate design notes (`19-subjectivity-1a-belief-v1.md`, `20-distal-news-frontier.md`), folded in here as the ADR's implementation record once both shipped — one document for the whole epistemics arc rather than three.
**Supersedes nothing. Extends:** the Perception→Reasoning→Action→History layering (execution-model §Invariants).

---

## 1. Context — why this, why now

Foundation is complete: Locations, Actors, Organizations, a causal Event log, and deterministic history. Every system above the snapshot line reads one **objective** world. Today, when the king dies, every actor and organization reasons from the same fact the instant it is emitted.

The next capability is the one very few simulations have: **different entities inhabiting different realities because they hold different knowledge of the same objective world.** A witness knows. The temple hears. Merchants hear later. A neighbouring kingdom hears weeks later, distorted. Organizations `resolve()` on what they believe, not on what is true. History diverges.

The trap is equal and opposite to scripting: a world that generates divergent private realities *no one can trace* has failed exactly as hard as one that scripts its outcomes (CLAUDE.md, Legibility). This ADR is written to avoid both — and to avoid a fourth parallel subsystem that makes the engine less elegant as it grows.

## 2. The pressure-test finding: the substrate already exists

Before designing a "belief engine," we checked whether the engine already contains the primitive. It does — twice.

| Primitive | Struct | Holder → Referent | Fold (reducer) | Reasons |
|---|---|---|---|---|
| `Thought` (opinion.ts) | `{ kind, value, sinceTick, expiresTick?, cause }` | Actor → Actor (directed edge) | signed diminishing-returns sum → **sentiment** | `opinionReasons()` |
| `ReputeMark` (reputation.ts) | `{ kind, value, sinceTick, expiresTick?, witnesses, cause }` | Actor → *the public* | witness-weighted sum → **standing** | `standingReasons()` |
| `memory` (model.ts) | `EventId[]` | Actor → Events | *(none — raw pointer list)* | — |
| **`Belief` (proposed)** | `{ subject, assertion, evidence[] }` | Actor → *any proposition* | evidence accumulation → **stance (True/False/Unknown) + derived confidence** | `beliefReasons()` |

`Thought` and `ReputeMark` are the **same struct minus one field**. The code already says so in its own comments ("the community-scale sibling of opinion-as-thoughts… exactly like opinion.ts"). Each is a bounded list of **sourced, kinded, decaying marks**, folded to a scalar, with a reasons-extractor for the inspector. That shared shape is the real primitive. Call it a **Mark**.

`memory` is the odd one out — a bare pointer list with no confidence, no decay-of-certainty, no record of *how* the actor came to hold it. That absence is precisely why perception can only ever write **true** things: a `memory` entry is a witnessed event id, and a witnessed event is true by construction. **Epistemics begins the moment an actor can hold a Mark whose claim the objective Event log contradicts.**

## 3. Decision 1 — A Belief is a Mark, not a Thought. Unify the substrate; keep the folds separate.

The seductive version — *"a belief is a Thought"* — is **rejected**, because it unifies the wrong layer.

- A `Thought` is **affective and first-person**: a magnitude on a signed scale that you *sum*. You cannot transmit a grudge; you can only give someone a reason to form their own.
- A `Belief` is **propositional and truth-apt**: it asserts that the world *is* a certain way ("the king is dead", "the bridge is unsafe", "this map is authentic"). You cannot sum three propositions the way you sum three grudges. Their reducer is **arbitration** (which claim wins) plus **confidence** (how sure), not addition.

So the honest unification is one level down:

> **`Thought`, `ReputeMark`, and `Belief` are three `Mark` kinds over one substrate. What differs is the fold: sentiment-sum, standing-sum, and belief-arbitration respectively.**

**Consequence for implementation:** extract the common substrate (`{ kind, value/assertion, sinceTick, expiresTick?, cause }`, plus the `addMark / prune / reasons` housekeeping that `opinion.ts` and `reputation.ts` already duplicate) into one module. `Belief` is a third consumer of it with its own reducer. We refactor toward the unified substrate rather than cloning a fourth silo — this is a *reuse* win the audit already implies, not new surface area.

**`Mark` is promoted to a first-class ontology concept** (`11-simulation-ontology.md` §Constructs): *a subjective, sourced, time-varying assertion held by an entity, reduced by domain-specific semantics — sentiment, reputation, or belief.* It now stands alongside Event, Relationship, and Record, and names the layer where nearly all of MythOS's subjectivity lives. The distinction it enforces — **a Mark can be false; an Event cannot** — is the entire foundation of this phase.

## 4. Decision 2 (Q1) — What a Belief is about

**A Belief's `subject` is any addressable id** — Actor, Location, Object, Organization, or Event. This mirrors `Relationship`, which the ontology already permits "between any two entities with Identity." A belief about the *unsafe bridge* (Location), the *authentic map* (Object), the *dead king* (Actor via an Event), and the *guild's treachery* (Organization) are all the same shape: a `holder` asserts an `assertion` about a `subject`.

**The Belief ↔ Thought boundary** (they must not collide on "the king is trustworthy"):

- **Thought** — *"I resent the king."* First-person affect. Not truth-apt, not transmissible. Lives on the A→B edge.
- **Belief** — *"The king is trustworthy / is dead / betrayed us."* A truth-apt claim about the world that **can be told to someone else** and can be **wrong**.

The bright line: **Beliefs are transmissible and falsifiable; Thoughts are first-person and affective.** When an actor hears "the king is fair," they acquire a *belief* (which may seed a Thought via their own valuation). They never receive the teller's Thought directly.

## 5. Decision 3 (Q3) — How truth is represented

**A Belief is an independent claim that may or may not correspond to the objective Event log. It is *not* a pointer-to-truth-plus-confidence.**

This is the load-bearing decision of the whole phase. If a Belief stored "the true value + my confidence in it," false belief would be unrepresentable and the feature would not exist.

- **Objective truth lives in `Event.data`** — the immutable, causal log. Unchanged by this ADR.
- **A Belief is a separate assertion** held by an actor, backed by an **evidence stack** (which may support a false assertion). The field is named `assertion`, not `claim`: an actor *asserts* something about reality; the historian later determines whether that assertion corresponds to the objective log.
- **Confidence is derived, never stored** (see §9.1–9.2). A Belief does not record "I am 82% sure." It records the *evidence* — witness / testimony / document / inference marks — and both confidence and stance (True/False/Unknown) are computed from it, exactly as `computeOpinion` derives sentiment from Thoughts and `computeStanding` derives standing from marks. The engine stores reasons, not conclusions.
- **Correspondence is computed on demand, never stored.** "Is this belief true?" is answered by comparing the `assertion` against the Event log at read time. It is **not** a field on the Belief.
- **Critically, the believer cannot see the comparison.** An actor who believes the king lives does not know they are wrong — nothing in their reasoning inputs reveals the mismatch. Only the **historian / UI / determinism layer** may compute correspondence, to render "believed falsely that…". This is what produces genuine divergent realities rather than actors who secretly know the truth.

**And belief never writes reality (execution-model invariant 10).** A Belief is a read-only input to reasoning: it may change what an entity *intends*, and an intent may become an Action whose outcome writes reality — but no belief modifies world state on its own. The permitted chain is **Reality → Belief → Reasoning → Intent → Action → Outcome → Reality**; the shortcut **Belief → Reality** is forbidden. This is the structural guarantee that a false belief perturbs *decisions*, never the objective log — the same discipline invariants 8 and 9 already impose on reasoning, extended to knowledge.

## 6. Decision 4 (Q4 + Q2) — Testimony is the propagation atom

**The unit of propagation is a single `Testimony`: one sourced claim transmitted from a source to a holder.** Not the whole belief set, not the actor's mind — one claim at a time. This unifies Q4 (propagation unit) with Q2 (how belief changes), because *every* channel of belief change reduces to acquiring or aging a Testimony:

| Channel | Source of the Testimony | Causative? (per invariants 8 & 9) |
|---|---|---|
| **Witnessing** | the world itself (first-hand; already `remember()` + `witnessDeed()`) | the *event* is already causative; forming the belief is an inert read |
| **Testimony (telling)** | another Actor — a spoken claim | **causative** — telling is an Action; it emits (`told`) and may distort |
| **Document** | an Object carrying claims at rest (a letter, log, treaty, map) | **writing** and **reading** are Actions (emit); the claims sit inert in the Object between |
| **Inference** | the holder's own reasoning over held beliefs | **inert** — derived, no event (invariant 8) |
| **Forgetting** | decay of confidence to zero | **inert** — housekeeping, no event |
| **Contradiction** | two beliefs about one subject collide → arbitration | **inert** until it changes an Action; the *acting-on-it* is what emits |

Two structural payoffs:

- **A Document is testimony-at-rest.** An Object with claims can be read after its author is dead — the crown's forged charter, the explorer's lost map, the heretic's burned-but-copied gospel. This directly attacks the Tolkien-gap "objects as historical agents" item in the memory dossier: objects become *carriers of belief across time*, not just owned trinkets.
- **Witnessing is first-hand testimony where the source is the world.** One acquisition path, three sources — no special cases.

**Invariant compliance (execution-model §8–9):** acquisition *by an action* (telling, writing, reading) emits Events; **decay, inference, and arbitration are inert reads** and MUST NOT emit, exactly as the intent-overlay leak in Phase 2C taught. Belief is not a participant in history; *acting on* a belief is.

## 7. Determinism — distortion must be seeded

Rumor distortion is the marquee behaviour and the single most tempting place to reach for randomness. It must not.

- Every distortion draw uses a **local RNG stream salted by `(seed, sourceEvent, teller, hearer)`** — the exact pattern `witnessDeed` already uses (`mixSeed(world.seed, eventId, actor)`) so the shared settlement RNG is never advanced and the rest of the sim stays byte-identical.
- A rumor's mutation along a chain of tellings is therefore **reproducible**: same seed → same distorted history, every run. "Different realities" are deterministic realities.
- `Math.random()` remains banned (invariant 7).

## 8. Legibility budget — non-negotiable, built *with* the belief

Per CLAUDE.md, divergent realities is the easiest feature to make illegible. Ship the inspector **with** the primitive, not after. The UI MUST be able to answer, for any actor and any subject:

> **"What does this actor believe about this, how sure are they, and how did they come to believe it?"**

Because every Belief carries `source`, the provenance chain is already the answer: *believed the king lives — heard from a merchant (confidence 0.4, fading) — who heard from a caravan — who left before the death.* This is the `Record → Event` chain extended one hop past the witness, rendered by the same reasons-extractor pattern as `opinionReasons()` / `standingReasons()`. **If a belief's trace cannot be rendered, the spread mechanism is not done.**

## 9. Decisions and remaining forks

Ratified after the Prime Movers capstone (`18`) and a confidence/arbitration review. RESOLVED items are load-bearing. Every fork is now closed: §9.6, the last open one, was settled by Legend Drift (`30` §4.1) — it lived in *propagation*, not the substrate, so it never blocked the `Mark` refactor.

### 9.1 Confidence math — RESOLVED: two-axis, derived, never stored

Reject the single scalar: it conflates *observation* with *trust*. "I watched the king die" and "a drunk merchant told me the king died" can both read 0.9 — but they are not the same knowledge. Each piece of evidence therefore carries **two axes**:

```ts
Evidence extends Mark {          // Mark supplies { kind, sinceTick, expiresTick?, cause }
  kind: 'witness' | 'testimony' | 'document' | 'inference'
  polarity: 1 | -1               // supports (+1) or contradicts (-1) the belief's assertion
  observationConfidence: number  // [0,1] how direct/clear the sensing
  sourceTrust: number            // [0,1] how far the holder trusts the source (culture data)
}

Belief { subject, assertion, evidence: Evidence[], lastUpdated }
//  confidence AND stance (True/False/Unknown) are DERIVED from evidence — never stored
```

The first implementation slice of this design is scoped in §12 below: witness + testimony producers only, everything else deferred as a future producer/consumer of Evidence.

- `observationConfidence` — how direct and clear the sensing was (a personal witnessing ≈ 1.0; a glimpse through fog, far less).
- `sourceTrust` — how far the holder trusts the source. **Source trust is pack/culture data.** This means cultures differ in *epistemology* with no new system: a mystical culture assigns dreams high trust, a rationalist one near zero; a zealot trusts the priest, a cynic the ledger.

| Situation | observationConfidence | sourceTrust |
|---|---:|---:|
| Witnessed personally | 1.0 | — |
| Trusted priest's word | 0.7 | 0.95 |
| A known liar's word | 0.7 | 0.15 |
| Ancient manuscript | 0.6 | 0.8 |
| A dream | 0.2 | *varies by culture* |

**effectiveConfidence = f(evidence stack)** — computed, never a stored number. The Belief stores *why* it is held, exactly as `opinion.ts` stores Thoughts and `reputation.ts` stores marks. The engine stores reasons, not conclusions.

### 9.2 Arbitration — RESOLVED: evidence accumulation, not "a winner"

Reject "highest confidence wins." Minds do not select a winning claim; they **integrate** evidence. Belief accumulates Bayesian-in-spirit — log-odds-style, so it is order-independent and deterministic, recomputed from the evidence stack in `sinceTick` order exactly like `computeOpinion`:

```
witness A → 0.80   ·   witness B agrees → 0.92   ·   trusted priest dissents → 0.67   ·   personal observation → ~1.0
```

Supporting evidence pushes toward the assertion, contradicting evidence away; a strong first-hand observation can dominate. There is never a replacement, only a revision.

> ### Principle: Beliefs are revised, not replaced.
> New evidence never overwrites a belief — it enters the stack and the stance is re-derived. This is why a Belief stores evidence rather than a verdict, and why *how a mind changed its mind* stays fully legible. It is the epistemic sibling of the engine's existing rule that opinions and reputations are never stored numbers but sums of sourced, decaying reasons.

### 9.3 Suspend judgment — RESOLVED (new fork): True / False / Unknown, not merely a probability

A Belief yields a **stance**, derived from effectiveConfidence against two pack thresholds:

```
conf ≥ believe     → holds the assertion TRUE
conf ≤ disbelieve  → holds it FALSE (believes the negation)
otherwise          → UNKNOWN — suspends judgment
```

"I don't know" is first-class, and should be **common**. Its payoff is behavioural: through invariant 10, an entity in UNKNOWN may **refuse to act** for want of evidence — a caravan that waits, a council that stalls, a kingdom that will not march on a rumor. Indecision becomes emergent, not scripted. A world where organizations sometimes genuinely lack sufficient evidence is a richer world than one where everyone always knows enough to act.

### 9.4 Who holds belief — RESOLVED: Actors hold, Organizations derive

Confirmed by Prime Movers §1 (one subjective layer, one per entity). Actors carry evidence stacks; an Organization's stance is a fold of its members' beliefs, mirroring the 2C member-derived worldview. No separate org-belief store.

### 9.5 Belief about beliefs (theory of mind) — RESOLVED: out of scope for v1

Prime Movers' two-layer world (objective vs. a hold on it) makes belief-about-belief a *third* layer. Deferred; revisit only if organizational diplomacy demands it.

### 9.6 Distortion model — RESOLVED: the ASSERTION mutates, past a pack threshold (Legend Drift)

What mutates when a testimony is retold — its confidence, its detail, its subject, its assertion? **Both, in that order.** Ordinary testimony (`tellBelief`) attenuates `sourceTrust`/`observationConfidence` per hop, as §9.6 originally recommended for v1. The higher-drama increment it deferred — assertion-mutation ("the king was *poisoned*") — is now shipped as **Legend Drift** (`30-mythic-layer.md` §4.1, `engine/belief.ts`'s `retell` producer):

- **When.** Only once a story crosses a pack threshold of hops-in-chain (`DRIFT_HOPS`) *or* years-since-the-original-event (`DRIFT_YEARS`); an eligible retelling then distorts with pack-set probability (`DRIFT_CHANCE`). Nothing drifts while an event is still close at hand — drift is a slow curdle, not noise.
- **Into what.** A pack-owned table keyed by the base assertion (`DRIFT_SPECS`: `dead` → {`slain`, `taken-by-the-sea`, `cursed`, …}). The engine knows only "a retelling may distort past a threshold"; a universe of meticulous record-keepers ships no table and never drifts. A drifted assertion is `<base>#<variant>` — its own proposition, on the same evidence stack, so a witness who was there can contradict the legend.
- **How drawn.** A PURE HASH of the retelling chain — `(seed, source event, teller, depth)` — never `world.rng`, never `world.tick` (the discipline of `24-local-maps.md` §8 law 2). A distorted history is exactly as reproducible as a clean one, and a teller tells their version identically to everyone, so a legend spreads coherently instead of dissolving.
- **Legibility (§8).** Evidence carries `hops`, plus `driftedFrom`/`driftedAt` — set where the tale turned and *carried forward by every faithful retelling after it*, so any holder of a legend can name the exact retelling it changed at, not just whoever changed it. Surfaced by `driftReasons` through the shared `Reason`/ReasonsList surface.

Subject-mutation and detail-loss remain unbuilt, and are not blocking: a subject swap ("it was the *prince*, not the king") is the same producer with a different draw target, if a pack ever wants it.

**Consumer.** `chronicle.ts`'s `cultureLegendOf`/`renderLegendFor` render a culture's *currently held* belief about an event rather than the objective Event — derived from its members exactly as `orgBeliefOf` derives an institution's, so subjectivity still exists only where agency exists. Two peoples' oral histories of one death now genuinely diverge.

### 9.7 Assertion kinds: event vs status (monotonic vs competitive) — SHIPPED (1D-minimal)

Beliefs come in two kinds, and conflating them would rot `computeBelief` into special cases. Documenting the distinction now, before the first status assertion is written, is what keeps the reducer clean.

- **Event assertion** — `dead`, `born`, `married`. **Monotonic / append-only.** It happens once and never becomes false. Evidence *accumulates*: corroboration raises confidence; a rare false report pushes back through log-odds, but the truth is stable. This is exactly what `computeBelief` reduces today.
- **Status assertion** — `reigns`, `owns`, `is-at-war`, `occupies-office`. **Competitive / replaceable.** It describes the *current* value of a slot that holds at most one thing, so it must be *revised*. A new claim (a coronation) doesn't merely add evidence — it competes for the slot and can **displace** the incumbent. A status belief is really the question **"who currently fills this slot?"** — a categorical belief over claimants, not a scalar over one proposition:

```
office:king-of-Thuba              office:king-of-Thuba
  Aldric   0.91       ── coronation ──▶   Aldric   0.22
  Beatrice 0.07                            Beatrice 0.95
```

Revising a status is not "adding a belief" — it is **replacing the winner of a category.**

**The decision that keeps the primitive clean:** event and status are **different reducers over the same Evidence substrate**, never a branchy `computeBelief`. `computeBelief` stays the monotonic accumulator; a future `computeStatusBelief` arbitrates a slot's claimants (arg-max with confidence, so a new claim can overtake the incumbent). This is the same **Mark → many reducers** law that already gives `computeOpinion` / `computeStanding` / `computeBelief`: one substrate, one reducer per semantics. **A status belief is a new fold, not a new primitive.**

**Why coronation feels heavier than mourning:** it is the engine's first *status* belief — the first **living** belief, one that can be overturned. It is therefore genuinely 1D, and the reason to enter the political milestone through the primitive rather than the feature.

**`1D-minimal` proves exactly one property** — *a belief can change because later evidence outweighs earlier* — with no kings, organizations, or allegiance in scope:

```
believes: Aldric reigns
  → learns: Beatrice was crowned
  → no longer believes: Aldric reigns
  → now believes:  Beatrice reigns
```

If that passes, revision is proven, and coronation / allegiance / divergent-timelines become consumers of it.

**Shipped** in `statusBelief.ts` (5 tests). Two functions, and neither touches `computeBelief`:

- `computeStatusBelief(holder, slot)` — a **resolver over competing beliefs**, not a new belief. It arg-maxes the per-claimant event beliefs (`reigns:<slot>`) and returns the occupant (or none). The orthogonal question: `computeBelief` answers *"is P believed?"*, `computeStatusBelief` answers *"among claimants for slot S, who wins?"*. `dead` never uses it — it has no slot and no competitors.
- `learnCoronation(holder, newRuler, slot)` — the **producer**, where the "one filler" competition lives: it adds evidence *for* the new ruler and *against* every incumbent claimant (a slot holds one filler, so a successor unseats the predecessor). Revision is then ordinary evidence accumulation resolved by arg-max — which is why Aldric's confidence *drops* rather than merely being outranked.

A status belief is a new **fold + producer** over the unchanged Evidence substrate — not a new primitive. The test suite already shows two holders believing *different* rulers reign in one slot (divergent timelines in miniature), so the political milestone is now purely a consumer of this reducer.

## 10. Consequences

**Unlocks:** delayed and distorted news; organizations reasoning from stale/false information and diverging; documents as belief-carriers across generations (objects-as-historical-agents); "believed falsely that…" as a first-class historical annotation; secrets, propaganda, and heresy as emergent rather than scripted.

**Costs:** one substrate refactor (unifying Thought/ReputeMark/Belief), a new per-actor belief store replacing the bare `memory` pointer list, a spread cadence in the tick pipeline, and a belief inspector. A save-version bump (execution-model §Save).

**Risks:** illegibility (mitigated by §8), determinism leaks via distortion (mitigated by §7), and scope creep into theory-of-mind (fenced by §9.4).

## 11. Recommended sequence

1. **This ADR** — ratify §3–§6; settle §9. ← *you are here*
2. **Prime Movers** (1 page) — distil the objective/subjective seam this ADR formalises; mostly a ratification of `11-ontology` + invariant 8.
3. **Substrate refactor** — extract the shared `Mark` module from opinion.ts/reputation.ts (behaviour-preserving, under existing determinism tests).
4. **Belief primitive** — `Belief` as a third Mark consumer; witness→belief write; inspector; correspondence-on-demand for the historian only.
5. **Propagation** — Testimony atom; telling (causative), documents (testimony-at-rest), seeded distortion; belief-driven org reasoning.

---

## 12. Implementation slice — Belief v1 (folded from `19-subjectivity-1a-belief-v1.md`)

**The single question:** What is the smallest Belief system that proves the Subjectivity layer? Answer: actors holding **different beliefs about the same objective event**, derived from **different evidence**. If two actors diverge on one death, Subjectivity exists. Everything else is a later producer or consumer of Evidence — not a new subsystem.

**Scope fence — in v1:** an actor can **witness** an event → gains supporting Evidence (inert, no emit); an actor can **receive testimony** → gains Evidence weighted by trust in the source; an actor holds **multiple pieces of Evidence** for a proposition; `computeBelief` derives a **stance** (True/False/Unknown) and a **confidence**; beliefs are **revised** as new Evidence arrives (never replaced).

**Explicitly NOT in v1** — each a future *producer* or *consumer* of Evidence, never a new subsystem: rumor distortion · lying-as-a-mechanic · documents · books · maps · propaganda · forgetting (beyond mark expiry) · organizations holding beliefs · player fog-of-war · conversation/dialogue · multi-value propositions (v1 is binary).

> The fraudster in the success test is **not** a lying subsystem. It is ordinary testimony whose assertion (`the king lives`) happens to contradict the truth. A false belief is what a trusted source's contrary testimony *produces*.

**The reducer** (`belief.ts`, third reducer alongside `computeOpinion`/`computeStanding`):

```ts
function computeBelief(belief: Belief, tick: number): BeliefState {
  let logOdds = 0;
  for (const e of activeMarks(belief.evidence, tick)) {
    const weight = e.observationConfidence * e.sourceTrust;
    logOdds += e.polarity * STRENGTH * weight;              // STRENGTH: pack constant (~3)
  }
  const confidence = 1 / (1 + Math.exp(-logOdds));          // logistic → [0,1], 0.5 = no net evidence
  const stance = confidence >= BELIEVE ? 'true' : confidence <= 1 - BELIEVE ? 'false' : 'unknown';
  return { stance, confidence };
}
```

Derived never stored, order-independent and deterministic (no RNG), accumulation not a winner, and **Unknown is the baseline** (no evidence ⇒ confidence 0.5 ⇒ Unknown — ignorance is the default).

**One funnel, many producers.** Producers never write the belief store directly; they build an `Evidence` and call `acquireEvidence(world, holder, subject, assertion, evidence)` — the ONE way evidence enters a belief. Witness and Testimony are v1's two producers (built one-at-a-time, each with its own test); Document/Inference are later producers of the same funnel.

**Witnessing is an inert read** (writes `world.beliefs`, does not `emit()` — exactly like `remember()`). **Testimony's `sourceTrust` is derived from the hearer's opinion of the teller** — reusing the emergent social graph instead of inventing a trust mechanic (no relationship → neutral 0.5). v1 testimony is itself inert; telling becomes a first-class causative Action only in a later increment.

**Shipped progression since v1** (each stage adds one producer or consumer; Belief itself never changes — see the "belief primitive is fixed, its use grows outward" principle, echoed from Prime Movers `18`):

- **1A — Belief exists** (producers: witness, testimony) ✓
- **1B — Belief changes behavior** (consumer: mourning, via `reactToBeliefs`) ✓ — reactions ask `computeBelief`, never inspect `Evidence`; reaction state lives in `world.reactions`, never on the `Belief` (Belief ≠ Reaction, as Intent ≠ Action)
- **1C-local — Belief spreads locally** (producer: conversation, `shareBelief`) ✓
- **1D — Belief revises** (reducer + producer: `computeStatusBelief` / `learnCoronation` — event assertions are monotonic/append-only, status assertions are competitive/replaceable; a slot with one filler, revised by displacement, never a branchy `computeBelief`) ✓
- **Organizations derive belief** (`orgBeliefOf`, `orgStatusBeliefOf` — members' beliefs reduced to an institutional stance, never stored; the epistemic twin of `worldviewOf`) ✓
- **Politics consumes belief** (coronation → allegiance; a `succession_settled` perception fact penalises outward intents only under contestation — ignorance never makes a polity cautious, only instability does) ✓
- **1C-distal — Belief spreads geographically** ✓ — see §13.

**Known asymmetry (documented, not desired):** emotional reactions (mourning) are subjective — you mourn when you *learn* — while social/legal state (widowhood, inheritance, membership) still updates objectively at the instant of death. A future Epistemic Relationships phase may migrate these behind belief, one at a time.

**The LOD law this establishes:** *subjectivity exists only where agency exists* (now in `11 §Mark`). An Actor holds beliefs; an Organization *derives* them from its members; an aggregate settlement holds none. Evidence has **carriers** (witness, messenger, letter, caravan, priest, sensor, vision, …) — a Universe Pack seam — and `acquireEvidence` fires at the carrier's arrival tick, giving time-delayed causality for free.

## 13. Distal propagation — the News Frontier (folded from `20-distal-news-frontier.md`)

**The collision this resolves:** every epistemic milestone above lives inside the focused settlement, where actors exist to hold beliefs. An aggregate province has no residents, so by the LOD law it can hold no belief — yet the promise of Subjectivity is a world that desynchronizes across the whole map (the capital crowns Beatrice; a frontier province still serves Aldric). The question is not "how does news travel?" but:

> **What exists objectively, before a mind exists to believe it?**

**The boundary this adds:**

> ## News is objective. Belief is subjective. Transport moves news; minds convert news into evidence.

News — an event happening, and word of it *physically arriving* somewhere — is an objective fact, true whether or not anyone there is currently simulated. What a mind makes of that news is subjective, and exists only where minds do. The pipeline grows one tier:

```
Reality  →  News  →  Evidence  →  Belief
          (logistics)  (a mind reads it)
```

News is closer to weather or trade than to opinion — it is not a `Mark`, not history, not subject to epistemic laws. **Epistemics begins only at Evidence.**

**The News Frontier** — not a record, but a *frontier* in the graph-theory sense: a wave of word expanding outward from an event, across the geography/travel graph, at travel speed. A settlement's stored arrival tick is a cache of where the wave has reached, nothing more — which is why intercepted messengers, telegraphs, or magical sending are just swappable propagation mechanics over the same abstraction. **Only transport advances the frontier** — one writer, the same discipline as "only witnesses create Evidence; only producers call `acquireEvidence`."

**Coarse recognition at a distance** is LOD, not a second truth: a non-focused province's org reads recognition straight off the news frontier (whoever's coronation-news last arrived), lossy and objective — the same input the fine, member-derived recognition would produce on focus, just read coarser.

**Reconcile-on-focus:** when a settlement is focused and its residents instantiate, their beliefs are seeded from the settlement's news frontier — they know exactly what had arrived, no more. **The camera never creates information** — focusing reveals no new facts, it materializes minds into an informational environment that already existed.

**Acceptance criterion (the engine's first observer-independence test):** delete the camera, run the world 500 years at aggregate LOD focusing nothing, then focus any settlement — its residents must instantiate believing *exactly* the news that objectively reached that place. Too much = the camera leaked omniscience. Too little = reconcile-on-focus is broken.

**v1 scope:** coronations first (feeds coronation→allegiance across the map), then deaths of notables. Propagation is a computed frontier (arrival tick = event tick + graph-distance × speed along existing routes); no in-transit distortion (clean arrival, latency only — rumor mutation is a later producer refinement). A latency inspector ships alongside ("why hasn't the duke reacted? — the news reaches him in nine days" is a pure read).

**Future generalization (a note, not a change):** News may be the first payload of a more general Propagation substrate — the engine already has physical transport (`travel.ts`), informational transport (News), and biological transport (lifecycle/migration) as instances of *objective fields propagate independently of observation*. Not built; recorded as a seam.

## Revision History

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-03 | Initial ADR. Pressure-tests the "belief = Thought" unification and rejects it in favour of a shared `Mark` substrate with per-domain folds (§3). Decides belief referent (§4), truth-as-independent-claim with correspondence-never-stored-and-invisible-to-believer (§5), and Testimony-as-propagation-atom with documents as testimony-at-rest (§6). Fixes seeded distortion (§7) and a mandatory legibility budget (§8). Collects 5 open forks for ratification (§9). |
| 0.2 | 2026-07-03 | Ratification review. **`Mark` promoted to a first-class ontology Construct** (`11` §Constructs), no longer ADR-local (§3). Belief field **`claim` renamed to `assertion`** to match the philosophy — an actor asserts; the historian judges correspondence (§2, §4, §5). Added the **belief-never-writes-reality guarantee as execution-model invariant 10** and cross-referenced it (§5): the causal chain is Reality → Belief → Reasoning → Intent → Action → Outcome → Reality, never Belief → Reality. |
| 0.4 | 2026-07-03 | Documented **assertion kinds** (§9.7) ahead of implementation: **event** assertions are monotonic/append-only (`computeBelief` accumulates); **status** assertions are competitive/replaceable — a slot with at most one filler, revised by displacement, reduced by a future `computeStatusBelief` (arg-max over claimants). Different reducers over one Evidence substrate, never a branchy `computeBelief` (the Mark→many-reducers law). Coronation is the first status/"living" belief; `1D-minimal` proves belief revision alone (Aldric reigns → Beatrice crowned → Beatrice reigns) before any political consumer. |
| 0.3 | 2026-07-03 | Resolved the confidence/arbitration forks (§9 rewritten from open forks to decisions). **Confidence math**: two-axis evidence (`observationConfidence` + culture-defined `sourceTrust`), confidence **derived, never stored** (§5, §9.1). **Arbitration**: evidence *accumulation* (Bayesian-in-spirit, order-independent), not "highest confidence wins" — principle **"Beliefs are revised, not replaced"** (§9.2). New resolved fork: **suspend judgment** — stance is True/False/**Unknown**, and UNKNOWN entities may refuse to act via invariant 10 (§9.3). Belief struct updated to an evidence stack (§2). Only the distortion model (§9.6) remains open, and it belongs to propagation. |
