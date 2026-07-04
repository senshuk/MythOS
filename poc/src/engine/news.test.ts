/**
 * Subjectivity 1C-distal — the News Frontier (objective transport, with latency).
 *
 * This proves the objective layer: word of a coronation propagates across the map at travel speed,
 * arriving at each settlement by travel time. It is not belief — nothing here forms an opinion; it
 * is the objective informational environment into which minds are later materialized. "Space became
 * part of cognition" begins here, before a single mind reads the news.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { propagateCoronation, newsKey } from './news';
import { TRAVEL_SPEED } from '../content/fixture';

describe('the News Frontier — objective propagation with latency', () => {
  it('news reaches its own settlement at once, and distant ones by travel time', () => {
    const w = createWorld(5);
    const origin = w.settlements[0];
    const RULER = 999; // any id — the frontier is objective; it does not care whose news it carries
    w.tick = 1000;
    propagateCoronation(w, origin.id, RULER);

    // the origin knows immediately (0 latency)
    const here = w.newsFront.get(newsKey(origin.id, origin.id))!;
    expect(here.ruler).toBe(RULER);
    expect(here.arrival).toBe(1000);

    // a distant settlement knows LATER — by exactly the travel time, no more, no less
    const other = w.settlements.find((s) => s.id !== origin.id && s.ruinedYear === undefined)!;
    const there = w.newsFront.get(newsKey(other.id, origin.id))!;
    const expected = 1000 + Math.ceil(w.substrate.distance(origin.pos, other.pos) / TRAVEL_SPEED);
    expect(there.ruler).toBe(RULER);
    expect(there.arrival).toBe(expected);
    expect(there.arrival).toBeGreaterThan(here.arrival); // news travels slower than events
  });

  it('every settlement records the news, and its latency grows with distance', () => {
    const w = createWorld(5);
    const origin = w.settlements[3] ?? w.settlements[0];
    w.tick = 200;
    propagateCoronation(w, origin.id, 7);

    for (const s of w.settlements) {
      if (s.ruinedYear !== undefined) continue;
      const entry = w.newsFront.get(newsKey(s.id, origin.id));
      expect(entry).toBeDefined();
      // arrival is never earlier than the event, and equals event tick + travel latency
      expect(entry!.arrival).toBeGreaterThanOrEqual(200);
      const expected = 200 + Math.ceil(w.substrate.distance(origin.pos, s.pos) / TRAVEL_SPEED);
      expect(entry!.arrival).toBe(expected);
    }
  });

  it('is deterministic and survives a save/load round-trip', () => {
    const build = () => {
      const w = createWorld(7);
      w.tick = 500;
      propagateCoronation(w, w.settlements[0].id, 42);
      return w;
    };
    const a = build();
    const b = build();
    expect([...a.newsFront]).toEqual([...b.newsFront]); // same seed → identical frontier

    const reloaded = deserializeWorld(serializeWorld(a));
    expect([...reloaded.newsFront]).toEqual([...a.newsFront]); // objective state round-trips intact
  });
});
