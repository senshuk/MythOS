# 24 — Local Maps: the Close View (the third RimWorld pass)

**Document type:** Design proposal — the two-scale map (planet ↔ place), studied from the
RimWorld 1.6 install in `/RimWorld` and mapped onto MythOS's existing substrate, LOD, and
Location machinery.
**Companion documents:** `08-rimworld-study.md`, `22-mood-and-causal-worldgen.md` (causal
worldgen — the geography this builds on), `03-entity-world-data-model.md` (Location),
`14-component-model.md`. Implementation anchors: `engine/geography.ts`,
`engine/substrate.ts`, `engine/location.ts`, `engine/lod.ts`, `ui/terrain.ts`, `ui/MapView.tsx`.
**Status:** L1 + L2 + L3 SHIPPED (2026-07 — `content/localmap.ts`, `ui/LocalMapView.tsx`,
zoom-adaptive amplification in `ui/terrain.ts`; read-only engine builders
`buildLocalChronicle` + `buildHouseholds`). Two shipped-time deviations from the
sketches below: (1) growth rings deferred — the sim keeps no population history to
band building ages from; (2) **L2 shipped as a DERIVED reading, not Location-tree
state**: households are computed from ties at request time (couples co-housed, the
unwed under a parent's roof, eldest heads the hearth) — same player experience,
zero new world state. Populating the Location tree remains L4's opening move,
when locations become sim-meaningful. L4 open.

---

## 1. What RimWorld actually does (read from its Defs)

RimWorld has **two map truths sharing one seed**, and the second is *lazy*:

1. **The planet** is a tile grid where each tile stores only *summary attributes* —
   biome, hilliness, elevation, rainfall, temperature, river links, road links, coast
   direction, faction ownership. It is built once, by an **ordered pipeline of
   `WorldGenStepDef`s** (`Data/Core/Defs/WorldGeneration/WorldGenerator.xml`):
   `Terrain → Tiles → Lakes → Rivers → AncientSites → AncientRoads → Factions → Roads →
   Mutators → Features` (named regions like "Menga Forest" come last, naming what the
   earlier steps made).

2. **A local map** (the ~250×250-cell playfield) is generated **on demand** — only when a
   tile is actually settled or visited — by a **`MapGeneratorDef`: an ordered, data-driven
   list of `GenStepDef`s** (`Data/Core/Defs/MapGeneration/CommonMapGenerator.xml`), each a
   small parameterised generator with an explicit `order`:

   ```
   10-100   abstract grids        (ElevationFertility — noise fields for the tile)
   200-300  natural terrain       (RocksFromGrid, Terrain, RemoveTinyIslands)
   390      roads                 (world road links enter/exit on the correct edges)
   400-800  structures            (critical, then non-critical: ruins, shrines)
   850-875  start spot, scenario
   900-1200 scatters              (geysers, plants, snow, animals)
   1500+    fog, final mutators
   ```

   Different map *kinds* — player base, faction base, encounter — are different
   `MapGeneratorDef`s **composing the same shared steps** with different parameters.
   1.6's `TileMutators.xml` adds per-tile landmark modifiers that hook multiple stages.

**The load-bearing ideas:**

- **Determinism makes the local map implied, not stored.** An unvisited tile's map
  doesn't exist anywhere; (world seed, tile id, tile attributes) will produce it
  identically whenever it's needed. Only *changes* need persistence.
- **Continuity sells the illusion.** The tile's world-scale facts flow *into* the local
  map: the river crosses it matching the world river's course and size; roads enter from
  the edges its world-graph neighbours actually lie toward; coastal tiles get their ocean
  on the correct side; rainfall/temperature drive plants and snow. Zooming in never
  contradicts what the planet view promised.
- **The pipeline is data.** Mods add/replace GenSteps in XML without engine changes —
  the exact shape MythOS's pack boundary wants.
- **What RimWorld does NOT do:** its local maps are *ahistorical*. A 5,000-year-old
  world generates the same scatter of ruins as a 100-year one. This is the gap MythOS
  can drive through (§4).

## 2. What MythOS already has (the anchors)

We are closer to this than it first appears — several pieces are *stronger* than
RimWorld's equivalents:

| RimWorld | MythOS today |
|---|---|
| Per-tile summary attributes | **A continuous causal Geography field** (450² grid over the world extent): elevation, wind-advected moisture, temperature, water kind, drainage flux + `flowTo` tree, hilliness, named features (`engine/geography.ts`). We don't need to *invent* a local tile's terrain — we can **sample and amplify the field we have**. |
| Lazy local maps | **The LOD system** (`lod.ts` focus/promote/demote) — the *social* version of "only the visited tile is real": one settlement lived in full, the rest macro. |
| Map gen from tile facts | The UI already re-derives the substrate from the seed (`MapView` pattern: presentation re-derives cheap deterministic data instead of shipping rasters over the worker boundary). |
| Settlement layout | **The Location containment tree** (`Location`, `parentId`, `childrenByParent`, `engine/location.ts` — settlement ⊃ district ⊃ building ⊃ room). Machinery + tests exist; **nothing populates it during play yet.** This is the prepared anchor. |
| Roads entering on correct edges | `ui/terrain.ts buildRoads` already traces valley-hugging road vectors between settlements over the real terrain, and `buildRivers` traces the drainage tree. The local map reuses their segments near the settlement. |
| GenSteps as data | The pack boundary (`content/mapstyles.ts`, `UniversePack`) — local-map vocabulary belongs there too. |

## 3. The proposal — "the Close View"

**Zoom past the world map's floor on a settlement (or press "walk its streets") and the
stage crossfades to a generated local map of that settlement and its surroundings — the
same deterministic world, four hundred times closer.**

### 3.1 Principles (where we deliberately diverge from RimWorld)

1. **Presentation first, simulation later.** RimWorld's local map IS its sim arena —
   pawns path on those cells. MythOS's sim is social and settlement-scoped; we do **not**
   move simulation onto a cell grid. The Close View is a *rendering of what the sim
   already knows*, drawn from facts it already produces. That is Legibility, not
   scripting — and it keeps the deterministic core untouched (L1–L3 add zero sim state).
2. **One seed, all the way down.** Everything on the local map derives from
   `mixSeed(seed, settlementId, salt)` + current sim facts. Same world, same year ⇒ same
   picture, on every machine. Nothing local enters the save file (Save Philosophy: the
   save is the world, and the world already implies this).
3. **The pack owns the vocabulary.** The engine knows only `LocalGenStep` (an ordered,
   pure `(facts, rng, canvas-plan) → plan` pipeline — RimWorld's GenStepDef, as
   TypeScript pack data). The fantasy pack lays out timbered houses, a shrine, fields;
   a sci-fi pack lays out domes and landing pads; a starfield world's pack supplies an
   orbital view or declares no close view at all (MODULES flag).

### 3.2 Terrain: sample + amplify (not regenerate)

The local frame is the settlement's neighbourhood (~12×12 world units of the 200-unit
world — a few km at fiction scale). Terrain comes from:

