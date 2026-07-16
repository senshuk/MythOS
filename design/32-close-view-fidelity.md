# 32 — Close-View Fidelity: performance, ground, and the lived-in look

**Document type:** Proposal — a staged plan to close the gap between the 2D close view
and the settlement fidelity of the best 2D colony sims (RimWorld studied directly:
five reference maps across biomes, cultures and eras). Comprehension first
(CLAUDE.md): every visual gain below is a *derived readout* of sim state the plan
already carries — nothing stored, nothing scripted, deterministic per seed.
**Companion documents:** `24-local-maps.md` (the Close View + town plan pipeline),
`27-lived-in-villages.md` (inhabitants), `28-settlement-legibility.md` (fortunes,
architecture), `22-mood-and-causal-worldgen.md`.
**Status:** Stage 1 (performance floor) IN PROGRESS. Stages 2–5 unscheduled.

---

## 1. The lens: what the reference maps are actually made of

Studied against our close view, RimWorld's look decomposes into four load-bearing
elements — none of which is "more content":

1. **Ground reads as materials, not gradients.** Their terrain is discrete surfaces —
   soil, rich soil, gravel, sand, packed dirt, stone floor — with *dithered, irregular
   boundaries*. Our painter produces continuous watercolour (bilinear biome fields +
   fbm grain). Theirs looks like ground; ours looks like a map.
2. **Buildings have visible interiors.** Lit rooms with beds, tables, a hearth do
   enormous work. Our buildings are styled roof-rects (arch styles, ridges, chimneys)
   — sealed boxes.
3. **Depth cues everywhere.** Thick dark wall outlines, one consistent drop-shadow
   direction, ambient darkening where walls meet ground.
4. **Clutter with causes.** Woodpiles, pens, carts, drying racks — props that say
   *someone works here*. We have the instinct (stalls, scaffolds, graves) at a tenth
   of the density.

Our plan pipeline is architecturally *ahead* of its own rendering: it already knows
households, professions, wealth, fortunes, culture styles, crops. The renderer spends
that knowledge sparingly. This document is about spending it — and about making the
canvas fast enough to afford it.

## 2. Stage 1 — the performance floor (pure perf, no visual change)

Two independent costs today:

**The terrain paint** (`ui/terrain.ts` `computeTerrainImage`, run in a worker, ~2s at
native res, re-run on every zoom/pan settle):

- **Cache the per-geography tables.** The per-cell land-colour LUT (`landR/G/B`,
  ~200k `biomeOf` calls) and the river channel stamp field depend only on the
  geography — not the viewbox. Key them by the world seed (threaded through the
  worker request) in a small LRU beside the worker's compute; every repaint after the
  first skips the whole rebuild. The world map's synchronous paint path shares the
  same cache.
- **Latest-wins is already right** (LocalMapView keeps a pending map and drops stale
  buffers); the cache composes under it.

**The SVG overlay** (a big town emits ~400–600 React elements, most with handlers):

- **Batch the non-interactive scatter.** Trees and reeds have no hover/click
  behaviour. Group by (form, tone) and emit ONE `<path>` per group (circles as arc
  pairs, conifers as triangles, fronds as strokes). ~200 DOM nodes become ~a dozen.
- **Memoize the glyphs.** `PlanGlyph` under `React.memo` with stable callbacks, so a
  tooltip `setTip` re-renders one tooltip div — not 600 glyphs. This is the most
  *felt* jank in the current view.

Explicitly out of scope for stage 1: tiles, GPU. See §6.

## 3. Stage 2 — ground as materials (the look transformation)

In the same per-pixel pass (worker today, shader later), after the biome colour:
quantize near-settlement ground into **discrete surfaces with dithered boundaries** —
a hash-threshold per pixel, RimWorld's exact trick, deterministic by construction:

- **Packed earth** inside the town radius, shading to **cobble** at a wealthy core
  (wealth is already in `SettlementView`; distance-to-centre is free).
- **Sand** along shores (waterline distance already resolved per pixel), **exposed
  rock** above a hilliness threshold, **dark turned soil** under the plan's fields.
