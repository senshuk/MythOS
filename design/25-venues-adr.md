# 25 — Venues: Locations Become Sim-Meaningful (Close View L4)

**Document type:** ADR — the first sim meaning for the Location tree (design/24 §3.7
said L4 needs one). Deliberately narrow: ONE capability, held to the standing
disciplines (bounded scope, outcomes-only history, pack owns vocabulary).
**Status:** v1 SHIPPED (2026-07).

## Decision

**Social events happen SOMEWHERE.** The focused settlement mints its public venues —
the market square, the shrine, the tavern, the ruler's hall — as real Locations
(children of the settlement in the containment tree), and the social outcomes the sim
already emits (weddings, brawls, friendships, feuds) name the venue they happened at:
*"Faiyal and Thonios were married at the shrine of the Windwalker."* Venues are
inspectable (their own event history — every wedding the shrine has seen) and the
close view's drawn buildings link to them.

## The laws

1. **Venues are stages, never actors.** A venue decides nothing, knows nothing, owns
   nothing. It is where an outcome is RECORDED to have happened — pure legibility.
   Anything more (a tavern's economy, room-level pathing) is out of scope until a
   future ADR argues for it.
2. **Venue choice must not perturb the streams.** Which venue hosts an event is a pure
   hash of (participants, tick) over the eligible venues — never a draw from
   `world.rng` or any actor stream. Adding venues to a build changes NO dice: the same
   seed + inputs yields the same history, now annotated with places.
3. **Minting is idempotent, lazy, and stream-free.** `ensureVenues` runs at promote
   (and after load, for the already-promoted settlement — old saves upgrade lazily),
   creates only venues whose pack-defined condition holds and which don't already
   exist, and names them from pure philology (`mixSeed`-seeded, culture's own tongue).
   Persistence needs no format change — generic locations serialize since v9.
4. **The pack owns the vocabulary.** WHICH venues a settlement raises (`VENUES` defs:
   condition + naming) and WHICH event types happen where (`VENUE_HOSTS`) are pack
   data through the pack boundary. A pack with no venues simply has un-located events
   — the engine never requires them.
5. **Only the lived-in-full settlement has venues.** Macro settlements' social lives
   are aggregate; there is nothing to locate. Venues persist after demote (a tavern
   doesn't vanish when unobserved) and re-mint checks keep re-promotion idempotent.

## What this deliberately defers

Travel arrivals at the gate; org actions at the seat; per-venue lenses; households as
Location entities (still a derived reading, design/24 L2); any venue-local simulation.
