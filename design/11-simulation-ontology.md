# MythOS Simulation Ontology

**Document type:** Engine constitution — what kinds of things exist in a MythOS simulation.
**Companion documents:** `12-capabilities.md` (what each entity type can do), `13-simulation-rules.md` (time, space, systems, rules, invariants).
**Status:** Canonical. Changes require explicit revision with justification.

---

## Purpose

This document defines the conceptual categories of the MythOS engine. It answers one question:

**What kinds of things exist in a MythOS simulation?**

It does not describe how things are implemented (that is for engine implementation documents), nor does it describe what specific things exist in any particular universe (that is for universe packs). It defines the vocabulary that every future system must speak.

If a proposed feature uses a concept not defined here, that concept must either be mapped to an existing category or the ontology must be formally revised. "Crystal Nexus," "Force," "karma," and "dilithium" are not simulation entities — they are instances of Location, Rule, Capability configuration, and Resource, respectively.

---

## How to Classify Anything

Before reading the entity definitions, understand the classification principle:

**Entity types are defined by their capabilities — not the other way around.**

The test for any proposed entity is: *Which capabilities does it need?*

| If it needs... | It is a... |
|---|---|
| Agency | Actor |
| Collective Decision Making | Organization |
| Containment + Mobility | Vehicle (a movable Location) |
| Containment | Location |
| History without any of the above | Object |

This inversion is deliberate. "Actors have Agency" puts the entity first and the capability second. "Agency creates Actors" puts the capability first. The practical consequence: when a universe pack introduces a new concept — a hivemind, a divine force, a sentient ship, a nanobot swarm — the classification question is always the same: *What capabilities does it need?* The answer determines the type. No committee discussion required.

A starship that carries passengers and can be navigated is a Location (Containment) with Mobility — therefore a Vehicle. If the pack assigns it Agency, it becomes an Actor that happens to also be a Vehicle. The question is always about capabilities, never about appearance or physical form.

---

## What Exists in a MythOS Simulation

A MythOS simulation contains four distinct tiers:

```
Simulation
│
├── Entities          (addressable things with identity and history)
│   ├── Actor
│   ├── Organization
│   ├── Location
│   │   └── Vehicle   (a movable Location — not a separate top-level category)
│   └── Object
│
├── Constructs        (structural elements — addressed but not simulated as participants)
│   ├── Event
│   ├── Relationship
│   ├── Record
│   └── Mark
│
├── Data              (fungible quantities — not addressed as entities)
│   └── Resource
│
└── Systems           (defined in simulation-rules.md)
    ├── Economy
    ├── Weather
    ├── Disease
    ├── Magic
    ├── Technology
    └── (universe-defined)
```

**Entities** have a stable ID, accumulate history, and participate in the simulation as named, addressable things. Destroying an entity does not erase it — it ends its active participation while retaining its historical record.

**Constructs** have identity but exist to describe relationships between entities, not to participate independently. An Event is a fact, not an actor. A Relationship is a bond, not a thing.

**Data** is fungible and has no identity. Resources are tracked as quantities, not as named individuals.

**Systems** are defined in `13-simulation-rules.md`. They mutate entities. Entities do not own systems.

---

## Entities

---

### Actor

**Definition:** An autonomous agent capable of forming goals, making decisions, taking actions, maintaining relationships, and accumulating personal history.

**Core property:** Agency — the capability to form a goal and act toward it.

**Note on "agent" vs. "individual":** Actor does not require biological individuality. A Borg collective node, an ant colony operating as a single agent, an AI hivemind, or a nanobot swarm all qualify as Actors if the universe pack assigns them Agency. The engine does not assume one body, one mind. It assumes one decision-making entity.

**Capabilities:** Identity, Agency, Memory, Relationships, Reputation, Influence, Needs, Ownership, Membership, History, Destruction.

*(Capability specifications are in `12-capabilities.md`.)*

**Examples:**
- A human farmer
- An elven scholar
- An android executive
- A dragon
- A Borg node assigned individual goals by a pack
- A trained animal with pack-defined agency
- A sentient AI

**Non-examples:**
- A kingdom — Organization
- A sword — Object
- A city — Location
- A caravan — Vehicle (a movable Location)
- A merchant fleet — Organization that owns Vehicles
- A swarm operating under collective intelligence — Organization with Collective Decision Making, unless the pack assigns it Actor-level individual agency

**Actor identity is immutable.** The same actor who is a farmer, becomes a soldier, rises to general, then is exiled, remains one entity throughout. Their role, reputation, and relationships change. Their ID does not.

