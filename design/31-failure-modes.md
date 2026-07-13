# 31 — Failure Modes

**Document type:** Standing engineering checklist — not a feature proposal, not a
constitution. This document does not describe how the engine works; it catalogs ways the
architecture could degrade as it grows, so degradation is caught by a known checklist
instead of rediscovered from scratch each time.
**Companion documents:** `18-prime-movers.md` (the laws this checklist watches for
violations of), `11`–`15` (the constitution), `16-interaction-principles.md` (the one
primitive that already self-flagged its own stretch risk), `29-subsystem-appendix.md`
(ground truth for what's shipped), `30-mythic-layer.md` (the proposal whose new mechanisms
this review checked for landing spots).
**Status:** Living document. Findings below are dated and cited to exact file:line;
re-verify before trusting a claim, per the standing memory discipline. **No new primitives
are proposed anywhere in this document** — every finding below was checked against
whether existing abstractions are genuinely stretched before reaching for a new Construct,
and in every case a refactor, a test, or a documentation fix was sufficient.

---

## How to read this

Each numbered section below answers one question first: *does the current architecture
already address this?* Where the answer is yes, the citation is the evidence. Where the
answer is no, the finding is classified as one of three things — an implementation
concern (fix it when convenient), a candidate for its own ADR (needs design work before
code), or a missing engine-wide invariant (promote to `18`). §9 collects every open
finding into the standing checklist table the title promises.

---

## 1. Primitive Stretch Audit

| Primitive | Current shape | Verdict |
|---|---|---|
| **Mark** | `mark.ts` (52 lines): 4 fields, 4 shared functions (`isActive`, `activeMarks`, `dropExpired`, `indexByKind`), consumed identically by `opinion.ts`, `mood.ts`, `reputation.ts`, `belief.ts`, and reused by `organization.ts` for org↔org relations. | **Not stretched.** The module's own docstring states what it must never do, and every consumer imports the same four functions rather than reimplementing expiry. This is the primitive to point to when asking "what does 'coherent' look like." |
| **Event** | `WorldEvent` (model.ts:551-559): 7 fields, deliberately open `type: string`. ~47 distinct type strings emitted across the engine (the in-code comment inventories ~35 — stale, but harmlessly so). | **Not stretched** — the open `type`/`data` payload is the *intended* extension point (every new event kind is content, not a schema change), not sprawl. Action item: refresh the stale comment; not an architecture concern. |
| **Organization** | 1,018 lines across 4 dedicated engine modules (`organization.ts`, `orgAction.ts`, `orgReason.ts`, `orgInteraction.ts`), referenced in 24 files project-wide. | **Confirmed stretch — already self-diagnosed.** `design/16-interaction-principles.md:7-9` states, dated to Phase 2E: *"Organizations v1 [is] feature-complete… otherwise Organizations risk becoming a 'god subsystem.'"* This is not a new finding; it is a documented risk with a documented mitigation (freeze; no new features without roadmap justification) already in force. Carried into §9 as a **watch item**, not a new action. |
| **Actor** | ECS-style — no single type; 13 components per `design/14-component-model.md`. `Aspiration` alone reads 9 of them. | **Coupling risk, not stretch.** No single file is bloated, but high fan-in (one system reading 9 components) means a schema change to any touched component risks a silent break elsewhere. `14-component-model.md` already maintains a system-dependency table — the mitigation is *keeping that table current*, not a new mechanism. |
| **Location** | `location.ts` (262 lines, core type) vs. `content/localmap.ts` (1,279 lines, worldgen/rendering). | **Not stretched** — the size gap is a different *concern* (procedural map generation, a content/presentation problem) living in a different layer, not the same primitive splitting into duct-taped responsibilities. |

**No primitive audited shows evidence of needing to split.** Organization is the one
confirmed pressure point, and it already has a stated, working mitigation.

## 2. Hidden Primitive Audit

**Decay is unified only where the value is Mark-shaped.** Every Thought/ReputeMark/Evidence
consumer shares `mark.ts`'s expiry functions — confirmed, no exceptions found.

**Decay is duplicated everywhere else.** `engine/lod.ts` alone hand-rolls at least five
distinct decay/mean-reversion constants with no shared helper: settlement wealth
(`wealth * 0.96 + …`, lod.ts:1047), stability mean-reversion (`stability * 0.9 + …`,
lod.ts:697), inter-settlement relation (`relation * 0.92 + …`, lod.ts:783), post-war
population loss (`pop *= 0.85/0.95`, lod.ts:358-359), and trade volume under hostility
(`*= 0.6/0.7`, lod.ts:1057,1063) — plus `chronicle.ts`'s independent `FADE_PER_YEAR = 0.6`
linear decay. Each is a hand-picked literal at its call site.

