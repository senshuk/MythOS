# MythOS Capability Specifications

**Document type:** Engine constitution — what each simulation entity type can do.
**Companion documents:** `11-simulation-ontology.md` (what exists), `13-simulation-rules.md` (time, space, systems, rules).
**Status:** Canonical. Changes require explicit revision with justification.

---

## Purpose

This document defines every capability a simulation entity can possess. Capabilities are reusable, orthogonal specifications. An entity type's behavior is determined by which capabilities it has, not by inheritance or special-casing.

When a universe pack wants to give a new behavior to an entity type, it does so by configuring capability parameters — not by adding new entity types or engine code.

---

## Capability Reference

The full capability list, with brief descriptions:

| Capability | What it gives an entity |
|---|---|
| **Identity** | A stable, unique ID and a name |
| **Agency** | The ability to form goals and act toward them (Actors only) |
| **Collective Decision Making** | A governance structure that produces organizational decisions (Organizations only) |
| **Memory** | A bounded personal record of past events that influences behavior |
| **Relationships** | Directed opinion bonds to other entities, composed of decaying Thoughts |
| **Reputation** | A public standing visible to other entities, composed of witnessed Marks |
| **Influence** | The power to produce change in the world, independent of reputation |
| **Needs** | Internal states that decay over time and motivate behavior |
| **Ownership** | The ability to hold title over other entities |
| **Membership** | The ability to belong to an Organization |
| **Containment** | The ability to spatially hold other entities |
| **Mobility** | The ability to change position in the world |
| **History** | The accumulation of Events into a personal timeline |
| **Destruction** | The ability to be destroyed, ending active participation while retaining historical record |

---

## Capability-to-Entity Matrix

| | Actor | Organization | Location | Vehicle | Object |
|---|---|---|---|---|---|
| **Identity** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Agency** | ✓ | — | — | — | — |
| **Collective Decision Making** | — | ✓ | — | — | — |
| **Memory** | ✓ | ✓ | — | — | — |
| **Relationships** | ✓ | ✓ | — | — | — |
| **Reputation** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Influence** | ✓ | ✓ | ✓ | — | — |
| **Needs** | ✓ | — | — | — | — |
| **Ownership** | ✓ | ✓ | — | — | — |
| **Membership** | ✓ | ✓ | — | — | — |
| **Containment** | — | — | ✓ | ✓ | optional¹ |
| **Mobility** | ✓ | — | — | ✓ | — |
| **History** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Destruction** | ✓ | ✓ | ✓ | ✓ | ✓ |

1. Objects can contain other Objects (a chest contains coins), but this is shallow containment — it does not make the Object a Location. Entities cannot act inside an Object.

---

## Capability Specifications

---

### Identity

**What it gives:** A stable, unique identifier and a displayable name. The entry point into every other simulation system.

**Required fields:**
- `id: EntityId` — monotonically allocated, never reused, never changed after assignment
- `name: string` — the current displayable name (may change; the ID does not)
- `createdTick: number` — the tick at which this entity came into existence

**Invariants:**
- No two entities ever share an ID, including destroyed entities
- Every entity with Identity must have a creation Event in its history
- Name changes are recorded as Events; the historical record shows former names

**Universe pack configuration:** None. Identity is uniform across all entity types and all universes.

---

### Agency

**What it gives:** The ability to form goals, produce Intents, and take Actions. The engine calls the actor's aspiration evaluation, gets an Intent, and resolves it into world-state changes.

**Applies to:** Actor only.

**Mechanism:**
1. The Aspiration system evaluates the actor's current state (needs, relationships, personality, situation) and selects the active Aspiration.
2. The Aspiration produces an Intent (a serializable, reversible description of what the actor wants to do this tick: `court(targetId)`, `socialize(targetId)`, `work`, `idle`, etc.).
3. The Intent Resolver applies the Intent to the world state and emits Events.

**Distinction from Collective Decision Making:** An Actor's Agency is singular — one entity deciding. Collective Decision Making is plural — a governance structure synthesizing many inputs into one decision.

**Universe pack configuration:**
- Aspiration types (which goals exist and when they apply)
- Intent types (what actions are available)
- Resolve behavior (what each Intent does to world state)

---

### Collective Decision Making

**What it gives:** An Organization a governance structure that synthesizes member values, leadership disposition, and pack-defined rules into organizational goals and decisions.

**Applies to:** Organization only.

**Mechanism:**
The Organization does not decide the way an Actor does. It has a Governance Model (elected, hereditary, council, consensus, etc.) that determines:
- Who leads
- How long leadership lasts
- How succession is resolved
- How collective goals are formed (dominant coalition, leader dictates, vote, etc.)

The engine calls `governance.resolve(organization, world)`, not `organization.decide()`. Governance is a component of an Organization, not an inherent property.

