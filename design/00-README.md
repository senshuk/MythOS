# MythOS Design Dossier

This folder contains a two-part architectural study:

1. **Part 1 — Warsim Reverse-Engineering Analysis** (`01-warsim-analysis.md`)
   A software-architect's teardown of *Warsim: The Realm of Aslona*, reconstructed
   from its shipped data files and save files (the BASIC/QB64 source is closed). It
   covers architecture, simulation, procedural generation, content organization,
   save/load, UI, strengths, weaknesses, and what to redesign.

2. **Part 2 — MythOS Engine Design** (files `02`–`07`)
   A principal-engineer's design for the *fictional universe simulation engine*
   described in `CLAUDE.md`. It deliberately challenges several assumptions in the
   stated vision where they will cause long-term pain.

| File | Contents |
|------|----------|
| `01-warsim-analysis.md` | Full Warsim teardown (deliverables 1–9 of the brief) |
| `02-vision-and-architecture.md` | Vision doc, architecture doc, assumptions challenged |
| `03-entity-world-data-model.md` | Entity model, world model, data model, save format |
| `04-simulation-systems.md` | Tick model, scheduler, LOD, all core systems |
| `05-modules-and-universe-packs.md` | Module/plugin system, universe pack format |
| `06-tech-roadmap-mvp-risks.md` | Tech recs, folder layout, roadmap, MVP, risks, things to avoid |
| `07-lessons-and-surpassing-warsim.md` | Lessons from Warsim, how to surpass it without cloning |

3. **Part 3 — RimWorld Storytelling Study** (`08-rimworld-study.md`)
   An evaluation of *RimWorld* (Ludeon) focused on **storytelling & worldbuilding** —
   the Storyteller/AI-Director, the Thought (opinion/mood) system, Tales
   (history-as-content), and the recursive RulePack grammar — plus what the Warsim
   evaluation under-weighted, and prioritized recommendations for MythOS and the PoC.
   Studied from the shipped XML `Defs` and `Source/` reference; no code/content copied.

| File | Contents |
|------|----------|
| `08-rimworld-study.md` | RimWorld storytelling teardown + what to fold into MythOS |

4. **Part 4 — Dwarf Fortress Study** (`09-dwarf-fortress-study.md`)
   An evaluation of *Dwarf Fortress* (Bay 12 / Kitfox) focused on **depth and the
   world-before-player**: pre-play worldgen history, civilizations as data-driven
   ethics/values, meaningful procedural language, and legends-as-database — plus the
   crucial *cautionary* lesson (DF's depth costs legibility, LOD, and determinism,
   which MythOS must keep). Studied from the shipped XML/raw `objects`; nothing copied.

| File | Contents |
|------|----------|
| `09-dwarf-fortress-study.md` | DF deep-simulation teardown + what to fold into MythOS, and what to avoid |

5. **Part 5 — The Intent / Resolver Seam** (`10-intent-resolver-design.md`)
   A concrete design for step 1 of *player-as-actor*: splitting every action into a
   serializable `Intent` (decided) and a shared resolver (applied), so the player
   becomes one more intent producer with no `if (isPlayer)` in any rule. Designed
   directly against the current `systems/social.ts` and `systems/needs.ts`, with the
   determinism plan (dedicated player RNG stream + replay input log) and a staged
   migration checklist.

| File | Contents |
|------|----------|
| `10-intent-resolver-design.md` | Intent/resolver seam: the player-as-actor foundation |

6. **Part 6 — Engine Constitution** (`11-simulation-ontology.md`, `12-capabilities.md`, `13-simulation-rules.md`)
   Three companion documents that together form the conceptual foundation of the engine. Produced before Phase 1 World Topology implementation so all future systems share a consistent vocabulary. Revised after third-party technical review.

| File | Contents |
|------|----------|
| `11-simulation-ontology.md` | What exists: Actor (autonomous agent, not individual), Organization, Location, Vehicle (Location sub-type), Object; entity vs. construct vs. data tiers; capability-first classification ("Agency creates Actors"); dual-role entity guidance |
| `12-capabilities.md` | What each entity type can do: Identity, Agency, Collective Decision Making, Memory, Relationships, Reputation, Influence, Needs, Ownership, Membership, Containment, Mobility, History, Destruction — each specified with mechanism, pack config, and invariants |
| `13-simulation-rules.md` | How the simulation operates: Time (configurable calendar), Space (three world model types, adjacency, travel), Systems (core + optional modules), Rules (physical/social/economic/supernatural per-universe), Invariants (16 hard constraints), Universe Extension Contract |
| `14-component-model.md` | Bridge between ontology and implementation: full component catalog (Identity, Lifecycle, Needs, Personality, Traits, Profession, SocialTies, Memory, Reputation, Relationships, Faith, Exile, Fidelity, LocationMeta, MacroPop, Economy, FactionSplit, DirectorState, Substrate) with read/write contracts, system dependency table, component lifecycle, and Phase 1–3 anticipated components |
| `15-execution-model.md` | How the machine runs: tick pipeline (daily/weekly/yearly cadences with ordering rationale), event emission and perception pipeline, snapshot build pipeline, player input queue and replay log, LOD focus change protocol, save/load lifecycle, worker/thread boundary, and 7 execution invariants — the authoritative answer to "what happens first?" |

---

## How Warsim was studied

The repository ships the compiled game (`Warsim.exe`, ~20 MB QB64 binary) plus a
fully exposed `Data/` and `Saves/` tree. The source is not present, so every claim
in Part 1 is grounded in **observable file formats and content**, not in reading
code. Where a mechanism is inferred rather than directly observed, it is marked
*(inferred)*. The most informative artifacts were:

- `Saves/0.txt` — a complete world serialized as one flat positional record.
- `Data/RaceType.txt`, `Data/RaceSuffix.txt` — the race + modifier grammar.
- `Data/RacePacks/*` — Warsim's embryonic "universe pack" concept.
- `Data/Currency.txt`, `Data/Weapons/*`, `Data/monsters.txt`, `Data/Faces/*` —
  compositional procedural generation by part-assembly + token grammar.
- `Data/Names/*` and the `*_NamingSystem.txt` files — the naming engine.
- `Data/*Talk.txt` — context-tagged dialogue pools.
- `Extras/Warsim Cheat List.txt` — an unintentional catalogue of every live
  simulation subsystem (factions, relations, bandits, demons, plague, void gates,
  leagues, deserters, mercenaries, blackmarket, slavers, public opinion, quests).
