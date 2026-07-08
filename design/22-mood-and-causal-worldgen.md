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
