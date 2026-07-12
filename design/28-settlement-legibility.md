# 28 — Settlement Legibility & Life: the town as a readout of its simulation

**Document type:** Proposal — how a settlement, in the 2D close view and the 3D fly-in,
comes to *show* the simulation that made it: its fortunes, its faith, its wars, its
culture, its life. Fidelity in service of comprehension (CLAUDE.md), not decoration.
**Companion documents:** `24-local-maps.md` (the Close View + town plan pipeline),
`27-lived-in-villages.md` (inhabitants, gatherings), `22-mood-and-causal-worldgen.md`.
**Status:** proposed. Implementing **#1 (Fortunes)** first.

---

## 1. The lens

The town plan already reads several sim facts spatially: population → size, wealth →
walled compounds, specialization → fields/piers/mineheads, culture → grid vs organic,
history → scorches/monuments/tombs, governance → palisade/seat. Every one of those lets
the player ask "why is this town like this?" and trace an answer.

The gap: a settlement does not yet show **how it is *doing*** — whether it is dying or
booming, at war or at peace, devout or worldly. Two towns of the same size read
identically whether one is a thriving port and the other a plague-hollowed remnant. The
richest, most MythOS-native improvements close that gap. Everything below is derived from
sim state the plan **already receives** (`SettlementView`: `stability`, `wealth`,
`subsistenceSecurity`, `civilWarYear`, `polity.wars`, `foundedYear`, `patronDeity`; plus
the `chronicle`) — no new engine tracking.

## 2. #1 — Fortunes (implementing first)

A single derived **fortune** (−1 declining … +1 prospering) from `stability`, food
security and wealth, plus flags for recent grief/boom and war (chronicle + `polity.wars`
+ `civilWarYear`). Manifestations:

- **Decline → the town visibly shrinks.** A declining settlement grows **derelict
  houses** (roofless, weathered, weed-taken) among its anonymous roofs, and leaves
  **empty lots** its people no longer fill — the town has pulled back to its core. The
  known households (the living, named residents) keep their roofs; decay eats the edges.
  *A dying town looks like one.*
- **Prosperity → fresh building.** A booming town raises **new-timber houses** and shows
  **scaffolding** on the growing edge — construction, not decay.
- **Faith → a graveyard.** Where a patron deity is revered, a **burial ground** stands by
  the shrine, its rows of markers scaled by the town's age and the dead the chronicle
  actually recorded — the sim's deaths made ground.
- **War → a defensive posture.** A settlement at war (civil war, a polity war, or recent
  raids) raises **watchtowers** at its gates and a heavier wall; a town long at peace
  stays open.

All deterministic, all traced to a fact ("why is this quarter derelict? — the town has
lost a third of its people since the plague of y162").

## 3. #2 — Architecture by culture & role (next)

Pack-defined **building styles per culture** (timber+thatch, stone+slate, adobe+flat,
conical) so a Tamar village and a foreign town don't share a silhouette — reinforcing
"every culture is different". Building **detail** (doors, windows, chimneys) so a house
reads as a dwelling. Roof variety by culture × wealth.

## 4. #3 — Ambient life (extends design/27)

**Chimney smoke** (the cheapest "inhabited" cue); **livestock** in pastures / **boats**
at piers / drying racks — the specialization alive; **render the gatherings** already
simulated (a funeral crowd at the shrine); a **derived day-rhythm** (design/27 L6) —
figures at the market by day, home by dusk, a pure derivation, no spatial sim.

## 5. #4 — Environment (fidelity)

**Tree variety** by biome (broadleaf/conifer/palm/scrub) and **orchards in rows** for
fruit towns instead of all-cones; **crops that match the specialization** (wheat, vines,
paddies); **shore & water detail** (foam, reeds).

## 6. #5 — Legibility & interaction (comprehension pillar)

**District labels / "read-the-town" mode** — any structure tells what it is and why it's
here; **story overlays** — a household's kin/rivals across the map, a mark's event chain.

## 7. Decision-filter check (CLAUDE.md)

- **Improves the simulation's legibility?** Yes — #1 makes a town's economic/military/
  religious state readable at a glance and traceable to events.
- **Generic across universes?** Yes — "decline/prosperity/war/faith" and their
  manifestations are pack vocabulary (a sci-fi hab shows the same states differently);
  the derivation reads engine-neutral `SettlementView` fields.
- **Data-driven?** Entirely — from existing sim state + chronicle, no scripting.
- **Emergent & traceable?** Every derelict quarter, watchtower, and grave traces to real
  stability/war/death the sim produced.
- **No special cases?** One `fortune` derivation feeds pack-defined manifestations through
  the existing LocalGenStep pipeline.
