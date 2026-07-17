/**
 * OBJECTS AS HISTORICAL AGENTS, v1 (design/33) — dynastic heirlooms. These tests pin
 * the ADR's contract: minting is deterministic and scarce, an heirloom's biography is
 * ordinary traceable Events, conquest SEIZES and ruin LOSES, renown is a decaying
 * reducer (the Law of Mythic Scarcity, design/18), a lost relic is belief-worthy (so
 * its fate can drift into legend), and it all round-trips through a save.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { objectRenown, objectRenownTier, heirloomsOf, transferHeirlooms } from './objects';
import { BELIEF_WORTHY } from './perception';
import { driftSpecsFor } from '../content/fixture';
import { renderEvent } from './render';
import { DAYS_PER_YEAR } from './model';

describe('minting (worldgen heirlooms)', () => {
  it('a world mints SOME heirlooms, deterministically, and registers their names', () => {
    const a = createWorld(123456, false);
    const b = createWorld(123456, false);
    expect(a.objects.length).toBeGreaterThan(0); // founding lines carry treasures…
    expect(a.objects.length).toBeLessThan(a.houses.length); // …but most houses get none (scarcity)
    expect(a.objects.map((o) => `${o.id}:${o.name}:${o.holderHouseId}`)).toEqual(
      b.objects.map((o) => `${o.id}:${o.name}:${o.holderHouseId}`),
    );
    for (const o of a.objects) {
      expect(a.names.get(o.id)).toBe(o.name); // prose and legends resolve it forever
      expect(o.history.length).toBeGreaterThanOrEqual(1); // the forging is its first record
      expect(o.history[0].kind).toBe('object_forged');
    }
  });

  it('a forging is an ordinary, renderable event anchored to its settlement', () => {
    const w = createWorld(123456, false);
    const obj = w.objects[0];
    const forge = w.events.find((e) => e.id === obj.history[0].eventId)!;
    expect(forge).toBeDefined();
    expect(forge.subjects[0]).toBe(obj.id);
    expect(renderEvent(w, forge)).toContain(obj.name); // n(0) resolves via the name registry
  });
});

describe('transfer (seized and lost)', () => {
  it('a victorless fall LOSES the heirloom; the loss is recorded and belief-worthy', () => {
    const w = createWorld(123456, false);
    const obj = w.objects[0];
    const house = w.houses.find((h) => h.id === obj.holderHouseId)!;
    const s = w.settlements[house.originSettlementId];
    const year = Math.floor(w.tick / DAYS_PER_YEAR);
    transferHeirlooms(w, house, s, year, undefined, undefined);
    expect(obj.holderHouseId).toBeUndefined();
    const lost = w.events.find((e) => e.type === 'object_lost' && e.subjects[0] === obj.id)!;
    expect(lost).toBeDefined();
    expect(obj.history.some((h) => h.kind === 'object_lost')).toBe(true);
    // the epistemics seam: a loss forms beliefs whose retellings can drift into legend
    expect(BELIEF_WORTHY.object_lost).toBe('lost');
    expect(driftSpecsFor('lost').length).toBeGreaterThan(2);
  });

  it('a fall WITH a victor SEIZES the heirloom into the victor house', () => {
    const w = createWorld(123456, false);
    const obj = w.objects[0];
    const fallen = w.houses.find((h) => h.id === obj.holderHouseId)!;
    const victor = w.houses.find((h) => h.id !== fallen.id && h.extinctYear === undefined)!;
    const s = w.settlements[fallen.originSettlementId];
    transferHeirlooms(w, fallen, s, Math.floor(w.tick / DAYS_PER_YEAR), undefined, victor);
    expect(obj.holderHouseId).toBe(victor.id);
    expect(heirloomsOf(w, victor.id).map((o) => o.id)).toContain(obj.id);
    expect(w.events.some((e) => e.type === 'object_seized' && e.subjects[0] === obj.id)).toBe(true);
  });

  it('pre-history razes leave LOST relics — worlds begin with treasure-tales to tell', () => {
    // across a few seeds, some world has an ancient ruin whose line held an heirloom
    let found = false;
    for (const seed of [123456, 7, 42, 99, 2024] as const) {
      const w = createWorld(seed, false);
      if (w.events.some((e) => e.type === 'object_lost') || w.events.some((e) => e.type === 'object_seized')) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

describe('renown — the Law of Mythic Scarcity', () => {
  it('is computed, decays without reinforcement, and climbs again on new history', () => {
    const w = createWorld(123456, false);
    const obj = w.objects[0];
    const fresh = objectRenown(w, obj);
    expect(fresh).toBeGreaterThan(0);
    // no new events: three centuries on, the songs stop being sung
    w.tick += 300 * DAYS_PER_YEAR;
    const faded = objectRenown(w, obj);
    expect(faded).toBeLessThan(fresh * 0.1);
    expect(objectRenownTier(w, obj)).toBe('plain');
    // a seizure writes new history — renown climbs again
    const fallen = w.houses.find((h) => h.id === obj.holderHouseId)!;
    const victor = w.houses.find((h) => h.id !== fallen.id)!;
    transferHeirlooms(w, fallen, w.settlements[fallen.originSettlementId], Math.floor(w.tick / DAYS_PER_YEAR), undefined, victor);
    expect(objectRenown(w, obj)).toBeGreaterThan(faded);
  });
});

describe('persistence & determinism', () => {
  it('objects round-trip through a save byte-for-byte', () => {
    const w = createWorld(123456);
    runYears(w, 8);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(JSON.stringify(back.objects)).toBe(JSON.stringify(w.objects));
  });

  it('the live sim carries heirlooms forward without disturbing determinism', () => {
    const a = createWorld(2024);
    const b = createWorld(2024);
    runYears(a, 15);
    runYears(b, 15);
    expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects));
  });
});
