# 22 — Mood & Causal Worldgen (the second RimWorld pass)

Design 08 (the RimWorld study) identified four transferable storytelling systems, and all
four shipped: opinion-as-thoughts, Chronicle/Tales, the Grammar primitive, and the
Director. This document records the SECOND RimWorld pass: the two systems the study
deferred — the **inner life of a pawn** (needs → thoughts → mood → mental breaks) and
**causal world generation** (climate and rivers with physical reasons). Both shipped
together (save v21).

---

## Part 1 — Mood: how an actor's own life feels

### The gap

Opinion-as-thoughts made *relationships* legible sums of sourced, decaying marks — but an
actor still had no feelings about their OWN life. Grief did not exist. A plague survivor
was indistinguishable from a newlywed. RimWorld's deepest storytelling loop — suffering
accumulates → a mind breaks → the break makes new history — had no MythOS counterpart.

### The shape

**Self-thoughts** (`engine/mood.ts`, `world.selfThoughts`): the SAME `Thought` mark +
`ThoughtSpec` machinery as opinion, held about one's own life. Pack data
(`SELF_THOUGHT_SPECS`): grief_spouse, grief_kin, insulted, heartened, newly_wed,
child_born, brawl_shock, fearful_times, good_times, catharsis. Emitted at the deed's
site — `killActor` (grief for spouse and kin), the resolver (kindness/dispute/marriage/
brawl), lifecycle (births), the Director (a plague or boon colours every villager).
Every mark carries its `cause` event id.

**Mood** = neutral 500 + temperament baseline (`moodBaseline`: warm souls run brighter,
hot-tempered lower) + situational rows (each need's band, weighted by
`MOOD_NEED_WEIGHTS` — an empty need weighs more than a full one lifts, loss-aversion) +
the diminishing per-kind sum of active self-thoughts. `moodReasons` lists every
contribution — the player can always ask "why do I feel this way" and get sourced rows.

**Mental breaks** (`maybeBreak`): when mood falls below a temperament-set threshold
(`breakThreshold`: the volcanic snap early, the serene endure), each week risks a break —
chance scaling linearly to `BREAK_CHANCE_MAX` at mood 0. The break is a normal `Intent`
(`kind: 'break'`, `mode: lash_out | withdraw | binge`) chosen by temperament-weighted
pack data (`BREAKS`); lash_out targets whoever the heart already resents most (lowest
opinion, RNG-free). The resolver emits a public `mental_break` event (chronicle interest
22 — the village remembers the year a neighbour lost their grip), applies the mode's
effects through existing machinery (a lash-out is a real slight that can seed a real
rivalry), and grants **catharsis** — the positive thought that stops a broken soul
re-breaking weekly.

**One rule, every actor.** The break check runs in BOTH intent producers: the NPC decider
(settlement stream) and the player seam in `actWeekly` (player stream). A broken mind
takes the turn from anyone — there is no player exemption and no `if (isPlayer)`.

