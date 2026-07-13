# Appendix: MythOS Subsystem Catalogue

Prepared for third-party review (simulation/engine architects, computational
philologists, historians of world-building systems). This is a flat inventory
of every subsystem currently implemented in the PoC engine (`poc/src/engine`,
`poc/src/systems`, `poc/src/content`), cross-referenced to the design docs
that motivated each one. It is descriptive, not evaluative — it exists so a
reviewer can decide what to interrogate.

Scope note: MythOS is a genre-agnostic simulation engine (see `CLAUDE.md`).
Everything below is engine-level and data-driven; concrete fantasy/sci-fi
content lives in "Universe Packs" and is out of scope for this appendix
except where a system's *design* is worth reviewing (e.g. procedural
philology, culture generation).

---

## 1. Core Data Model & Execution

| Subsystem | File(s) | What it does |
|---|---|---|
| World/entity model | `model.ts`, `world.ts` | Canonical entity types: Actor, Organization, Location, Object — see `design/11-simulation-ontology.md` |
| Component catalogue | (cross-cutting, see `design/14-component-model.md`) | Identity, Lifecycle, Needs, Personality, Traits, Profession, SocialTies, Memory, Reputation, Relationships, Faith, Exile, Fidelity, LocationMeta, MacroPop, Economy, FactionSplit, DirectorState, Substrate |
| Tick/execution pipeline | `sim.ts` | Daily/weekly/monthly/yearly cadences; ordering rationale in `design/15-execution-model.md` |
| Level of detail (LOD) | `lod.ts` | Simulation-frequency scaling by relevance/distance from player focus |
| RNG | `rng.ts` | Deterministic seeded randomness — no wall-clock or non-reproducible entropy |
| Persistence / save format | `persistence.ts`, `idb.ts` | IndexedDB save/load; save-versioning philosophy in `CLAUDE.md` §Save Philosophy |
| Universe Pack contract | `pack.ts` (+ `pack.test.ts`, `pack.conformance.test.ts`) | Live-binding pack interface; a new genre = one module implementing `UniversePack`, no engine changes (`design/archive/05-modules-and-universe-packs.md`) |
| Worker/thread boundary | `worker/sim.worker.ts`, `worker/protocol.ts` | Simulation runs off main thread; typed message protocol to UI |
| Determinism test suite | `sim.determinism.*.test.ts` (11 files) | Bit-for-bit reproducibility checkpoints per subsystem (belief, orgs, houses, dynasties, personality, tales, LOD, pack data, director) |

## 2. World Generation & Geography

| Subsystem | File(s) | What it does |
|---|---|---|
| Terrain/geography generation | `geography.ts` (+ `.test.ts`) | Causal terrain: wind → rain-shadow → drainage rivers, hilliness; terrain generated *first* and drives founding/economy (`design/18-prime-movers.md`) |
| Biomes | `content/biomes.ts` | Biome classification feeding settlement viability, resources |
| Settlement founding & location model | `location.ts` (+ `.test.ts`) | Settlement placement, hierarchy, legibility (`design/28-settlement-legibility.md`) |
| Local/close-view maps | `content/localmap.ts`, `design/24-local-maps.md` | Planet ↔ generated local map (RimWorld-style "Close View"); L1–L4 shipped |
| Venues | `venues.ts` (+ `.test.ts`), `content/venues.ts`, `design/24-local-maps.md` §8 | Concrete places-within-settlements (taverns, temples, markets) as the L4 local-map layer |
| Terrain rendering (3D) | `ui/terrain.ts`, `ui/terrain3dGeo.ts`, `ui/terrainWorker.ts` | Presentation-layer 3D map, decoupled from sim data |

## 3. Actors — Individual Simulation

| Subsystem | File(s) | What it does |
|---|---|---|
| Personality model | (component: Personality/Traits, `design/` actor-personality docs) | Per-individual innate value profile + orthogonal temperament + trait spectra (not archetypes) |
| Needs | `systems/needs.ts` | Generic need-satisfaction drives (data-driven, not species-hardcoded) |
| Lifecycle | `systems/lifecycle.ts` | Aging, birth, death — species-generic (no hardcoded human lifespan) |
| Backstory generation | `backstory.ts` (+ `.test.ts`) | Procedural personal history generation for actors |
| Family / households | `family.test.ts`, `households.test.ts` | Kinship structures, household composition |
| Aspirations | `aspiration.ts`, `content/aspirations.ts` | Long-horizon personal goals distinct from moment-to-moment decisions |
| Ambitions | `ambition.ts`, `content/ambitions.ts` | Actor-level drives that generate the player's legible "why am I doing this" goal (`CLAUDE.md` §Legibility) |
| Decision-making | `decide.ts` (systems), `decision.ts` (engine), `content/decisions.ts` | Actor choice resolution — same code path for player and NPC |
| Intent/Resolver seam | `intent.ts`, `design/archive/10-intent-resolver-design.md` | Every action is a serializable Intent + shared resolver; player is one more intent producer |

## 4. Social Fabric

