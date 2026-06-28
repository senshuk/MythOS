# MythOS Simulation Rules

**Document type:** Engine constitution — time, space, systems, rules, invariants, and universe extension contract.
**Companion documents:** `11-simulation-ontology.md` (what exists), `12-capabilities.md` (what each type can do).
**Status:** Canonical. Changes require explicit revision with justification.

---

## Purpose

This document defines the framework within which all simulation entities operate:

- **Time** — how the engine measures and advances time
- **Space** — how positions, distances, adjacency, and movement work
- **Systems** — what mutates entities (distinct from entities themselves)
- **Rules** — universe-specific constraints that define what is possible
- **Invariants** — absolute constraints that must hold in any valid simulation state
- **Universe Extension Contract** — what universe packs can and cannot change

---

## Time

### The Tick

The fundamental unit of simulation time is the **tick**. One tick represents one real-world unit of simulated time.

**The engine does not know what a tick means in narrative terms.** That is the universe pack's concern. The engine knows only that ticks are monotonically increasing integers. Every event, thought, mark, and record is timestamped in ticks.

**Universe packs define tick duration.** Examples:
- Fantasy pack: 1 tick = 1 day
- Historical pack: 1 tick = 1 day
- Space opera pack: 1 tick = 1 standard day (with interstellar travel measured in weeks of ticks)
- Strategy pack: 1 tick = 1 turn (abstract, not calendar-based)

### The Calendar

A **Calendar** is a universe pack's definition of how ticks map to human-readable time concepts.

**Calendar components (all pack-defined):**
- `ticksPerDay: number` — how many ticks constitute one calendar day
- `daysPerWeek: number`
- `daysPerMonth: number` (may vary by month — packs define month lengths)
- `months: MonthDef[]` — names, lengths, seasonal associations
- `daysPerYear: number` — computed from month definitions
- `era: EraCalendar[]` — named periods (Age of Heroes, Imperial Period, Post-Collapse), each with a start tick and a name
- `specialDays: SpecialDayDef[]` — pack-defined significant days (festivals, holy days)

**Multiple calendar systems may coexist.** A universe pack may define multiple calendars used by different cultures. The engine tracks time in ticks. Each calendar is a lens through which ticks are rendered as human-readable dates.

**Example calendar definitions:**

```
// Fantasy calendar
calendar = {
  ticksPerDay: 1,
  daysPerYear: 365,
  months: [
    { name: "Frostmonth", days: 31 },
    { name: "Seedmonth", days: 28 },
    ...
  ]
}

// Science fiction stardate calendar
calendar = {
  ticksPerDay: 1,
  format: "stardate",
  stardateEpoch: 2323,
  stardateScale: 1000  // 1000 stardates per year
}

// Abstract turn-based calendar
calendar = {
  ticksPerDay: 1,
  daysPerYear: 52,  // 52 turns per year
  months: [
    { name: "Quarter 1", days: 13 },
    ...
  ]
}
```

### Simulation Frequency

The engine simulates at multiple frequencies for efficiency. The exact frequencies are determined by the engine's LOD system and scheduler, but the principle is:

- **Tick-level:** Immediate state changes, player inputs, decay
- **Period-level (pack-defined short cycle):** Social decisions, local economic transactions
- **Year-level (pack-defined long cycle):** Demographic change, political succession, macro history

Packs define the names and durations of these cycles; the engine provides the scheduling framework.

---

## Space

### The World Model

Every simulation has a **World Model** — the geometric and topological description of where things are and how they connect. The World Model is pack-defined. The engine provides the spatial query and movement framework.

**Three supported world model types:**

**1. Graph model (recommended for most settings)**
- Locations are nodes in an undirected graph.
- Edges represent adjacency (two Locations that can directly interact or travel between).
- Distance is edge weight (travel time, cost, or abstract distance).
- No coordinate system required. Suitable for: fantasy kingdoms, space sector maps, dungeon networks, political maps.

**2. 2D coordinate model**
- Locations have (x, y) positions on a surface.
- Adjacency is proximity-based (within range threshold) plus explicit connections.
- Distance is Euclidean or pack-defined metric.
- Suitable for: terrestrial worlds, planetary maps, hex-grid settings.

**3. 3D coordinate model**
- Locations have (x, y, z) positions.
- Suitable for: space settings with true three-dimensional movement.