**Actors move.** Location is a component of an Actor, not part of their identity. An Actor currently in Location A who moves to Location B is the same Actor.

**Actors can die.** Death ends active simulation. The dead Actor remains in the archive. Their relationships, reputation, and events remain accessible.

---

### Organization

**Definition:** A persistent collective entity with governance, goals, resources, membership, and reputation — capable of acting as a single agent in the simulation through its governance structure.

**Core property:** Collective Decision Making — a governance structure that synthesizes member values, leadership disposition, and rules into organizational decisions and goals.

**Important distinction:** Organizations do not have Agency in the same sense Actors do. An Actor decides. An Organization's governance decides on behalf of its members. The engine calls `organization.governance.resolve(...)`, not `organization.decide(...)`. This distinction matters because governance can change (a democracy becomes a dictatorship) without changing the organization's identity.

**Capabilities:** Identity, Collective Decision Making, Memory, Relationships, Reputation, Influence, Ownership, Membership, History, Destruction.

**Examples:**
- A kingdom
- A mercantile guild
- A church
- A pirate fleet (as collective entity, not the ships)
- A military order
- A criminal syndicate
- A university
- A corporation
- A political party
- A nomadic tribe (as social entity; its camp is a Vehicle)
- A revolutionary movement

**Non-examples:**
- An individual king — Actor who holds leadership role within the Organization
- A single ship — Vehicle (the fleet is the Organization)
- A church building — Location (the faith institution is the Organization)

**Organizations outlive their members.** A guild persists when its founders die. A kingdom persists when its king is replaced. The Organization's reputation and history are not the reputation and history of its current leader.

**Organizations can own other Organizations.** A kingdom can have vassal kingdoms. A corporation can own subsidiaries. Ownership cycles are forbidden (an organization cannot own itself, directly or transitively).

**Organizations can have a physical seat.** An Organization optionally designates a primary Location as its headquarters. Losing the seat is a significant event, not an organizational death.

**Organizations can split.** A schism produces two successors from one. Prior history belongs to the original Organization; successors may claim it through reputation.

**Organizations can merge.** Two Organizations become one. The merged Organization inherits both histories, or one absorbs the other — defined by the governing event.

**Organizations can go dormant.** An Organization with no members retains identity, reputation, and resources. It can be reactivated.

**Organizations can be destroyed.** Dissolution, conquest, or total membership loss can end an Organization. Destruction is an Event. The historical record persists.

---

### Location

**Definition:** A spatial container that holds Actors, Organizations, Objects, Vehicles, and other Locations, and that participates in economic, political, and historical events.

**Core property:** Containment — the ability to hold other entities within a defined spatial boundary.

**Capabilities:** Identity, Containment, Reputation, History, Destruction. Optionally: Mobility (when the Location is a Vehicle).

**Location types are entirely pack-defined.** The engine does not know whether a Location is a planet, a tavern, or a space station. It knows that a Location has containment and participates in history.

**Examples of Location types (defined by universe packs, not the engine):**
- Planet, Moon, Asteroid, Orbital
- Continent, Kingdom, Region
- City, Town, Village, Hamlet, Outpost
- District, Neighborhood, Block
- Building, Chamber, Room, Corridor
- Space Station, Habitat Dome, Generation Ship (while stationary)
- Dungeon, Cave, Ruin

**Non-examples:**
- A caravan — Vehicle (it moves autonomously)
- A kingdom as political entity — Organization (its territory is a set of Locations)
- A ship under sail — Vehicle

**Locations can be nested.** A room is inside a building, which is inside a district, which is inside a city. Nesting depth is unlimited and pack-defined. A Location knows its immediate parent.

**Locations can be adjacent without containment.** Two cities on the same continent are neighbors, not one inside the other. Adjacency is a graph edge, not a parent-child relationship.

**Locations have capacity.** Maximum entities they can contain. Capacity is pack-defined per type and can change through construction or destruction events.

**Locations can be ruined.** When population reaches zero or a destruction event fires, a Location becomes a ruin. Ruins retain identity and history. They can be resettled (creating a new active state) or remain as historical markers.

**Fixed Locations do not move.** A building does not relocate. A building inside a Vehicle moves with its parent. Fixed Locations inherit the mobility of their parent Vehicle.

---

### Vehicle

**Vehicle is a Location with the Mobility capability — not a separate top-level entity category.**

