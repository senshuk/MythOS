# 35 — Closing the Actor ↔ Settlement Economic Gap (ADR)

**Document type:** ADR. Proposes the bridge between the two economies the engine already
runs: the real, closed-loop settlement economy (produce → consume → stock → scarcity
price → edge trade, `engine/lod.ts economyYearly`) and the cosmetic actor "economy" (a
wealth-*need* meter with one thin profession hook, no conservation, no contact with
prices). No new entity types — three existing systems each gain the input they were
always missing.
**Status:** Proposed. Scope fence in §6.
**Companion documents:** `18` Prime Movers ("significance is derived, never stored" —
obeyed here by making production derived), `13` Simulation Rules (conservation as a
reducer law), `11` Simulation Ontology (no new categories needed), `33` Objects
(inheritance becomes an economic event, not only a sentimental one), `17` Epistemics
(merchants act on *believed* prices), `26` POV Gameplay (poverty and fortune as legible
player stakes).

## 1. The gap, stated precisely

The engine currently runs **three unrelated quantities all named "wealth":**

1. **Actor `WEALTH_NEED`** — a 0..1000 satisfaction meter. Minted by `work`
   (`professionIncomeOf(prof) * 7`), burned by cost-of-living, gifts, binges. A gift
   debits the giver and gives the recipient only a *thought* — nothing transfers.
2. **Settlement `econ.wealth`** — a prosperity index. Conserved between towns during
   edge trade; partially minted by production.
3. **Org treasury** — institutional funds. Fed by a real tithe transfer from the seat;
   spent with affordability gates; conservation unit-tested.

Layers 2 and 3 touch (the tithe). Layer 1 touches nothing. The consequences ripple far
beyond economics:

- **Professions are labels.** A smith produces no materials; a farmer feeds no one;
  settlement production is terrain-only, fixed per-capita, forever. The one mechanical
  effect of a profession is the refill rate of one actor's private meter.
- **Actors never meet a price.** The engine computes genuine scarcity prices every year
  and no actor ever buys or sells at one.
- **Property is weightless.** Inheritance (`gameplay loop`), theft-adjacent crime
  (future), dowries, tribute felt at the hearth — none can matter mechanically while
  actor wealth is a mood dressing. `33` gave objects history; nothing yet gives them
  *value*.
- **One known leak in the macro loop:** the org `trade` action mints `{wealth:+30}`
  from nothing — the only non-conserving flow among the org interactions. This ADR
  retires it (§4.4).

The fix is not a new "economy module." It is wiring the layers together under one law.

## 2. The law: coin is conserved; prosperity is derived

Adopt one engine-wide rule, the fiscal sibling of `18`'s significance law:

> **Every unit of coin has a source and a sink. Coin moves; it is never minted by a
> transaction. Minting happens in exactly one place — production — and destruction in
> exactly one place — consumption.**

Concretely:

- **Actor coin** becomes a real balance (`world.coin: Map<EntityId, number>`), distinct
  from `WEALTH_NEED`. The need meter survives, but becomes **derived at read time** from
  the actor's coin relative to the local cost of living — a *felt* wealth, subjective
  and situational (rich in a poor village ≠ rich in the capital), which is exactly what
  a need is. One quantity stored, one derived: the naming collision resolves itself.
- **Settlement `econ.wealth`** is redefined as what it already almost is: the aggregate
  of its residents' coin plus civic stock value — a **reducer over the population**, not
  independent state. For aggregate (non-promoted) settlements it remains a scalar,
  now with explicit book-keeping for the flows below.
- All existing conserving flows (edge trade, tithe, tribute) are untouched — they
  already obey the law. The audit that proves it extends the existing conservation
  test: **world coin total is invariant across every reducer except production and
  consumption.**

## 3. Increment A — professions as production

Production stops being terrain-only. It becomes **terrain × workforce**, derived, never
stored:

