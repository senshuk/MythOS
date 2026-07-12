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
zero new world state. **L4 v1 SHIPPED as VENUES (design/25 is its ADR):** the
focused settlement mints its public venues (square, shrine, tavern, ruler's hall)
as real Locations at promote; weddings, brawls, friendships and feuds name their
venue in prose ("married at the shrine of the Windwalker"), venues are inspectable
("what happened here"), and the close view's drawn buildings link to them. Venue
choice is a pure hash — no stream perturbation, verified by the determinism suite.

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

---

## 7. L4 addendum — cell mechanics (the terrain proposal)

**Document type:** Design note / mini-ADR for the L4 line §3.7 held open. Prompted by a
RimWorld terrain-system study (its ~40 discrete terrain Defs — Soil/Rich Soil/Sand/
Gravel/Marsh/Mud/Ice, moving-vs-still water, buildable-vs-impassable — each carrying
fertility, movement, buildability and beauty numbers). The question this note answers:
*how much of that do we adopt, and how, without betraying §3.1 or the engine philosophy?*

### 7.1 The trap, and the reframe

RimWorld's terrain is a **discrete enumeration** tuned to its base-building minigame:
`Sand`, `Gravel`, `MarshyTerrain`, `Concrete`, each a named row with hardcoded stats. To
port that list would hardcode a *fantasy-genre vocabulary* into the engine — exactly what
"Everything Is Data" and the engine/pack boundary forbid. A sci-fi pack has no "Marsh";
it has regolith and ash-flats. So we **do not port the terrain types**.

What we port is the **mechanisms** those types encode, expressed as **continuous,
universe-neutral fields** the engine already owns (or can derive) — and let the *pack*
supply the labels. RimWorld says "this cell is Marsh → 0.7 fertility, slow move, hard to
build." MythOS says "this cell has moisture 0.8, elevation just above sea, hilliness 0,
low flux → high wetness → the pack calls it a mire, and it reads as fertile-but-boggy."
Same texture, no enum, and it survives a pack swap.

This keeps §3.1's core divergence intact: **we still do not move the social simulation
onto a cell grid.** L4 adds mechanical *properties* to the physical substrate — things
presentation renders and bounded local systems may read — not a pawn-pathing arena.

### 7.2 The five primitives (what L4 actually adds)

Each is a pure function of the existing `Geography` field (or the derived plan), so each
adds **zero save state** (Save Philosophy — the seed already implies it):

1. **`groundMoveCost(geo, cell)`** — a continuous impedance for crossing a *land* cell on
   foot: `1 + elevation·k + hilliness·k + wetness·k`. Generalises the road router's
   private `cellRoadCost` (`ui/terrain.ts`) so one function feeds road routing *now* and
   local pathing *later*. RimWorld's Fast/Medium/Slow tiers become a scalar, so "roads
   avoid the bog" falls out for free — no `Marsh` row required.
2. **Sub-biome fertility variance** — the economy stops reading one flat biome yield and
   blends the *raw* `fertility` field into it (`yield = biomeBase · fertilityFactor`). A
   grassland now has rich pockets and thin ones — RimWorld's Rich Soil (140%) vs Sand
   (~70%) *within* one biome, from the noise field we already compute. (This shifts
   worldgen: founding viability and carrying capacity read `terrainYields`. It stays
   deterministic, so the determinism suite holds; only the *specific* worlds change.)
3. **Graded buildability** — `buildable()` becomes `buildability(): 0..1` (0 submerged/
   impossible, low on steep/boggy ground, 1 on flat dry ground). The Close View places
   fewer/smaller structures on marginal ground instead of a hard yes/no — RimWorld's
   marsh "high fertility, difficult to build on" texture, as a threshold not a flag.
4. **Wear / trampling** — a `wear` value that rises with local traffic; worn ground reads
   packed (lighter, faster, less fertile). This is the one primitive that *could* imply
   per-cell state. **Resolution: derive it, don't store it** — traffic concentrates on
   streets and around the square, which the plan already knows, so wear is a derived
   overlay (paths form because traffic flows, legible cause→effect), not a stored counter.
   A future *simulated* trampling (cells accruing wear from actual movement) is the only
   part that would need state, and is explicitly deferred past L4.
5. **Water flow speed** — `WaterKind` already separates SEA/LAKE/RIVER; a `flowSpeed`
   derived from `flux` recovers RimWorld's shallow / moving-shallow / moving-deep / deep
   distinction as a continuous property (fords are cheap on a trickle, impassable on a
   torrent; the river renders with current) — four enum rows collapse to one number.

### 7.3 What stays out of scope even at L4

- **Real-time pawn pathing / per-tile combat as the sim's arena.** L4 delivers the
  *fields*; it does not make the local map the place simulation *runs*. If a future system
  reads `groundMoveCost` for a bounded outcome (a raid resolves faster over open ground
  than through a mire), that consumer is held to the org-intent disciplines — bounded
  knowledge, outcomes-only history — exactly as §3.7 required.
- **Per-cell beauty / cover as combat mechanics.** RimWorld's beauty and cover numbers
  are base-building-and-firefight coupling we have no arena for. Deferred until (and
  unless) there is a system that consumes them.
- **Discrete terrain Defs.** We never introduce a `TerrainDef` enum. If a pack wants to
  *name* zones ("mire", "shingle", "hardpan"), that is a pure labelling function over the
  continuous fields (like `biomeOf`), living in pack content — never in the engine.

### 7.4 Decision-filter check

1. *Improves the simulation?* Yes — #2 gives the economy real sub-biome texture; the rest
   makes terrain legible and lays the substrate future bounded systems can read.
2. *Generic across universes?* Yes — all five are continuous physical fields; the pack
   owns every label. A pack swap changes vocabulary, not engine code.
3. *Data-driven?* The fields are seed-derived; the labels and yield curves are pack data.
4. *Emergent gameplay?* Rich-soil pockets steer where farms and wealth concentrate; worn
   paths emerge from traffic; fords open and close with the season's river — all derived,
   none scripted.
5. *Legible & traceable?* Cause→effect throughout: the path is worn *because* traffic
   flows there; the ford is impassable *because* the river is in flood.
6. *Special cases?* None — starfield packs simply supply no surface fields; the same
   functions return their neutral defaults.
7. *Five years?* Continuous-field terrain with pack-owned vocabulary is the only shape
   that lets a new universe reuse the mechanics without re-tuning an enum of terrain rows.

---

## 8. Town-plan v2 — fidelity & realism

**Document type:** Design note for a fidelity pass on the Close View plan. The L1 plan
(§3.3) is a deliberately-crude radial *sketch* — spokes from the centre, houses jittered
along them (overlaps and all), civic buildings dropped at random angles, workshops
scattered. It reads as *a* town, not as *this people's* town on *this ground*. v2 closes
that gap in three tiers, all still **presentation-only** (zero sim/save state).

### 8.1 The principle — realism is fidelity to the sim

In MythOS a town is believable when its form truthfully reads its facts: this culture,
this wealth, this economy, this terrain, this history. So the goal is **not decoration**;
every element v2 adds must read a real fact. Two ideas carry the pass:

- **Parcels are the new substrate of the plan.** Instead of stamping shapes at jittered
  points, buildings claim a **footprint** on the ground; nothing overlaps, buildings front
  a street, yards fall out behind. This one change removes the biggest fake-tell.
- **Culture is a first-class input to FORM**, not just a label on a tooltip. The pack maps
  each culture to a **`TownForm`** (grid / organic / dispersed / terraced), a building-shape
  vocabulary, and a material tone — so a steppe herder folk and a mercantile coast folk lay
  out visibly differently, the same way `biomeOf`/`MAP_STYLES` are pack data.

Everything below stays deterministic (`mixSeed(seed, settlementId, …)`), pack-owned, and
derived — a pack swap changes the vocabulary, never the engine.

### 8.2 Tier 1 — structural realism (the big lifts)

1. **Parcel placement (`Parcels`).** A claimed-footprint model replaces `Houses`' jitter:
   a candidate footprint is accepted only if it clears existing parcels, sits on buildable
   ground (§7.2 graded), and fronts a street; it reserves a back yard. Deterministic scan
   in a fixed order so the same town packs the same way.
2. **A connected, terrain-conforming street network (`TerrainStreets` v2).** Streets follow
   the **low-`groundMoveCost` grain** — switchbacking a hillside, hugging a valley, running
   a **bank-road** along the river — and gain **cross-links** between spokes, so the core
   reads as a web with **blocks** (which the parcel step then fills), not a bare star.
3. **Culture-specific form.** The pack's `TownForm` per culture drives street pattern
   (tight grid vs organic tangle vs dispersed compounds vs hillside terraces), the parcel
   packing density, and the building-shape set. This is the most MythOS-aligned lift:
   fidelity to *who lives there*.

### 8.3 Tier 2 — sim-grounded detail (cheap now the terrain fields exist)

4. **Livelihood ← real geography.** Extend `Livelihood` with the §7 fields: **mills on
   fast river reaches** (`cellFlowSpeed`), **terraced fields on slopes** vs strip-plots on
   the flat (`buildability`), **docks toward deep water**, and a **bridge drawn where a road
   crosses the river** (we already cost the ford; now show the crossing).
5. **Zoning / density rings.** Replace uniform outward-thinning with legible rings — civic
   core → craft quarter → residential → agrarian fringe — so the town *reads* its economy
   spatially.
6. **A coarse building-age gradient.** True growth rings need a pop history we don't keep
   (§ shipped-time deviation 1); approximate it — **old dense core, newer sprawl** from
   distance-to-centre + `foundedYear` — weathered stone at the heart, fresh timber at the
   edge. Lands the "this town has lived" feel without new state.

### 8.4 Tier 3 — polish

7. **Footprint variety** — attached row-houses in the dense core, walled compounds for the
   wealthy, plain cots at the fringe (not one rectangle repeated).
8. **Depth** — a consistent drop-shadow / light direction so the flat SVG reads as built
   volume (Atlas line-work, unchanged palette).
9. **Biome vegetation** — the countryside's flora follows biome (palms at a desert oasis,
   conifers in taiga, near-bare tundra), not uniform green dots.