**Verdict: a real, unnamed pattern ("a decaying scalar with a rate"), but not a missing
primitive.** Per the test in §2 of this document's own instructions — is this an
implementation concern, an ADR, or an invariant? All the affected values live in one file
(`lod.ts`) and one adjacent one (`chronicle.ts`); the duplication is local and mechanical,
not independently reinvented across unrelated subsystems in a way that would justify a
formal Construct alongside Mark. **Classified as an implementation concern**: extract a
shared `decay(value, ratePerTick)` utility next time `lod.ts`'s economy code is touched.
Zero semantic change, zero determinism risk (identical math, just de-duplicated) — a
cleanup, not an architecture fix. Tracked in §9.

**Historical continuity / epochs**: not yet implemented (the Age/epoch-transition
mechanism is `30-mythic-layer.md` §4.6, proposed, not shipped) — nothing to audit in code.
Not a new finding.

## 3. Graph Explosion Audit

| Graph | Storage | Cadence | Size at target scale |
|---|---|---|---|
| Actor relationships | `world.rels: Map<EntityId, Map<EntityId, RelEdge>>`, lazy | continuous (daily/weekly) | O(actors²) worst case, sparse; bounded to the one focused settlement (~50-200 actors, `06-tech-roadmap-mvp-risks.md:119`) |
| Organization membership | **not stored** — `membersOf` (organization.ts:139-145) derives it by scanning `homeSettlement` | on demand | O(settlement population) per call |
| Ownership (Object) | does not exist in the engine yet | — | — |
| Kinship | flat `spouses`/`children` arrays on the Actor record, not a graph; `HouseholdView` is an explicit derived reading | on demand | trivial |
| Belief/evidence | `world.beliefs: Map<EntityId, Belief[]>`, per-holder lists, not actor-to-actor | continuous | bounded by evidence accumulation, uncapped today (see §4) |
| Settlement/region graph **and** trade routes | **the same structure** — `world.edges: RegionEdge[]`, K=3-nearest + union-find bridging, `relation` and `tradeVolume` on one edge | yearly (`geographyYearly`, `economyYearly`) | ~3×55 + bridges ≈ 150-200 edges (`24-local-maps.md:238`'s stated 55-settlement target) |
| Location containment | tree, `parentId` + derived `childrenByParent` reverse index | on demand | trivial, acyclic |
| Org-to-org | reuses the **same** `world.rels` map as actors, plus a flat `world.orgAgreements` list scanned linearly | yearly + on-interaction | dozens of agreements |

**The one confirmed composition risk.** `geographyYearly` (lod.ts:764-863) already
composes three structures in one yearly pass, per region-graph edge: an `orgOpinionOf`
lookup into the org-relationship graph, a **linear scan of `world.orgAgreements`** via
`activeAgreement`, and on a war trigger another linear scan via `alliesOf` plus an
org→seat→settlement lookup. At the stated scale (E≈150-200, agreements≈dozens) this is
cheap — tens of thousands of operations per year, trivial. **The answer to "at what world
size does this become the dominant problem"**: when settlement count and alliance count
both grow past the current target by roughly an order of magnitude, the linear
`orgAgreements` scan (repeated once per edge) becomes the term that grows fastest, since
it's the only O(edges × agreements) shape found in the whole audit. **Classified as an
implementation concern, pre-registered, not urgent**: index `orgAgreements` by sorted
org-id pair when/if settlement count grows materially. No code change recommended today —
the current scale doesn't need it, and building the index now would be exactly the
premature optimization CLAUDE.md warns against.

**The more important finding actually came from the reducer audit (§4), not this one** —
see the cross-reference there for why organization count, not raw graph size, is the real
long-term driver.

## 4. Reducer Cost Audit

`computeOpinion`, `computeStanding`, `computeBelief`, `computeStatusBelief` are all cheap:
each loops over one entity's own bounded Mark stack (per-kind `stackLimit` for
thoughts/reputation; **belief's evidence array has no cap at all** — noted, not yet a
problem at current scale, but the one place accumulation is genuinely unbounded). None are
cached — correct, per Mark's "derived never stored" law — and none need to be: **LOD
structurally bounds their invocation to the one focused settlement's actors plus ≤6 summary
actors per other settlement** (`MAX_SUMMARIES_PER_SETTLEMENT = 6`, lod.ts:102). Reducer cost
does not scale with total world population; it's capped by the same mechanism that already
caps everything else.