**Governance models are pack-defined.** The engine provides the governance resolution framework. Packs define which governance models exist (democracy, monarchy, theocracy, consortium, hive-mind consensus) and their parameters.

**Universe pack configuration:**
- Governance model types
- Succession rules per governance model
- Coalition-forming behavior
- Organizational goal types (expand, defend, trade, convert, explore, survive)

---

### Memory

**What it gives:** A bounded personal record of past Events that influences the entity's current behavior. Distinct from History (which is the full unlimited archive).

**Applies to:** Actor, Organization.

**Mechanism:**
- A bounded buffer (cap defined by the engine) holds recent Event IDs.
- Events above the interest threshold are retained; events below the threshold age out first.
- When the Actor or Organization makes decisions, it consults its Memory to weight aspirations and intents.

**Memory vs. History:**
- **Memory** is the active window — what the entity currently knows and acts on.
- **History** is the complete archive — every Event the entity ever participated in. History does not influence behavior directly; it is the record.

**Memory is subjective.** Two Actors who witnessed the same Event may remember it differently, depending on their personality and relationship to the other subjects. This is a future capability; current implementation treats Memory as an objective event list.

**Universe pack configuration:**
- Memory buffer size (how many events an Actor or Organization actively holds)
- Memory influence weights (how strongly past events affect current aspirations)

---

### Relationships

**What it gives:** Directed opinion bonds to other entities, composed of typed, decaying Thought objects. The current opinion is computed from the Thought stack, not stored directly.

**Applies to:** Actor (maintains), Organization (maintains). Any entity with Identity can be the *target* of a Relationship.

**Mechanism:**
- A Relationship is a directed edge from entity A to entity B.
- The edge contains a list of Thoughts: `{ kind, value, sinceTick, expiresTick?, cause? }`.
- Opinion = diminishing-returns sum of active Thoughts, grouped by kind.
- The Thought stack is the explanation: "spent good time together (+50), slighted twice (-90), shared faith (+40)."

**Thought kinds are pack-defined.** The engine provides the Thought structure and the computation. Packs define what kinds of thoughts exist, their base values, durations, stack limits, and decay multipliers.

**Thresholds are pack-defined.** The engine does not hardcode "friend at 300" or "feud at -300." Those are default values in the pack fixture. Different universe packs may use different scales.

**Cross-entity Relationships:** A Relationship from an Actor to a Location, or from an Organization to an Actor, is valid. The same Thought system applies. These are less common than Actor→Actor relationships but are used for "loves this city," "reveres this artifact," and "distrusts this guild."

**Universe pack configuration:**
- Thought kinds and their parameters (base value, duration, stack limit, decay multiplier, display label)
- Opinion thresholds (friend, rival, feud, ally, enemy)

---

### Reputation

**What it gives:** A public standing — visible to other entities — composed of witnessed Marks. Reputation reflects what the world knows and says about an entity.

**Applies to:** Actor, Organization, Location, Vehicle, Object.

**Mechanism:**
- A Mark is generated when a notable Event occurs involving this entity.
- Each Mark has: kind, value, sinceTick, expiresTick?, witness count, and a cause Event.
- Mark value scales with witness count: `value × √witnesses`. A deed seen by thousands outweighs one seen by a single person.
- Standing = sum of active Marks (not diminishing-returns — public reputation is more stable than private opinion).

**Reputation is public information.** Any entity that queries another's standing gets the same number. Reputation does not require a prior Relationship. An Actor who has never met a famous Organization still knows its reputation.

**Reputation kinds are pack-defined.** "Shed blood," "protected the weak," "broken an oath," "conquered a city" are pack vocabulary. The engine provides the Mark structure and the standing computation.

**Universe pack configuration:**
- Reputation mark kinds and their parameters (base value, duration, display label)
- Witness thresholds for propagation

---

### Influence

**What it gives:** The power to produce change in the world — independent of what others think of the entity.

**Applies to:** Actor, Organization, Location.

**Distinction from Reputation:**
- **Reputation** = what others think (perception)
- **Influence** = what you can cause to happen (power)

These are orthogonal. Examples:
- A deposed king: high Influence (still controls allies, resources, loyalists), low Reputation (publicly disgraced).
- A celebrated retired hero: high Reputation (legendary), low Influence (no longer commands resources or armies).
- A corrupt bureaucrat: moderate Reputation (officially respected), high Influence (controls the apparatus that everyone depends on).