- Boundaries dither (hash ≥ blend fraction → surface A, else B) instead of lerping —
  the difference between "ground" and "gradient" is exactly this.

Alongside: **shadows and wall weight** in the SVG overlay. One consistent shadow
direction (SE), a soft dark offset shape per building, heavier wall outlines. An
afternoon of work; transforms depth perception of the whole town.

Pack vocabulary throughout: a sci-fi pack maps "cobble core" to "ferrocrete pad".

## 4. Stage 3 — the canvas goes GPU (smooth zoom)

The per-pixel fbm-over-bilinear-fields loop is exactly the workload fragment shaders
eat. `computeTerrainImage` is a ~100-line shader; zoom/pan becomes continuous 60fps
with **no repaint machinery at all** — no worker, no tiles, no settle-debounce. The
three.js dependency is already in the project (lazy, for the 3D view), so WebGL is
paid for. Determinism holds: same uniforms, same pixels.

Caution (from the preview-tooling memory): preview_eval throttles rAF to ~30fps —
before/after claims must be profiled in a real browser.

Tiling the 2D paint (slippy-map style, LRU) is the incremental alternative if the
shader stalls; likely skipped entirely if stage 3 lands early enough.

## 5. Stage 4 — interiors and clutter (the "alive" pass)

- **Interior cutaway at high zoom (LOD reveal).** Past a zoom threshold a roof fades
  to a floor: a hearth, beds scaled to the household the plan *already carries* (L2),
  a workbench in a workshop, casks in the tavern, an altar in the shrine. Deterministic
  per building hash; purely presentation. This makes "hover a lit roof, meet the
  family" *visible* instead of textual — the emotional core of the reference maps.
- **Clutter derived from livelihood.** A woodpile and cart by farm houses, nets drying
  at boathouses, a coal heap at the smith, livestock dots in pens for herder specs,
  cargo on piers. Each is 2–3 SVG primitives; the diversity comes free from
  `specialization` and household professions the plan already reads.
- **Rock outcrops and boulders** where hilliness is high — the countryside currently
  varies only by tree form/density; the reference maps get half their terrain
  character from stone.

## 6. Stage 5 — layout: clusters, not scatter

- **Shared-wall terraces.** The `claim()` circle-parcel model produces detached
  scatter; real dense cores read as *clusters*. A post-pass merges adjacent same-street
  `row` houses into single terrace footprints; `compound` may grow an L-wing around
  its yard. No new state — a fold over the plan.
- **Rotation discipline by culture.** Grid cultures snap street tangents toward 90°
  crossings and houses exactly to them; organic cultures keep the jitter. Half the
  difference between the reference maps' village styles is rectilinearity discipline.
- **District walls.** A shrine precinct with its own low wall, the seat with a bailey
  — one more `frontage`-style step. We already zone (craft row, graveyard) without
  *enclosing*, and enclosure is what makes zones legible at a glance.

## 7. Decision-filter check

1. *Improves the simulation?* No sim change at all — improves the **readout** of it,
   which is the Legibility pillar's half of the bargain.
2. *Generic across universes?* Yes — every stage is pack vocabulary (surfaces,
   interiors, clutter, layout discipline are all data/derivation, not engine).
3. *Data-driven?* Everything derives from `SettlementView` + geography + households
   the plan already receives. Nothing stored.
4. *Emergent gameplay?* Indirect — legibility is what makes emergence *felt*.
5. *Traceable?* Clutter and interiors all trace to causes (profession, household,
   wealth); nothing decorative-random.
6. *Special cases?* None — stages extend the existing `LocalGenStep` pipeline and the
   painter's existing zoom-gate pattern.
7. *Five years?* The GPU move (stage 3) is the piece that keeps the close view viable
   as worlds and screens grow.
8. *Already exists unnamed?* Stage 1 is literally naming what the world map already
   does (decoupled repaint, caching) and applying it one step further; the dither
   trick is the painter's existing hash-noise, thresholded instead of blended.
