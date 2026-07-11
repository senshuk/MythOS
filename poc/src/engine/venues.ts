/**
 * VENUES — the Location tree's first sim meaning (design/25). The engine's half is
 * pure MECHANISM: mint the venues whose pack-defined condition holds (idempotent,
 * lazy, stream-free), and stage a social outcome at the first host type present.
 * What venues exist and what happens where is the pack's vocabulary (content/venues).
 *
 * THE LAW (design/25 §2): nothing here may touch world.rng or any actor stream —
 * venue choice is a pure hash, minting draws from pure philology. Adding venues to a
 * build changes NO dice: the same seed + inputs yields the same history, annotated.
 */
import { type World, type Settlement, type EntityId, type LocationId } from './model';
import { createLocation, getChildren } from './location';
import { VENUES, VENUE_HOSTS } from './pack';
import { mixSeed } from './rng';

/**
 * Raise the settlement's missing venues (children in the containment tree). Runs at
 * promote and after a load — idempotent by locationType, so re-promotion and old
 * saves upgrade cleanly. A venue persists after demote: a tavern doesn't vanish when
 * the world stops watching it.
 */
export function ensureVenues(world: World, s: Settlement): void {
  if (s.ruinedYear !== undefined) return;
  const existing = new Set(getChildren(world, s.id).map((c) => c.locationType));
  for (const def of VENUES) {
    if (existing.has(def.type) || !def.applies(s)) continue;
    const named = def.name(s, world.seed);
    createLocation(world, {
      name: named.name,
      nameMeaning: named.meaning,
      locationType: def.type,
      parentId: s.id,
    });
  }
}

/** The lazy-upgrade hook: a loaded save's focused settlement is already promoted, so
 *  promote() won't run — raise its venues here instead. */
export function ensureFocusedVenues(world: World): void {
  const s = world.settlements[world.focusedSettlementId];
  if (s?.detailed) ensureVenues(world, s);
}

/**
 * WHERE does this outcome happen? The first host type (pack preference order — a
 * wedding wants the shrine before it settles for the square) that the actors' home
 * settlement has raised; a pure hash breaks ties among same-type venues. Returns
 * undefined when the pack doesn't locate this event type, or no venue exists — the
 * event simply goes un-located, exactly as before.
 */
export function pickVenue(
  world: World,
  eventType: string,
  a: EntityId,
  b: EntityId,
): { venueId: LocationId; venue: string } | undefined {
  const hosts = VENUE_HOSTS[eventType];
  if (!hosts) return undefined;
  const sid = world.homeSettlement.get(a);
  if (sid === undefined) return undefined;
  const children = getChildren(world, sid);
  for (const t of hosts) {
    const of = children.filter((c) => c.locationType === t);
    if (of.length > 0) {
      const pick = of[mixSeed(world.seed, a, b, world.tick) % of.length];
      return { venueId: pick.id, venue: pick.name };
    }
  }
  return undefined;
}
