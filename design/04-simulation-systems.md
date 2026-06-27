# Part 2 — MythOS: Simulation Systems

How the world *moves*. This defines the tick model, the scheduler, Level-of-Detail,
and the core systems — generalizing Warsim's subsystems into universe-neutral form.

---

## 1. Time & the tick model

### 1.1 Multi-rate ticks (improving on Warsim's single yearly tick)

Warsim's one-year tick is elegantly simple but too coarse to "live as a
blacksmith." MythOS uses a **hierarchical clock** with systems registered at the
rate that suits them — exactly the frequencies sketched in `CLAUDE.md`:

```
base unit = 1 hour (or 1 day, configurable per universe)
  Immediate  : player/active-actor actions          (event-driven, not ticked)
  Hourly     : local active-actor needs & activities
  Daily      : settlement economy, local markets
  Weekly     : trade flows, travel resolution
  Monthly    : faction politics, diplomacy drift
  Yearly     : demographics, aging, births/deaths, history consolidation
```

- A **tick** advances the base clock; the scheduler fires each cadence when its
  period elapses. So "1 year" still happens — it's just composed of many smaller
  steps, and most actors are only touched at coarse cadences.
- **Time-scaling** is a UI concern: the player can fast-forward (run many base
  ticks, skipping the micro layer for off-screen actors). The sim never depends on
  *wall-clock*; "speed" = how many base ticks per real second the UI requests.

### 1.2 Determinism in scheduling

- Cadences fire in a **fixed, declared order** each tick (e.g. needs → economy →
  movement → social → politics → events → history). Stable order = reproducible
  results.
- Within a system, entities are processed in **sorted EntityId order**, never hash-
  map order.

---

## 2. The Scheduler & Level-of-Detail (the heart of the engine)

This is the mechanism that makes "every actor equal" affordable (`02 §3.2`).

### 2.1 Fidelity tiers