**The one real exception, confirmed by two independent audits converging on the same
finding**: `orgBeliefOf`, `orgStatusBeliefOf`, and `worldviewOf` each linear-scan **all of
`world.entities`** to filter by `homeSettlement`, rather than reading from a
per-settlement resident index — O(world.entities) per call, called once per organization
per year (`orgIntentYearly`). Because `world.entities` is itself LOD-bounded, this is not
a raw-population risk — but it means **cost scales with settlement count** (more
settlements → more summary actors → larger `world.entities`, scanned in full by every
organization every year), which is the actual dominant term as the world grows, not the
region-graph edge count from §3.

**Classified as an implementation concern, pre-registered:** index residents by settlement
(a maintained `Map<SettlementId, EntityId[]>`) so these three functions scan their seat's
residents directly instead of the whole world. Not urgent at the ~55-settlement target;
worth doing before that target is raised materially.

**Caching rule, defined now per the instructions, before it's needed:** if any reducer
above ever needs a cache, the cache may be invalidated **only by the exact write-path event
that changed the underlying Mark stack** (a witness/testimony/mark added or expired) —
never time-based, never opportunistic, never "recompute if it looks stale." This is the
one rule that keeps a future cache from becoming the next `House.prestige` — a value that
silently stops reflecting current truth. No cache exists today; this rule exists so the
first one built doesn't get this wrong.

## 5. Inspectability Audit

**Confirmed duplication, not yet a bug.** `opinionReasons`, `standingReasons`, and
`moodReasons` all return the identical shape `{ label: string; value: number }[]`, but
each file re-declares that type inline rather than sharing one — three independent
implementations of the same idea, currently in sync only by convention.

**Confirmed gap against the engine's own stated law.** `17-epistemics-adr.md` §8 states:
*"Ship the inspector WITH the primitive, not after… if a belief's trace cannot be
rendered, the spread mechanism is not done."* **No `beliefReasons()` function exists.**
Belief — the newest and most legibility-sensitive subsystem in the engine — is the one
missing its own reasons function, in direct tension with the law that introduced it.

**Confirmed scope gap.** `ui/Inspector.tsx` fans out into 8 entity-detail branches (actor,
figure, settlement, house, culture, deity, feature, venue); only the **actor** branch has
any reasons-fed explanation UI. Org-, settlement-, and house-level "why" has no rendering
surface at all today, despite those levels already having computed stances
(`orgBeliefOf`, `worldviewOf`, House prestige).

**Why this matters now, not just in the abstract:** `30-mythic-layer.md`'s new
mechanisms (Attractor Strength, the Mythic Feedback Loop, Legend Drift) are all Belief- or
Organization-level phenomena. Every one of them inherits both gaps above — no shared
Reasons type to slot into, and no belief inspector to extend. Shipping any of them without
first closing this gap means each invents its own bespoke explanation UI, which is exactly
how the current three-reasons-functions duplication happened in the first place.

**Classified as an implementation concern (mechanical fix) plus one confirmed law
violation to close before `design/30` ships anything belief-shaped:** extract one shared
`Reasons` type and a generic `<ReasonsList>` component; write the overdue
`beliefReasons()`. Neither requires a new primitive — both are completing primitives
that already exist.

## 6. Historical Bias Audit

**Confirmed: `MODULES` (content/fixture.ts:23-27) only gates `religion`, `factions`, and
`travel`.** Chronicle, Director, `figuresYearly`, and belief-reaction all run
unconditionally whenever a settlement has focus (`sim.ts:213-236`) — no flag disables
them. A pack cannot ship without history/chronicle machinery today.

**Verdict: this is not hidden bias — it is a documented, deliberate scope boundary, and
the code matches the design docs exactly.** `design/archive/05-modules-and-universe-packs.md:55-57`
already lists events/history as **core, always-on**, calling it "the opinionated
ontology" — only religion/magic/space-travel-class systems are pack-optional. More
importantly, CLAUDE.md's own Project Vision is explicit: *"History is continuously being
created"* is a top-level pillar, not a genre flavor. **MythOS is a historical simulation
engine that is genre-neutral, not a genre-neutral engine that happens to simulate
history** — a cyberpunk or hard-SF pack is expected to still have a Chronicle and a
Director (with sci-fi-flavored content), the same way it's expected to still have Actors
and Organizations. Genre-neutrality was never meant to extend to "history itself is
optional," and stress-testing against a pure logistics/economics pack with no historical
dimension at all is testing against a use case the engine was never designed to support —
that's a feature of the vision, not a gap in the implementation.