10. **Citadel + terrain-following walls** — a keep on the **highest ground** in the frame
    and a palisade that hugs defensible terrain (ties to `defensibility`, §7 conflict work).

### 8.5 The Close View now zooms (supersedes the L1 "static vista")

L1 shipped the Close View as a *fixed raster* — a composed vista, not a pannable stage
(§3.6). That made magnifying it (browser/OS zoom, or just leaning in) hit the raster's
resolution and blur. §8 lifts that: the Close View now **zooms and pans**, and the terrain
canvas **re-paints the visible sub-frame at native resolution** on each settle — the world
map's proven *decoupled-repaint* pattern (`ui/MapView.tsx`): during a gesture the painted
bitmap rides a cheap CSS transform, and ~160ms after it settles one native repaint lands
and the transform resets. Because `paintTerrain` is zoom-adaptive (finer fractal octaves as
the frame tightens), nearing the ground now reveals *real* detail instead of a magnified
smear. The SVG town-plan overlay rides the same transform, so plan and terrain stay locked.
This is still pure presentation — no sim state, one seed all the way down.

### 8.6 A 3D terrain view (WebGL prototype)

A flat 2D top-down paint has a hard ceiling — it can never read like a real fly-in, because
below the 450² grid there is no real data and the shading is 2D. `ui/LocalTerrain3D.tsx` is a
**raw-WebGL2 prototype** that takes the other road: a heightmap of the settlement's ground —
the world's real elevation (bilinearly sampled) for the large forms, continued with coherent
fbm below the grid — rendered as a lit, orbitable 3-D mesh with slope/altitude colouring
(rock on the steep, snow on cold heights, biome tint on the rest). It runs on the **GPU**, so
orbit/zoom stay at 60fps with no main-thread repaint stall (the 2D canvas's weakness), and it
adds **no dependency** (hand-rolled shaders + a tiny mat4). Reached by a **"3D" button** in the
close view. It extrudes the **town PLAN onto the mesh** — buildings with **pitched gable roofs**
(pale timber walls, darker roofs; per-role heights, the seat rising over the houses, a peaked
shrine), monuments as flat-topped boxes, walls/bridges as ribboned boxes, trees as cones — plus
**streets and fields draped on the surface**, over a **translucent water plane** at sea level
that gives a smooth shoreline (the land dips under it rather than stair-stepping). It reads as a
recognisable town on real terrain, orbitable at 60fps. Verified on a mountain settlement
(Krylylle): snow-capped peaks, forested slopes, red-roofed houses on the mountainside — the
dramatic relief a flat coastal town (Aisyrivom) can't show.

**Atmosphere pass ("Path B" — hand-written, still no dependency):** a two-pass pipeline now
renders the scene into an offscreen buffer and resolves it to the screen through **FXAA**
(NVIDIA 3.11 compact port). The scene shader applies **ACES filmic tone mapping** (+ soft
skylight) and **exponential distance fog** toward the horizon; a fullscreen **atmospheric sky**
(view-ray gradient zenith→horizon→ground, with a sun disk + glow) fills the background, and the
fog fades distant terrain into it for real atmospheric perspective. Together these lift it from
"flat-shaded mesh" to a graded outdoor scene — the biggest look-per-effort win short of adopting
a 3-D engine. (The fog is **camera-relative** — normalised by camera distance so the focal
plane stays clear and only the far background hazes — after a first attempt fogged everything.)

**Shadow maps:** the scene depth is rendered once from the sun into a 2048² depth texture
(the light and geometry are static), and the main pass projects each fragment into light space
and PCF-samples it (3×3) for soft self- and cast-shadows over terrain and buildings. Attributes
use fixed locations (0/1/2) so one VAO feeds both the scene and the depth-only shadow program.
A lower sun angle gives longer, readable shadows and stronger relief.

**SSAO + reflective water:** the pipeline now renders the scene into a colour + **sampleable
depth** target, computes **SSAO** (16-sample hemisphere in view space, position + normal
reconstructed from depth, blurred) and multiplies it into the composite — contact/crevice
darkening that grounds the buildings and deepens the terrain. The sea is a **reflective water**
shader (its own program): the analytic sky reflected through a **Fresnel** term, **rippled
normals** (drifting noise, so it animates via a continuous loop), and a sharp **sun glint** —
convincing water without a planar-reflection re-render (which would also mirror the terrain — a
later step). Note: the "rock on steep faces" tint is now gated to TERRAIN (`uRock`), so vertical
building walls keep their timber colour instead of greying. Vibrance (post-tonemap saturation)
is tunable — set to 1.15.

**Three.js is now THE 3D renderer** (`ui/LocalTerrain3DThree.tsx`; the hand-rolled WebGL
renderer was deleted after the comparison). The geometry is renderer-agnostic in
`ui/terrain3dGeo.ts` (`buildTerrain`/`buildStructures` — the world's real elevation continued
with fbm, and the town plan extruded), fed into `THREE.BufferGeometry`. What was ~500 lines of
hand-GLSL is now three built-ins: PCFSoft shadow maps from a `DirectionalLight`, `SSAOPass` +
`SMAAPass` + `OutputPass` in an `EffectComposer`, an atmospheric `Sky`, `ACESFilmicToneMapping`,
`FogExp2`, `OrbitControls`, and animated **`Water`** (real reflection + refraction + sun glint,
with a procedurally-generated tiling normal map so it needs no image asset). Two fixes made on
consolidation: vertex colours are converted **sRGB→linear** before upload (three renders linear;
without this the biome colours read pale), and the whole 3D view is **`React.lazy`-loaded** so
three.js sits in its own chunk (~173 KB gzip) off the initial bundle (which dropped to ~124 KB
gzip) — it downloads only when the "3D" button is pressed. Cost: one dependency (`three`).
Notes: adding/removing the dep or editing the `lazy()` host file throws transient Fast-Refresh /
optimiser errors in dev — a dev-server restart clears them; production builds are clean. **PBR terrain textures (slope/altitude splat).** `scripts/gen-terrain-textures.mjs` generates
seamless tiling **grass / rock / snow** material sets (albedo + normal) into `public/textures/`
(committed files — a photo-CC0 set from ambientCG/Poly Haven can replace them 1:1). The terrain's
`MeshStandardMaterial` **splats them by slope + altitude** via an `onBeforeCompile` injection:
cliffs (`vWNrm.y` low) bare grey rock, high ground (`vWPos.y`) catches snow, the rest is grass —
and grass keeps the biome hue (biome vertex colour × grass detail) while rock/snow show their own
colour, so it reads clean instead of muddy. A per-fragment world position + world normal are
passed through for the blend.

**Water.** three's `Water` mirrored the (hazy, near-white) Sky and read grey no matter how the
sky/params were tuned. Replaced with a **custom water `ShaderMaterial`** we fully control: a
deep-blue base that dominates, a *bluish* grazing sheen (never white), animated ripple normals,
and a bright sun glint. Colours are authored in LINEAR (the composer's `OutputPass` tone-maps),
and it uses three's own fog chunks (`fog: true` + `UniformsLib.fog`) so it matches the scene. Now
the sea reads blue at every angle. The Sky was also clarified (lower turbidity, higher rayleigh).

**SSR — evaluated and deliberately NOT adopted.** The only reflective surface is the flat sea,
which already uses three's `Water` = a **planar reflection** that renders the full mirrored scene
(terrain + buildings genuinely reflect). For a flat plane, planar reflection is *strictly better*
than SSR: SSR is screen-space, so it drops off-screen/behind-camera geometry and shows edge-fade
artifacts — a downgrade here. `SSRPass` also replaces the render pass and doesn't compose with the
`SSAOPass` we depend on. SSR is the right tool for arbitrary/curved reflective surfaces, which this
scene doesn't have. Productive reflection levers instead: an **environment map** (PMREM from the
`Sky`) for subtle sky reflections on roofs/terrain via metalness, or a **wet-shoreline** band
(lower roughness near sea level). Remaining polish: streets/fields are
flat drapes (fine on gentle ground, can clip on steep slopes), and vertical exaggeration vs.
building scale is hand-tuned. StrictMode note: the WebGL context must NOT be `loseContext()`-ed
on cleanup, or the remount reuses a dead context and every shader compile fails.

### 8.7 What stays out of scope

Building interiors, per-building economics/sim, real population-history growth rings, and
any pawn pathing — all still §3.7 / L4 territory. v2 is a richer *rendering* of facts the
sim already produces, nothing more.

### 8.8 Decision-filter check

1. *Improves the simulation?* Indirectly — it makes the sim's facts (culture, wealth,
   economy, terrain, age) far more legible in one glance.
2. *Generic across universes?* Yes — `TownForm`, shapes and tones are pack data; the engine
   knows only the parcel/step pipeline. A sci-fi pack swaps in domes and habs unchanged.
3. *Data-driven?* Culture forms, building vocabularies and zoning curves are all pack data.
4. *Emergent gameplay?* The plan is derived, so every terrace, mill and weathered core is an
   emergent read of that town's real situation, never authored.
5. *Legible & traceable?* Its whole purpose — the form answers "what kind of place is this?"
   at a glance, and every civic/history mark keeps its click-through.
6. *Special cases?* None — ruins and starfields still flow through the same pipeline; a
   culture with no declared `TownForm` falls back to the organic default.
7. *Five years?* Parcels + pack-owned form is the shape that lets new cultures and new
   universes get distinct towns for free, without touching the renderer.
