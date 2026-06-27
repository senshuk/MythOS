# Part 2 — MythOS: Entity Model, World Model, Data Model & Save Format

This document defines *how the world is represented*. It is deliberately concrete
(types in TS-ish pseudocode) so it can be argued with. Everything here assumes the
deterministic, ECS, worker-isolated core from `02`.

---

## 1. Entity Model

### 1.1 The ECS decision (and why, not a class hierarchy)

`CLAUDE.md` says "composition over inheritance." The disciplined way to honor that
*and* afford "every actor equal" at scale is an **Entity-Component-System**:

- **Entity** = a stable opaque ID (`EntityId = number`), nothing more.
- **Component** = a plain data record attached to an entity (`Position`, `Needs`,
  `Mortal`, `MemberOf`). No methods.
- **System** = a function that reads/writes components for all entities matching a
  query, advancing them one tick.

Why not `class Actor { age(); marry(); }`? Because (a) behavior belongs in systems,
not entities, so universes can add/replace behavior without subclassing; (b) data-
oriented stores (Structure-of-Arrays) are far cheaper for thousands of actors; (c)
serialization is trivial when entities are just bags of plain components.

> **One actor model, not "player vs NPC."** A player is an entity that *also* has a
> `PlayerControlled` component. Systems never branch on it; the **control layer**
> sources intents differently. This is how you keep the philosophy without `if
> (isPlayer)` smeared everywhere.

### 1.2 Identity & references

