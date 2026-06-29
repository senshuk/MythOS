/**
 * Transportation: a mobile Location travels between world positions with DURATION — it
 * occupies its origin, spends days in transit (where a hazard may delay it), then arrives,
 * updates its position, and docks. Contained things move WITH their vehicle. A fixed place
 * never travels. And the whole transit state survives a save/load. "Then make them move."
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runDays, hashWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { createLocation, getLocation, setParent } from './location';
import { startTravel, travelTick, positionOf, inTransit } from './travel';
import { TRAVEL_SPEED, HAZARD_DELAY_TICKS } from '../content/fixture';
import type { World } from './model';

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

/** A headless world (no focus → cheap to advance day by day) with a vehicle placed at the
 *  first settlement, plus a destination position a known distance away. */
function shipWorld(seed: number) {
  const w = createWorld(seed, false);
  const home = w.settlements[0];
  const start = { x: home.pos.x, y: home.pos.y };
  const destPos = { x: home.pos.x + 40, y: home.pos.y + 10 };
  const ship = createLocation(w, { name: 'Wanderer', locationType: 'ship', mobility: 'mobile', pos: start });
  const dist = w.substrate.distance(start, destPos);
  const duration = Math.max(1, Math.ceil(dist / TRAVEL_SPEED));
  return { w, home, start, destPos, ship, duration };
}

describe('Travel: a journey has duration', () => {
  it('a mobile location travels and arrives after distance / speed days', () => {
    const { w, ship, destPos, duration } = shipWorld(1);
    expect(duration).toBeGreaterThan(1);
    startTravel(w, ship, { pos: destPos });
    expect(inTransit(w, ship)).toBe(true);

    runDays(w, duration - 1);
    expect(inTransit(w, ship)).toBe(true); // still en route the day before arrival

    runDays(w, 1);
    expect(inTransit(w, ship)).toBe(false);
    expect(getLocation(w, ship)!.pos).toEqual(destPos); // position updated on arrival
  });

  it('arriving at a destination LOCATION docks the vehicle there', () => {
    const { w, ship } = shipWorld(2);
    const port = w.settlements[1].id;
    startTravel(w, ship, { locationId: port });
    runDays(w, 400); // well beyond any journey length
    expect(inTransit(w, ship)).toBe(false);
    expect(getLocation(w, ship)!.dockedAt).toBe(port);
    expect(getLocation(w, ship)!.pos).toEqual(w.settlements[1].pos);
  });

  it('emits travel_started then travel_arrived', () => {
    const { w, ship, destPos } = shipWorld(3);
    const startId = startTravel(w, ship, { pos: destPos });
    runDays(w, 400);
    // the started event precedes the arrival event in id order
    const arrived = w.events.find((e) => e.type === 'travel_arrived' && e.data.vehicle === 'Wanderer');
    expect(arrived).toBeDefined();
    expect(arrived!.id).toBeGreaterThan(startId);
  });
});

describe('Travel: rules', () => {
  it('a fixed location refuses to travel', () => {
    const w = createWorld(4, false);
    const rock = createLocation(w, { name: 'Standing Stone', locationType: 'monument', pos: { x: 0, y: 0 } });
    expect(() => startTravel(w, rock, { pos: { x: 50, y: 50 } })).toThrow(/fixed/i);
  });

  it('a location already in transit cannot start a second journey', () => {
    const { w, ship, destPos } = shipWorld(5);
    startTravel(w, ship, { pos: destPos });
    expect(() => startTravel(w, ship, { pos: { x: 1, y: 1 } })).toThrow(/already in transit/i);
  });

  it('departing clears a previous dock', () => {
    const { w, ship } = shipWorld(6);
    startTravel(w, ship, { locationId: w.settlements[1].id });
    runDays(w, 400);
    expect(getLocation(w, ship)!.dockedAt).toBe(w.settlements[1].id);
    startTravel(w, ship, { locationId: w.settlements[2].id });
    expect(getLocation(w, ship)!.dockedAt).toBeUndefined(); // no longer docked once underway
  });
});

