# Part 2 — MythOS: Vision & Architecture

> Written as a principal engineer who is *on your side* and therefore willing to
> push back. Where I think a stated assumption will cause years of pain, I say so
> and propose an alternative. Endorsements are as important as challenges — several
> of your instincts are exactly right.

---

## 1. Vision Document

### 1.1 One-sentence vision

**MythOS is a deterministic, headless simulation core that grows living fictional
worlds from data-defined "Universe Packs," where stories emerge from interacting
systems and the player inhabits the world as one ordinary actor among thousands.**

### 1.2 What it is / is not

| It is | It is not |
|-------|-----------|
| A simulation engine + content format | A single game |
| Universe-agnostic core + swappable packs | A fantasy kingdom game with reskins |
| Deterministic, offline-first, replayable | An AI-narration product |
| Emergent (systems produce stories) | Scripted (authors write stories) |
| Browser-first, worker-isolated sim | A desktop engine ported to web |

### 1.3 Pillars (and the honest tension in each)

1. **Simulation first.** Stories emerge from systems. *Tension:* pure emergence can
   feel like noise; you still need **legibility** — the player must be able to
   *read* why things happened. Warsim solves this with history-as-text; MythOS must
   too (an explainable event/causality log is a feature, not an afterthought).
2. **World before player.** The world runs without the player. *Tension:* a world
   that fully ignores the player can feel pointless to play. The resolution is
   **agency without centrality** — the player can *perturb* systems meaningfully
   without the systems *revolving around* them.
3. **Every actor is equal (data), not equal (cost).** One data model for all
   actors, `controlledByPlayer` the only special flag. *Tension — the big one:* you
   **cannot** simulate every actor at full fidelity in a browser. See §3.2; the
   principle survives as *uniform model, tiered fidelity*.
4. **Engine knows no specific universe.** Tolkien/Trek/etc. are packs. *Tension:* a
   maximally generic engine risks the *inner-platform effect* — an empty framework
   that does nothing well. Resolution: the engine is **opinionated about
   simulation primitives, agnostic about content** (§3.3).
5. **Everything is data — within reason.** *Tension:* "everything is data" taken
   literally means inventing a scripting language and a rules VM. That is a multi-
   year tar pit. Resolution: **content & tunables are data; systems are code with
   declared extension points** (§3.4).
6. **Deterministic & offline.** Endorsed without reservation — but it must be
   *engineered from line one* (§3.5), not retrofitted.

### 1.4 Definition of success (borrowed and sharpened from your doc)

Success = a player says *"I've never seen this happen before"* **and can find out
why**. Two testable proxies:
- **Novelty:** two playthroughs of the same pack with different seeds produce
  materially different histories (different dominant powers, different conflicts).
