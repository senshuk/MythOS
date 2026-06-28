# MythOS Component Model

**Document type:** Engine constitution — the bridge between the conceptual model and implementation.
**Companion documents:** `11-simulation-ontology.md` (what exists), `12-capabilities.md` (what each type can do), `13-simulation-rules.md` (time, space, systems, rules).
**Status:** Canonical. Changes require explicit revision with justification.

---

## Purpose

The ontology defines *what* kinds of things exist. Capabilities define *what* each type can do. This document defines *how* — the concrete data structures and data flow that implement capabilities in the engine.

Every capability is realized as one or more **components**. A component is a typed data payload attached to an entity ID. The simulation is a set of component maps read and written by systems on a schedule.

This document answers:
- What components exist?
- Which entity types can have each component?
- Which systems read each component?
- Which systems write each component?
- How do universe packs add new components?

---

## What a Component Is

A **component** is a record of data owned by an entity, keyed by that entity's ID in a global map.

```
ComponentMap<T> = Map<EntityId, T>
```

Components are **passive**. They hold data. They do not contain logic. Systems contain logic. A `Needs` component does not know it is decaying — the Needs system reads it, computes the decay, and writes the result back.

Components are **independent**. The `Faith` component knows nothing about the `Reputation` component. The Religion system reads both and writes to both. Dependencies run through systems, not through components.

Components are **optional per entity**. Not every Actor has every component. An Actor without Faith has no entry in the faith map. Systems check for component presence before operating on an entity.

Components are **owned by entities but written only by systems**. No entity reads its own components and mutates them directly. All mutation goes through a system that is scheduled, deterministic, and logged.

---

## The Read/Write Contract

Every component must declare:
- **Readers:** systems that read this component to make decisions or produce output
- **Writers:** systems that write this component (create, update, or delete)

A system that reads a component it did not declare as a dependency produces undefined behavior. A system that writes a component it did not declare as a writer produces a consistency violation.

This contract is enforced through code review and architecture discipline, not at runtime. It is documented here to make the dependency graph legible.

**Write ordering matters for determinism.** On any given tick, systems run in a fixed sequence. A system that reads a component modified earlier in the same tick sees the updated value. This is intentional and must be consistent across runs. Any change to system execution order is a breaking change that requires a save version bump.

---

## Component Catalog

Components are grouped by the entity type they primarily belong to. Some components appear on multiple entity types.

---

### Actor Components

#### `Identity`

```typescript
interface Identity {
  given: string        // personal name
  family: string       // family/clan/house name
  sex: string          // open string; 'm', 'f', or species-defined
  speciesId: string    // references Species pack data
}
```

**Capability realized:** Identity
**Entity types:** Actor
**Readers:** Lifecycle, Narrative (name rendering), LOD (demotion/promotion), Succession (heir selection)
**Writers:** World (on createActor — immutable after creation)
**Pack extension:** `sex` and `speciesId` are open strings; packs define valid values. The engine does not validate against a closed enum.

---

#### `Lifecycle`

```typescript
interface Lifecycle {
  bornTick: number
  ageYears: number      // display age (computed from bornTick, updated yearly)
  alive: boolean
  deathTick?: number    // set when actor dies; undefined while living
}
```

**Capability realized:** History (lifespan), Destruction (death)
**Entity types:** Actor
**Readers:** Lifecycle system (death probability), Needs system (famine check), Decision system (adult filter), Succession (maturity check), Narrative (age phrasing)
**Writers:** Lifecycle system (ageYears yearly; alive and deathTick on death)
**Note:** `bornTick` is set at creation and never changes. `ageYears` is a derived display value, not authoritative — the authoritative age is `(currentTick - bornTick) / ticksPerYear`.

---

#### `Needs`

```typescript
type Needs = Record<NeedKey, number>   // 0..1000 scale; NeedKey is pack-defined
```

