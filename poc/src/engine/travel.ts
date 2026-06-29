/**
 * Transportation: mobile Locations (Vehicles) travelling between world positions.
 *
 * The Spatial Foundation (engine/location.ts) taught the engine WHAT space is — nested,
 * acyclic containment. This module teaches it how things MOVE through that space. A
 * mobile Location (mobility='mobile' — a ship, caravan, starship, nomadic camp) can be
 * sent on a journey; travel has DURATION, not teleportation (constitution `design/13`):
 *
 *   startTravel → the location enters `transit` and emits `travel_started`.
 *   travelTick  → each tick, a journey may be DELAYED by a hazard; when its arrival tick
 *                 is reached it lands — position updates, it docks at the destination if
 *                 the destination was a place — and `travel_arrived` fires.
 *
 * Determinism: arrivals are resolved in ascending id order each tick, and hazard rolls
 * draw from the world's dedicated `travelRngState` stream (isolated like geo/director),
 * so transit randomness never perturbs any other system. A contained location has no
 * independent position — it moves WITH its container (see `positionOf`).
 *
 * Like the foundation, this is a capability: the default world founds no mobile
 * locations, so `travelTick` is a no-op there and nothing about existing worlds changes.
 */
import { type World, type LocationId, type WorldPosition, type Transit, type EventId } from './model';
import { Rng } from './rng';
import { getLocation, getAncestors } from './location';
import { emit } from './world';
import { TRAVEL_SPEED, HAZARD_DELAY_TICKS } from '../content/fixture';

/** Where a Location actually IS in the world: its own position, or — for a contained
 *  location with none — the nearest ancestor that has one (it moves with its container).
 *  A location in transit reports its journey origin until it arrives. */
export function positionOf(world: World, id: LocationId): WorldPosition | undefined {
  const loc = getLocation(world, id);
  if (!loc) return undefined;
  if (loc.transit) return loc.transit.fromPos;
  if (loc.pos) return loc.pos;
  for (const anc of getAncestors(world, id)) {
    if (anc.transit) return anc.transit.fromPos;
    if (anc.pos) return anc.pos;
  }
  return undefined;
}

/** Is this (mobile) Location currently en route? */
export function inTransit(world: World, id: LocationId): boolean {
  return getLocation(world, id)?.transit !== undefined;
}

export interface TravelDest {
  /** travel to a specific world position … */
  pos?: WorldPosition;
  /** … or to a destination Location (the journey ends docked there). */
  locationId?: LocationId;
}

export interface TravelOpts {
  /** distance units per tick; defaults to the pack's TRAVEL_SPEED. */
  speed?: number;
  /** per-tick chance (0..1) a hazard delays the journey; defaults to 0 (a safe route). */
  hazard?: number;
}

/**
 * Send a mobile Location on a journey. Throws if the location is missing, not mobile, or
 * already in transit, or if the destination cannot be resolved to a position. Returns the
 * `travel_started` event id. The journey resolves over subsequent ticks in `travelTick`.
 */
export function startTravel(world: World, id: LocationId, dest: TravelDest, opts: TravelOpts = {}): EventId {
  const loc = getLocation(world, id);
  if (!loc) throw new Error(`startTravel: location ${id} does not exist`);
  if (loc.mobility !== 'mobile') throw new Error(`startTravel: location ${id} is fixed, it cannot travel`);
  if (loc.transit) throw new Error(`startTravel: location ${id} is already in transit`);

  const fromPos = positionOf(world, id);
  if (!fromPos) throw new Error(`startTravel: location ${id} has no resolvable position`);

  let toPos: WorldPosition | undefined = dest.pos;
  if (toPos === undefined && dest.locationId !== undefined) toPos = positionOf(world, dest.locationId);
  if (!toPos) throw new Error(`startTravel: destination has no resolvable position`);

  const speed = opts.speed ?? TRAVEL_SPEED;
  const dist = world.substrate.distance(fromPos, toPos);
  const duration = Math.max(1, Math.ceil(dist / Math.max(0.0001, speed)));

  const transit: Transit = {
    fromPos: { ...fromPos },
    toPos: { ...toPos },
    toLocationId: dest.locationId,
    departTick: world.tick,
    arriveTick: world.tick + duration,
    hazard: opts.hazard ?? 0,
    delayTicks: 0,
  };
  loc.transit = transit;
  loc.dockedAt = undefined; // a departing vehicle is no longer docked anywhere

  return emit(world, 'travel_started', [], {
    vehicle: loc.name,
    dest: dest.locationId !== undefined ? getLocation(world, dest.locationId)?.name ?? '' : '',
    eta: duration,
  });
}

/**
 * Resolve all in-flight journeys for this tick. For each mobile Location in transit, in
 * ascending id order: roll its hazard (which may push the arrival back), then — if its
 * arrival tick has been reached — land it (update position, dock if bound for a place,
 * clear transit) and emit `travel_arrived`. A no-op when nothing is travelling.
 */
export function travelTick(world: World): void {
  // collect travellers first (in id order) so the set is stable while we mutate it
  const travellers: LocationId[] = [];
  for (const id of [...world.locations.keys()].sort((a, b) => a - b)) {
    if (world.locations.get(id)!.transit) travellers.push(id);
  }
  if (travellers.length === 0) return;

  const rng = new Rng(world.travelRngState);
  for (const id of travellers) {
    const loc = world.locations.get(id)!;
    const t = loc.transit!;
    // a hazard can strike before arrival, delaying the journey (piracy, storm, breakdown).
    // At most one mishap per journey (delayTicks === 0 gate) so a high hazard cannot
    // outrun the clock and strand the vehicle forever — the journey always completes.
    if (t.hazard > 0 && t.delayTicks === 0 && world.tick < t.arriveTick && rng.chance(t.hazard)) {
      t.arriveTick += HAZARD_DELAY_TICKS;
      t.delayTicks += HAZARD_DELAY_TICKS;
      emit(world, 'travel_delayed', [], { vehicle: loc.name, by: HAZARD_DELAY_TICKS });
    }
    if (world.tick >= t.arriveTick) {
      loc.pos = { ...t.toPos }; // mobile position is updated on arrival (mutable for vehicles)
      if (t.toLocationId !== undefined && world.locations.has(t.toLocationId)) loc.dockedAt = t.toLocationId;
      const destName = t.toLocationId !== undefined ? getLocation(world, t.toLocationId)?.name ?? '' : '';
      const days = world.tick - t.departTick;
      loc.transit = undefined;
      emit(world, 'travel_arrived', [], { vehicle: loc.name, dest: destName, days });
    }
  }
  world.travelRngState = rng.state;
}