- Every entity has a **stable `EntityId`** for its whole life (never reused).
- All relationships are **references by ID**, never by array position (the cardinal
  fix over Warsim's positional indices).
- Entities carry a **kind tag** (`actor | settlement | faction | item | …`) for
  fast filtering, but kind is just data — the engine doesn't special-case it.

### 1.3 The core ontology (engine-level components)

These are the universe-neutral primitives the engine *is* opinionated about
(`02 §3.3`). A Universe Pack never removes these; it adds setting-specific ones via
modules.

```ts
// --- universal ---
Identity      { name: string; titleRefs: ContentId[]; kind: EntityKind }
Lifecycle     { bornTick: number; lifespanRef: ContentId; alive: boolean }
SpeciesRef    { species: ContentId }          // -> species content record
CultureRef    { culture: ContentId }
Location      { region: EntityId; settlement?: EntityId } // graph refs, not x/y*
Inventory     { items: EntityId[]; wealth: Int /*abstract value*/ }
Needs         { [needKey]: Int }              // hunger, safety, esteem… data-defined
Goals         { stack: Goal[] }               // utility/GOAP-style
Memory        { episodes: MemoryRef[] }       // remembered events (bounded)
Traits        { values: ContentId[] }         // the RaceSuffix-style modifier set
Skills        { [skillKey]: Int }
// --- social / political ---
MemberOf      { faction?: EntityId; org?: EntityId; household?: EntityId }
Relationships { edges: Map<EntityId, RelationEdge> }   // see World Model §3
Role          { profession: ContentId; office?: ContentId }
// --- control ---
PlayerControlled? { /* presence = player */ }
// --- LOD ---
Fidelity      { tier: 'full' | 'summary' | 'aggregate' }
```

\* `Location` is **graph-based** (which region/settlement), not Cartesian. Add a
`SpatialModule` with `{x,y}`/hex coords only for universes that need tactical
geography. Most don't; keeping it optional avoids paying for a map you won't use.

### 1.4 Entity *templates* (data, not subclasses)

A "Blacksmith" or a "Khedivate" is **not a class**. It's a **template**: a named
bundle of components-with-defaults living in pack content. Instantiation = "stamp
this template, then run generators to fill names/faces/stats." This is the
generalization of Warsim's `RaceType` line into "any entity from a data template."

---

## 2. World Model

### 2.1 The world is a graph of regions, not a pixel map

Warsim proved you can have rich strategy with *no coordinate map* — locations are a
set with abstract adjacency. MythOS should adopt a **region graph** as the baseline
spatial model, with optional finer geometry per module:

```
World
 └─ Regions (nodes)  ── adjacency edges (distance, terrain, passability)
      └─ Settlements (located in a region)
           └─ Sites / districts (optional finer grain)
      └─ Routes (trade/travel) overlaying the adjacency graph
```

- A **fantasy continent**, a **galaxy** (regions = star systems, edges = lanes), or
  **modern Earth** (regions = cities) all map onto the same graph. *This is what
  makes "any map type" real instead of aspirational* — you change node/edge
  semantics via a module, not the engine.
- Geography can now drive emergent strategy (chokepoints, frontiers, distance-
  decayed trade) — the thing Warsim couldn't do.

### 2.2 Aggregate vs. individual layers

The world is simulated at **two coupled layers** (core to the LOD design):

- **Macro layer (always on, cheap):** per-region/per-settlement aggregates —
  population by species/culture/age-band, wealth, stability, prevailing
  profession mix, faction control. Evolves by *rates*, not by people.
- **Micro layer (active set only):** individual actors promoted from the macro
  layer. Their actions feed back into macro aggregates.

A settlement's mayor is a *macro fact* ("this town has a leader of culture X,
disposition Y") until the player shows up, at which point a concrete actor is
**deterministically materialized** from that fact + seed.

### 2.3 Relationships as a typed graph (generalizing Warsim's matrix)

Warsim's best structure was the relation matrix. Generalize it:

```ts
RelationEdge {
  from: EntityId; to: EntityId;
  type: ContentId;        // 'rivalry' | 'allegiance' | 'kinship' | 'trade' | …
  valence: Int;           // -1000..1000
  flags: BitSet;          // atWar, allied, married, vassal…
  sinceTick: number;
  cause?: EventId;        // why this edge exists -> legibility
}
```

- Works for actor↔actor, faction↔faction, actor↔faction, settlement↔route.
- Stored as a **sparse adjacency** (Warsim's dense 14×14 matrix doesn't scale; use
  edges, indexed both directions).
- `cause` links every relationship to the event that created/changed it — this is
  what makes the world **legible** (`02 §1.3`).

### 2.4 History as first-class data

The **event/history log** is canonical (`02 §2.2`). Every meaningful change emits a
typed, dated, entity-referencing event:

```ts
WorldEvent {
  id: EventId; tick: number;
  type: ContentId;                 // 'battle' | 'marriage' | 'coup' | 'famine'…
  subjects: EntityId[];            // who/what was involved
  data: Record<string, Json>;      // typed per event-type
  causes: EventId[];               // causal parents -> story graph
}
```

Narrative text is **rendered from events on demand** via templates (don't *store*
prose like Warsim does — store structured events, render text in the view). This
keeps history queryable ("all wars Faction A started"), localizable, and free of
the delimiter problems that plagued Warsim's format.

---

## 3. Data Model (content, not runtime state)

Two clearly separated kinds of data:

1. **Content** (immutable, authored, shipped in packs): species, cultures,
   governments, professions, item templates, name grammars, dialogue pools,
   trait/modifier definitions, event templates, tunables.
2. **State** (mutable, per-world, in saves): entities, components, relationship
   edges, the event log, RNG cursor, tick.

### 3.1 Content addressing

- Every content record has a **namespaced stable id**: `pack:type/key`, e.g.
  `mythcore:species/elf`, `startrek:species/vulcan`. Namespacing prevents pack
  collisions and lets packs extend/override others.
- Content is loaded into the **Content Registry** at world creation; state
  references content by id. (A save stores the *pack set + versions* it needs.)

### 3.2 The universal record shape

Learn from Warsim's bespoke-per-file mess: use **one self-describing format** for
all content. Recommended authoring format: **JSON/JSON5** (or TOML) with a typed
schema per record type, validated on load. Example species record (the modern
form of a `RaceType` line):

```json5
{
  "id": "mythcore:species/goblin",
  "type": "species",
  "name": "Goblin",
  "lifespan": { "mean": 40, "sd": 8 },
  "physiology": { "size": "small", "diet": "omnivore" },
  "reproduction": { "rate": "high" },
  "baseTraits": ["mythcore:trait/tribal", "mythcore:trait/aggressive"],
  "ranks": [                              // Warsim's 3 power tiers, generalized
    { "name": "Goblin Tribal",   "power": 40 },
    { "name": "Goblin Berserker","power": 95 },
    { "name": "Goblin Warlord",  "power": 125 }
  ],
  "naming": "mythcore:namegrammar/goblin",
  "description": "Mischievous, tribal peoples who spread quickly…"
}
```

### 3.3 Generation grammars as data (port Warsim's best ideas)

Three reusable content schemas, lifted and generalized from §3 of the analysis:

- **Token grammar** (generalizes `Currency.txt`, kingdom names): tiered token
  lists + a template with substitution tokens (`{RACE}`, `{PLACE}`), produces
  names/currencies/mottos. One engine, many uses.
- **Part-assembly** (generalizes `monsters.txt`, `Faces`, `Weapons`, `Flags`):
  parts tagged by slot/tier carrying **both a visual and a description fragment**;
  the assembler composes a picture *and* a sentence together. Keep this dual-output
  property — it's Warsim's cleverest trick.
- **Modifier/trait** (generalizes `RaceSuffix.txt`): a modifier is
  `{ name, statDeltas, descriptionFragment, applicabilityTags }`. The engine
  applies modifiers uniformly to *any* entity (people, polities, items, regions).
  "Battle Orcs," "Cursed Sword," "Frostbound Khedivate" all fall out of one system.

### 3.4 Tunables

Per-module numeric config (drift rates, tax coefficients, combat constants) lives
in **typed config records** the pack can override. Systems read tunables from the
registry; **no magic numbers compiled into systems** (a Warsim weakness). This is
the *safe* end of "everything is data" — config, not scripting.

---

## 4. Save Format

The save format is where Warsim is weakest and where good choices pay off forever.

### 4.1 Principles

1. **Keyed and schema'd**, never positional. (Kill Warsim's #1 weakness.)
2. **Versioned with migrations.** Every save records `engineVersion`, `packs +
   versions`, and `schemaVersion`; a migration chain upgrades old saves.
3. **Event-sourced + snapshots.** Canonical = ordered event log; snapshots are
   periodic materializations for fast load.
4. **Self-contained but content-by-reference.** A save references packs by id+
   version (it does not embed all content), but embeds everything needed to
   reconstruct *state*. (Loader verifies required packs are present.)
5. **Chunked, not monolithic.** Don't repeat the one-giant-blob mistake; store in
   discrete IndexedDB object stores so large worlds load incrementally.

### 4.2 Layout (IndexedDB object stores)

```
db: mythos-world-<worldId>
 ├─ meta        { worldId, seed, engineVersion, schemaVersion,
 │                packs:[{id,version}], createdTick, savedTick }
 ├─ snapshots   keyed by tick:  { tick, componentStores(compressed), rngCursor }
 ├─ events      append-only:    WorldEvent[]  (the canonical history)
 ├─ entities    optional index for fast lookups
 └─ blobs       large/rare payloads (generated art caches, etc.)
```

- **Load** = newest snapshot + replay events after it (usually 0). 
- **Determinism guarantee:** `snapshot(tick=0=seed only)` + full event log must
  reproduce the latest snapshot exactly. CI asserts this (`02 §3.5`).

### 4.3 Serialization details

- Component stores serialize as plain typed data (consider columnar/SoA + a binary
  codec like CBOR/MessagePack for size; JSON for debug builds).
- **No delimiter-as-punctuation hazard** — structured encoding means generated
  prose is just string values, never a parsing landmine (Warsim had to avoid
  periods in dialogue!).
- Compress snapshots (e.g. `CompressionStream` gzip) before writing.

### 4.4 Migration strategy

- Each schema change ships a `migrate_vN_to_vN+1(state)` pure function.
- On load, run the chain from the save's `schemaVersion` to current.
- Keep migrations **forever** and test them against fixtures (a corpus of old
  saves). This is the cost of "backward compatibility is important" in `CLAUDE.md`
  — pay it deliberately, not ad hoc like Warsim.

### 4.5 "Scenarios" and pack-distribution

Warsim shipped scenarios as full saves (`DFMod`, `Spooktaria`). MythOS should
distinguish:
- **Universe Pack** = rules + content (what a world *can be*).
- **Scenario** = a Universe Pack + a specific starting world-state (a curated
  snapshot at tick 0, or a seed + setup script). Ship scenarios as `pack-ref +
  seed + optional initial snapshot` — small, reproducible, and not a brittle full
  dump.