- The pack maps each profession to a resource role it produces
  (`Profession.produces: ResourceKey` — farmer → subsistence resource, smith →
  materials, hunter → subsistence, healer/guard → service, i.e. no vector output but a
  modifier; all pack data, zero engine names).
- A settlement's yearly production vector becomes
  `terrainYields(site) × workforceFactor(settlement)`, where `workforceFactor` is
  derived from the settlement's **profession distribution** — for promoted settlements,
  read off the living cast (the sampled cast is already the statistical mirror of the
  population, per the population-scale design); for aggregate settlements, a small
  stored distribution vector initialized from terrain (fishing towns start with
  fishers) and drifted by the same lifecycle events that already assign professions.
- Terrain remains the **prime mover** (`18`): it sets what a place *can* yield;
  workforce sets how much of that potential is realized. A mining town that loses its
  smiths to a plague genuinely produces less — and the famine chain that follows is
  traceable to the deaths.
- **Profession choice becomes situational, not uniform-random.** `pickProfession`
  gains the settlement's specialization and current scarcity as weights (children grow
  into the trades their town needs — dear materials pull the young toward the forge).
  This is the supply response the macro economy currently lacks (§1: production is
  inelastic), obtained without prices ever commanding anyone — scarcity *tilts*
  life-course decisions actors were already making.

## 4. Increment B — conserved actor coin

The flows, each a pure reducer, each traceable:

1. **Wage (production → coin, the one mint):** a working actor earns their
   profession's share of what their labor produced, priced at the *local* price. The
   trader's flat `income: 6` dies; a smith in a materials-hungry town out-earns one in
   a glut. `Profession.income` survives only as a pack-tuned share weight.
2. **Cost of living (coin → destruction, the one sink):** the flat `-1/tick` becomes
   consumption priced at local food/goods prices. Famine now *impoverishes* before it
   kills — a legible early chapter the current cliff-edge famine lacks.
3. **Gifts transfer.** `resolveGift` moves coin giver → recipient (the thought stays;
   generosity now costs and enriches truly). The generosity precepts (`23`) gain real
   teeth at zero new machinery.
4. **Org flows reach the hearth.** The tithe draws from resident coin (aggregated for
   non-promoted settlements) rather than an abstract index; tribute paid by a town is
   felt in its residents' balances. The org `trade` action is **retired** in favor of
   `trade_agreement`, which already does the job conservatively (§1's leak, closed).
5. **Inheritance.** At death, coin passes by the same succession rules that pass
   heirlooms (`33`) and the player's line (gameplay loop). An heir now inherits an
   *estate* — and a disputed succession disputes something. Dowries, debts, and bequest
   choices are future consumers, not present scope (§6).
6. **LOD honesty (`15`):** coin is per-actor only for the promoted cast; an aggregate
   settlement holds one pooled balance. Promotion deals a sampled share of the pool to
   the new cast (seeded by profession and standing); demotion returns the balance to
   the pool. Same pattern population promotion already uses; conservation holds across
   both transitions and is tested there.

## 5. Increment C — the merchant is an emergent role, not a label

Delete the idea that "trader" names what an actor *is*. A **merchant is any actor doing
a particular thing:** buying where they believe goods are cheap, traveling, and selling
where they believe goods are dear. Everything needed already exists:

- **Capital:** Increment B's coin.
- **Price gaps:** the settlement price vectors, already computed.
- **Travel:** the travel system, already shipped.
- **Bounded knowledge (`17`):** the crucial ingredient. A merchant does not read
  `econ.price` — they act on **price *beliefs***: prices witnessed where they have
  been, and testimony carried by news and travelers, stamped with when it was learned.
  The venture is offered as an **ambition** (`trade_venture`, pack data, the exact
  shape `emulate` took in `34`): offered to an actor whose coin clears a threshold and
  who *holds a belief* that somewhere reachable, something sells for meaningfully more
  than it costs here.
- **The venture is an arc, not a die roll** (the `seek_relic` precedent): buy at the
  origin's real price, travel with the goods (an Object in transit — robbable,
  losable, a story), sell at the destination's real price *as it is on arrival*. Stale
  beliefs mean real ruin: the shortage ended, the war closed the road, the price
  collapsed. Profit and bankruptcy are both emergent, both traceable — "why is this
  family rich?" resolves to a ledger of ventures, "why did this one fail?" to a belief
  that had gone stale by two winters.
