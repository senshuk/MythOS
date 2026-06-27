# Part 2 — MythOS: Technology, Structure, Roadmap, MVP, Risks

The execution plan. Opinionated, sequenced, and built around one rule: **make a
tiny world feel alive before making the engine universal.**

---

## 1. Technology Recommendations

### 1.1 Core stack

| Concern | Recommendation | Why |
|---|---|---|
| Language | **TypeScript** (strict) | Types are your schema discipline; matches `CLAUDE.md` |
| Sim runtime | **Plain TS in a Web Worker**, no framework | Headless, deterministic, testable, off main thread |
| UI | **React + TS** | As specified; only renders snapshots |
| State→UI | **Snapshot/delta messaging** (structured clone; later `SharedArrayBuffer`) | Clean sim/UI boundary |
| UI state mgmt | **Zustand or Redux** (UI only) | Keep sim state *out* of React |
| Persistence | **IndexedDB** via a thin wrapper (`idb`) | As specified; chunked stores |
| Build/tooling | **Vite** + **Vitest** + **ESLint** + **Prettier** | Fast, standard, worker-friendly |
| Serialization | **CBOR/MessagePack** (prod) + JSON (debug) | Compact binary snapshots |
| Compression | `CompressionStream` (gzip) | Native, no dep |
| RNG | **seedable PCG/xorshift** (vetted lib or ~30 LOC) | Determinism foundation |
| Content format | **JSON5** (authoring) → compiled/validated tables | Comments + trailing commas for authors |
| Schema validation | **Zod** (or JSON Schema) | Total validation of untrusted packs |
| Monorepo | **pnpm workspaces** | Engine / packs / app / tools as packages |

### 1.2 Deliberate "no"s (avoid these temptations)

- ❌ **A custom scripting language / rules VM** in v1 (`02 §3.4`). Systems are TS.
- ❌ **An existing heavy game engine** (Phaser/Unity/Babylon) — MythOS is a *data
  simulation*, not a render engine; they'd fight your determinism and worker model.
- ❌ **A class hierarchy of entities** (`Actor extends Being…`) — use ECS (`03 §1`).
- ❌ **ORM/SQL in the browser** — IndexedDB suffices until the server era.
- ❌ **Premature multiplayer/server** — design for it (determinism, event log),
  build it late.
- ❌ **Floating point in cross-platform-critical paths** if you intend lockstep MP.

### 1.3 ECS library choice

Either adopt a small TS ECS (e.g. `bitecs` for SoA/perf, or `miniplex` for
ergonomics) **or** write a ~200-line minimal ECS you fully control. Given
determinism + serialization requirements, a **thin in-house ECS** is defensible and
often the right call here (you need exact control over iteration order and storage).

---

## 2. Suggested Project Folder Structure

A **monorepo** separating engine, modules, packs, app, and tools:

```
mythos/
  packages/
    engine-core/                 # ECS, scheduler, RNG, event log, save/load
      src/
        ecs/            (entities, components, stores)
        scheduler/      (multi-rate clock, LOD/active-set)
        rng/            (seeded PRNG)
        events/         (event bus + history log)
        registry/       (module + content + tunable registries)
        persistence/    (IndexedDB, snapshots, migrations)
        worldview/      (read API exposed to systems & snapshots)
      test/             (determinism + replay tests)

    modules/                     # code capabilities (depend on engine-core)
      core-actors/      (needs, goals, lifecycle, memory)
      core-world/       (regions, settlements, route graph)
      relationships/    (typed relation graph)
      diplomacy/
      economy/
      combat-abstract/
      magic/            (optional examples)
      space-travel/

    procgen/                     # reusable generators (universe-neutral)
      token-grammar/    (Currency/KingdomNames pattern)
      part-assembly/    (Faces/Flags/Weapons pattern, dual visual+text output)
      modifiers/        (RaceSuffix pattern, generalized)
      names/

    content-schemas/             # Zod schemas shared by modules + tools

    app-web/                     # React app: renders snapshots, sends intents
      src/ (ui/, workers/sim.worker.ts, store/)

    pack-sdk/                    # helpers + validators for pack authors
    devtools/                    # world inspector, history viewer, determinism harness

  packs/                         # Universe Packs (pure data)
    mythcore-fantasy/
    aslona-like/
    star-empire/

  scenarios/                     # seed + setup bundles
  docs/                          # this dossier + ADRs
  fixtures/                      # old saves for migration tests
```

Principle: **`engine-core` knows nothing about any universe; modules know nothing
about each other's internals; packs are pure data.** Dependency arrows point inward
only (packs → modules → engine-core).

---

## 3. Development Roadmap

Sequenced to keep something *playable and alive* at every milestone. Each phase ends
with a demo you could hand to a player.

### Phase 0 — Foundations (determinism or bust)
- ECS, seeded RNG, multi-rate scheduler, event log, snapshot save/load to IndexedDB.
- **CI determinism harness**: run 100 ticks twice → identical state hash;
  snapshot+replay → identical. *This gate must be green before any system is built.*
- No gameplay yet — this is the spine.

### Phase 1 — The Living Village (vertical slice, ONE tiny world)
- Modules: `core-actors`, `core-world`, `relationships`, `events`.
- One settlement, ~50–200 actors with needs→goals→intents, professions, aging,
  births/deaths, memory, relationships.