**Hybrid models are valid.** A universe can have a 2D surface model for the planetary layer, with a graph model for the interstellar layer above it and a nested graph for dungeon layouts within it. The engine supports hierarchy across model types.

### Adjacency

Two Locations are **adjacent** if they share an edge in the graph model, or are within adjacency range in a coordinate model.

**Adjacency is pack-defined per location type.** Two cities are adjacent if connected by a road, river, or proximity. Two star systems are adjacent if connected by a hyperspace lane. Two rooms are adjacent if connected by a door.

**Adjacency is not the same as containment.** A room inside a building is contained by the building. Two rooms connected by a corridor are adjacent to each other. Containment and adjacency are independent relationships.

**Adjacency edges have attributes:**
- `distance: number` — travel cost or time
- `relation: number` — current diplomatic/commercial relationship between adjacent Locations (-100 to 100)
- `tradeVolume: number` — recent economic activity (decays over time)
- `type: string` — pack-defined edge type (road, river, hyperspace lane, tunnel, etc.)

### Distance

**Distance determines transit time.** When an Actor or Vehicle moves between two Locations, transit time is `distance / speed`. Speed is determined by mode of transport (walking, sailing, warp drive — all pack-defined).

**Distance has social consequences.** Adjacent Locations interact more frequently. Distant Locations trade less, raid less, and are culturally slower to influence each other.

**Distance in graph models** is the shortest-path edge weight. In coordinate models, it is the metric between coordinates (with road/route modifiers applied by the pack).

### Travel

**Travel is an action with duration, not a teleportation.** When an Actor or Vehicle initiates travel from A to B:

1. A `travel_started` event fires.
2. The entity enters transit state (position = "in transit from A to B").
3. Events can occur during transit (pack-defined encounter tables, weather, etc.).
4. On arrival, a `travel_arrived` event fires and the entity's position updates.

**Transit interruption** is possible. A storm can delay a ship. Pirates can intercept a caravan. Mechanical failure can strand a vehicle. These are Events that extend or terminate transit.

**Simultaneous travel by multiple entities** is deterministic. The order in which transit arrivals are resolved on any given tick is fixed (by ID order, or pack-defined priority).

### Regions

A **Region** is an optional spatial concept for grouping Locations without a containment relationship. Regions express geographic identity (the Northern Wastes, the Outer Rim, the Industrial Sector) without asserting that all Locations within them are jurisdictionally or physically nested.

Regions are pack-defined. They are not entity types — they are labels applied to sets of Locations. A Location can belong to multiple Regions.

---

## Systems

**Systems are not entities.** They are engine modules that run on a schedule and mutate entity state. They read from and write to entities. Entities do not own or contain systems.

**The engine provides a system framework.** Universe packs enable, disable, and configure systems. The engine scheduler calls each enabled system at its defined frequency.

### Core Systems (always active)

| System | What it does | Frequency |
|---|---|---|
| **Needs** | Decays Actor needs; checks famine conditions | Tick (daily) |
| **Decision** | Evaluates Actor aspirations, produces intents | Period (weekly) |
| **Resolution** | Applies intents to world state, emits events | Period (weekly) |
| **Lifecycle** | Aging, death probability, births | Year |
| **Macro Population** | Aggregate population dynamics for non-detailed locations | Year |
| **Economy** | Production, stock, prices, trade flows | Year |
| **Geography** | Relation drift, raids, route changes | Year |
| **Chronicle** | History retention and compaction | Year |
| **Director** | Narrative pacing and incident firing | Year |
| **Succession** | Ruler succession and dynasty tracking | Year |

### Optional Systems (enabled by universe packs)

| System | What it does | Required capability |
|---|---|---|
| **Religion** | Faith bonds, conversion, apostasy, schism | Faith component on Actor |
| **Factions** | Value-axis split detection, rivalry, civil war | Personality component on Actor |
| **Disease** | Pathogen spread, morbidity, epidemic events | Health component (pack-defined) |
| **Weather** | Climate state, seasonal effects, disaster events | Climate component on Location |
| **Magic** | Spell effects, magical resource flows, arcane events | Magic component (pack-defined) |
| **Technology** | Research, adoption, obsolescence | Technology component on Location/Organization |
| **Crime** | Law violation, witness chains, enforcement, reputation | Law component (pack-defined) |
| **Naval** | Ship travel, sea trade, maritime warfare | — (Vehicle system extension) |
| **Space Travel** | Interstellar travel, FTL mechanics, orbital mechanics | — (Vehicle system extension) |
| **Genetics** | Hereditary trait inheritance, mutation | Genetics component on Actor |