**Definition:** A movable Location — a spatial container that can transport its contents between positions in the world.

**The distinction from a fixed Location:** A fixed Location has `mobility = fixed`. A Vehicle has `mobility = mobile`. The simulation systems that read `mobility` determine whether the entity can travel between positions. All other Location behavior is identical.

**Capabilities (as a Location):** Identity, Containment, Reputation, History, Destruction — plus Mobility.

**Examples of Vehicle types (pack-defined):**
- Sailing ship, war galley, merchant vessel
- Merchant caravan (wagon train)
- Airship, balloon, dirigible
- Train, locomotive, rail convoy
- Starship, shuttle, freighter
- Generation ship (may be civilization-scale)
- Nomadic camp (a movable settlement)
- Military army on the march (structured, not a swarm)
- Submarine, underwater habitat

**Non-examples:**
- A horse — Actor (or Object if not assigned agency by the pack); actors use horses, caravans use horses as components
- A harbor — Location where Vehicles dock
- A merchant company — Organization that owns Vehicles
- A planet under ordinary circumstances — Location (but a pack can define planet-scale engines that grant mobility)

**Vehicles can dock.** When a Vehicle docks at a Location, it enters a docked state. While docked, it is treated as spatially connected to the Location. Actors can board or disembark. The Vehicle is not contained inside the Location — it is adjacent to it, with a permeable boundary.

**Vehicles can be nested.** A shuttle can be inside a starship's hangar bay. Nested Vehicles inherit their parent's position and move with it.

**Vehicles can be destroyed.** A sinking ship, a burned caravan. Destruction is an Event. Historical record persists.

**Vehicles have ownership.** A Vehicle can be owned by an Actor, an Organization, or another Organization that controls it. Ownership history is tracked.

**Vehicle movement is transit, not teleport.** Movement from A to B has duration. Events can occur in transit (piracy, storm, mechanical failure, mutiny). Transit time is a function of distance and speed, both pack-defined.

---

### Object

**Definition:** A persistent, non-autonomous entity that carries historical significance through its creation, ownership, location, and destruction.

**Core property:** History — an Object's value to the simulation comes entirely from the events it participates in, not from any choices it makes.

