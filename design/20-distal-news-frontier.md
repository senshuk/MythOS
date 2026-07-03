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

### News is not part of Epistemics — it is logistics

The layer this milestone inserts belongs to *neither* Reality nor Belief. The mental model was `Reality → Belief`; it is now:

```
Reality  →  News  →  Evidence  →  Belief
          (logistics)  (a mind reads it)
```

News is closer to **weather or trade than to opinion**. It is not a mental state, not history, not a `Mark`, not a subject of the epistemic laws. It is the objective *movement of word* across the map — pure logistics. **Epistemics begins only at Evidence**, the moment a mind reads the news. This is precisely why nothing in the frozen epistemic core changes: News sits *beneath* it, in the same tier as travel and geography, not inside it.

## The two layers

**Objective — the News Frontier.** Do not think of this as a *record* (that sounds archival). Think of it as a **frontier in the graph-theory sense**: a wave of word expanding outward from where an event occurred, across the geography/travel graph, reaching each settlement at travel speed.

```
Death at the Capital
      │   the frontier expands along the roads
      ├── Village A   (day 3)
      ├── Fort B      (day 8)
      └── Harbor C    (day 12)
```

A settlement's stored arrival tick is merely a **cache of where the wave has already reached** — not an archive of facts, just the wavefront's position. The framing is deliberate: it scales *without change* to intercepted messengers, delayed caravans, telegraphs, newspapers, magical sending — all of which are just different **propagation mechanics** advancing the same frontier. The frontier is the abstraction; the mechanics are swappable.

News enters the frontier at the settlement where the event occurs, then propagates outward at travel speed (`travel.ts` already models transit with duration). A settlement's arrival tick = event tick + cumulative travel time along the route. That difference *is* information latency — no special logic, a consequence of transport.

**Subjective — Belief.** Unchanged. Where subjects exist (the focused settlement's residents), arrived news is converted into `Evidence` through the existing funnel:

```
news frontier ──▶ acquireEvidence ──▶ computeBelief / computeStatusBelief
                                    ──▶ orgBeliefOf / orgStatusBeliefOf ──▶ intent ──▶ action
```

Every reducer and consumer already built is untouched. Distal is a **producer** feeding evidence from a new objective source — nothing more.

**Only transport advances the frontier.** This is the new prohibition, and it sits beside the ones already protecting the layer — *only witnesses create Evidence; only producers call `acquireEvidence`; only reducers read Evidence*. The news frontier has exactly **one writer: the propagation system.** Nothing else — not a reaction, not a reducer, not the UI, not a focus change — ever advances a settlement's frontier. A stray `settlement.newsFrontier.set(...)` outside propagation is a violation, the same class of bug as a reducer that mutates. One writer keeps "what has arrived where" a single, traceable truth — the kind of law that saves an architecture years later.

## Coarse recognition at a distance (LOD, not a second truth)

For a non-focused province's org, recognition is read **coarsely off the news frontier**, never from (nonexistent) member belief: *the province recognizes whoever's coronation-news last arrived here.* This is objective (based on arrival), lossy (no trust, no partial spread, no contest) — the LOD **approximation** of the fine, member-derived recognition that materializes on focus. Coarse at distance, exact up close, and the two agree to first order because both reflect what news arrived. It is a *coarser reading of the same objective input*, not a competing source of subjective truth.

This is what lets provinces make *different decisions from different news* while the camera is elsewhere: an aggregate org's allegiance (rung 3's consumer) reads its coarse recognition, so the province that only knows of Aldric marches for Aldric.

## Reconcile-on-focus

When a settlement is focused and its residents instantiate, their beliefs are **seeded from the settlement's news frontier** — they already know exactly what had arrived (and no more). This is the "subjectivity reappears on focus" principle from `11 §Mark`, now sourced from the objective frontier. The coarse aggregate recognition sharpens into real, potentially-divergent member beliefs — with no discontinuity, because both derive from the same arrived news.

This preserves a further law: **the camera never creates information.** Focusing a settlement reveals no new facts — it materializes minds *into* an objective informational environment that already existed, unwatched. Residents come to exist already knowing precisely what had reached that place, and nothing more. LOD changes the *resolution* at which the world is simulated, never the *truth* of what is known where.

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

## Acceptance criterion

The whole design reduces to one testable sentence:

> **Delete the camera.** Run the world entirely at aggregate LOD for 500 years, focusing nothing. Then focus any settlement. Its residents must instantiate believing **exactly** the news that objectively reached that place — and nothing else.

If that holds, the frontier is doing precisely what this note promises: information exists and moves objectively whether or not anyone is watching, and minds are materialized *into* it — never the reverse. If a focused settlement's residents know **more** than the frontier delivered, the camera leaked omniscience (the "camera never creates information" law is broken). If they know **less**, belief wasn't seeded from the frontier (reconcile-on-focus is broken). The single sentence tests the entire model.

This acceptance criterion is really the engine's first **observer-independence** test — *changing what is simulated must never change what is true* (`18` §Observer independence). News is where that property is first made concrete; it is a north star for the whole engine, not just this layer.

## Future generalization — a note, not a change

News is not the only thing that moves objectively beneath agency. The engine already has **three** such layers:

```
Reality
  ├── Physical transport      — people, goods, armies       (travel.ts)
  ├── Informational transport — news                         (this note)
  └── Biological transport    — births, deaths, migration    (lifecycle, lod)
        ↓
   subjective simulation
```

Travel is no longer special; it is one instance of a general idea — **objective fields propagate independently of observation.** The News Frontier may therefore be the first *payload* of a more general **Propagation** substrate that could later also carry plague, magical corruption, rumor, fashion, innovation, or a pack's own field. *Propagation* is the system; *News* is only the first payload.

**This is a mental note, not a change.** Nothing here renames the frontier or alters v1 — build News concretely. But if the pattern recurs (and the list above suggests it will), "News Frontier" may naturally become one specialization of a propagation substrate, and this note marks the seam where that generalization would attach. If it never recurs, nothing is lost — which is exactly when to defer an abstraction rather than invent it.

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
| 1.2 | 2026-07-03 | Tied the acceptance criterion to the engine-wide **observer-independence** north star (`18`). Added a **future-generalization note** (not a change): the engine already has three objective transport layers (physical/informational/biological), all instances of *objective fields propagate independently of observation*; News may be the first payload of a general **Propagation** substrate — recorded as a seam, deliberately not built. |
| 1.1 | 2026-07-03 | Sharpened four framings from review: **News is not Epistemics — it is logistics** (a distinct tier `Reality → News → Evidence → Belief`, closer to weather/trade than opinion; epistemics begins at Evidence). Reframed the frontier from a *record* to a **graph-theory frontier** — a wave whose arrival ticks are a cache of where it reached, so intercepted messengers / telegraphs / magical sending are just swappable propagation mechanics. Added the prohibition **only transport advances the frontier** (one writer, beside the Evidence laws). Made explicit that **the camera never creates information** (focus materializes minds into an environment that already existed). Added the acceptance criterion: **delete the camera** — run 500 years at aggregate LOD, focus anywhere, and residents must instantiate believing exactly the news that reached that place, no more, no less. |