**Capability realized:** Needs
**Entity types:** Actor
**Readers:** Needs system (decay check, famine trigger), Aspiration system (urgency evaluation), Narrative (need-state phrasing)
**Writers:** Needs system (daily decay), Resolution system (refill on work/socialize/rest intents)
**Pack extension:** `NeedKey` is fully pack-defined. The engine iterates whatever keys are present. Adding a new need type requires only pack data — no engine code change.
**Invariant:** All values are clamped to [0, 1000] after every write. No value outside this range is valid.

---

#### `Personality`

```typescript
interface PersonalityComponent {
  values: Record<ValueAxis, number>          // cultural value alignment scores (-100..100)
  temperament: Record<TemperamentAxis, number>  // individual behavioral profile (-100..100)
}
```

**Capability realized:** Agency (personality shapes aspirations and decisions)
**Entity types:** Actor
**Readers:** Aspiration system (value/temperament weighting), Faction system (axis scoring), Heir selection (trait weighting), Narrative (nature phrasing: "honourable, warlike")
**Writers:** World (on createActor — **immutable after creation**)
**Pack extension:** `ValueAxis` and `TemperamentAxis` are pack-defined string enums (e.g., `war`, `tradition`, `honor`, `curiosity`). The engine operates on whatever axes are present.
**Invariant:** Personality is fixed at birth. No system writes to a Personality component after the entity is created. Any system that does so is a bug.

---

#### `Traits`

```typescript
type Traits = string[]   // open string tags; e.g., ['ambitious', 'paranoid', 'gifted']
```

**Capability realized:** Agency (trait-weighted aspiration), History (trait events)
**Entity types:** Actor
**Readers:** Aspiration system (trait-specific aspiration unlocks), Heir selection (ambition scoring), Narrative (trait labeling)
**Writers:** World (on createActor); Lifecycle system (rare trait acquisition events, pack-defined)
**Pack extension:** Trait strings are pack-defined vocabulary. The engine does not validate them. New trait types require only pack data.

---

#### `Profession`

```typescript
type Profession = string   // pack-defined; e.g., 'farmer', 'soldier', 'merchant'
```

**Capability realized:** Needs (profession determines work income), Reputation (profession context in events)
**Entity types:** Actor
**Readers:** Resolution system (work intent income calculation), Narrative (title/role phrasing), Economy (labor supply calculation)
**Writers:** World (on createActor); Resolution system (career change intents, pack-defined)
**Pack extension:** Fully pack-defined. The engine does not enumerate valid professions. Profession income rates are defined in pack data.

---

#### `SocialTies`

```typescript
interface SocialTies {
  spouses: EntityId[]     // current spouses (count limited by pack marriage rules)
  parents: EntityId[]     // genetic/legal parents (up to 2 for sexual species, 1 for asexual)
  children: EntityId[]    // all offspring
}
```

