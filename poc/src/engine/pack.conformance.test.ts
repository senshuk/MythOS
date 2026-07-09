/**
 * PACK CONFORMANCE (agnosticism Phase E): the same engine battery over EVERY universe.
 * If a check fails for one pack only, the engine has a silent assumption baked in — the
 * whole point of the contrarian AEON pack (one asexual species, secular, no precepts,
 * elected-only) is to trip such assumptions. Add future packs (Tolkien, Trek…) to PACKS
 * and they inherit the battery.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createWorld, runYears, hashWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { allEvents, fullActors } from './world';
import { FANTASY_PACK, setPack, type UniversePack } from './pack';
import { AEON_PACK } from '../content/aeon';

const PACKS: [string, UniversePack][] = [
  ['fantasy', FANTASY_PACK],
  ['aeon', AEON_PACK],
];

afterAll(() => setPack(FANTASY_PACK)); // leave the process on the default universe

describe.each(PACKS)('conformance: the %s universe', (_name, pack) => {
  it('builds a living, deterministic world', () => {
    const w = createWorld(11, false, pack);
    expect(w.settlements.length).toBeGreaterThan(0);
    expect(w.settlements.every((s) => /^[A-Z]/.test(s.name))).toBe(true); // named in some tongue
    expect(w.houses.length).toBeGreaterThan(0); // lineages exist under ANY succession mode
    // deterministic: the same seed under the same pack is the same world, byte for byte
    expect(hashWorld(createWorld(11, false, pack))).toBe(hashWorld(w));
  });

  it('simulates years, then survives a save/load round-trip mid-flight', () => {
    const w = createWorld(11, true, pack);
    const before = allEvents(w).length;
    runYears(w, 8);
    expect(allEvents(w).length).toBeGreaterThan(before); // history is being made
    expect(fullActors(w).some((id) => w.lifecycle.get(id)!.alive)).toBe(true); // people live
    // the save file is the world — and the world continues identically after loading
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(hashWorld(loaded)).toBe(hashWorld(w));
    runYears(w, 2);
    runYears(loaded, 2);
    expect(hashWorld(loaded)).toBe(hashWorld(w));
  });
});

describe('the aeon universe is genuinely contrarian (not fantasy re-skinned)', () => {
  afterAll(() => setPack(FANTASY_PACK));

  it('one asexual species, secular, elected polities — and the engine copes', () => {
    const w = createWorld(11, true, AEON_PACK);
    runYears(w, 8);
    // every soul is a syntid unit
    for (const id of fullActors(w)) expect(w.identity.get(id)!.speciesId).toBe('syntid');
    // secular: nobody holds faith, and no religious history exists
    for (const id of fullActors(w)) expect(w.faith.get(id) ?? '').toBe('');
    const kinds = new Set(allEvents(w).map((e) => e.type));
    for (const k of kinds) expect(/^(converted|apostasy|faction_|civil_war|exile)/.test(k), `event '${k}'`).toBe(false);
    // no pair bonds: an asexual species never marries
    expect(w.stats.marriages).toBe(0);
    // its cultures are aeon's, not fantasy's
    for (const s of w.settlements) expect(['combine', 'swarm']).toContain(s.cultureId);
  });
});
