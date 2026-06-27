# MythOS PoC — The Living Village

A proof of concept for the MythOS simulation engine. It validates the two riskiest
bets from the design dossier (`../design/`) **before** any of the ambitious
universe-pack scope is built:

1. **Determinism at the core** — same seed + same code ⇒ byte-identical world.
2. **Emergent, legible aliveness** — a small village produces varied history from
   interacting systems, and *any* event can be traced back to its causes.

It is deliberately **not** the universe-pack engine yet. It is one tiny world,
proven alive, on a deterministic, worker-isolated core.

## What it does

A single settlement of ~120 founders runs forward in time. Villagers have needs,
professions, traits, relationships, and memory. They befriend, quarrel, marry,
have children, feud, occasionally kill each other in brawls, and die. Everything
that happens is recorded as a **structured, causally-linked event**, and the UI
lets you watch the history and click any event to ask *"why did this happen?"*.

## Architecture (mirrors the dossier)

- **Deterministic core** (`src/engine`) — ECS-style world, one seeded PRNG
  (`rng.ts`) threaded through everything, multi-rate scheduler (`sim.ts`:
  needs=daily, social=weekly, lifecycle=yearly). No `Math.random` / `Date.now`.
- **Systems** (`src/systems`) — `needs`, `social` (the emergence engine), and
  `lifecycle`. They communicate only via components + events.
- **Opinion as thoughts** (`src/engine/opinion.ts`) — a relationship is *not* a
  single number; it's a list of sourced, (mostly) decaying **thoughts** whose
  diminishing-returns sum is the effective opinion (the RimWorld idea, kept
  deterministic). Every interaction leaves a small routine thought; notable ones
  leave a stronger sourced thought tied to an event. This makes relationships
  **legible** — the inspector lists *why* ("+128 spent good time together ×12, +90
  a kindness, −44 quarrelled") — and **emergent** (bonds accrue, saturate, and fade
  unless renewed). Friendship / rivalry / feud / marriage are threshold crossings of
  the summed opinion.