**Systems interact through entities, not directly.** The Disease system writes to Actor health components. The Economy system reads from Location resource stocks. The Director reads from Chronicle interest scores. Systems are decoupled from each other; they share only the entity state they read and write.

**Systems must be deterministic.** Every system must produce identical output given identical input. Systems that require randomness must use the world's seeded RNG and advance the RNG cursor in a fixed sequence.

---

## Rules

**Rules define what is possible in a universe.** They are the physics of the simulation. They differ across universe packs. The engine enforces rules by checking them before resolving intents and events.

Rules are not entities. They are not systems. They are constraints and enablers that the engine reads before taking action.

### Categories of Rules

**Physical Rules**

Define the constraints of the natural world.

| Rule | Examples across universes |
|---|---|
| Gravity | Standard (all universes), microgravity (space stations), null (pure energy beings) |
| Atmosphere | Breathable, toxic, vacuum — determines what Actor types can be in a Location |
| Traversability | Which terrain/space types are passable by which movement modes |
| Speed limits | Maximum travel speed (light speed for sci-fi, wind speed for nautical) |

**Social Rules**

Define what social structures and transitions are valid.

| Rule | Examples across universes |
|---|---|
| Marriage | Monogamy, polygyny, polyandry, any pair, group marriage, no marriage |
| Inheritance | Primogeniture, ultimogeniture, equal division, merit-based, religious appointment |
| Succession | Hereditary, elected, conquered, divine right, algorithmic (AI-decided) |
| Property | Private ownership, communal, state-owned, personal possession only |
| Citizenship | Who can belong to which Organization, under what conditions |

**Economic Rules**

Define how resources and wealth flow.

| Rule | Examples |
|---|---|
| Currency | Gold standard, barter, energy credits, reputation-as-currency |
| Trade barriers | Tariffs, embargoes, guild monopolies |
| Labor | Free labor, indentured, automated, cooperative |
| Property rights | What can be owned by whom |

**Supernatural/Technological Rules**

Define capabilities that only some universes have.

| Rule | Fantasy | Sci-Fi | Historical | Modern |
|---|---|---|---|---|
| Magic | Common / Rare / Forbidden | Disabled | Disabled | Disabled |
| Warp travel | Disabled | Enabled | Disabled | Disabled |
| Resurrection | Possible (necromancy) | Possible (cloning) | Disabled | Disabled |
| FTL communication | Disabled | Enabled (subspace) | Disabled | Disabled |
| Cybernetics | Disabled | Enabled | Disabled | Limited |
| Psionics | Rare | Varies | Disabled | Disabled |

### How Rules Are Defined

Rules are pack-defined data. They are read by engine systems before resolving intents and events. The engine provides rule-checking hooks; packs provide rule definitions.

**Format (illustrative):**

```
rules:
  marriage:
    type: "any_pair"          # monogamy, polygyny, polyandry, any_pair, group
    minAge: 16                # in years
    requiresConsent: true
    sameSpeciesOnly: false
    
  inheritance:
    type: "primogeniture"     # primogeniture, equal_division, merit, appointed
    legitimacy: true          # only legitimate children inherit
    
  magic:
    enabled: true
    rarity: "rare"            # common, uncommon, rare, forbidden
    systemId: "thaumaturgy"   # which Magic system to activate
    
  warpTravel:
    enabled: false
```

### Rule Enforcement

Rules are enforced in the Intent Resolver. Before resolving an intent, the resolver checks whether the intent is legal under current rules:

- A `court` intent checks marriage rules (age, consent, species, existing spouses).
- A `travel` intent checks traversability rules (can this actor type pass through this terrain?).
- A `magic` intent checks whether magic is enabled and what rarity tier applies.

If an intent violates a rule, it is rejected and an alternative intent is selected (or the actor idles). Rule violations by NPCs are never silently applied — the simulation maintains rule consistency at all times.

---

## Invariants

The following constraints must hold in any valid simulation state. If any invariant is violated, the simulation is in an error state.