- **Legibility:** for any notable event, the player can trace a causal chain in the
  history log ("war happened *because* relation crossed −60 *because* of the raid
  in year 12 *because* of the border dispute…").

---

## 2. Architecture Document

### 2.1 The shape

```
┌────────────────────────────────────────────────────────────────┐
│ PRESENTATION (React/TS, main thread)                            │
│  - renders read-only snapshots of world state                   │
│  - sends intents (player actions) → sim                         │
│  - never mutates sim state directly                             │
└───────────────▲───────────────────────────┬────────────────────┘
                │ snapshots / deltas         │ intents (commands)
                │ (structured-clone/SAB)     │
┌───────────────┴───────────────────────────▼────────────────────┐
│ SIMULATION CORE (TS, Web Worker, headless, deterministic)       │
│                                                                 │
│  World State (ECS-style stores) ──▶ Systems (pure-ish)          │
│        ▲                                   │                     │
│        └──────── Scheduler (multi-rate, LOD) ◀── Seeded RNG      │
│                                   │                             │
│                          Event Bus + History Log                │
│                                                                 │
│  Content Registry  ◀── Universe Pack Loader ◀── Module Registry │
└───────────────┬─────────────────────────────────────────────────┘
                │ persistence
┌───────────────▼─────────────────────────────────────────────────┐
│ STORAGE: IndexedDB (snapshots + event log)  → later: Postgres    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Foundational decisions (the load-bearing ones)

1. **Headless sim core, isolated in a Web Worker.** The simulation must have *zero*
   dependency on React, the DOM, or wall-clock time. UI is a pure function of a
   world snapshot. This is the inversion of Warsim's interleaved logic+print and is
   non-negotiable for testability, determinism, and not freezing the browser tab.
2. **Command/snapshot boundary.** UI sends **intents** (serializable commands);
   the worker applies them inside the tick and returns **snapshots/deltas**. No
   shared mutable objects across the boundary. This single rule buys you
   multiplayer-readiness, replay, and undo for free later.
3. **Determinism as an invariant.** One seeded PRNG stream threaded through the
   sim. Banned in sim code: `Math.random`, `Date.now`, `Map`/`Set` iteration-order
   reliance on insertion of non-deterministic keys, floating-point where integers
   suffice. A world is reproducible from `seed + ordered intents`.
4. **Event-sourced history, snapshot for speed.** The canonical timeline is an
   ordered, append-only **event log**; periodic **snapshots** make load fast. This
   gives you replay, time-travel debugging, tiny diffs for multiplayer, *and*
   Warsim's "history book" as a first-class artifact.
5. **Data-oriented entity storage (ECS), not a class hierarchy of `Actor`.** The
   `CLAUDE.md` instinct "composition over inheritance" is right; the way to honor
   it at scale is an **Entity-Component-System**: entities are IDs, data lives in
   typed component stores, systems iterate stores. This is also how you make "every
   actor equal" affordable.

### 2.3 The three registries

- **Module Registry** — code-level capabilities (Economy, Diplomacy, Magic, Space
  Travel…). A module contributes component types, systems, and content schemas.
- **Content Registry** — runtime tables of typed records loaded from packs
  (species, governments, items, name grammars, dialogue pools…).
- **Universe Pack** — a manifest that *selects which modules are on* and *provides
  the content* that fills their schemas. (See `archive/05-modules-and-universe-packs.md`.)

This cleanly separates "what the engine *can* do" (modules/code) from "what this
world *is*" (pack/data) — the separation Warsim only achieved for races.

---

## 3. Assumptions Challenged (the critique you asked for)

### 3.1 "There should never be separate code paths for Player vs NPC"

**Endorse the intent, reject the literal reading.** Keep a single *data model* and
a single set of *simulation rules*; `controlledByPlayer` should gate **input
source**, not behavior. ✅ But you *will* need a distinct **control layer**: a
player-controlled actor gets intents from the UI; an AI actor gets intents from a
**goal/utility AI**. Both produce the *same intent type* consumed by the *same
systems*. So: one set of action-resolution rules, two intent producers. That is not
a "separate code path for the player" — it's a clean *strategy* seam. If you skip
this seam you'll smear `if (isPlayer)` checks across every system, which is the
actual anti-pattern you're trying to avoid.

### 3.2 "Every character follows identical simulation rules" + full living world

**This is the assumption most likely to sink the project if taken literally.**
Simulating tens of thousands of actors — each ageing, working, forming
relationships, remembering events — at full fidelity, deterministically, every
tick, in a single browser thread, is not feasible. Warsim already conceded this:
only a few hundred NPCs have identity; the rest are aggregate population +
dialogue draws.

**Resolution — Uniform model, tiered fidelity ("LOD agents"):**
- All actors share the same components and rules.
- The **scheduler** runs full per-actor simulation only for actors in the
  **active set** (near the player, politically significant, or recently
  perturbed).
- Distant/insignificant actors are simulated **statistically in aggregate**
  (a settlement's population evolves by demographic rates, not per-person).
- Actors are **promoted** to full fidelity on demand (player approaches; an
  aggregate process "elects" a mayor → instantiate a real actor) and **demoted**
  back to aggregate when they leave the spotlight, preserving a compact summary.
- **Determinism is preserved** because promotion is a pure function of (seed,
  aggregate state, demand), so the "same" NPC is reconstructed identically.

This is the single most important engineering idea in MythOS. It lets you keep the
"every actor equal" *philosophy* while staying inside a browser's budget. Design it
in from day one — it cannot be bolted on later.

### 3.3 "The engine should know nothing about any universe"

**Right about content, wrong if applied to primitives.** If the engine truly knows
*nothing*, it can't simulate anything — you'd push all behavior into pack data and
reinvent a game engine in JSON (the *inner-platform effect*). Draw the line
precisely:

- **Engine is agnostic about**: setting, lore, species names, item lists,
  geography, tech labels, which modules are on.
- **Engine is opinionated about**: the *primitives* of simulation — that there are
  Actors with needs and goals; Relationships with valence; Factions with members
  and territory; a Time/Tick model; an Economy abstraction of value flow; an Event
  log. These are universe-neutral but **not empty** — they encode a worldview that
  any setting maps onto. Your `CLAUDE.md` core-concepts list (Actor, Species,
  Culture, Settlement, Political Entity, …) *is* that opinionated ontology. Good.
  Commit to it as engine-level; don't try to make *it* data-driven too.

### 3.4 "Everything should be data-driven"

**The most dangerous slogan in the doc.** There is a spectrum:

```
content data → tunables/config → declarative rules → scripting → full VM
   (cheap, safe) ─────────────────────────────────────▶ (expensive, becomes a language)
```

- **Do** data-drive: content (species/items/names/dialogue), numeric tunables
  (tax rates, drift speeds, combat coefficients), and *composition* (which modules,
  which content tables) — declaratively.
- **Don't** (in v1–v2) build a **rules scripting language** to express *system
  behavior* as data. You will spend years building a worse Lua, with no debugger,
  no types, and non-deterministic edge cases. Keep **systems in TypeScript** with
  **declared extension points** (events, hooks, strategy interfaces, content-driven
  modifiers). If a real modding-script need emerges later, embed an existing
  sandboxed interpreter — don't invent one.
- **The `RaceSuffix` pattern is the sweet spot**: data that carries *both stats and
  description*, applied by generic engine code. Generalize *that* (a universal
  "modifier/trait" system) rather than generalizing toward a scripting VM.

### 3.5 "Deterministic simulation" — endorsed, but cost it honestly

Determinism in JS/TS is achievable but demands discipline you must adopt on day 1:
- A single **injected RNG** (e.g. seeded xorshift/PCG); never `Math.random`.
- **No wall-clock** in sim; time is the tick counter.
- **Deterministic iteration**: iterate entities by sorted stable ID, not by hash-
  map order or float keys.
- **Float caution**: prefer integers/fixed-point for anything compared across
  platforms; if you ever go multiplayer, float drift across browsers is real.
- **Determinism tests in CI**: run a world for N ticks twice, assert identical
  state hash; run from snapshot vs. from replay, assert identical. Treat a
  determinism break as a build-breaking bug.

### 3.6 Browser / React / IndexedDB / TS — mostly endorsed, three caveats

1. **Sim off the main thread (Web Worker).** Non-negotiable; otherwise a big tick
   freezes the UI.
2. **Don't let React's object model leak into the sim.** The sim owns plain data;
   React renders snapshots. No shared class instances.
3. **IndexedDB is fine for saves**, but store **structured snapshots + an event-log
   object store**, not a single giant blob (don't repeat Warsim's monolith). Plan
   for compression and chunking; worlds will get large.

### 3.7 Scope — the existential risk

The vision spans *any setting, any tech level, magic + space + naval + cyber +
genetics modules, multiplayer, cloud, modding SDK*. **That is 5–10 years of work.**
The dominant failure mode for this kind of project is **boiling the ocean and
shipping nothing playable**. The architecture must let you build a *thin vertical
slice* (one small pack, three systems) that is genuinely fun, then widen. The
roadmap (`06`) is built around that discipline. If you internalize one sentence
from this whole dossier: **make one tiny world feel alive before you make the
engine universal.**

---

## 4. Summary of recommendations

| Your instinct | Verdict | Engineering form it should take |
|---------------|---------|--------------------------------|
| Sim first, emergent | ✅ keep | + explainable causal history log |
| World before player | ✅ keep | + meaningful perturbation, not centrality |
| One model for all actors | ✅ model / ⚠️ cost | Uniform components, **LOD/aggregate fidelity** |
| Player == NPC, no special paths | ✅ intent | One rule set, **two intent producers** |
| Engine knows no universe | ✅ content / ⚠️ primitives | Opinionated **core ontology**, agnostic content |
| Everything is data | ⚠️ partial | Data for content+tunables; **systems in TS** |
| Deterministic & offline | ✅ keep | Injected RNG, no wall-clock, **CI determinism tests** |
| Browser/React/IndexedDB/TS | ✅ keep | **Worker-isolated sim**, snapshot saves, ECS |
| Magic/space/cyber/MP/cloud | ✅ later | **Module system now, content later, MP much later** |
| Universe Packs = data | ✅✅ keep | Generalize beyond races to **all content + module selection** |