- **Chronicle / Tales + Annals** (`src/engine/chronicle.ts`) — the world's *memory*,
  in **two tiers**. Each year, notable events are scored by **interest** (a
  brawl-killing or famine is far more memorable than a birth). The **rolling
  Chronicle** is bounded and *fades* (recent living memory — it drives the Director's
  sense of drama). The **permanent Annals** keep the most momentous events of *all
  time* plus landmark **foundings and ruins**, and **do not fade** — so a deep
  pre-play past survives for the player to inherit. They feed **named ages** (a
  chronological timeline from "the First Year of X" through wars, plagues, and "the
  Fall of Y") and **legends** ("Folk still tell of how…"). Settlements that fall to
  population 0 become **ruins**, recorded forever and shown on the map. (RimWorld's
  Tale idea + Dwarf Fortress's deep-history legends — see `../design/09…`.)
- **Historical figures** (`src/engine/figures.ts`) — the deep past has *people*, not
  just events. The aggregate layer mints lightweight figure RECORDS (DF's model —
  not ECS actors): a **founder** per settlement and a **line of rulers** that succeed
  one another across centuries (dynasties). Founding, ruin, and ruler-death events
  name them, so the ages read "founded by X", "fell to ruin under Y". Figures get an
  id + a name in the registry (so events render them) but no components, so the actor
  systems never touch them. Worldgen prerequisite #3 — a player enters a world whose
  history is *peopled*.
- **Grammar** (`src/engine/grammar.ts`) — a tiny weighted, recursive symbol-rewriting
  grammar (the RimWorld RulePack idea) used to narrate legends and name eras with
  real variety. Productions reference other symbols as `[symbol]`; callers inject
  bindings (`[event]`, `[VICTIM]`). Deterministic — read-only renderers seed a local
  RNG from a stable key (the event id), so a tale is always told the same way.
- **Director / Storyteller** (`src/engine/director.ts`) — the RimWorld AI Director,
  adapted and kept deterministic. It does *not* script outcomes; it paces **drama**.
  Each year it reads how much memorable drama the world has produced lately (straight
  from the Chronicle's interest scores), builds **tension** during calm stretches,
  and — past a threshold — fires one **incident** (a boon, a hard year, a plague that
  can kill named villagers). When the world is already dramatic on its own, tension
  stays low and it holds back: setback → recovery → escalation, without piling on.
  Personalities (Balanced / Grim / Gentle / Chaotic) are data and **swappable live**
  from the UI; it runs on its own RNG stream, independent of which settlement you
  watch, and is fully reproducible.
- **Level-of-Detail layer with THREE fidelity tiers** (`src/engine/lod.ts`):
  - **full** — per-actor simulation; the focused settlement only.
  - **summary** — *named individuals living elsewhere*, tracked world-wide, aged
    and killed coarsely (yearly), keeping identity + relationships across focus
    changes. This is what makes cross-settlement relationships and "the person you
    met is still there when you return" possible.
  - **aggregate** — the anonymous mass: a `MacroPop` evolving by rates in
    O(1)/year, no entities at all.

  Focusing a settlement **demotes** the current one (notables → summaries, the rest
  freed) and **promotes** the target (resident summaries → full, plus fresh actors
  from the aggregate). **Migration** moves named people between settlements each
  year, carrying their relationships, so a friendship or feud can span the map.
  Live-entity count stays **bounded** (one settlement of full actors + a capped set
  of summaries) no matter how large the world grows. Each settlement owns an
  **independent RNG stream** (`mixSeed(seed, id)`), so its history is
  **locality-independent**; the focused settlement's stream *is* `world.rng`.
  - **Headless / worldgen mode** (`createWorld(seed, false)`): a third operating
    mode with **no settlement focused** — every settlement aggregate, zero live
    actors. This is what lets the world run **deep pre-play history** for centuries
    cheaply (200 years in ~10 ms) before a player `focusSettlement`s into it,
    inheriting an already-deep past. (Dwarf Fortress's "the world already exists" —
    see `../design/09-dwarf-fortress-study.md`. This is prerequisite #1 of the
    worldgen pre-history pass.)
- **Region graph / geography** (`lod.ts`: positions, `buildRegionGraph`,
  `geographyYearly`) — settlements have 2D positions and form a connected proximity
  graph whose **edges are trade routes** carrying a `distance` and a drifting
  `relation`. Each year (on a dedicated geo RNG stream): relations drift and hostile
  edges **raid** (the weaker aggregate side loses people → frontiers). An occasional
  **border grievance** sours relations sharply, and a deeply hostile border can flare
  into open **war** — an inconclusive **battle** (both sides bleed, named by their
  rulers) or, against a much weaker neighbour, a **conquest** that razes it to ruin.
  **Migration is distance- and relation-weighted**, so people move to near, friendly
  places.
- **Economy** (`lod.ts`: `economyYearly`, deterministic, no RNG) — every settlement
  has a **specialization** (farming / mining / crafting / balanced) that sets what it
  **produces**; everyone **consumes** the same basket, so specialists run surpluses &
  deficits that set **local scarcity-driven prices**. **Goods then flow along
  non-hostile edges** from cheap (surplus) to dear (scarce), equalizing prices,
  building **wealth** and trust. Towns that run out of food suffer **famine**;
  well-fed, wealthy towns gain stability. The trade routes are the substrate; goods
  are the layer on top. (Farming towns export cheap food; mining towns import it —
  exactly the emergent pattern you'd want.)
- **A varied event repertoire** (Warsim / RimWorld / DF flavour) — beyond births,
  marriages, feuds, plagues, and famines, the Director also raises **wonders** (named
  great works — *"the Eternal Citadel of X was raised"* — positive permanent
  landmarks), looses legendary **beasts** (*"the Pale Beast ravaged Y"*), and sends
  **omens** (comets, eclipses, blood-red auroras). Geography adds **battles** and
  **conquests**. Names for wonders, beasts, and omens come from the grammar primitive,
  so they read fresh every time. The deep history is no longer a wall of plagues.
- **A sustainable world** (`lod.ts`: `stepMacro`) — aggregate settlements grow
  **logistically** toward a soft carrying capacity: they breed fast when there's room
  (so they **recover from shocks** instead of spiralling to ruin) and taper when full.
  This is what lets a world survive *centuries* of war, plague, and famine with most
  of its settlements intact (≈8/10 at 200 years, ≈6/10 at 500), instead of grinding
  itself to extinction.
- **Structured history** (`src/engine/model.ts` + `render.ts`) — events store
  type/subjects/data/**causes**; prose is rendered on demand, never stored. A
  persistent **name registry** (`world.names`) renders actors that demotion freed,
  so history outlives the entity.
- **Worker isolation** (`src/worker`) — the sim runs entirely in a Web Worker;
  the UI sends **intents** (advance, focus, inspect) and renders **snapshots**.
- **Generic fixture content** (`src/content/fixture.ts`) — original, abstract
  species/professions/traits. In the real engine this becomes a Universe Pack.

## Scale, concretely

A fresh world holds ~2,000 souls across 10 settlements, but only the focused
settlement (~200–350 actors) is ever held as live entities (a ~6× ratio). Click a
settlement to move detailed observation there; aggregate settlements grow, shrink,
prosper, and suffer hardship while you're not watching, and a few remembered
figures persist across visits. The determinism gate proves all of this stays
reproducible across a fixed script of focus changes.

## Run it

```bash
cd poc
npm install
npm test          # determinism + LOD/economy/opinion/chronicle/grammar/director/worldgen/annals/figures/forge/variety gate (49 tests) — must stay green
npm run dev       # open http://localhost:5173  — watch the village
```

In the UI: pick a **seed** and a **history** length, then **Forge world** to drop
into a settlement that already has centuries of named ages, legends, ruins, and
ruling dynasties (set history to "none" for a fresh year-0 start). Advance
**+1 / +10 / +60 years**, switch **Storyteller**, click a settlement to focus it,
click a **villager** to see their relationships & life (with the *reasons*), or
click an **event** and follow **why?** to walk its causal chain.

## Determinism gate

`src/engine/sim.determinism.test.ts` is the build-breaking invariant: two runs of
the same seed produce identical worlds; different seeds diverge (proving novelty);
running in two steps equals running in one. If it ever goes red, a
non-deterministic input has crept into the sim.

`src/engine/narrative.demo.test.ts` is not a pass/fail test but a demonstration —
run `npx vitest run src/engine/narrative.demo.test.ts` to print a sample emergent
history and a traced causal chain to the console.

## Done so far

1. Deterministic, worker-isolated ECS core with snapshot/replay-grade determinism.
2. A single **living village** (needs / social / lifecycle) producing legible,
   causally-traceable history.
3. The **LOD layer**: a world of many settlements where only the focused one is
   simulated in detail and the rest evolve as aggregates — all deterministic and
   locality-independent.
4. The **summary tier + migration**: named individuals persist world-wide between
   the full and aggregate tiers, move between settlements, and carry their
   relationships with them, so bonds and feuds span the map.
5. The **region graph**: settlements have positions and a connected proximity graph;
   raids erupt on hostile frontiers and migration follows distance + relation.
   A clickable SVG map shows it all.
6. The **economy**: specialization-driven production & consumption set scarcity
   prices; goods flow along the trade routes from surplus to deficit, building wealth
   and keeping towns fed (or not — famine where the routes can't reach). Settlement
   rows show specialization, wealth, and food status.
7. **Opinion as thoughts** (RimWorld-inspired): relationships are summed, decaying,
   sourced thoughts instead of a flat number — legible (the inspector lists *why*)
   and emergent. (See `../design/08-rimworld-study.md`.)
8. **Chronicle / Tales**: notable events are scored by interest and remembered;
   the world re-narrates them as **named years** and **legends**, turning emergent
   history into worldbuilding content (e.g. a feud that erupts one year and ends in
   a killing six years later becomes two named years).
9. **Grammar primitive** (RimWorld RulePack idea): a weighted recursive grammar
   gives the legends and era names real variety, deterministically.
10. **Director / Storyteller** (RimWorld AI Director): a deterministic, swappable
    pacing layer that reads the chronicle's drama, builds tension during calm, and
    fires incidents (boons, hard years, plagues) — easing off when the world is
    already dramatic. The single biggest storytelling lever.
11. **Headless / worldgen mode** (DF "world before player", prerequisite #1): the
    sim can run with no settlement focused — pure aggregate, no live actors —
    generating centuries of pre-play history (named ages, legends) in milliseconds,
    which a player then enters via `focusSettlement`, inheriting a deep past.
12. **Permanent Annals + ruins** (worldgen prerequisite #2): a non-fading deep-history
    tier keeps the most momentous events of all time plus landmark foundings/ruins,
    so a 200-year pre-history's ancient ages *survive* (the rolling chronicle alone
    would forget them). Settlements that fall to ruin are recorded forever and shown
    on the map.
13. **Historical figures** (worldgen prerequisite #3): founders and lines of rulers
    are minted as lightweight records, so the deep past is *peopled* — the legends
    name them ("founded by X", "fell to ruin under Y"), and a player inherits a
    history with dynasties, not faceless events.
14. **Worldgen pre-history pass** (`forgeWorld`, the DF headline feature): the UI's
    **Forge world** button + a "history: N centuries" control run the whole flow —
    `createWorld(seed, false)` → headless centuries → enter the greatest surviving
    settlement. The player steps into a world that *already exists*, with named ages,
    surviving legends, ruins, and ruling dynasties. Deterministic from (seed, years).

## Deliberately deferred (see `../design/06`)

Player-as-one-actor control, deeper economy (production chains, money/markets as
first-class actors rather than per-settlement aggregates, player-run businesses),
tactical combat, formal diplomacy/alliances between settlements (relations exist
per-edge but there are no treaties or multi-settlement wars beyond raids),
data-driven **Universe Packs**, and IndexedDB persistence. Smaller follow-ups: raids
& famine that kill specific *full* actors when your focused town is affected (today
the focused settlement takes no aggregate damage), freeing dead full actors during
very long single-focus sessions, and terrain (positions are random — no rivers,
mountains, or coasts shaping the graph).