**Capability realized:** Relationships (kinship bonds), Membership (family as proto-organization)
**Entity types:** Actor
**Readers:** Lifecycle (birth: identifies bearer's spouse), Resolution (court intent: marriage eligibility), Succession (heir: family line), Narrative (relationship prose)
**Writers:** Resolution system (marriage: adds to spouses), Lifecycle system (birth: adds to children/parents)
**Invariant:** The engine does not enforce monogamy. `spouses.length` is validated against the pack marriage rule on each `court` resolution.

---

#### `Memory`

```typescript
type Memory = EventId[]   // bounded buffer; newest events retained when over cap
```

**Capability realized:** Memory
**Entity types:** Actor (bounded buffer), Organization (future)
**Readers:** Aspiration system (recent experience weighting), Director system (recent drama signal)
**Writers:** Event emission system (appends on every event where this actor is a subject); Compaction system (prunes oldest below cap)
**Cap:** Pack-defined. Default: 48 recent event IDs. When the cap is exceeded, lowest-interest events are pruned first, then oldest.

---

#### `Reputation`

```typescript
interface Reputation {
  marks: ReputeMark[]
}

interface ReputeMark {
  kind: string            // pack-defined; e.g., 'shed blood', 'a kindness'
  value: number           // standing delta (scaled by √witnesses at write time)
  sinceTick: number
  expiresTick?: number    // undefined = permanent
  witnesses: number       // how many observed this deed
  cause?: EventId         // the event that produced this mark
}
```

**Capability realized:** Reputation
**Entity types:** Actor, Organization (future), Location (future), Object (future), Vehicle (future)
**Readers:** Heir selection (standing score input), Narrative (standing phrasing, mark explanation), UI Inspector (reputation breakdown)
**Writers:** Reputation system (on qualifying events); Opinion system (standing affects relationship weights)
**Standing computation:** `sum(mark.value for active marks)`. Not diminishing-returns — public reputation is more stable than private opinion.
**Pack extension:** Mark kinds are pack-defined. The engine provides the mark structure and standing computation; packs define what deeds exist and their base values, durations, and witness propagation behavior.

---

#### `Relationships`

```typescript
// Stored as a nested map: Map<EntityId, Map<EntityId, RelEdge>>
// RelEdge is shared between both directions (A→B and B→A point to the same object)

interface RelEdge {
  thoughts: Thought[]
  sinceTick: number
  flags: RelFlags         // friend?, rival?, feud?, spouse?
}

interface Thought {
  kind: ThoughtKind       // pack-defined; e.g., 'bonded', 'slighted', 'faithBond'
  value: number
  sinceTick: number
  expiresTick?: number
  cause?: EventId
}
```

**Capability realized:** Relationships
**Entity types:** Actor (primary), Organization (future)
**Readers:** Aspiration system (partner/socialize targeting), Decision system (partner selection), Narrative (relationship prose, opinion explanation), UI Inspector (relationship list)
**Writers:** Social system (addThought on socialize/brawl/court resolution), Religion system (faithBond/faithFriction thoughts), Faction system (factionRivalry thoughts)
**Opinion computation:** Diminishing-returns sum of active thoughts grouped by kind. Newer thoughts count fully; older ones are multiplied by `spec.mult^i`.
**Pack extension:** ThoughtKind strings and their specs (base value, duration, stack limit, decay multiplier, display label) are pack data.

---

#### `Faith`

```typescript
type Faith = string   // deity ID (pack-defined) or '' (faithless)
```

**Capability realized:** Relationships (faith bonds between actors), Reputation (religious standing events)
**Entity types:** Actor
**Readers:** Religion system (bond/friction sampling, conversion eligibility), Faction system (faith as a value axis input), Narrative (faith phrasing, deity references)
**Writers:** Religion system (conversion: sets to patron deity ID; apostasy: sets to '')
**Pack extension:** Deity IDs are pack-defined. The engine does not enumerate valid faiths.

---

#### `Exile`

```typescript
interface ExileRecord {
  fromSettlementId: LocationId
  axis: string           // the value axis that drove the civil war
  factionName: string    // the faction the exile belonged to
  year: number           // year of exile
}
```

**Capability realized:** History (exile as a permanent life event), Relationships (ongoing exile affects bonds)
**Entity types:** Actor
**Readers:** Faction system (exile status affects succession eligibility), Narrative (exile phrasing), UI Inspector (exile status display)
**Writers:** Civil war system (on exile resolution event)
**Note:** The presence of an ExileRecord does not prevent an actor from being the subject of future events. It is a historical fact, not a hard restriction on simulation participation. Return-from-exile is a future system that would clear or modify this record.

---

#### `Fidelity`

```typescript
type Fidelity = 'full' | 'summary'
```

**Capability realized:** (LOD tier tracking — not a capability but a simulation management concern)
**Entity types:** Actor
**Readers:** All systems (systems skip non-full actors for expensive operations), LOD system (promotion/demotion logic)
**Writers:** LOD system (on focus change: promotes to full, demotes to summary)
**Note:** Fidelity is an engine concern, not a pack concern. Pack systems should never read or write fidelity directly — they use the `fullActors()` and `summaryActors()` query helpers.

---

### Location Components

#### `LocationMeta`

```typescript
interface LocationMeta {
  name: string
  nameMeaning?: string       // etymology from philology system
  foundedYear: number
  ruinedYear?: number
  cultureId: string          // dominant culture
  governmentId: string       // governance model
  capacity: number           // carrying capacity multiplier
  detailed: boolean          // true = full per-actor simulation active
  epoch: number              // bumped on each demotion (for RNG re-generation)
  rngState: number           // locality-specific RNG cursor
}
```

**Capability realized:** Identity, History (founding/ruin), Containment (capacity)
**Entity types:** Location
**Readers:** All systems (name resolution, culture lookups), Narrative (settlement prose)
**Writers:** World (on createLocation), Lifecycle system (ruinedYear on population collapse)

---

#### `MacroPop`

```typescript
interface MacroPop {
  population: number
  children: number       // cohort: age 0..maturity
  adults: number         // cohort: age maturity..elderhood
  elders: number         // cohort: age elderhood..lifespan
  stability: number      // -100..100
  dominantSpecies: string
}
```

**Capability realized:** History (demographic record), Containment (population capacity)
**Entity types:** Location
**Readers:** Economy system (labor supply, consumption), LOD system (promotion population target), Director system (world population signal), Geography system (raid/war power calculation), Narrative (population phrasing)
**Writers:** LOD system (macroYearly: logistic growth, cohort aging, famine damage)
**Note:** MacroPop is the aggregate-fidelity population representation. When a Location is detailed, individual Actors represent the population; MacroPop is updated to reflect them. When a Location is demoted, individual Actors are freed and MacroPop carries the population forward.

---

#### `Economy`

```typescript
interface Economy {
  specialization: string                    // e.g., 'farming', 'mining', 'crafting'
  production: Record<ResourceKey, number>   // what this location produces per year
  stock: Record<ResourceKey, number>        // current inventory
  price: Record<ResourceKey, number>        // current market price
  wealth: number                            // accumulated economic surplus
}
```

**Capability realized:** (Economic participation — not a named capability but implied by Location's role in systems)
**Entity types:** Location
**Readers:** Economy system (production, trade, price update), Needs system (famine: subsistence stock check), Director system (wealth signal), Narrative (prosperity/hardship phrasing), UI (price display)
**Writers:** Economy system (production, stock, price, wealth yearly), Geography system (raid toll on stock), LOD system (famine damage on stock)
**Pack extension:** `ResourceKey` strings and `specialization` strings are pack-defined. The engine iterates whatever keys are present.

---

#### `FactionSplit`

```typescript
interface FactionSplit {
  axis: ValueAxis             // the most-divided value axis
  highName: string            // name of the pro-axis faction
  lowName: string             // name of the anti-axis faction
  highLeaderId?: EntityId
  lowLeaderId?: EntityId
  axisMean: number            // cached mean for O(1) pole assignment
}
```

**Capability realized:** (Faction simulation — implemented as a Location component for the focused settlement)
**Entity types:** Location (focused settlement only in current implementation; future: all Locations)
**Readers:** Faction system (rivalry thought generation), Succession system (contested succession detection), Civil war system (war resolution), Narrative (faction prose), UI (faction display)
**Writers:** Faction system (detectSplit yearly)

---

#### `CurrentRuler`

```typescript
type CurrentRuler = FigureId | undefined
```

**Capability realized:** History (leadership record), Relationships (ruler-as-notable for LOD)
**Entity types:** Location
**Readers:** Succession system (reign-end check), Narrative (ruler phrasing), UI (ruler display)
**Writers:** Succession system (figuresYearly: on succession event)

---

#### `CivilWarClock`

```typescript
type CivilWarClock = number | undefined   // tick when contested succession began; undefined if no contest
```

**Capability realized:** History (faction conflict record)
**Entity types:** Location
**Readers:** Civil war system (grace period check)
**Writers:** Faction system (set on contested succession), Civil war system (clear on resolution)

---

### World-Level Components

These are not per-entity maps — they are single instances on the World object.

#### `DirectorState`

```typescript
interface DirectorState {
  personality: string    // 'balanced' | 'grim' | 'gentle' | 'chaotic'
  tension: number        // 0..200; accumulates during calm, released by incidents
  incidents: number      // total incidents fired
  lastIncidentYear: number
}
```

**Capability realized:** (AI Director — not a capability but a world-level system state)
**Readers:** Director system (tension/trigger check), Narrative (mood phrasing), UI (tension display)
**Writers:** Director system (directorYearly)

#### `Substrate`

```typescript
interface Substrate {
  // 2D surface or starfield; deterministically generated from world seed
  // Not serialized — reconstructed from seed on load
  siteOf(pos: Vec2): TerrainSite
  adjacencyOf(pos: Vec2): Vec2[]
}
```

**Capability realized:** Space (world model)
**Readers:** Economy system (terrain yields), Geography system (adjacency), LOD (settlement placement)
**Writers:** World initialization (generated from seed; never mutated after creation)
**Invariant:** Substrate is always regenerated from the world seed. It is never serialized.

---

## Component Lifecycle

### Creation

Components are created when an entity is created. `createActor(world, params)` initializes all required Actor components in a single call. `createLocation(world, params)` initializes all Location components. No system creates components piecemeal.

**Required vs. optional components:** Some components are always created with the entity (Identity, Lifecycle for Actors; LocationMeta, MacroPop for Locations). Some are created conditionally (Faith is only added when an Actor is in a culture with a patron deity; Exile is only added if the civil war system fires).

### Mutation

Systems read components, compute new values, and write the result back. No component mutates itself. Every mutation is observable, deterministic, and occurs in a fixed system execution order.

**Immutable components.** Some components are designated immutable after creation (Personality, bornTick within Lifecycle). Systems must not write to these. Immutability is a design invariant enforced by discipline, not runtime protection.

### Archival

When an Actor dies or a Location is ruined, the entity moves from the active index to the archive. Its components are retained for history queries and narrative rendering. Archived components are never mutated — they represent the entity at the moment of its destruction.

### Demotion (LOD)

When an Actor is demoted from full to summary fidelity, expensive components (Needs, short-term Thoughts below interest threshold) may be pruned to reduce memory. Identity, Personality, Faith, Reputation, and high-interest Relationships are retained. When promoted back to full, fresh Needs and lightweight Thoughts are reconstructed.

---

## System Component Dependencies

The following table documents which systems read and write which components. This is the dependency graph that governs system execution order.

| System | Reads | Writes |
|---|---|---|
| **Needs** | Needs, Lifecycle (alive check), Economy (stock for famine) | Needs |
| **Aspiration** | Needs, Personality, Traits, Memory, Relationships, SocialTies, Faith, Reputation, Fidelity | (produces Intent — not a component) |
| **Decision** | Aspiration output, Fidelity, Lifecycle | (produces Intent queue) |
| **Resolution** | Intent, Needs, SocialTies, Relationships, Fidelity, Profession | SocialTies, Needs, Relationships (thoughts), Reputation (marks) |
| **Lifecycle** | Lifecycle, Identity, SocialTies, Species pack data | Lifecycle, SocialTies (births/deaths) |
| **Religion** | Faith, Relationships, LocationMeta (cultureId) | Faith, Relationships (thoughts), [emits events] |
| **Faction** | Personality, Fidelity, FactionSplit, LocationMeta | FactionSplit, Relationships (thoughts), CivilWarClock |
| **Civil War** | FactionSplit, CivilWarClock, Personality, Fidelity | CivilWarClock, Exile, [emits events] |
| **MacroPop** | MacroPop, Economy | MacroPop, Economy (stock) |
| **Economy** | Economy, MacroPop, Substrate, LocationMeta (specialization) | Economy |
| **Geography** | LocationMeta, MacroPop, Economy, Substrate, edges | MacroPop (raid toll), edges (relation drift) |
| **Succession** | CurrentRuler, FactionSplit, Fidelity, Traits, Reputation, LocationMeta | CurrentRuler, [emits events] |
| **Chronicle** | Events (recent), Memory | Chronicle, Annals |
| **Director** | DirectorState, Chronicle (interest), MacroPop | DirectorState, [emits events] |
| **LOD** | LocationMeta (detailed), Fidelity, MacroPop | Fidelity, MacroPop, [creates/removes actors] |
| **Narrative** | All components (read-only — renders snapshots) | Nothing |
| **Snapshot** | All components (read-only — produces UI snapshot) | Nothing |

---

## How Universe Packs Add Components

Universe packs extend the component set by defining new component types in pack data. The engine supports new components through a generic extension mechanism.

**Rule: New components must be declared before use.** A pack that adds a `Magic` component must declare:
- The component's schema (TypeScript interface)
- Which entity types can have it
- Which system(s) read and write it
- How it is initialized (on entity creation, or lazily on first write)
- How it is serialized (for save file compatibility)

**Rule: Pack components cannot modify the read/write contract of engine components.** A pack can add a new component that a new system reads. It cannot make the existing Needs system also write to the new component. Cross-component dependencies between engine systems and pack components must go through pack-defined systems, not through modification of engine systems.

**Rule: Pack components are versioned separately from engine components.** A save file records which pack version was used. Pack component schema changes require migration support within the pack, not engine-level migration.

### Examples of Pack-Defined Components

**Magic system:**

```typescript
// Pack component: MagicAffinity
interface MagicAffinity {
  talent: number         // 0..100 innate magical ability
  school: string         // e.g., 'fire', 'necromancy', 'psionic'
  mana: number           // current mana reserve (if pack uses mana model)
}
// Added to: Actor
// System: Magic system reads/writes on each tick
```

**Health system (disease/combat):**

```typescript
// Pack component: Health
interface Health {
  hp: number             // current hit points
  maxHp: number          // maximum hit points
  conditions: string[]   // active conditions: 'infected', 'wounded', 'starving'
}
// Added to: Actor
// System: Disease system reads/writes; Combat system writes
```

**Technology system:**

```typescript
// Pack component: TechLevel
interface TechLevel {
  era: string            // e.g., 'iron_age', 'industrial', 'spacefaring'
  knownTechs: string[]   // specific technologies unlocked
}
// Added to: Location
// System: Technology system reads/writes yearly
```

---

## The Component Model and the Phase Roadmap

As new phases are implemented, new components will be introduced. The following are anticipated but not yet implemented:

### Phase 1 — Location Abstraction

| New component | Purpose |
|---|---|
| `LocationType: string` | Pack-defined type label (city, dungeon, starship, etc.) |
| `Mobility: 'fixed' \| 'mobile'` | Distinguishes fixed Locations from Vehicles |
| `ParentLocationId?: LocationId` | Enables Location nesting (the world hierarchy) |
| `WorldPosition` | Coordinates or graph node identifier in the world model |

### Phase 2 — Organizations

| New component | Purpose |
|---|---|
| `OrgIdentity` | Name, founding event, dissolution event |
| `Governance` | Governance model ID, current leader, succession rule |
| `OrgMembership` | Member list with roles |
| `OrgGoals` | Current organizational aspirations and priorities |
| `OrgResources` | Organizational treasury (resources owned) |
| `OrgReputation` | Reputation marks (same structure as Actor Reputation) |
| `OrgRelationships` | Relationship graph to other Organizations |
| `OrgSeat?: LocationId` | Primary location (headquarters, throne, etc.) |

### Phase 3 — Objects with History

| New component | Purpose |
|---|---|
| `ObjectIdentity` | Name, creator, creation event |
| `ObjectOwnership` | Current owner + full ownership history |
| `ObjectLocation` | Where the object is (carrier entity or Location ID) |
| `ObjectHistory` | Timeline of events this object participated in |
| `ObjectReputation` | Fame/infamy marks (same structure as Actor Reputation) |
| `ObjectCondition` | Wear/damage state (pack-defined) |

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-28 | Initial component model — catalogs all current engine components with read/write contracts; defines component lifecycle (creation, mutation, archival, LOD demotion); introduces system dependency table; specifies pack extension rules; previews Phase 1–3 anticipated components |