- **The profession label follows the behavior**, not the reverse: an actor whose
  ventures succeed *becomes known as* a merchant (reputation/backstory consume the
  record). Repeated ventures along one edge are the micro-story of the macro
  `tradeVolume` that edge already accumulates — the two layers narrate each other.

This is question 8 of the decision filter answered three times over: capital, prices,
travel, ambitions, arcs, and bounded belief all exist; the merchant is their
intersection, unnamed until now.

## 6. Scope fence (deliberately excluded)

- **No labor market.** Wages are production shares, not bid. Hiring, contracts, and
  wage competition are a future ADR if ever.
- **No credit, debt, or banking.** Coin balances are non-negative; ruin is a floor,
  not a spiral.
- **No actor-facing goods inventory** beyond the merchant venture's cargo. Actors do
  not shop; consumption stays statistical. (Objects of `33` remain singular and
  historied, not stock.)
- **No price formation from actor trades.** Prices stay the settlement scarcity
  reducer; merchant ventures move *stock* (which moves prices next tick) but do not
  haggle. One price authority, no second market mechanism.
- **Org treasuries unchanged** beyond §4.4's source-of-tithe redefinition and the
  retired `trade` action.
- **No taxation UI / fiscal policy verbs** — POV ruler economics belongs to `26`.

## 7. Consequences elsewhere (why this pays beyond economics)

- **Crime** gets its missing substrate: theft can move coin, and "wealthy" becomes a
  targetable, witnessable fact rather than a mood.
- **Mood & ambitions** sharpen for free: felt-wealth derived from real coin means the
  poor actor's resentment traces to an actual ledger, not a decaying meter.
- **Houses & dynasties:** estates compound or dissipate across generations — the
  economic shadow of prestige, and a second axis on which houses rise and fall.
- **Epistemics gets a new belief domain** (prices) with built-in stakes — the first
  belief whose staleness costs coin, the sharpest possible demonstration of `17`.
- **Legibility:** every fortune answers "why?" — a wage history, a venture ledger, an
  inheritance, a tribute. Every ruin, the same.

## 8. Decision-filter check

Improves the simulation (closes the engine's largest confirmed real-vs-cosmetic split);
generic (professions, produces-mappings, share weights, venture thresholds are all pack
data — a sci-fi pack maps engineer → materials and freighter runs are merchant
ventures unchanged); data-driven; emergent (no scripted merchants, no quest — ventures
follow believed price gaps, fortunes follow ventures); legible (one conservation law
plus per-flow traces; §7's "why is this family rich?"); no special cases (player coin
is actor coin; aggregate settlements use the promotion pattern LOD already established);
five-years sound (markets, credit, and fiscal policy are additive consumers of a
conserved substrate — the law in §2 is what makes them buildable later without
re-plumbing); and question 8 with emphasis: nearly every part already exists —
`Profession.income`, `econ.price`, travel, ambitions, arcs, sampled promotion — this
ADR names their intersection and adds only coin.

## 9. Migration & versioning

Save version bump: `world.coin`, per-settlement profession distribution (aggregate
tier), and the redefined `econ.wealth` reducer. On load of an old save, deal initial
coin from the existing settlement wealth index by standing and profession — the world's
current prosperity becomes its opening ledger, and total coin thereafter is invariant
under everything but production and consumption (extend the `organization_2c`
conservation test to a world-total audit).
