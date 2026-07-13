# MythOS Design Dossier

This folder is a running architectural record for the engine described in
`CLAUDE.md`: game studies that shaped early decisions, the frozen engine
constitution, and ADRs/proposals for each subsystem as it was designed and
shipped. **`29-subsystem-appendix.md` is the reconciliation anchor** — a flat,
regenerable catalogue of every subsystem actually implemented, cross-referenced
back to the doc that motivated it. When a doc below says "shipped," `29` is the
place to verify it's still true.

Superseded and purely historical material lives in `archive/` (see bottom of
this file) — kept for provenance, no longer authoritative.

## Part 1 — Game studies

| File | Contents |
|------|----------|
| `01-warsim-analysis.md` | Warsim reverse-engineering teardown (Part 1) + distilled lessons and a strategy to surpass it without cloning (Part 2, folded in from the former `07-lessons-and-surpassing-warsim.md`) |

RimWorld and Dwarf Fortress studies (`08`, `09`) and the early Warsim-era engine
sketches (`03`–`05`) have been fully absorbed into the shipped systems and the
constitution below; they now live in `archive/` as historical record.

## Part 2 — Vision, roadmap

| File | Contents |
|------|----------|
| `02-vision-and-architecture.md` | Vision doc, architecture doc, assumptions challenged |
| `06-tech-roadmap-mvp-risks.md` | Tech recs, folder layout, roadmap, MVP, risks, things to avoid |

## Part 3 — Engine Constitution (frozen)

Produced before Phase 1 World Topology implementation so all future systems share a
consistent vocabulary. Revised after third-party technical review; changes since are
additive (see each file's Revision History), never contradictory.

| File | Contents |
|------|----------|
| `11-simulation-ontology.md` | What exists: Actor, Organization, Location, Vehicle, Object; entity vs. construct vs. data tiers; capability-first classification; the `Mark` construct (shared subjective substrate) |
| `12-capabilities.md` | What each entity type can do: Identity, Agency, Collective Decision Making, Memory, Relationships, Reputation, Influence, Needs, Ownership, Membership, Containment, Mobility, History, Destruction |
| `13-simulation-rules.md` | How the simulation operates: Time, Space, Systems, Rules, 16 Invariants, Universe Extension Contract |
| `14-component-model.md` | Bridge from ontology to implementation: full component catalog, read/write contracts, system dependency table |
| `15-execution-model.md` | Tick pipeline, event emission/perception pipeline, snapshot build, player input/replay, LOD focus protocol, save/load lifecycle, 10 execution invariants |
| `18-prime-movers.md` | Capstone worldview doc: objective vs. subjective, the engine's development methodology ("freeze the primitive, grow only producers/consumers"), observer independence |
| `21-the-subjective-journal.md` | UI/HUD constitution: cockpit vs. journal, the three-questions model |

## Part 4 — ADRs and design notes (per subsystem)

Each file's own header states its status (proposed / shipped) and companion docs.

| File | Contents |
|------|----------|
| `16-interaction-principles.md` | Org↔org interaction guidance (Phase 2E) — the 5 principles; shipped features tracked in `29` §5, not here |
| `17-epistemics-adr.md` | Belief layer ADR: Mark→Belief, evidence/confidence, propagation — includes the v1 implementation slice (§12) and distal News Frontier (§13), folded in from their original standalone notes once both shipped |
| `22-mood-and-causal-worldgen.md` | Mood/self-thoughts/mental-breaks + causal geography (wind/rivers/named features) |
| `23-precepts-belief-module.md` | Precepts/Ideoligion belief module (creed → conscience self-thoughts) |
| `24-local-maps.md` | Close View (planet ↔ local map): terrain amplification, town plan, history marks, souls-on-the-map, cell mechanics, town-plan v2 fidelity, 3D terrain view — includes the Venues ADR (§8, folded in from its original standalone ADR) |
| `26-pov-gameplay.md` | POV gameplay: autopilot, audiences, value-tinted choices, ruler role verbs, leaving home — all shipped, kept as the design record |
| `27-lived-in-villages.md` | Lived-in villages: inhabitants + communal gatherings on the Close View (L1–L2 shipped; L3–L6 staged) |
| `28-settlement-legibility.md` | Settlement Fortunes/legibility (active proposal, not yet shipped) |
| `29-subsystem-appendix.md` | Flat catalogue of every implemented subsystem, cross-referenced to the docs above — **the reconciliation anchor** |
| `30-mythic-layer.md` | Prioritized proposal for Tolkien-depth mythic history as optional pack-configurable modules: legend drift, artifact-lite agency, the Mythic Feedback Loop (legends reshaping culture/ambition/organizations), Creation Paradigm & Rules-based Decline, oaths/prophecy, divine actors, sacred geography, language-as-archaeology, corruption-as-contagion, Director myth-awareness; cross-genre-validated (ASOIAF/Star Trek/Dune/40K/Foundation/Mass Effect/RimWorld), plus a Historical Attractor legibility reducer and the Law of Mythic Scarcity (anti-inflation) — active proposal, not yet shipped |
| `31-failure-modes.md` | Standing engineering checklist (not a feature doc) cataloging how the architecture could degrade at scale — primitive stretch, hidden decay/graph/reducer patterns, inspectability gaps, historical-bias boundary, Prime Movers dilution — evidence-audited against the actual codebase, no new primitives proposed |

## `archive/` — superseded or purely historical

Kept for provenance; no longer authoritative. Current equivalents are noted.

| File | Why archived |
|------|------|
| `03-entity-world-data-model.md` | Early ECS/entity/save-format sketch; superseded by `11`–`15` |
| `04-simulation-systems.md` | Early tick/scheduler/LOD sketch; superseded by `13`, `15`, `29` |
| `05-modules-and-universe-packs.md` | Early module/pack design; superseded by the shipped `pack.ts` contract (`29` §1) |
| `08-rimworld-study.md` | RimWorld storytelling teardown; all four lessons (Storyteller/Thoughts/Tales/RulePack) shipped |
| `09-dwarf-fortress-study.md` | Dwarf Fortress depth teardown; worldgen pre-history and ethics/values lessons shipped |
| `10-intent-resolver-design.md` | Intent/Resolver refactor ADR; fully shipped (`intent.ts`) |