**Capabilities:** Identity, Ownership, History, Destruction. Optionally: Containment (a chest contains coins; a ship's log contains records).

**An Object has no agency.** It does not decide. It is acted upon. If a proposed Object seems to need decisions, it is either an Actor (if pack-defined with Agency) or the decision-making is happening in the Actor or Organization that controls the Object.

**Examples:**
- A sword, axe, shield
- A crown, throne, scepter
- A book, codex, scroll, data chip
- A painting, statue, tapestry
- A religious relic, sacred vessel
- A key, seal, signet ring
- A letter, treaty document, contract
- A ship's log, captain's journal
- A nuclear device (before detonation — after detonation it becomes an Event)
- An alien artifact

**Non-examples:**
- A ship — Vehicle (it transports entities)
- A building — Location (it contains entities)
- A kingdom — Organization
- A sentient sword that gives advice — Actor (if the pack assigns it Agency)

**Objects can contain other Objects (shallowly).** A chest contains coins. A book contains information. Object containment does not make the outer Object a Location — entities cannot live or act inside an Object.

**Objects can be owned.** At most one primary owner at a time. Ownership transfers through trade, inheritance, theft, gifting, or conquest. Ownership history is part of the Object's record.

**Objects can have Reputation.** A famous sword has a reputation. Other entities know of it and respond to it. The reputation system for Objects is the same system as for Actors — no special cases.

**Objects become historically significant through events.** An Object involved in high-interest events is flagged as historically significant. Historically significant Objects appear in Chronicles, Annals, and Legends. The threshold is pack-defined.

**Objects can be destroyed.** A burned book, a melted sword. Destruction is an Event. Historical record persists.

---

## Constructs

Constructs have identity but exist to describe structure and relationships between entities, not to participate independently.

---

### Event

An immutable fact about a world-state transition.

- Has a unique ID, a tick, a type (open string), a subject list, a data payload, and a cause list.
- Is never modified after creation.
- Is never created by presentation systems — only by simulation systems.
- Cause list forms a directed acyclic graph. Cycles are impossible.
- Subject list is open: any entity type can be a subject.
- Prose is never stored on the Event — it is rendered on demand by presentation systems.

### Relationship

A directed bond from one entity to another, expressing opinion through a stack of typed, decaying Thought objects.

- Represents how entity A feels about entity B.
- Is not symmetric: A→B opinion and B→A opinion are independent.
- Exists between any two entities with Identity (Actor→Actor, Actor→Location, Organization→Organization, etc.).
- Opinion is computed from active Thoughts, not stored directly.
- Can explain itself: the Thought stack is the reason list.

### Record

An entry in an entity's personal timeline — a pointer to an Event annotated with that entity's role in the event.

- Entities do not store Events directly — they store Records that reference Events.
- The same Event produces Records in multiple entities' timelines.
- Records are the foundation of legibility: "why does this actor distrust this organization?" is answered by reading their Records.

### Mark

A subjective, sourced, time-varying assertion held by an entity. Marks are the shared substrate beneath every system that models what an entity *feels, reckons, or holds true* — the engine's unit of subjectivity.

- A Mark carries: a `kind`, a magnitude or `assertion`, the tick it arose (`sinceTick`), an optional expiry (its certainty decays unless renewed), and a `cause`/`source` (provenance — *why* it is held).
- Marks live in bounded, decaying stacks and are reduced to a domain-specific reading. **The substrate is shared; the reduction semantics differ by domain:**
  - **Sentiment** — a stack of `Thought` marks on a Relationship edge reduces to an opinion.
  - **Reputation** — a stack of witness-weighted marks reduces to public standing.
  - **Belief** — a stack of *evidence* marks (witness / testimony / document / inference) reduces to a held stance (True / False / Unknown) and a **derived** confidence (Epistemics; see ADR `17`). Confidence is never a stored number — it is computed from the evidence, the same way sentiment and standing are.
- **A Mark is never objective.** It is what an entity *holds*, not what is *true*. The objective record is the Event log; Marks are the subjective layer above it. This is why a Mark can be false while an Event cannot.
- **Marks are self-explaining:** the stack *is* the reason list. Opinions, reputations, and beliefs all answer "why?" through the same inspector pattern.

Marks are not independently addressed (they have no stable cross-world ID; they live in the stacks of the entities that hold them), but they are a first-class *structural category*: most of the engine's subjectivity is one Mark reduction or another. Recognizing Thought, Reputation, and Belief as three folds over one substrate — rather than three parallel systems — is what keeps the subjective layer elegant as it grows.

**Subjectivity exists only where agency exists.** Marks attach to entities that *act*. An **Actor** holds them directly. An **Organization** *derives* them from its members — a fold of member Marks, exactly as it derives its worldview — and owns no stack of its own (an org with its own evidence would be a second, competing source of truth). A **Location**, a **Construct**, a fungible **Resource**, or an aggregate summary holds **none**. This is the same law LOD already enforces everywhere else — a population summary is not a person, an economic summary is not a merchant — now extended to knowledge: *a settlement does not believe.* When an aggregate settlement comes into focus and its actors instantiate, subjective state reappears among them naturally. The lowest-fidelity entity that can hold a Mark is simply the lowest-fidelity entity that still has agency — today, an Organization.

**Individual minds are first-class; collective minds are always derived.** A higher level of abstraction never creates a second source of subjective truth — it *reduces* the level below it. This is already a pattern, not a one-off: **every aggregate mental state is a reducer over its members.** `worldviewOf` reduces member *values* to a collective worldview; `orgBeliefOf` reduces member *beliefs* to a collective belief; the same shape will recur for member fears → collective fear, member morale → collective morale, member priorities → collective priority. An organization's every mental state is therefore a **collective reducer**, never a stored quantity. So the rule for placing new group-level mental state is: *write the reducer; do not add the field.* (`orgBeliefOf` is the first collective **belief** reducer; `worldviewOf` was the first collective reducer of any kind. The general concept — collective cognition — is real, but it should be named only once a second belief-consumer forces it, not before.)

**Reducers read; producers write; neither does both.** The subjective layer has exactly two kinds of function over the Mark substrate, and the line between them is a law, not a style.

- **Reducers** — `computeOpinion`, `computeStanding`, `computeBelief`, `computeStatusBelief`, `orgBeliefOf` — are **pure reads**. Each answers one question ("how do I feel about them?", "is P believed?", "who holds this slot?") and mutates nothing: a reducer never adds a Mark and never calls a producer. Reducers compose **hierarchically only** — a higher reducer may build on a lower one (`computeStatusBelief` resolves over `computeBelief`), which is a *radius*; sibling reducers never depend on each other, so the reducers never form a web.
- **Producers** — `witnessBelief`, `tellBelief`, `shareBelief`, `learnCoronation` — only **add evidence**, and return nothing. A producer may *read* current state to decide what to contribute, but must never resolve the consumer-facing answer, gate its evidence on a reducer's verdict, or manufacture evidence to "fix" a contradiction. A producer that asks *"who currently wins?"* before contributing has crossed the line: `learnCoronation` adds evidence for the new ruler and against the incumbents **unconditionally** — it never consults `computeStatusBelief`.

Reducers are historians; producers are witnesses. This keeps the dependency graph radial from `mark`, and it is what lets an unbounded set of producers (witness, testimony, document, divination, sensor, …) and consumers (mourning, allegiance, vengeance, …) terminate at a fixed, tiny set of reducers without any of them entangling.

---

## Data

### Resource

A fungible quantity tracked in economic systems. Resources have no identity, no history, and no relationships. They are numbers with a type label.

- Resource types are pack-defined (food, tools, dilithium, spice, ammunition, credits).
- Resources are held by entities (Actors, Organizations, Locations) but are not entities themselves.
- A stockpile of grain is not a simulation entity. The granary that holds it is a Location.
- Resources flow between entities through economic system activity.

---

## Dual-Role Entities

Some entities simultaneously exhibit properties of more than one category. This is intentional and must be handled without special-casing.

### Vehicle + Location

Every Vehicle is a Location. A starship is a Location (it contains actors, chambers, corridors, economics, social dynamics) that also has Mobility. The engine represents this with a single entity that has both the Containment and Mobility capabilities. There is no separate "Starship" entity type — there is a Location with `type: "starship"` and `mobility: mobile`.

### Organization + Location (the seat relationship)

A church is an Organization (has governance, membership, goals, and decisions) whose physical presence is a Location (the cathedral building, which has containment and economy). These are two separate entities linked by an ownership/seat relationship. The Organization can move its seat. The Location continues as a distinct entity. They are not merged.

### Organization + Vehicle (nomadic collectives)

A nomadic tribe is an Organization (collective identity, leadership, goals) whose territory is a Vehicle (a movable settlement — the camp). The Organization does not move. Its seat moves. The Organization is associated with its seat's current position for all spatial purposes.

### Actor + Object (constructs and golems)

The line between an Object and an Actor is Agency. A golem that follows orders from a script is an Object configured with deterministic behavior rules. A golem assigned goals, memory, and the ability to form new intentions is an Actor — regardless of what it is made of. The pack decides which category applies. The engine does not assume.

---

## What This Document Does Not Cover

- How entities are implemented in code → engine implementation documents
- What specific entities exist in any universe → universe packs
- What each capability means and how it works → `12-capabilities.md`
- How time, space, systems, and rules work → `13-simulation-rules.md`
- How the UI presents any of these concepts → presentation layer documents

---

## Revision History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-28 | Initial ontology |
| 1.1 | 2026-06-28 | Vehicle moved from top-level to Location sub-type (mobility=mobile); Actor definition changed from "autonomous individual" to "autonomous agent" to support hive minds and swarms; Organization Agency changed to Collective Decision Making; Resource moved from entity hierarchy to Data tier; Constructs tier introduced; Dual-role entity guidance expanded; Document split into three: ontology (this), capabilities, simulation-rules |
| 1.2 | 2026-07-03 | **Mark** promoted to a first-class Construct — the shared subjective substrate beneath Thought (sentiment), Reputation (standing), and Belief (Epistemics). Names the layer where the engine's subjectivity lives; a Mark can be false while an Event cannot. Introduced alongside the Epistemics ADR (`17`). |
| 1.3 | 2026-07-03 | Added two laws to the Mark section: **subjectivity exists only where agency exists** (Actor holds, Organization derives, Location/Construct/Resource/aggregate hold none — the LOD discipline extended to knowledge) and **individual minds are first-class, collective minds always derived** (every aggregate mental state is a collective reducer over members — `worldviewOf`, `orgBeliefOf`, … — never a stored field; no second source of subjective truth at higher abstraction). |
| 1.4 | 2026-07-03 | Added the **reducers read / producers write** law to the Mark section: reducers (`compute*`, `orgBeliefOf`) are pure reads that compose only hierarchically (never a sibling web); producers (`witnessBelief`, `tellBelief`, `shareBelief`, `learnCoronation`) only add evidence, never resolve/gate on a verdict or manufacture evidence. Keeps the dependency graph radial from `mark` so unbounded producers/consumers terminate at a fixed tiny set of reducers. |
