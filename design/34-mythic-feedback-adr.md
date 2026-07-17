# 34 — The Mythic Feedback Loop, v1 (ADR)

**Document type:** ADR for the implemented slice of `30-mythic-layer.md` §4.10 — the
review's central point: Legend Drift (shipped) makes stories change; this makes stories
change *civilizations*. No new Construct — three existing reducers/selectors each gain
one legitimate input, exactly as Prime Movers' growth law prescribes.
**Status:** Implemented (v1). Scope fence below.
**Companion documents:** `30` §4.10 (the design case), `33` (heirlooms — prime legend
fuel), `17` (Belief substrate), `18` §"Significance is derived, never stored" (the
living-legend reducer obeys it).

## 1. The loop, closed

`Event → Belief → Retelling (drift) → Culture / Ambition / Organization → new Intents →
new Events`. The input to all three consumers is one shared reducer:

- **`livingLegendsAt(world, seatId)`** — the legends a community currently HOLDS: every
  (subject, drifted assertion) pair affirmed (stance `true`) by that settlement's living
  residents, with its holder count. Computed on demand from the decaying Belief stacks —
  never stored, so a legend no one retells quietly stops being a living legend (`18`).
  Subjectivity exists only where agency exists: an aggregate settlement, having no
  simulated residents, holds no living legends (the same law `worldviewOf` obeys).

## 2. The three consumers

1. **Culture drift** — `worldviewOf` (engine/orgReason.ts) applies `legendValueNudge`:
   each living legend past `LEGEND_MIN_HOLDERS` nudges the member value-mean along the
   axis the pack maps that legend's variant to (`LEGEND_THEMES`: "slain in battle" →
   war; "carried into the hills" → freedom; "melted down" → craft…), scaled by how
   broadly it is held and capped at saturation. A people that widely believes their
   king was slain in battle drifts, a little, toward the martial — derived at read
   time, the members' innate values untouched.
2. **Ambition selection** — a new pack ambition, **`emulate`** (content/ambitions.ts):
   offered to an actor who personally HOLDS a living legend about a remembered figure
   and whose own strongest value matches the legend's theme. "Walk in the steps of X"
   — fulfilled by building a standing worthy of the tale. The offer comes from the
   actor's real situation (they know the legend; it speaks to who they are), never a
   menu.
3. **Organization founding** — `legendOrdersYearly` (engine/legend.ts): a legend held
   by `LEGEND_ORDER_HOLDERS`+ residents founds a DEVOTIONAL order (a new
   `ORG_CATEGORY_DEVOTIONAL` category — the first non-political organization kind),
   named by the pack from the legend's variant ("the Seekers of Wryo", "the Wardens of
   Anva"), seated at the settlement, led by the holder of highest standing, and
   remembering its founding legend (`Organization.legendSubjectId`). The founding
   event's cause chain runs through the founder's own evidence back to the original
   event — "why does this order exist?" resolves completely.

## 3. Orders that ACT + Attractor Strength (v1.1, same increment cycle)

The two items v1's fence deferred, now shipped through the existing pipelines:

- **Category-scoped intent vocabularies** — `IntentDef.orgCategories`: the six polity
  intents are scoped `['political']`; devotional orders weigh their own pair. One
  pipeline, each org considering only its own kind of life.
- **`commemorate` → `hold_rite`** — the order retells its founding tale to residents who
  lack it (a `retell` OrgEffect through the existing belief machinery). This is the
  institution keeping its own myth alive against decay: the loop sustaining itself.
- **`seek_relic` → `search_for_relic`** — when the order's legend subject is a LOST
  object (`relic_lost`, a bounded perception fact: an order knows the state of the one
  thing it exists for), it seeks. The search is an ARC, not a die roll: expeditions
  harden the order (readiness) until it is equal to the finding, each attempt history
  ("scoured the land… and returned empty-handed"), and the recovery
  (`recover_object` effect) passes the relic into the seat's ruling house's keeping and
  stamps the object's own history — renown carries the finding. Found → it commemorates.
- **Attractor Strength** (`30` §6) — `attractorStrength(world, subject)`: believers
  world-wide + sworn orders weighted by how long they have stood + a living emulator +
  the object's own decaying renown, each part labelled. Pure; decays by construction
  (every input decays or dissolves — mythic scarcity holds). Surfaced on figure/object
  peek cards: "an attractor of ambition — 12 souls hold its legend · the Seekers of
  Voskarn, sworn 31 years."
- **Scarcity guards on founding** (`30` §7, tuned against live play, which showed a
  lively town founding four orders in nine years — inflation that cheapens every one):
  the holder threshold is the pack floor OR a real SHARE of the community (5%),
  whichever is greater; eligibility is judged per SUBJECT across all drift variants (a
  town gripped by three tellings of one tale is still gripped by one tale — the order
  swears to the dominant telling); one founding per settlement per YEAR at most; and
  one per GENERATION (20y) — a founding is a rare turning of the communal soul. All
  derived from records the world already keeps; no new state.

## 3b. Scope fence (still deliberately excluded)

- Emulation matching against the legendary figure's *recorded personality* (freed at
  demote; the legend's theme matched to the emulator's values instead).
- Cross-settlement legend aggregation (legends live where believers live; news/travel
  already carries beliefs between towns).
- Attractor Strength as a simulation INPUT (it is a legibility read, per `30` §6's own
  argument; the moment a consumer wants it, that is a new producer decision).

## 4. Decision-filter check

Improves the simulation (the review's single sharpest gap); generic (themes, thresholds,
labels, category are pack data); data-driven; emergent (which legends form, spread, and
found orders follows who told whom, never a script); legible (nudges, offers, and
foundings all trace to the specific held Belief and its evidence); no special cases
(three existing systems gain one input each; the reducer is a sibling of `worldviewOf`);
five-years sound (organic Ecclesiarchies and engineered Missionaria Protectiva both ride
these same producers — design/30 §5's cross-genre validation).
