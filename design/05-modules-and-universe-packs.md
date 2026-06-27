# Part 2 — MythOS: Module/Plugin System & Universe Pack Format

This is the mechanism that delivers the central promise: **the engine stays
unchanged; only universe data changes.** It generalizes Warsim's `RacePacks` from
"a subset of races" to "a selection of modules + a body of content."

---

## 1. Two distinct extension concepts (don't conflate them)

| | **Module (plugin)** | **Universe Pack** |
|---|---|---|
| Is | Code: components, systems, schemas, generators | Data: content + a manifest |
| Author | Engine/advanced devs (TypeScript) | Worldbuilders/modders (mostly data) |
| Examples | `economy`, `diplomacy`, `magic`, `spaceTravel`, `naval`, `genetics` | "Aslona-like Fantasy," "Star Empire," "Modern Earth" |
| Ships | With the engine or as trusted add-ons | As downloadable content bundles |
| Trust | High (runs code) | Low (data validated against schemas) |

Keeping these separate is critical for **security** (untrusted packs never run
arbitrary code) and for **clarity** (worldbuilders don't write systems; they
configure and fill them).

---

## 2. Module system

### 2.1 What a module contributes

```ts
interface Module {
  id: string;                          // 'mythos:economy'
  version: SemVer;
  dependsOn: string[];                 // other module ids
  components: ComponentSchema[];       // new component types
  systems: System[];                   // tick logic (see 04 §4)
  contentSchemas: ContentSchema[];     // record types this module understands
  generators?: Generator[];            // procgen this module provides
  tunables: TunableSchema[];           // configurable numbers + defaults
  intents?: IntentSchema[];            // player/AI actions this module accepts
  events?: EventSchema[];              // event types + default text templates
  migrations?: Migration[];            // schema migrations for its components
}
```

### 2.2 Lifecycle

1. **Register** modules at boot (core modules always; optional ones if a pack asks).
2. **Resolve dependencies** (topological; fail fast on missing/cyclic deps).
3. **Compose schemas** into the Content Registry; validate.
4. **Order systems** by cadence + declared `order` for deterministic ticking.
5. **Activate** only the modules the loaded Universe Pack enables.

### 2.3 Core vs optional modules

- **Core (always on):** `actors` (needs/goals/lifecycle), `world` (regions/
  settlements), `relationships`, `events/history`, `time`. These *are* the
  opinionated ontology (`02 §3.3`).
- **Optional (pack-enabled):** `economy-deep`, `diplomacy`, `combat-tactical`,
  `magic`, `spaceTravel`, `naval`, `religion`, `crafting`, `genetics`, `psionics`,
  `cybernetics`, `spatial-grid`. A universe turns on what it needs.

### 2.4 Module decoupling rules

- Modules interact **only** through components, events, and intents — never by
  importing each other's internals. A module may *depend on* another's component
  schema (declared in `dependsOn`).
- A universe missing an optional module simply has those components/systems absent;
  content referencing a disabled module is rejected at load with a clear error
  (not a silent failure — a Warsim weakness).

---

## 3. Universe Pack format

A Universe Pack is a **directory/bundle** (zip for distribution) of a manifest +
content files + optional assets, all data.

### 3.1 Bundle layout

```
my-universe/
  pack.json5                 # manifest (below)
  content/
    species/*.json5
    cultures/*.json5
    governments/*.json5
    professions/*.json5
    items/*.json5
    traits/*.json5           # the RaceSuffix-style modifiers, generalized
    namegrammars/*.json5     # token grammars (Currency/KingdomNames pattern)
    partsets/*.json5         # part-assembly sets (faces/flags/weapons pattern)
    dialogue/*.json5         # context-tagged pools (TavernTalk pattern)
    eventtemplates/*.json5
    regions/*.json5          # world template / map seed
    tunables/*.json5         # overrides of module tunables
  scenarios/*.json5          # optional curated starting states (seed + setup)
  assets/                    # optional: icons, ascii-art sets, audio refs
  locales/*.json5            # optional: translations of name/text templates
```

### 3.2 The manifest (`pack.json5`)

```json5
{
  "id": "aslona-fantasy",
  "name": "Aslona-like Fantasy",
  "version": "1.0.0",
  "engineRange": ">=0.4.0 <0.6.0",   // compatible engine versions
  "modules": [                        // which capabilities to enable
    "core",
    "diplomacy",
    "economy-deep",
    "combat-abstract",
    "magic",
    "religion"
  ],
  "extends": [],                      // other packs this builds on (optional)
  "worldgen": {                       // how to build tick-0 worlds
    "regionTemplate": "aslona-fantasy:regions/continent",
    "speciesPool": "aslona-fantasy:pool/all",   // cf. Warsim RacePacks
    "factionCount": { "min": 5, "max": 9 },
    "techLevel": "medieval"
  },
  "defaults": { "baseTimeUnit": "day", "calendar": "aslona-fantasy:cal/standard" }
}
```