| Subsystem | File(s) | What it does |
|---|---|---|
| Relationships | `systems/social.ts`, `social.ts` (engine) | Generic relationship graph (not player-centric) |
| Reputation | `reputation.ts`, `reputation_depth.test.ts`, `reputation_effects.test.ts` | How actors are perceived, and downstream behavioral effects |
| Opinion | `opinion.ts` | Actor-to-actor sentiment, feeding relationships/mood |
| Gatherings / communal events | `gathering.ts` (+ `.test.ts`), `design/27-lived-in-villages.md` | Weddings, funerals, communal events at the local-map level |
| Audiences | `audiences.test.ts`, `design/26-pov-gameplay.md` | Warsim-style structured social encounters with value-tinted choice framing |
| Perception pipeline | `perception.ts`, `perception.coronation.test.ts` | What actors witness/learn from events (bounded knowledge, no omniscience) |

## 5. Political Entities & Organizations

| Subsystem | File(s) | What it does |
|---|---|---|
| Organization model | `organization.ts` (+ validation, `_2c` tests) | Generic Political Entity abstraction — kingdoms/empires/hive-worlds/federations all one type |
| Org actions | `orgAction.ts` (+ `.test.ts`) | Collective actions taken by organizations |
| Org reasoning | `orgReason.ts` (+ `.test.ts`) | Organization-level "why" — worldview derived from member composition |
| Org belief | `orgBelief.test.ts`, `orgStatusBelief.test.ts` | What an organization (collectively) believes/knows — bounded, not omniscient (`design/` Org Intent 2C constraints) |
| Org-to-org interaction | `orgInteraction.ts` (+ `.test.ts`) | Diplomacy/interaction between political entities — Phase 2E of engine universality roadmap |
| Alliance | `alliance.test.ts` | Formal inter-org alignment |
| Annexation | `annex.test.ts` | Territory/entity absorption |
| War | `war.ts` (+ `.test.ts`) | Conflict simulation |
| Allegiance | `allegiance.test.ts` | Actor-to-org loyalty binding |
| Envoy | `envoy.test.ts` | Inter-org emissary mechanic |
| Mandate | `mandate.test.ts` | Authority/legitimacy grants |
| Status belief | `statusBelief.ts` (+ `.test.ts`) | Subjective belief about relative status/rank |

## 6. Dynasties, Succession & Inheritance

| Subsystem | File(s) | What it does |
|---|---|---|
| Dynasties & Houses | `figures.ts`, related tests, `design/` dynasties-houses doc | Multi-generation lineages: succession, prestige, rise/fall, Great Houses panel |
| Player dynasty continuity | `player.ts`, `player.dynasty.test.ts` | Death hands control to `heirOf`/`inheritHeir` — no game-over state (`CLAUDE.md` §World Before Player) |
| House inspection | `house.inspect.test.ts` | Player-facing lineage introspection tooling |

## 7. Belief, Ethics, Religion (the "Belief Layer")

| Subsystem | File(s) | What it does |
|---|---|---|
| Culture/Values | (component, `design/` belief-layer doc) | Data-driven cultural value systems, not hardcoded per-species ethics |
| Ethics | `ethics.test.ts` | Moral-framework evaluation of actions |
| Religion | `religion.ts`, `religion.stage2.test.ts` | Religion as emergent/generated institution, Stage 1+2 |
| Precepts | `precepts.test.ts`, `design/23-precepts-belief-module.md` | RimWorld-Ideoligion-style creed precepts emitting conscience self-thoughts |
| Conscience | `conscience.ts` (+ `.test.ts`) | Guilt/outrage/pride self-thoughts feeding mood |
| Factions (schism) | `factions.ts` (+ `.test.ts`) | Intra-cultural schism, civil war, exile, return-from-exile |
| Leave/exile | `leave.test.ts` | Actors leaving organizations/settlements under duress or choice |
| Procedural culture generation | `content/cultureGen.ts`, `design/` procedural-cultures doc | Creed roster generated per world-seed (variable count, rule-derived precepts, divine-tongue deity names) — not a fixed content list |

## 8. Epistemics — Subjective Knowledge

| Subsystem | File(s) | What it does |
|---|---|---|
| Belief (Mark) model | `belief.ts`, `mark.ts`, `design/17-epistemics-adr.md` | Belief modeled as a Mark (not a Thought); truth = independent claim; core epistemics ADR |
| Belief propagation | `belief.propagation.test.ts` | How beliefs spread actor-to-actor (Testimony as the propagation atom) |
| Claims | `claim.test.ts` | Independent, checkable truth-claims distinct from any actor's belief about them |
| News / distal information | `news.ts` (+ `.test.ts`), `design/17-epistemics-adr.md` §13 | Information decay/distortion over distance — the "distal news frontier" |
| Subjective journal | `design/21-the-subjective-journal.md` | Player-facing log of what *this actor* knows, not omniscient world state |
| Reactions | `reactions.ts` (+ `.test.ts`) | Actor responses triggered by newly-formed beliefs |
| Causes | `causes.test.ts` | Causal-chain tracking so events are traceable ("why did this happen?" — `CLAUDE.md` §Legibility) |