describe('Travel: contained things move with the vehicle', () => {
  it('a cabin inside the ship reports the ship position, before and after the voyage', () => {
    const { w, ship, start, destPos } = shipWorld(7);
    const cabin = createLocation(w, { name: 'Aft Cabin', locationType: 'room' });
    setParent(w, cabin, ship); // contained, no independent position
    expect(getLocation(w, cabin)!.pos).toBeUndefined();
    expect(positionOf(w, cabin)).toEqual(start); // inherits the ship's position

    startTravel(w, ship, { pos: destPos });
    runDays(w, 400);
    expect(positionOf(w, cabin)).toEqual(destPos); // moved with its container
  });
});

describe('Travel: hazards', () => {
  it('a hazard delays arrival by a bounded amount (one mishap per journey)', () => {
    const { w: safeW, ship: safeShip, destPos: safeDest, duration } = shipWorld(8);
    // baseline: a safe journey arrives exactly on schedule
    startTravel(safeW, safeShip, { pos: safeDest });
    let safeDays = 0;
    while (inTransit(safeW, safeShip)) { runDays(safeW, 1); safeDays++; }
    expect(safeDays).toBe(duration);

    // a certain hazard (p=1) adds exactly one delay of HAZARD_DELAY_TICKS, then no more
    const { w, ship, destPos } = shipWorld(8);
    startTravel(w, ship, { pos: destPos }, { hazard: 1 });
    let days = 0;
    while (inTransit(w, ship)) { runDays(w, 1); days++; expect(days).toBeLessThan(1000); }
    expect(days).toBe(duration + HAZARD_DELAY_TICKS);
    expect(getLocation(w, ship)!.pos).toEqual(destPos);
  });

  it('a delay emits travel_delayed', () => {
    const { w, ship, destPos } = shipWorld(9);
    startTravel(w, ship, { pos: destPos }, { hazard: 1 });
    runDays(w, 400);
    expect(w.events.some((e) => e.type === 'travel_delayed' && e.data.vehicle === 'Wanderer')).toBe(true);
  });
});

describe('Travel: determinism & persistence', () => {
  it('round-trips an in-flight journey through save/load identically', () => {
    const { w, ship, destPos, duration } = shipWorld(10);
    startTravel(w, ship, { pos: destPos }, { hazard: 0.5 });
    runDays(w, Math.max(1, Math.floor(duration / 2))); // freeze mid-voyage
    expect(inTransit(w, ship)).toBe(true);

    const loaded = roundTrip(w);
    expect(hashWorld(loaded)).toBe(hashWorld(w)); // transit + travel RNG are in the hash
    const t0 = getLocation(w, ship)!.transit!;
    const t1 = getLocation(loaded, ship)!.transit!;
    expect(t1).toEqual(t0);

    // and both continue identically to the same arrival
    runDays(w, 400);
    runDays(loaded, 400);
    expect(hashWorld(loaded)).toBe(hashWorld(w));
    expect(getLocation(loaded, ship)!.pos).toEqual(getLocation(w, ship)!.pos);
  });

  it('the same seeded journey is reproducible', () => {
    const a = shipWorld(11);
    const b = shipWorld(11);
    startTravel(a.w, a.ship, { pos: a.destPos }, { hazard: 0.5 });
    startTravel(b.w, b.ship, { pos: b.destPos }, { hazard: 0.5 });
    runDays(a.w, 400);
    runDays(b.w, 400);
    expect(hashWorld(a.w)).toBe(hashWorld(b.w));
  });

  it('travelTick is a no-op in a world with no vehicles (default world unchanged)', () => {
    const w = createWorld(12, false);
    const before = hashWorld(w);
    travelTick(w);
    expect(hashWorld(w)).toBe(before);
  });
});