- **The Geography field as the authority**: elevation/moisture/temperature bilinearly
  sampled from the 450² grid set the *large forms* — the hill the town sits on, which
  side the sea is on.
- **Detail octaves** added below the grid's resolution: 2–3 extra fbm octaves (seeded
  `mixSeed(seed, 0x10ca1)`) modulated by the sampled `hilliness` — so zooming reveals
  crags in the highlands and gentle swells in farmland, never bilinear smear. This is
  the exact trick the terrain renderer already uses per-zoom, extended one level.
- **Water stays authoritative, never re-noised**: the local river is the drainage
  tree's actual course through the frame (`flowTo` walked at grid resolution, then
  smoothed + meander-detailed with the local rng), width ∝ `flux` — the river you saw
  from orbit is the river that runs past the mill. Coastline = the water field's edge,
  detail-amplified. Roads = the near-settlement segments of `buildRoads`' existing
  vectors, entering the frame from the directions of the settlement's real graph
  neighbours (RimWorld's continuity rule, for free).

### 3.3 The town plan: a LocalGenStep pipeline (pack data)

Facts already in `SettlementView`/engine state drive layout — nothing is invented:

```
TerrainSample     → the amplified ground (§3.2)
RiverAndCoast     → carve the authoritative water
RoadsIn           → world-graph road entries; their crossing = the market square
TownPlan          → streets radiate from the entries; density rings from the square
Buildings         → count ∝ population · size/quality ∝ wealth · style = culture pack
                    · the ruler's seat if governed (polity) · a shrine to the patron
                    deity · walls/palisade if the settlement has survived raids
Livelihood        → specialization: farm fields / fishing docks / mine heads / mills
Ruin              → if ruinedYear: generate the town at its peak, then decay it
                    deterministically by (year − ruinedYear) — collapsed roofs,
                    street trees, the shrine last to fall
Landmarks         → nearby named features labelled in the old tongue (featureName)
```

Each step is pure and ordered; a pack composes, reorders, replaces (`LocalMapDef` in the
`UniversePack`, exactly like `MAP_STYLES`).

### 3.4 History leaves marks — where we pass RimWorld

RimWorld's local maps are ahistorical; ours must not be. `eventsBySettlement` is already
an O(1) index. A `HistoryMarks` step reads the settlement's own chronicle and stamps it
into the plan:

- a **burned quarter** (regrown or rebuilt by years-since) for each raid/conquest/civil
  war event;
- a **monument** where a legend's deed happened; the **founder's tomb**; a memorial
  stone per famine with a toll;
- **growth rings**: building-age bands from the population history (a boom decade reads
  as a ring of same-era houses — Dwarf Fortress towns have this feel);
- the **faction split** drawn as the two poles' districts, and the civil-war barricade
  line while a conflict clock runs.

The Close View then answers the design pillar directly: *"why does this town look like
this?" — click the burned quarter, get the raid event, trace its causes.* Every mark
carries an `EventRef`, wired into the existing inspector/peek machinery.

### 3.5 Souls on the map (L2, the first engine change)

At `promote()` (already the moment full actors materialise), also populate the Location
tree deterministically: districts under the settlement, households under districts —
assignment from existing ties (spouses/children co-housed), workplaces from professions.
The focused settlement's Close View then shows *who lives where*: hover a house → the
household's peek card; click → the actor inspector. Other settlements still render a
Close View (terrain + plan from macro facts) but unpeopled — which **is the LOD story
made visible**: "only Aisyrivom is lived in full; the rest live on in chronicle and
rumour."

### 3.6 UI/UX

- **Entering**: zoom threshold (`view.s` ≥ ~5 with a settlement near centre) shows an
  "enter" affordance on the node; plus an explicit **"walk its streets"** button in the
  focus panel and settlement inspector. Crossfade the stage; the world map state is kept.
- **Leaving**: breadcrumb chip top-left ("◉ Aisyrivom — back to the world"), Esc, or
  zoom out past the local floor.
- **Same architecture as the world map**: one terrain canvas (deferred repaint + CSS
  transform during gestures — the pattern already proven) + one SVG overlay for
  buildings/labels/marks; hover peeks; lens toggles later (ownership, faith, age).
- The chronicle's local scope filter and the Close View reinforce each other: the feed
  scoped to the place, beside the place itself.

### 3.7 What is explicitly out of scope (until L4)

Moving any *simulation* onto the local map: pathing, per-building economics, cell-level
combat. If L4 ever wants events to name places ("a brawl at the Brass Tankard"), that is
the Location tree gaining sim meaning — a separate ADR, held to the org-intent
disciplines (bounded knowledge, outcomes-only history). The Close View must stay
valuable *without* it.

## 4. Phases

| Phase | Ships | Engine change |
|---|---|---|
| **L1** | Terrain amplification + town plan from current facts; enter/exit UX; hover names on buildings | none (UI + pack data only) |
| **L2** | Location tree populated at promote(); households on the map; click-through to actors | `lod.promote` + deterministic household assignment |
| **L3** | History marks (burned quarters, monuments, growth rings, barricades), each an EventRef | none (reads existing indexes) |
| **L4** | (optional, own ADR) events reference locations; arrivals at the gate; local lenses | Location becomes sim-meaningful |

## 5. Risks & open questions

- **Town-plan quality is the whole game.** A bad plan reads as noise and *damages*
  believability. Mitigation: start with RimWorld's own humility — their faction bases
  are simple prefab clusters; a crude-but-coherent radial plan with correct river/road/
  coast continuity beats an ambitious incoherent one. Iterate with screenshots.
- **Scale fiction**: one settlement of 350 souls ≈ 80–120 buildings — renderable as
  simple shapes at SVG level, no art needed (Atlas line-work style: roofs as filled
  quads, the same gold/ink language).
- **Threshold vs button**: ship both; the button is discoverable, the zoom threshold is
  the delight.
- **Starfield worlds**: the pack decides (`MODULES`/`LocalMapDef` absent ⇒ no Close
  View, or an orbital-system view later). The engine never special-cases it.

## 6. Decision-filter check

1. *Improves the simulation?* Indirectly — it makes existing simulation legible (and L2
   grounds households, which future systems can use).
2. *Generic across universes?* Yes — LocalGenStep vocabulary is pack data; engine knows
   only the pipeline.
3. *Data-driven?* The pipeline, styles, and building vocabulary are all pack data.
4. *Emergent gameplay?* The map is derived, so every burned quarter and growth ring is
   emergent record, not scripted content.
5. *Legible & traceable?* Its entire purpose — every mark carries an EventRef.
6. *Special cases?* None added; ruins/starfields flow through the same pipeline.
7. *Five years?* Two-scale worlds are the genre-proven shape (RimWorld, DF, CK); the
   lazy-deterministic approach is the only one that scales to 55 settlements.