## 9. Mood & Narrative Direction

| Subsystem | File(s) | What it does |
|---|---|---|
| Mood | `mood.ts` (+ `.test.ts`), `design/22-mood-and-causal-worldgen.md` | Self-thoughts → mood → mental breaks with catharsis; one rule for player and NPC alike |
| Director | `director.ts`, `sim.determinism.director.test.ts` | RimWorld-style AI Director / pacing layer over emergent events |
| Narrative assembly | `narrative.ts`, `content/narrative.ts`, `narrative.demo.test.ts` | Turns raw simulation events into player-legible stories (presentation layer per `CLAUDE.md` §AI Philosophy) |
| Grammar / procedural text | `grammar.ts` | Recursive rule-based text generation (RimWorld RulePack-style) for narration/flavor |
| Chronicle | `chronicle.ts` | Historical record-keeping / timeline of world events |

## 10. Language & Procedural Philology

| Subsystem | File(s) | What it does |
|---|---|---|
| Language generation | `language.ts`, `content/languages.ts`, `design/` procedural-philology doc | Per-culture generated tongue: phonology, morphology, naming |
| Sacred toponymy | (within language/culture gen) | Patron-deity capital names derived from generated divine-tongue (e.g. "shrine of the Forge Spirit") |
| Narrative arc naming (Stage 3) | (within language.ts / grammar.ts) | Multi-stage language evolution feeding place/figure naming over time |

*This subsystem is a primary review target for a computational-philologist
reviewer — it is the most linguistically load-bearing part of the engine and
has no direct analogue in Warsim/RimWorld/DF (see `design/` procedural-
philology memory for prior study notes).*

## 11. Economy, Travel, Location Meta

| Subsystem | File(s) | What it does |
|---|---|---|
| Travel | `travel.ts` (+ `.test.ts`) | Movement between locations, route/adjacency resolution |
| Location metadata | `location.ts` | Settlement attributes feeding economy/culture/founding rationale |
| Resource/need vectors | (component, universality audit) | Generic resource model, not per-species hardcoded |

## 12. Player-Facing Gameplay Loop

| Subsystem | File(s) | What it does |
|---|---|---|
| Decisions → Ambitions → Dynasty → Seat loop | `decision.ts`, `ambition.ts`, `player.ts`, `design/26-pov-gameplay.md` | The player-experience pillar reconciling "world before player" with "don't lose the player" |
| Autopilot | `autopilot.test.ts` | Fills in player actions when the player is idle/unfocused — world never pauses on the player |
| POV gameplay proposal | `design/26-pov-gameplay.md` | Audiences, value-tinted choices, org-bounded ruler verbs, travel (staged, not fully shipped) |
| Aeon / proof pack | `content/aeon.ts` | Reference Universe Pack proving the engine/pack boundary with no engine-side genre assumptions |

## 13. Presentation / UI (non-authoritative, reads sim state only)

| Subsystem | File(s) | What it does |
|---|---|---|
| Simulation hook | `ui/useSim.ts` | React binding to worker-hosted sim state |
| Lineage layout | `ui/lineageLayout.ts` (+ `.test.ts`) | Dynasty/family-tree visual layout algorithm |
| Substrate cache | `ui/substrateCache.ts`, `substrate.ts` | Cached derived-data layer for fast UI reads without re-deriving from raw sim state |
| Map rendering | `ui/terrain.ts`, `ui/terrain3dGeo.ts`, `ui/terrainWorker.ts` | 3D terrain visualization, off-main-thread |
| Render orchestration | `render.ts` | Engine-side hooks that feed presentation without leaking sim internals |

---

## Cross-Cutting Concerns Worth Reviewer Attention

1. **Determinism** — the entire sim tree must replay bit-identically from a
   seed; 11 dedicated determinism test files exist. A reviewer should check
   whether any subsystem (especially language/grammar generation, which
   often leans on incidental JS object-iteration order or Math.random-style
   patterns) violates this.
2. **Universality / no hardcoded genre** — verify that Actor, Organization,
   Location, Object, Species/Culture data model genuinely has zero
   `if (race === "X")`-style branches per `CLAUDE.md` §Everything Is Data.
3. **Legibility vs. depth trade-off** — Dwarf-Fortress-style depth (epistemics,
   belief propagation, procedural philology, causal geography) is deliberately
   bounded by LOD and the "subjective journal" so players aren't drowned;
   worth stress-testing whether these actually cohere into a followable story
   at scale, or whether depth has quietly outrun legibility.
4. **Player/NPC parity** — mood, decisions, ambitions, autopilot all claim a
   single code path for `controlledByPlayer=true` vs. NPC; worth spot-checking
   for special-cased branches that crept in.
5. **Pack boundary** — `pack.ts` + `pack.conformance.test.ts` are the sole
   enforcement that a new Universe Pack requires zero engine changes; this is
   the seam most likely to erode silently as content grows.

---

*Generated from repository state as of 2026-07-12. File paths are relative to
`poc/src/`. See `design/00-README.md` for the full design-doc index this
appendix cross-references.*