**One small action item, documentation only:** "genre-neutral" language in CLAUDE.md/
`13-simulation-rules.md` could be misread as "structure-neutral" by a future contributor.
Worth a one-line clarification (History/Chronicle/Director are core, not
`MODULES`-gated) the next time either doc is touched — not urgent, not an architecture
fix.

## 7. Prime Movers Audit

Applying the admission-criteria test (`18-prime-movers.md` §"Admission criteria for this
document," added in the prior session) to every section currently in that file:

| Law | Explains multiple systems? | Validated by implementation? | Still constitutional in 5 years? |
|---|---|---|---|
| Reality simulated / minds inferred (epigraph) | Yes — every subjective system | Yes — no "mind" object exists anywhere audited | Yes |
| Objective/subjective ontology (§1) | Yes | Yes — every audit above cleanly separated stored-objective from derived-subjective state | Yes |
| The causal chain (§2-3) | Yes | Yes — every reducer/producer found in every audit above follows Reality→…→History exactly | Yes |
| How the engine grows (freeze primitive, grow producers/consumers) | Yes — validated directly by §1 above (Mark's coherence is this law working) | Yes | Yes |
| Significance is derived, never stored | Yes (4/5 clean in last session's audit) | Yes — one violation found and tracked, not zero | Yes |
| Observer independence | Yes | **Partially** — the doc already says so itself ("a target… older systems only approximate") | Yes, as an honestly-partial law |

**Verdict: Prime Movers has not drifted into an encyclopedia.** Every law present passes
the three-question test; no section is a candidate for demotion to a subsystem ADR. The
admission-criteria section added last session is itself doing its job — recommend
re-running this exact table the next time a new law is proposed for promotion, and as a
periodic sanity check thereafter (e.g., every time roughly five more laws accumulate).

## 8. Explicitly not proposed here

Per this document's own instructions, and consistent with `30-mythic-layer.md`'s
discipline: no new Construct for "decaying scalars" (a shared function suffices, §2), no
new Construct for "graph composition" (an index suffices, §3), no new caching layer (none
is needed yet; a rule is pre-registered for when one is, §4), no new inspector
architecture (a shared type + component completes the existing pattern, §5), and no
change to the MODULES/core boundary (§6 concluded the current boundary is correct, not a
bug). Every finding in this document resolved to a refactor, a test, or a documentation
fix — exactly the outcome the instructions asked to verify before reaching for anything
larger.

## 9. Standing checklist

The permanent, updatable table this document exists to maintain.

**Prioritization (finalized after follow-up review, 2026-07-12).** Of the nine items
below, three are cheap, high-leverage architectural-debt reductions and are scheduled;
the rest are correctly deferred — a documented decision not to act, not an oversight.
Ranked by cost-to-value:

1. **#5 (`beliefReasons()` + shared Reasons/`ReasonProvider` convention)** — tiny cost,
   the highest value in this document: a direct, confirmed violation of `17 §8`'s own
   law, on the primitive every `30-mythic-layer.md` mechanism depends on. Spawned as its
   own task, scope widened to standardize all four reasons functions (opinion/standing/
   mood/belief) behind one shared convention — a coding convention, not a new primitive —
   so `Inspector.tsx` can eventually ask any entity to explain itself generically rather
   than special-casing each subsystem.
2. **#2 (shared `decay()` helper)** — tiny cost, moderate value: pure deduplication, zero
   behavior change, zero determinism risk. Spawned as its own task.
3. **#3 (perf-sanity trip-wire test)** — small cost: the one genuine test-coverage gap
   this review found. Spawned as its own task. Its *mitigations* (indexing
   `orgAgreements`, indexing residents-by-settlement) remain correctly deferred — the
   test's job is only to notice if/when they become necessary, not to build them now.

**Correctly not scheduled**: #1 (Organization) is a watch item with an existing
mitigation already in force, not an open action. #4 (cache invalidation rule) has nothing
to build — the rule exists precisely so no cache gets built prematurely. #8's actual fix
(`House.prestige`) was already spawned in the prior session. #6 and #7 are documentation/
process items with no code to schedule. Deferring the index-based optimizations behind
#3's trip-wire, rather than building them speculatively, is itself the correct
architectural call, not a gap.

| # | Failure signature | Detection method | Mitigation | Test coverage today |
|---|---|---|---|---|
| 1 | Organization accreting a 5th/6th engine module | `design/16`'s own stated policy: no new org features without roadmap justification | Already in force; re-state at each Organization-touching PR | `organization.test.ts`, `orgAction.test.ts`, `orgReason` tests exist; no automated "is Organization doing too much" check (a process discipline, not testable) |
| 2 | A new decaying value added with its own ad hoc multiplier instead of a shared helper | Grep for `\* 0\.\d+` literals outside `mark.ts` | Extract a shared `decay(value, ratePerTick)` util next time `lod.ts`'s economy code is touched | **Scheduled** — spawned as a follow-up task |
| 3 | Yearly-pass wall-clock growing faster than settlement/org count | No automated trip-wire exists today | Index `orgAgreements` by org-pair; index residents-by-settlement for `orgBeliefOf`/`orgStatusBeliefOf`/`worldviewOf` — deferred until settlement count is raised materially past ~55 | **Scheduled** — a perf-sanity test spawned as a follow-up task; the indexing mitigations themselves stay deferred |
| 4 | A reducer gets a cache with time-based or opportunistic invalidation | Code review against the rule in §4 | Cache invalidation must be tied to the exact Mark-write event, never else — stated now, before any cache exists | N/A — preventive rule, nothing to schedule |
| 5 | A new Mark-consuming subsystem ships with no `*Reasons` function or Inspector branch | Manual checklist item on review: "does this belief/mark consumer have a reasons function and an inspector panel?" | Extract a shared `Reasons` type/`ReasonProvider` convention + `<ReasonsList>` component; write the overdue `beliefReasons()` before `design/30`'s Belief-consuming mechanisms ship | **Scheduled** — spawned as a follow-up task, highest priority of the three |
| 6 | A contributor assumes History/Chronicle/Director can be disabled via `MODULES` | Confusion/support question | One-line clarification in CLAUDE.md/`13` that history is core, not pack-optional | N/A |
| 7 | A law proposed for `18-prime-movers.md` that only explains one subsystem | The three-question admission test (`18` §"Admission criteria") | Already in place | N/A, process discipline |
| 8 | A monotonically-increasing stored "significance" number with no decay (the `House.prestige` class of bug) | Grep for `+=` on any renown/fame/importance-shaped field with no corresponding decay path | `House.prestige` fix already spawned as its own task (prior session) | `sim.determinism.dynasties.test.ts` checks ordering only — would not catch a *re-introduced* violation; recommend a dedicated regression test once the prestige fix lands |

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-12 | Initial failure-modes audit, commissioned as a stress test of architectural deformation rather than a search for missing mechanics. Investigated via four parallel codebase audits (primitive stretch, graph structures, reducer cost, inspectability + historical bias) plus a direct re-review of `18-prime-movers.md` against its own admission criteria. Findings: Organization is a confirmed, self-diagnosed stretch case with an existing mitigation; decay/accumulation outside the Mark substrate is duplicated ~7 times in `lod.ts` with no shared helper (classified as a refactor, not a new primitive); `orgBeliefOf`/`orgStatusBeliefOf`/`worldviewOf` full-scan `world.entities` rather than an indexed resident list, the single most concrete "cost grows with settlement count" finding; `beliefReasons()` is missing entirely, a confirmed violation of `17 §8`'s own stated law, with real consequences for `30-mythic-layer.md`'s pending Belief-consuming mechanisms; the History/Chronicle/Director-is-core boundary is confirmed intentional (matches CLAUDE.md's own vision), not hidden bias; Prime Movers passes its own admission test on every current law, no dilution found. Introduced no new primitives — every finding resolved to a refactor, a test, or a documentation fix. |
| 1.1 | 2026-07-12 | Follow-up review prioritized §9's checklist rather than adding new findings: confirmed items #5 (beliefReasons + Reasons unification), #2 (shared decay helper), and #3 (perf-sanity trip-wire test) as the cheap, high-leverage set worth scheduling now, and confirmed everything else (Organization watch, cache-invalidation rule, the two indexing optimizations, House.prestige's already-spawned fix) is correctly deferred rather than overlooked. Widened #5's scope on review: unify all four reasons functions (opinion/standing/mood/belief) behind one shared convention (a `ReasonProvider`/`Explainable`-style interface) rather than just a shared return type, so `Inspector.tsx` can eventually ask any entity to explain itself without knowing every subsystem — explicitly a coding convention, not a new primitive. All three scheduled items spawned as follow-up tasks. |