**Feedback loops now closed:** mood colours everyday encounters (a miserable soul sours
company → quarrels → worse mood — RimWorld's social-fight spiral, gently); breaks enter
the chronicle, which the Director reads as drama, so a village spiralling into misery
eases the storyteller's hand.

### Discipline

- LOD: only full-fidelity actors hold self-thoughts; `addSelfThought` is the single gate
  (a no-op for aggregate/summary actors), so emitters never check fidelity.
- Determinism: serialized (save v20 → v21, backward-compatible: old saves start
  unburdened), digested into `hashWorld` (`st`/`stv` per actor — mood steers NPC
  behaviour, unlike `playerAmbition` which stays excluded).
- Presentation: `PlayerView.mood` + `ActorDetail.mood` ({value, word, reasons}); the
  cockpit shows "Spirits: <word>" with reasons on hover; the inspector shows any actor's
  mood — every soul's inner weather is inspectable (Legibility).

## Part 2 — Causal worldgen (climate with reasons)

### The gap

Moisture was an independent noise field (deserts were *painted*, not caused) and rivers
were random walks from high ground. "Why is this side of the mountains dry?" had no
answer — a Legibility failure at the map's scale.

### The shape (`engine/geography.ts`, still a pure function of the seed)

1. **Wind → rain shadow.** A seeded prevailing wind (one of 8 compass steps, exposed as
   `geo.wind`) marches across the grid: air saturates over water, drops a base drizzle
   over land, and is wrung out hard where the ground RISES (orographic lift). Windward
   coasts are lush; beyond a range lies desert. `wetness` still shifts whole-world
   climate for packs.
2. **Rain → rivers.** Depressions are filled (Planchon–Darboux) so every land cell
   drains; each cell's rainfall (its moisture) routes downhill by steepest descent;
   where accumulated **flux** crosses `RIVER_FLUX` the cell is a river. Rivers now grow
   downstream, rise in wet highlands, and always reach water or the map edge.
   `geo.flux` carries size (a mouth is wider than a spring).
3. **Hilliness.** Local relief classifies every cell flat/rolling/hills/mountainous
   (`geo.hilliness` — RimWorld's hilliness as data). Mountains dent `terrainCapacity`.
4. **Named features.** Connected components worth a name — seas, sizeable lakes,
   mountain ranges (anchored at their peak), great rivers (anchored at their mouth,
   flux ≥ `GREAT_RIVER_FLUX`) — are identified as `geo.features` (geometry + stable
   index only). The PACK names them (`content/languages.featureName`) in the world's
   **old tongue** — one dead language per world, so the land was named before any living
   culture arose. The map letters them like an atlas.

### Consequences

Settlement founding, economy, and biomes all read the same fields as before — but the
fields now have causes, so civilization follows geography that itself follows physics:
fertile belts trace windward coasts and river valleys; the great cities sit at mouths of
great rivers; the dry side of the spine stays sparse. Fixed-seed worlds changed shape
(tests that relied on seed luck were re-anchored to force their premises).

### Costs & notes

- Generation is a few×  slower than the old noise pass (fill + flow) — still one-time
  per world/load at 208².
- Old saves load fine (geography is never serialized), but their settlements were sited
  under the old generator's terrain; re-derived local readings (biome, yields) shift.
  Accepted for the PoC; a production engine would version the generator.

## Part 3 — refinements after an empirical review

An empirical pass (spot-generating worlds and tallying the results) caught three things
worth fixing before this counts as done:

1. **Ranges never formed.** Detecting a range from cells classed mountainous by *relief*
   was wrong — steep spots are isolated, so no component ever reached range size. A range
   is a **massif**: a connected run of high-*elevation* ground (`RANGE_ELEV` 0.68) that
   rears up into at least one true peak. Now every hilly world has a handful of named
   ranges, anchored at their highest peak.
2. **Too many labels.** A world had ~13 lakes + ~13 ranges — a cluttered map, not an
   atlas. Features are now culled to the **notable few** per kind (seas 3, ranges 6, great
   rivers 5, lakes 5), largest first. The rest of the terrain is still drawn, just unnamed.
3. **Rain shadow only shows on hot worlds** — a temperate default world is ~0.5% desert,
   a hot/dry one 50–70%. That's correct (deserts need heat), not a bug; noted so it isn't
   mistaken for the advection failing.

**Settlements now have a sense of place.** The named features were only map decoration
until settlements *knew* them. `geography.featureOf` (per-cell membership) + `nearestFeatureAt`
(a bounded ring search) let a settlement learn the landmark it sits beside; `lod.ts`
resolves it through the pack tongue into `Settlement.landmark` — "on the shores of the
Gairlsat", "in the shadow of the Waistust", "on the banks of …". Surface worlds only
(behind a `SurfaceSubstrate` check — a galaxy has no shoreline), honest radius (~6 cells,
so "beside" means beside), and only where notable (a town on an ordinary river gets
nothing — not every place is famous). Coverage: ~75–100% of settlements on most worlds,
0 on a dry pangaea whose towns cluster on un-great rivers. Serialized with the settlement
(optional, no migration), excluded from the hash (derived flavour, stable per seed),
surfaced in the settlement inspector. This is "geography is the prime mover" reaching the
story text, not just the sim numbers.

## Part 4 — Mapgen v2 (make it read like a RimWorld planet)

The causal spine (Parts 2–3) was right but a single map read as *one* climate. This pass
makes a map look like a RimWorld world — a slice of planet spanning many biomes — and adds
the two things that most sell that look: roads, and terrain the renderer does justice to.
(The aspect ratio was already square like RimWorld's play map, so no ratio change.)

1. **Climate bands.** Temperature is now a FULL latitude gradient — cold at one pole, hot
   at the other — so one map runs tundra → boreal → temperate → savanna → jungle. `baseTemp`
   still shifts the whole band (icier/hotter worlds), so worlds differ in overall warmth
   while each keeps a rich spread. Measured: 5–8 biomes above 2% land per map (was ~2–3).
   Settlement *placement* is unaffected (it reads fresh-water/fertility/elevation, not
   temperature) — only biomes/yields shift.
2. **Richer coastlines & islands.** The base elevation is now DOMAIN-WARPED (a low-frequency
   offset bends the sampling space) for organic bays, capes and fjords, plus a
   high-frequency coastal wobble that breaks smooth shores into inlets and offshore isles.
3. **Roads.** `buildRoads` (ui/terrain.ts) routes a path along each peaceful region edge,
   nudging interior points perpendicular toward lower LAND elevation so a road hugs the
   valleys and bends around hills; a pair mostly separated by water becomes a dashed `sea`
   lane instead. Pure function of geography + node positions — computed once per snapshot in
   a `useMemo`, never stored, no determinism/persistence impact. Hostile borders stay
   straight rose lines (a contested march, not a road).
4. **Render polish** (paintTerrain): coastal SHALLOWS (sea brightens toward the shore via
   `seaDist`, with a turquoise kiss on the shallowest), SNOW on cold high ground (white
   peaks near the poles and on tall ranges), and a stronger HILLSHADE amplified by
   `hilliness` so ranges read as real ridges.

Costs: the elevation change reshapes fixed-seed worlds (one seed-luck ambition test was
re-anchored). geography is still pure-from-seed and never serialized, so no save/hash impact.
12 geography tests (added: climate-band span, road classification); 260 total green.
Browser-verified: snow-capped northern band, roads threading between settlements, varied
coastlines, named features — a recognisably RimWorld-like world map.

### Part 4b — roads + fidelity (after "still janky" feedback)

The first roads (perpendicular per-point nudges + straight segments) came out sawtoothed,
and the 208-grid read blocky when zoomed. Both are render-only fixes — no generation change,
so no determinism/seed impact:

- **Roads are now a least-cost A\* path** over a terrain cost field (open water near-impassable,
  high/steep ground dear, gentle low land cheap), so a road threads the passes, hugs the
  valleys and runs the coast; the cell path is downsampled and drawn as a **Catmull-Rom
  cubic-bezier** — a flowing curve, not a zigzag. A water-separated pair is a gently-bowed
  `sea` lane instead. A* uses generation-stamped scratch buffers (no per-search N² clear);
  computed once per snapshot in a `useMemo`.
- **Terrain is bilinear-blended.** The painter precomputes a base colour per cell (biome or
  water, with coast shallows + snow) once, then **bilinear-blends the four surrounding cells
  per pixel** — smooth coasts and biome transitions instead of blocky squares — with hillshade
  applied per-pixel on top and rivers pulled back crisp (a one-cell river would otherwise blur
  away). Canvas renders at ~1.5× the display box so it stays sharp when zoomed. (Follow-up fix:
  hillshade is applied to LAND ONLY — shading the sea-floor relief made open water read as
  mountains.)

## Part 5 — Mapgen v3 (geological realism)

A deep pass on the terrain's physics, driven by "improve fidelity/realism." Each generation
step is pure-from-seed (no save/hash impact) but reshapes worlds, so seed-luck tests were
re-anchored as they surfaced.

- **v3-A — 300-cell grid + priority-flood drainage.** Grid 208→300 (finer everything), river
  thresholds scaled by (N/REF_N)². Replaced the O(N·N²) iterative depression fill (1.6s and
  under-draining at N=300) with **priority-flood** (Barnes 2014, ~150ms) that records a
  **drainage tree** — each cell's downstream — so flow accumulates to the sea along a real tree
  instead of dispersing via local steepest-descent on the flat filled surface. Site-suitability
  cell-distance thresholds (fresh-water reach) scaled by resolution, else founding starves.
- **v3-B — tectonic mountain belts.** `computeTectonics` scatters 5–8 drifting plates (Voronoi
  with a noise-warped wandering boundary); where two plates CONVERGE, a ridge is raised that
  falls off with distance — a **cordillera**. Replaces the old scattered ridged noise. ~5 coherent
  ranges per world. (Uplift tuned down after it over-mountained worlds and cut settlement counts.)
- **v3-C — hydraulic erosion.** `hydraulicErosion` runs 4 stream-power passes on the raw
  elevation: route drainage, then lower each land cell by ~K·√flux·slope so rivers **incise
  V-valleys** and dissect the ranges. Temperature is computed *after* so the lapse term reflects
  the carved terrain. Side benefit: the carved valleys create fresh-water sites that **recover the
  habitability** the uplift cost (seed 123456: 12→35 settlements).
- **v3-E — render polish.** Sandy **beaches** at warm waterlines, **valley ambient-occlusion**
  (concave ground sits in shadow), a low-frequency **detail-noise grain** so broad biome fills
  aren't flat, and rivers rendered a touch **wider** (nearest + adjacent cells pulled toward the
  river colour). Render-only.

Result: snow-capped linear ranges dissected by river valleys, textured biome bands from tundra
to jungle, smooth coasts with beaches, A*-routed roads, named features. 260 tests green.
(Deferred, v3-D: river deltas + endorheic salt lakes — heavier generation for marginal payoff
on the current arid-leaning worlds; left as future work.)
