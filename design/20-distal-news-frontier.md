# Subjectivity 1C-distal — the News Frontier

**Document type:** Design note — how belief travels across space without violating the LOD law.
**Companion documents:** `11-simulation-ontology.md` (§Mark laws), `17-epistemics-adr.md`, `19-subjectivity-1a-belief-v1.md`, `15-execution-model.md`. Transport: `travel.ts`.
**Status:** Proposed. Design frozen before code, because this is the first place epistemics meets LOD.

---

## The collision

Every epistemic milestone so far lived entirely inside the focused settlement, where actors are simulated and can hold beliefs. 1C-distal must cross that boundary — news of a coronation in the capital should reach a frontier province weeks later — and there it hits a wall we built on purpose:

> **Subjectivity exists only where agency exists** (`11 §Mark`). An aggregate settlement has no simulated residents, so it holds *no belief*. `orgStatusBeliefOf` of a memberless org returns *unknown*.

So an aggregate province cannot "recognize Aldric" — it has no minds. Yet the promise of the whole layer is a world that desynchronizes: the capital crowns Beatrice; one province marches under her banner; another still serves Aldric; a third has heard nothing. If belief could only exist under the camera, everything beyond it would be epistemically frozen, and that desync would be fake.

The question this note freezes is therefore not "how does news travel?" but:

> **What exists objectively, before a mind exists to believe it?**

## The boundary (the law this milestone adds)

> ## News is objective. Belief is subjective. Transport moves news; minds convert news into evidence.

An event happening, and word of it *physically arriving* at a place, are both **objective** facts about the world — a courier reached the town, whether or not anyone there is currently simulated to form an opinion. What each mind makes of that news — whether it believes, doubts, trusts the messenger — is **subjective**, and exists only where minds do. Distal propagation moves the objective thing (news); the already-frozen epistemic pipeline converts it into the subjective thing (belief) wherever subjects exist.

This preserves the agency law exactly. Aggregates never gain beliefs. They gain **infrastructure**.

## The two layers

**Objective — the News Frontier.** A per-settlement record of *which news has physically arrived, and when*. It exists at every settlement, focused or not, because it is transport state, not belief:

```
Settlement (aggregate or focused)
──────────────────────────────
news frontier
  · coronation of Beatrice — arrived tick 41 200
  · peace with Souvou      — arrived tick 40 010
  · (not yet: plague report)
```

News enters the frontier of the settlement where the event occurs, then propagates outward along the **geography/travel graph** at travel speed (`travel.ts` already models transit with duration). A settlement's arrival tick for a given piece of news = event tick + cumulative travel time along the route. That difference *is* information latency — no special logic, a consequence of transport.

**Subjective — Belief.** Unchanged. Where subjects exist (the focused settlement's residents), arrived news is converted into `Evidence` through the existing funnel:

```
news frontier ──▶ acquireEvidence ──▶ computeBelief / computeStatusBelief
                                    ──▶ orgBeliefOf / orgStatusBeliefOf ──▶ intent ──▶ action
```

Every reducer and consumer already built is untouched. Distal is a **producer** feeding evidence from a new objective source — nothing more.

## Coarse recognition at a distance (LOD, not a second truth)

For a non-focused province's org, recognition is read **coarsely off the news frontier**, never from (nonexistent) member belief: *the province recognizes whoever's coronation-news last arrived here.* This is objective (based on arrival), lossy (no trust, no partial spread, no contest) — the LOD **approximation** of the fine, member-derived recognition that materializes on focus. Coarse at distance, exact up close, and the two agree to first order because both reflect what news arrived. It is a *coarser reading of the same objective input*, not a competing source of subjective truth.

This is what lets provinces make *different decisions from different news* while the camera is elsewhere: an aggregate org's allegiance (rung 3's consumer) reads its coarse recognition, so the province that only knows of Aldric marches for Aldric.

## Reconcile-on-focus

When a settlement is focused and its residents instantiate, their beliefs are **seeded from the settlement's news frontier** — they already know exactly what had arrived (and no more). This is the "subjectivity reappears on focus" principle from `11 §Mark`, now sourced from the objective frontier. The coarse aggregate recognition sharpens into real, potentially-divergent member beliefs — with no discontinuity, because both derive from the same arrived news.

## What is frozen (everything downstream)

```
travel system  (existing)
      │
      ▼
news frontier   ← the ONE new objective thing
      │
      ▼   (focused: materialize; aggregate: coarse read)
Evidence · Belief · StatusBelief · orgBeliefOf · orgStatusBeliefOf   ← unchanged
      │
      ▼
Intent · Action · Reality   ← unchanged
```

The epistemic core does not move. Distal adds an objective transport layer *beneath* Evidence and one new arrow *into* `acquireEvidence`. If, on implementation, a single reducer or consumer needs to change, the design is wrong.

## v1 scope

- **News types:** coronations first (feeds coronation→allegiance across the map). Deaths of notables next.
- **Propagation:** a computed frontier — arrival tick per settlement = event tick + graph-distance × speed along existing routes. Physical carrier *entities* (that can be intercepted, delayed, or lost) are a later refinement; v1 needs only latency.
- **In-transit distortion:** none in v1 (clean arrival, latency only). Rumor mutation is a later producer refinement (ADR §9.6), and — per the boundary law — it too is an objective transport property until a mind reads it.
- **The latency inspector** (design/19) ships alongside: with per-settlement arrival ticks now stored, "why hasn't the duke reacted? — the news reaches him in nine days" is a pure read.

## Open questions to settle in implementation

1. **Frontier storage:** per-settlement `Map<newsKey, arrivalTick>`, bounded/compacted like events. Serialized (objective world state).
2. **Coarse recognition read:** an aggregate org recognizes the ruler of the latest-arrived coronation for its office — define the exact tie-break (most-recent arrival wins).
3. **Where the propagation pass runs:** a new aggregate-layer pass (geography cadence), symmetric with how trade/migration already flow along the graph.
4. **Promotion of the boundary law** to `11 §Mark` (or `15`) once News exists as an engine concept — it is a prohibition (aggregates never hold belief; only news) worth stating beside the others.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-03 | Initial design note. Defines the **News Frontier** (objective per-settlement arrival state) as the answer to "what exists before a mind believes it", freezing the boundary *news is objective, belief is subjective; transport moves news, minds convert it to evidence.* Aggregates gain infrastructure, never belief; coarse recognition is a lossy LOD reading of the same objective input; belief materializes from the frontier on focus. The entire epistemic core stays frozen — distal is a producer feeding `acquireEvidence` from a new objective transport layer. v1 = computed-latency frontier for coronations, no in-transit distortion, latency inspector alongside. |