Notice `modules` + `worldgen.speciesPool` together = a **vast generalization of
Warsim's RacePack**: a RacePack only chose a race subset; a MythOS pack chooses the
*rules in play, the geography, the tech level, and every content table*.

### 3.3 Pack composition & overrides

- Packs can **extend** other packs (`extends`), adding/overriding records by id.
  (A Middle-earth pack could extend a shared "MythCore Fantasy" base.)
- Override resolution is **last-writer-wins by load order**, with explicit
  `override: true` required to replace an existing id (prevents accidental clobber).
- This makes packs **layerable**: a base setting + a "Halloween" flavor layer +
  a personal house-rules layer.

### 3.3a Content & IP stance (project policy)

This is an **educational / personal project**, so packs may **directly model named
fictional universes** — Middle-earth, Star Trek, the Elder Scrolls, Dune, etc. — by
name, rather than the renamed-and-filed-off "inspired-by" approach. Packs can encode
those universes' species, factions, geography, governments, timelines, and
relationships as structured worldbuilding data.

Two things to keep in mind, framed as engineering guidance rather than legal advice:

- **The engine remains universe-agnostic regardless** (`CLAUDE.md`'s genericity
  principle is untouched). IP-specific content lives *only* in packs; no module or
  engine code ever references a specific franchise. So this stance changes content
  policy, not architecture.
- **Structured facts vs. verbatim text.** The engine wants *data* — "Vulcans:
  long-lived, logic-prioritizing, homeworld Vulcan; Federation member" — which is
  exactly the unprotectable factual/structural layer and is the right granularity
  anyway. Avoid pasting large verbatim passages of source novels/scripts into pack
  files; you don't need them, and structured records are more useful to the
  simulation. If you ever move from personal use toward public distribution, the
  IP picture changes (trademarks, derivative-work rights) — a distribution-time
  decision, separate from how you build and use packs privately now.

### 3.4 Validation (the safety the data-driven approach buys you)

On load, every record is validated against its module's `ContentSchema`:
- referenced ids exist (no dangling `species/elf`),
- required modules are enabled,
- numeric ranges/enums are legal,
- name grammars/part sets are well-formed.

Failures are reported with file+record+reason. Because packs are **pure data**,
this validation is total and safe — untrusted packs can't execute code, only fail
validation. (Contrast Warsim, where a malformed line could desync the positional
parser silently.)

### 3.5 Tech level & "any setting" — how it actually works

"Any fictional universe" is real because the engine simulates **relationships,
needs, factions, value-flow, and events** — all setting-neutral. A universe differs
only in:
- which **modules** are on (magic vs spaceTravel),
- the **content** filling them (species, governments, items, names),
- **region-graph semantics** (continent vs galaxy vs city map),
- **tunables** (lifespans, drift rates, economy depth).

A "Star Empire" pack: enable `spaceTravel`, `diplomacy`, `economy-deep`; regions =
star systems, edges = warp lanes; species = alien races; governments = star
empires/federations; items = ships. **No engine change.** That is the test of
whether the abstraction is right, and this design passes it.

---

## 4. Example: the same engine, three universes

| Aspect | Aslona Fantasy | Star Empire | Modern Earth |
|--------|----------------|-------------|--------------|
| Modules on | diplomacy, economy, combat-abstract, magic, religion | diplomacy, economy, spaceTravel, combat-abstract | diplomacy, economy-deep, crime, media |
| Regions | provinces on a continent | star systems | cities/nations |
| Edges | roads/borders | warp lanes | flights/trade lanes |
| Actors | peasants…kings | citizens…emperors | workers…presidents |
| Factions | kingdoms | star empires | states/corporations |
| "Combat" | abstract battles | fleet battles (same resolver) | conflict/protest/war |
| Win-state | none (sandbox) or pack-defined scenario | scenario | scenario |

All four share one core, one save format, one scheduler, one relationship graph.

---

## 5. Modding & tooling posture (long-term)

- Because packs are validated data, an in-browser **pack editor** is feasible and
  should be a first-class long-term goal (worldbuilders never touch TS).
- AI assistance (`CLAUDE.md`) belongs **here**: generate draft content records, name
  grammars, descriptions — authored offline, then shipped as static data. The *game*
  never needs AI at runtime; the *authoring tools* may use it.
- A **module SDK** (TypeScript) is the advanced extension path, gated by trust.