**How Influence is computed (base model):**
Influence is derived from:
- Resources owned (wealth is leverage)
- Membership leadership positions held (a guild master has more influence than a member)
- Organizational power (an Organization's influence aggregates from the above)
- Network centrality (how many high-influence entities this entity has Relationships with)

Exact formula is pack-configurable.

**How Influence is used:**
- Heir selection weights Influence alongside standing
- Organizational goal feasibility is gated on Influence
- Certain intents (recruit, negotiate, coerce) require minimum Influence thresholds
- The Director uses Influence to identify which actors are plausible incident triggers

**Universe pack configuration:**
- Influence computation weights (resource weight, position weight, network weight)
- Influence decay rate (unused influence atrophies)
- Influence thresholds for specific intents

---

### Needs

**What it gives:** Internal states that decay over time, fall below thresholds, and motivate behavior. The primary driver of an Actor's short-term aspirations.

**Applies to:** Actor only.

**Mechanism:**
- Each Actor has a Needs vector: `Record<NeedKey, number>` on a 0–1000 scale.
- Needs decay daily. Rate is pack-defined per need type.
- The Aspiration system checks current need levels when evaluating which aspiration to activate.
- Different aspiration types are triggered when different needs are critically low.

**Need types are entirely pack-defined.** The engine does not know what "food," "rest," "companionship," or "meaning" are. It knows that needs decay, that low needs create urgency, and that resolving intents refills needs. Which needs exist and what refills them is a pack concern.

**Need types differ by universe.** A fantasy pack might have: food, rest, companionship, meaning. A sci-fi pack might add: air, fuel cell, network uptime. A horror pack might add: sanity. The engine accommodates any set of needs without modification.

**Universe pack configuration:**
- Need types and their keys
- Decay rates per need type
- Urgency thresholds (below this level, this need dominates aspirations)
- Refill sources (which intents, events, or conditions restore each need)
- Species-specific need modifiers (elves may have slower social decay; robots may have no food need)

---

### Ownership

**What it gives:** The ability to hold legal title over other entities — Objects, Locations, Vehicles, and (with restrictions) Organizations.

**Applies to:** Actor, Organization.

**Ownership rules:**

| Owner type | Can own |
|---|---|
| Actor | Objects, Locations, Vehicles |
| Actor | Partial stake in Organization² |
| Organization | Objects, Locations, Vehicles, Organizations³ |

2. Actors can own shares or seats in Organizations (a merchant who owns 30% of a trading company), but not full title over an Organization in the way they own an Object.
3. Organization → Organization ownership is valid (vassal kingdoms, subsidiaries, affiliated guilds). Ownership cycles are forbidden.

**Ownership transfer is always an Event.** Trade, gift, inheritance, theft, conquest — all produce an ownership-transfer Event in the history of both the owner and the owned entity.

**Ownership history is complete.** Every entity tracks its full ownership chain. "This sword was owned by three kings before the current holder" is a query the simulation can answer.

**Slave ownership:** Actors cannot own other Actors by default. A universe pack that explicitly enables slave ownership must define it as an Organization type (a slave-holding institution owns a slave Actor's labor) or as a special ownership mark. The engine does not assume slavery is a valid ownership pattern.

---

### Membership

**What it gives:** The ability to belong to one or more Organizations.

**Applies to:** Actor, Organization (an Organization can be a member of another Organization — e.g., a vassal state in a confederation).

**Mechanism:**
- Membership is tracked on the Organization side: the Organization maintains its member list.
- An Actor or Organization can be a member of multiple Organizations simultaneously.
- Membership has a role (member, officer, leader, founder). Role is pack-defined.
- Membership changes are Events.

**Membership produces obligations and benefits.** Exactly what these are is pack-defined. A guild membership might grant trade access and require dues. A military order membership might require obedience and grant rank.

**Universe pack configuration:**
- Organization membership roles and their display labels
- Membership eligibility rules per Organization type
- Membership benefits and obligations per role

---

### Containment

**What it gives:** The ability to spatially hold other entities within a defined boundary.

**Applies to:** Location, Vehicle. Optionally (shallowly): Object.

**Rules:**

| Container | Can contain |
|---|---|
| Location | Actors, Objects, Vehicles, other Locations |
| Vehicle | Actors, Objects, other Vehicles |
| Object | Other Objects (shallowly — does not confer Location properties) |

**Containment is hierarchical.** If A is inside B and B is inside C, then A is inside C. This is transitive. Containment cycles are forbidden.

**Physical vs. jurisdictional containment:**
- **Physical containment** — entity A is spatially inside Location/Vehicle B. Computed from the containment hierarchy.
- **Jurisdictional containment** — entity A is under the authority of Organization B. Tracked on the Organization. These are independent: a city can be physically inside a kingdom's territory without being jurisdictionally controlled by that kingdom (a free city, an occupied zone, a disputed border).

**Capacity.** Every container has a maximum number of entities it can hold. Capacity is pack-defined per location/vehicle type. Exceeding capacity produces events (overcrowding, hazard) rather than a hard error.

**Universe pack configuration:**
- Capacity defaults per Location/Vehicle type
- Overcrowding event types and consequences
- Access rules (who can enter which container types)

---

### Mobility

**What it gives:** The ability to change spatial position in the world — to move from one position to another, carrying all contained entities along.

**Applies to:** Actor (moves between Locations), Vehicle (moves between positions, carrying its contents).

**Actor mobility:** An Actor's current Location is a component. Moving changes that component. Moving produces an event. Moving can be voluntary (travel intent) or involuntary (exile, capture, rescue).

**Vehicle mobility:** A Vehicle moves between positions (Locations, coordinates, or graph nodes — depending on the universe pack's world model). All entities inside the Vehicle move with it. Moving produces transit events. Events can occur in transit.

**Mobility is not instantaneous.** Transit has duration, computed from distance and speed. Both are pack-defined. During transit, the Vehicle and its contents are "in motion" — a distinct spatial state.

**Fixed Locations inherit parent mobility.** A building inside a moving Vehicle moves with the Vehicle. The building does not have Mobility; it has a parent that does.

**Universe pack configuration:**
- Actor travel speeds by terrain/mode of transport
- Vehicle speed by vehicle type
- Transit event types (encounters, weather, delays, piracy)
- Distance model (graph edges, 2D distance, 3D distance, hyperspace lanes)

---

### History

**What it gives:** An accumulation of Events linked to this entity, forming a timeline that becomes the historical record.

**Applies to:** All entity types.

**Mechanism:**
- Events are emitted by simulation systems.
- Each Event's subject list determines which entities' histories receive a Record.
- A Record is a pointer from the entity's timeline to the Event, annotated with the entity's role in it.
- The timeline is unbounded (archive). A bounded active window (Memory, where applicable) is the behavioral-influence layer.

**Chronicle and Annals selection.** History is not the Chronicle. The Chronicle is a curated selection of high-interest Events. History is the raw complete record. Every entity has history; only events above the interest threshold enter the Chronicle.

**Cross-entity history.** A sword's history includes all Events in which it appeared as a subject — battles, ownership transfers, legendary moments. A Location's history includes founding, sieges, rulers, famines, and wonders. This is uniform across all entity types.

**Universe pack configuration:**
- Interest scores per event type (determines Chronicle inclusion)
- Landmark event types (permanently retained in Annals regardless of age)
- Historical significance threshold (minimum cumulative interest for an entity to appear in Legends)

---

### Destruction

**What it gives:** The ability to be destroyed — ending active simulation participation while retaining the historical record.

**Applies to:** All entity types except Event (Events are immutable facts; they cannot be "destroyed," only archived).

**Mechanism:**
- Destruction is always an Event. There is no silent state change.
- A destroyed entity is removed from active simulation indexes.
- Its identity, relationships, reputation, and history remain in the archive.
- Its ID is never reused.
- Other entities that held Relationships with the destroyed entity retain those Relationships in their history.

**Destruction is permanent.** A destroyed entity cannot be un-destroyed. It can be succeeded (a new entity is created to inherit its role), rebuilt (a new entity shares the same location), or restored through pack-specific resurrection mechanics (which would create a new entity, not restore the original).

**Variants of destruction:**
- **Actor death** — biological death, execution, system shutdown. Actor moves to deadEntities.
- **Organization dissolution** — formal dissolution, conquest and absorption, total membership loss.
- **Location ruin** — population reaches zero, siege destruction. Location becomes a ruin (retains identity but participates passively).
- **Vehicle destruction** — sinking, crashing, detonation.
- **Object destruction** — burning, melting, shattering.

**Universe pack configuration:**
- Death conditions per Actor type (age, health, combat, starvation)
- Dissolution conditions per Organization type
- Ruin conditions per Location type
- Destruction event types and their consequences

---

## Capability Composition Rules

**Rule 1: Capabilities are additive.** An entity has the capabilities its type specifies plus any optional capabilities granted by the universe pack. Capabilities are never removed from an entity after it is created (a living Actor always has Agency; a destroyed Actor retains its historical record).

**Rule 2: Capabilities are orthogonal.** Adding or removing a capability from an entity type does not imply changes to other capabilities. If a universe pack wants Locations to have Memory (a haunted house that "remembers" its history and influences actors within it), that is a valid capability extension applied to a Location — it does not imply Locations now have Agency or Relationships.

**Rule 3: Capabilities do not create new entity categories.** A Location with Memory is still a Location. A Vehicle with Influence is still a Vehicle. Capability extensions do not promote entities to new types.

**Rule 4: Engine-provided capabilities can be configured but not replaced.** A universe pack can change how Memory works (buffer size, decay weights) but cannot replace the Memory system with an entirely different mechanism. If a fundamentally different mechanism is needed, it is a new capability that requires an ontology revision.

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-28 | Initial capabilities document — split from `11-simulation-ontology.md v1.0`; added Influence (distinct from Reputation); expanded Collective Decision Making from Organization's former Agency; formalized capability composition rules |
