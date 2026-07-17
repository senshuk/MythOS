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

## 3. Scope fence (v1 excludes, deliberately)

- Emulation matching against the legendary figure's *recorded personality* (freed at
  demote; v1 matches the legend's theme to the emulator's values instead).
- Orders that ACT (they exist, enroll, and are inspectable; devotional intents and
  order-driven behavior are the natural next increment via the existing org pipeline).
- The Attractor Strength reducer (`30` §6) — sequenced next, reading what this produces.
- Cross-settlement legend aggregation (legends live where believers live; news/travel
  already carries beliefs between towns).

## 4. Decision-filter check

Improves the simulation (the review's single sharpest gap); generic (themes, thresholds,
labels, category are pack data); data-driven; emergent (which legends form, spread, and
found orders follows who told whom, never a script); legible (nudges, offers, and
foundings all trace to the specific held Belief and its evidence); no special cases
(three existing systems gain one input each; the reducer is a sibling of `worldviewOf`);
five-years sound (organic Ecclesiarchies and engineered Missionaria Protectiva both ride
these same producers — design/30 §5's cross-genre validation).