- History log + a read-only React UI to *watch* the village and inspect causality.
- **Success test:** leave it running 50 years unattended; it produces a readable,
  varied local history. This proves emergence + legibility on a small scale.

### Phase 2 — The Player as One Actor
- Control layer: a `PlayerControlled` actor sourcing intents from UI; identical
  rules to NPCs.
- Player can take a profession, form relationships, act; world reacts; world keeps
  running if the player idles or dies.
- **Success test:** play as a farmer *and* as a would-be leader using the same
  systems, no special-case code.

### Phase 3 — Factions, Diplomacy & Scale (LOD proven)
- Modules: `diplomacy`, faction politics, the typed relation graph at scale.
- Multiple settlements + a region graph; LOD/active-set + aggregate macro layer +
  deterministic promotion/demotion.
- **Success test:** 10+ regions, tens of thousands aggregate pop, hundreds of full
  actors; kingdoms rise/fall/war/ally; fast-forward 200 years within performance
  budget; determinism still green.

### Phase 4 — Economy, Combat, Universe-Pack-ability
- Modules: `economy`, `combat-abstract`; finalize the **Universe Pack format** +
  loader + validation; ship **two** packs proving universe-neutrality
  (a fantasy pack and a structurally different one, e.g. a small sci-fi pack).
- **Success test:** the *same engine binary* runs both packs with no code change.

### Phase 5 — Depth & Modules
- Optional modules (magic/religion/naval/etc.), richer narrative templates,
  perception/reputation depth, scenario system.

### Phase 6 — Tooling & Community
- In-browser pack editor, module SDK, AI-assisted content authoring (offline),
  world inspector/history explorer for players.

### Phase 7+ — Server Era (only now)
- Postgres-backed persistence, cloud saves, then (much later) multiplayer built on
  the determinism + event-sourcing already in place.

> The ordering is the point: **determinism → tiny alive world → player → scale →
> universality → depth → tools → server.** Universality (the headline vision)
> deliberately comes *after* you've proven the world feels alive small.

---

## 4. MVP Definition

**The MVP is Phase 1 + 2: a single hardcoded-ish "village" universe that is alive
and inhabitable, on a deterministic core.** Concretely, the MVP must:

1. Run a deterministic, worker-isolated sim with save/load + replay (Phase 0).
2. Simulate one settlement of actors with needs, goals, professions, aging,
   relationships, memory, and a readable history log (Phase 1).
3. Let the player *be one actor* under identical rules and keep running without them
   (Phase 2).

**The MVP is explicitly NOT:** universe packs, multiple modules, large scale,
economy depth, combat, AI, multiplayer, or a map. Those are proven *later*. The MVP
exists to validate the two riskiest bets — **determinism at the core** and
**emergent legible aliveness from the needs/goals/memory/relationship loop** —
before investing in universality.

> Anti-goal: do **not** build the Universe Pack system first. It's the most exciting
> part and the most useless if the underlying world isn't yet fun.

---

## 5. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | **Scope/boil-the-ocean** — chase universality before fun | High | Fatal | Phased roadmap; MVP forbids packs; ship a fun village first |
| R2 | **Determinism erodes** over time (a stray `Math.random`/`Date.now`) | High | Severe | CI determinism gate from Phase 0; lint-ban the APIs in sim package |
| R3 | **Simulate-everyone performance wall** | High | Severe | LOD + aggregate macro layer designed in from day 1 (`04 §2`) |
| R4 | **"Everything is data" → accidental scripting VM** | Med | Severe | Hard line: content/tunables data, systems TS (`02 §3.4`) |
| R5 | **Inner-platform effect** — engine so generic it does nothing well | Med | High | Opinionated core ontology; prove with 2 real packs, not 10 stubs |
| R6 | **Save migration debt** | Med | High | Versioned, event-sourced saves + migration tests against fixtures |
| R7 | **Emergence feels like noise / illegible** | Med | High | Causal event graph + history UI as a *core feature*, not polish |
| R8 | **UI/sim coupling creeps in** | Med | High | Worker boundary + snapshot-only rendering enforced architecturally |
| R9 | **Float drift breaks future multiplayer** | Low now | High later | Integer/fixed-point in critical paths; decide MP determinism early |
| R10 | **Solo-dev burnout on a 5–10yr vision** | High | Fatal | Each phase independently demo-able & rewarding; resist horizontal sprawl |
| R11 | **Pack security** (untrusted content) | Low | Med | Packs are data-only + schema-validated; code only via trusted modules |

---

## 6. Things to Avoid (concise checklist)

- ❌ Positional/blob save files (Warsim's deepest debt). Keyed, versioned, sourced.
- ❌ Global mutable state reachable from everywhere. ECS stores + system contracts.
- ❌ `if (isPlayer)` branches in systems. One rule set, two intent producers.
- ❌ Hardcoded balance constants. Tunables in the registry.
- ❌ Storing rendered prose as canonical history. Store structured events; render
  text in the view.
- ❌ Delimiter-as-punctuation formats. Structured encoding only.
- ❌ Simulating every citizen at full fidelity. Aggregate-first + promotion.
- ❌ Building the pack system / map / multiplayer before the world is fun.
- ❌ Letting React objects into the sim, or running the sim on the main thread.
- ❌ A bespoke per-file content syntax. One validated schema-driven format.
- ❌ Requiring the network/AI to play. Offline-deterministic core; AI only assists
  authoring.
