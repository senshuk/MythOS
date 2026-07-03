# ADR — Epistemics (the Belief Layer)

**Document type:** Architecture Decision Record — the design of subjective knowledge.
**Companion documents:** `11-simulation-ontology.md`, `15-execution-model.md` (invariants 8 & 9), `14-component-model.md`.
**Status:** Proposed. Decisions below are recommendations for ratification; genuinely open forks are collected in §9.
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

Ratified after the Prime Movers capstone (`18`) and a confidence/arbitration review. RESOLVED items are load-bearing. Only §9.6 stays open — and it lives in *propagation*, not the substrate, so it does not block the `Mark` refactor.

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

The first implementation slice of this design is scoped in `19-subjectivity-1a-belief-v1.md`: witness + testimony producers only, everything else deferred as a future producer/consumer of Evidence.

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

### 9.6 Distortion model — OPEN (belongs to propagation, not the substrate)

What mutates when a testimony is retold — its confidence, its detail, its subject, its assertion? Recommendation: v1 lowers `sourceTrust`/`observationConfidence` along the chain and drops detail; assertion-mutation ("the king was *poisoned*") is a later, higher-drama increment. This decision is needed before propagation is coded, not before the `Mark` refactor.

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

## Revision History

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-03 | Initial ADR. Pressure-tests the "belief = Thought" unification and rejects it in favour of a shared `Mark` substrate with per-domain folds (§3). Decides belief referent (§4), truth-as-independent-claim with correspondence-never-stored-and-invisible-to-believer (§5), and Testimony-as-propagation-atom with documents as testimony-at-rest (§6). Fixes seeded distortion (§7) and a mandatory legibility budget (§8). Collects 5 open forks for ratification (§9). |
| 0.2 | 2026-07-03 | Ratification review. **`Mark` promoted to a first-class ontology Construct** (`11` §Constructs), no longer ADR-local (§3). Belief field **`claim` renamed to `assertion`** to match the philosophy — an actor asserts; the historian judges correspondence (§2, §4, §5). Added the **belief-never-writes-reality guarantee as execution-model invariant 10** and cross-referenced it (§5): the causal chain is Reality → Belief → Reasoning → Intent → Action → Outcome → Reality, never Belief → Reality. |
| 0.3 | 2026-07-03 | Resolved the confidence/arbitration forks (§9 rewritten from open forks to decisions). **Confidence math**: two-axis evidence (`observationConfidence` + culture-defined `sourceTrust`), confidence **derived, never stored** (§5, §9.1). **Arbitration**: evidence *accumulation* (Bayesian-in-spirit, order-independent), not "highest confidence wins" — principle **"Beliefs are revised, not replaced"** (§9.2). New resolved fork: **suspend judgment** — stance is True/False/**Unknown**, and UNKNOWN entities may refuse to act via invariant 10 (§9.3). Belief struct updated to an evidence stack (§2). Only the distortion model (§9.6) remains open, and it belongs to propagation. |