**Identity invariants:**
1. No two entities share an ID.
2. Destroyed entities retain their IDs in the archive and they are never reallocated.
3. Every entity with Identity has a creation Event in its history.

**Containment invariants:**
4. Containment is acyclic. No Location contains itself, directly or transitively.
5. Every non-root entity has exactly one spatial parent (or no parent, if it is a top-level entity in the world).

**Ownership invariants:**
6. Ownership is acyclic. No Organization owns itself, directly or transitively.
7. Actors cannot own other Actors unless the universe pack explicitly enables it through a defined pack mechanism.

**Causality invariants:**
8. Event causality is acyclic. No Event is its own ancestor.
9. Every cause Event referenced in a cause list exists in the event archive.

**Time invariants:**
10. Tick is monotonically increasing. It never decreases.
11. Every Event's tick is ≥ the tick of all its cause Events.
12. No Event references a future tick.

**Simulation invariants:**
13. Simulation output is deterministic: identical seed + identical inputs → identical world state at every tick.
14. No simulation system uses `Math.random()` or any non-seeded source of randomness.
15. The serialized save file fully reconstructs the simulation state. No hidden runtime state exists.

**Rule invariants:**
16. No intent is resolved that violates the current universe's active rules.
17. Rules cannot be changed during a running simulation. Rule changes require a world reset or an explicit epoch-transition event.

---

## Universe Extension Contract

This section defines what universe packs can and cannot change in the engine.

### What Packs CAN Define

- **New entity types** — within existing categories. "Starship" is a Location/Vehicle type. "Hive node" is an Actor type. These are pack-defined subtypes of engine-defined categories, not new categories.
- **New Thought kinds** — adding to the vocabulary of Relationships. "Betrayal," "life debt," "ideological kinship" are pack Thoughts.
- **New Reputation mark kinds** — "conquered a holy site," "discovered a new route."
- **New need types** — "sanity," "fuel," "network uptime."
- **New resource types** — "dilithium," "mana," "influence points."
- **New profession types** — "starship captain," "wizard," "corporate lawyer."
- **New government types** — "AI consensus," "corporate board," "theocracy."
- **New aspiration types** — "discover a new system," "found a religion," "become debt-free."
- **New intent types** — "cast spell," "hack system," "negotiate treaty."
- **New event types** — "hyperspace anomaly," "magic surge," "corporate merger."
- **New system configurations** — enabling/disabling optional systems and configuring their parameters.
- **New rules** — defining physics, social norms, and supernatural constraints.
- **New calendar definitions** — naming time units and defining the calendar structure.
- **New world model configurations** — graph structure, coordinate system, adjacency rules.
- **Interest scores** — which events are historically significant and by how much.
- **Capability parameters** — decay rates, thresholds, duration multipliers for any capability.

### What Packs CANNOT Do

- **Introduce new entity categories.** If a proposed concept doesn't fit Actor, Organization, Location, Object, or Vehicle, it must be mapped to the nearest category or the ontology must be formally revised.
- **Add new capabilities to entity types beyond the defined set.** Adding a new capability (e.g., "Quantum Entanglement") requires an ontology revision, not a pack addition.
- **Override invariants.** No pack can enable ID reuse, allow ownership cycles, or introduce non-determinism.
- **Replace engine systems with custom code.** Packs configure systems; they don't replace them. A pack that needs fundamentally different economic behavior must work within the Economy system's extension points or propose a new system module.
- **Remove required capabilities from entity types.** Every Actor must have Identity and Agency. A pack cannot create a non-addressed Actor.
- **Create special cases for specific entities.** The simulation rules are uniform. There is no "player exemption," no "hero exception," no "chosen one override."

### What Requires Ontology Revision

The following changes require a formal revision to `11-simulation-ontology.md`:

- Adding a new top-level entity category (peer to Actor, Organization, Location, Object)
- Adding a new core capability (peer to Identity, Agency, Memory, etc.)
- Changing which entity types can have which capabilities
- Changing any invariant

Ontology revisions must be documented with a justification and a version history entry in all three constitution documents.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-28 | Initial simulation rules document — split from `11-simulation-ontology.md v1.0`; added Time (configurable calendar), Space (three world model types, adjacency, travel), Systems (core and optional, with schedule and interaction rules), Rules (physical/social/economic/supernatural), Invariants (16 constraints), Universe Extension Contract |
