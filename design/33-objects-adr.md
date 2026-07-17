# 33 — Objects as Historical Agents, v1: Dynastic Heirlooms (ADR)

**Document type:** ADR for the first implemented slice of `30-mythic-layer.md` §4.2 —
the Object ontology tier (`11-simulation-ontology.md` §Object) enters the engine.
**Status:** Implemented (v1 slice). Scope fence below is deliberate; everything outside
it is future increments, not omissions.
**Companion documents:** `30` §4.2 (the design case), `11` §Object (the ontology spec
this implements a subset of), `17-epistemics-adr.md` (Beliefs about Objects — no new
mechanism, a Belief's subject was always any addressable id), `18-prime-movers.md`
§"Significance is derived, never stored" (the law `objectRenown` obeys).

## 1. What v1 proves

The smallest slice that makes an Object a historical *agent* rather than a stat line:

1. **An Object persists across centuries** — it outlives every actor, survives focus
   shifts (it lives at the world tier, like House and Figure), and is serialized.
2. **It moves through history by the world's own mechanisms** — held by a HOUSE
   (the engine's durable dynastic tier), it passes down the line implicitly with
   succession, is **seized** by a conqueror's house when its holder's city falls to
   one, and is **lost** when the city falls to ruin with no victor to take it.
3. **It accrues a traceable biography** — forging, seizure, loss are ordinary Events
   with the Object among their subjects; "why does this house bear that blade?"
   resolves through the same cause chains as everything else.
4. **It can be believed about, and its legend drifts** — a loss is BELIEF_WORTHY
   (`lost`), so witnesses form beliefs whose retellings mutate through the shipped
   Legend Drift mechanism: a blade "lost when the city fell" becomes, three
   generations later, "carried into the hills" or "buried with the king." A world's
   pre-history mints and loses heirlooms too, so worlds BEGIN with lost relics whose
   fates are already folklore.
5. **Its renown is computed, never stored** — `objectRenown()` reduces the Object's
   own event history with per-event recency decay (the Law of Mythic Scarcity,
   `18`). An heirloom no event has touched in generations quietly stops reading as
   storied; one seizure away from greatness, it climbs again.

## 2. Mechanism

- `WorldObject` (engine/model.ts): `{ id, name, nameMeaning, kind, forgedYear,
  originSettlementId, makerName?, holderHouseId?, destroyedYear?, historyEventIds[] }`.
  Ids share the entity id space (`nextEntityId`), so an Object can be a Belief
  subject and an Event subject with no adapter. `historyEventIds` is an INDEX (like
  `eventsBySettlement`), not stored significance — the tier is always recomputed.
- **Minting** (engine/objects.ts `maybeMintHeirloom`, called from `foundHouse`):
  a deterministic per-house hash gates minting to roughly a third of house
  foundings — scarcity at the source. The name is coined in the founding culture's
  own tongue (`objectName` in content/languages.ts — "Voskarn, 'the bright edge'"),
  and registered in `world.names` so prose and legends resolve it forever.
- **Transfer**: `endHouseAt` gains an optional `victorHouse`; the conquest/annex
  sites in `lod.ts` pass the victor's ruling house (seized → `object_seized`), the
  ruin sites pass none (lost → `object_lost`). Succession inside a house needs no
  event — the heirloom is the HOUSE's, and a house out of power keeps its old crown
  (that is a story, not a bug).
- **Kinds and prose are pack data**: the object-kind vocabulary (blade, crown,
  torc…), the naming concepts, the `lost` drift table, and the event templates all
  live in the pack; the engine knows only mint/transfer/lose/reduce.

## 3. Scope fence (v1 excludes, deliberately)

- **Actor-level bearers** — a named actor carrying the blade day to day interacts
  with the LOD demote/promote cycle; houses are the tier that already survives it.
- **Artifact-lite agency** (`30` §4.2's Intent-bearing artifacts) — a later
  increment on the dual-role Actor+Object seam, after the passive tier is proven.
- **Ambitions toward Objects / the Mythic Feedback Loop** (`30` §4.10) — next in
  design/30's own sequence, consuming what this slice produces.
- **Theft, gifting, trade; containment; destruction as an Intent** — the ontology
  permits them; nothing needs them yet.
- **Resurfacing of lost objects** — a lost relic returning (found in a ruin,
  dredged from the river) is the natural v2 hook the `object_lost` state exists for.

## 4. Decision-filter check

Improves the simulation (the gap analysis's #1 item); generic (all vocabulary is
pack data — a pack that mints nothing pays nothing); data-driven; emergent (which
houses mint, lose, and seize follows the world's own wars, never a script); legible
(a biography of ordinary Events + a computed renown with inspectable inputs); no
special cases (Belief, Event, House succession, Legend Drift reused wholesale);
five-years sound (the relic/crown/blade mechanism every genre needs, built once).