| Tier | Who | Simulated how | Cost |
|------|-----|---------------|------|
| **Full** | Active set: player, nearby actors, politically pivotal figures | Per-actor, every relevant cadence | high |
| **Summary** | Named-but-offscreen (a known rival in another city) | Coarsely, monthly/yearly, cheap heuristics | low |
| **Aggregate** | The masses (a city's 40,000 residents) | Statistical rates on the macro layer; no individuals | ~flat |

### 2.2 Promotion / demotion (deterministic materialization)

- **Promotion:** when an aggregate must yield an individual (player meets a guard;
  a town "needs" a mayor; a war needs a general), the engine **materializes** a
  full actor as a *pure function of (seed, macro-state, request key)*. Same inputs →
  same NPC, every time, on any machine. No stored individual needed until promoted.
- **Demotion:** when a full actor leaves the spotlight, fold their salient facts
  back into the macro layer + a compact `Summary` component; drop the expensive
  components. If re-promoted, reconstruct deterministically + apply the summary.
- **Persistence rule:** actors the player has *interacted with* or who hold *named
  offices* are "sticky" — they keep identity (stored), never silently regenerated.

### 2.3 Active-set selection

The active set is recomputed each coarse tick from: proximity to player, political
significance (faction leaders, parties to active conflicts), recent perturbation
(an event just touched them), and player "watchlist" (anyone the player is
tracking). Everything else stays aggregate. This is the budget governor.

---

## 3. Core systems (generalized from Warsim)

Each system is a TS module contributing components + tick logic + content schemas.
All read tunables from the registry; none hardcode balance.

### 3.1 Needs & Goals (Actor AI) — *new vs Warsim*

Warsim NPCs barely have interiority. MythOS gives actors **needs → goals →
intents**:
- `Needs` decay/rise per cadence (hunger, wealth, safety, status, belonging —
  the *set* of needs is data-defined per universe).
- A **utility/GOAP planner** scores candidate goals against needs + traits +
  opportunity, picks one, emits **intents** (the same intent type a player emits).
- Professions, daily routines, ambitions, and crimes all emerge from this loop.
- **This is the system that lets the player "be anyone"** — a farmer actor and a
  king actor run the identical loop with different opportunities.

### 3.2 Demographics & Lifecycle — *aggregate-first*

- Aging, births, marriages, deaths run mostly on the **macro layer** as rates per
  settlement/species/culture (cheap, supports huge populations).
- Full-tier actors get **individual** lifecycle events (this specific person
  marries this specific person), which write back to macro aggregates.
- Inheritance/succession is an event that can promote an heir to full fidelity.

### 3.3 Economy — *deeper than Warsim's gold-flow*

Warsim = single gold pool + policy modifiers. MythOS baseline:
- **Resources & production** per settlement (data-defined resource types; a region
  produces/consumes based on its profession mix and terrain).
- **Local markets** clear supply/demand into **prices** (even a simple price model
  beats Warsim's flat income lines and lets scarcity drive stories).
- **Trade** flows along the **route graph** with distance/risk costs (geography
  matters — the thing Warsim lacked).
- **Wealth** of actors/factions is an abstraction over holdings + income − upkeep.
- Keep it **tunable and optional in depth**: a "light economy" profile for
  universes that don't care; a "deep economy" profile for trade-focused ones.

### 3.4 Factions, Politics & Diplomacy — *generalize the relation matrix*

- Factions are entities with members, territory (regions), government type
  (content), treasury, and a **goals** stack (expand, defend, enrich, convert…).
- **Diplomacy = the typed relationship graph** (`03 §2.3`), driven by drift +
  event perturbations + thresholds → war/alliance/league/vassalage/tribute.
- Government type (data) parameterizes succession, decision-making, and stability —
  so "Khedivate," "Hive," "Federation," "Star Empire" are content, not code.
- **Internal politics:** factions have factions (nobles, parties) → coups, splits,
  secessions (Warsim's rebellions, generalized). Splits/merges are first-class
  events that reterritory and reassign members.

### 3.5 Conflict & Combat — *abstract resolver, optional tactics*

- Baseline: **abstract stochastic resolver** like Warsim — armies are typed-troop
  bags with `power` (from species `ranks`), modified by leaders/terrain/morale;
  resolve to casualties + outcome + territory change; emit a `battle` event.
- This single resolver handles thousands of army compositions cheaply.
- Tactical depth (positioning, a battle minigame) is an **optional module**, not a
  core assumption — most universes won't need it.
- **Crime/justice** (the "steal a horse" example in `CLAUDE.md`) is *not* a special
  case: it's the conflict system at actor scale + witnesses (perception) +
  reputation (relationship valence) + memory + law (faction policy). Build the
  *primitives* (perception, memory, reputation, law) and theft handles itself.

### 3.6 Events & Narrative — *structured, then rendered*

- **Event templates** (content) define triggers, eligible subjects, effects, and a
  **text template** for rendering. The engine fires them when conditions hold,
  binds live entities, applies effects, and appends a structured `WorldEvent`.
- **Random events** = event templates with stochastic triggers; **emergent events**
  = templates triggered by state thresholds (relation < −60 → war). Same machinery.
- **Narrative rendering** turns events into prose *in the view* via templates +
  the entity registry (localizable, queryable, no stored-prose fragility).
- **Causality:** every event records `causes` → the player can walk the story
  graph. This is the legibility pillar made concrete.

### 3.7 Memory, Perception & Reputation — *the substrate for emergence*

The systems that make Warsim-style stories *deeper*:
- **Perception:** actors observe events within range (witnesses to a theft).
- **Memory:** bounded episodic memory of events involving/observed by the actor;
  decays; influences goals and relationship valence.
- **Reputation:** an actor's aggregate standing = function of others' relationship
  edges + faction opinion. Drives prices, job offers, guard behavior, dialogue.
- These four (Needs, Memory, Perception, Reputation) are the **emergence engine** —
  build them well and most "interesting stories" arise without scripting.

### 3.8 Dialogue & Flavor — *port Warsim's context-tagged pools*

- **Context-tagged content pools** (the `TavernTalk` pattern, generalized):
  selection = filter-by-context(location, speaker traits, faction, current events)
  then weighted random draw, seeded.
- Optional **AI augmentation** (offline-by-default, never required): a pack may opt
  into AI-generated dialogue/flavor, but the sim and base content must be fully
  playable with zero network (`CLAUDE.md` AI philosophy — endorsed).

---

## 4. System contract (how modules plug in)

Every system declares:

```ts
interface System {
  id: string;
  cadence: Cadence;                 // hourly | daily | … | event-driven
  reads: ComponentType[];           // for scheduling & parallelism analysis
  writes: ComponentType[];
  order: number;                    // deterministic ordering within a cadence
  tick(world: WorldView, rng: Rng, tunables: Tunables): void;
  // event hooks for cross-system reactions:
  on?: Record<EventType, (e: WorldEvent, world: WorldView, rng: Rng) => void>;
}
```

- Systems communicate via **components + events**, never by calling each other —
  this keeps modules decoupled and the order deterministic.
- The `reads/writes` declarations let the engine *later* parallelize
  non-conflicting systems (e.g. across workers) without changing system code.

---

## 5. Performance posture

- **Aggregate-first:** the default cost is per-*settlement*, not per-*person*.
- **Active set bounded:** full-fidelity actor count has a hard budget; promotion is
  rate-limited.
- **Coarse cadences for far things:** distant factions resolve monthly/yearly.
- **SoA component stores + typed arrays** for hot systems.
- **Worker-isolated**, with a path to **multi-worker** via `reads/writes` analysis.
- **Profile against a target:** e.g. "10 regions, 50k aggregate pop, 300 full
  actors, simulate 100 years in < a few seconds of fast-forward." Set the number,
  test it in CI, and let it gate features. (Avoid premature optimization per
  `CLAUDE.md`, but *measure* from the start.)
