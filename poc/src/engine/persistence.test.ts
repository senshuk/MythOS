/**
 * Save/load is a determinism guarantee, not just data shuffling: a world that is
 * saved, serialized to JSON, and reloaded must be byte-identical AND must continue
 * identically to one that was never saved. That second property is what catches a
 * dropped component map or a broken shared-edge reference.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  runYears,
  hashWorld,
  canonicalize,
  focusSettlement,
  possess,
  schedulePlayerIntent,
  playerTurn,
} from './sim';
import { fullActors } from './world';
import { serializeWorld, deserializeWorld } from './persistence';
import type { World } from './model';

/** A rich, played session: deep history, focus changes, possession, player turns. */
function builtWorld(seed: number): World {
  const w = createWorld(seed);
  runYears(w, 6);
  focusSettlement(w, 4);
  runYears(w, 4);
  // possess someone and take a few real turns (so player state + input log are non-trivial)
  const adult = fullActors(w).find((id) => w.lifecycle.get(id)!.ageYears >= 20);
  if (adult !== undefined) {
    possess(w, adult);
    const other = fullActors(w).find((id) => id !== adult);
    playerTurn(w, { kind: 'work' });
    if (other !== undefined) playerTurn(w, { kind: 'socialize', target: other });
    playerTurn(w, { kind: 'work' });
  }
  return w;
}

/** Simulate going through storage: serialize → JSON → parse → deserialize. */
function roundTrip(w: World): World {
  return deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
}

describe('persistence (save/load)', () => {
  it('round-trips a world byte-identically', () => {
    const w = builtWorld(123456);
    const loaded = roundTrip(w);
    expect(canonicalize(loaded)).toBe(canonicalize(w));
    expect(hashWorld(loaded)).toBe(hashWorld(w));
  });

  it('a reloaded world continues identically (no hidden state lost)', () => {
    const original = builtWorld(99);
    const loaded = roundTrip(original);

    // advance BOTH the same way; if anything was dropped, they diverge or throw
    runYears(original, 5);
    runYears(loaded, 5);
    expect(hashWorld(loaded)).toBe(hashWorld(original));
  });

  it('preserves data the hash does not cover (needs, traits, profession, memory, inputs)', () => {
    const w = builtWorld(2024);
    const loaded = roundTrip(w);

    const sample = w.entities[Math.floor(w.entities.length / 2)];
    expect(loaded.needs.get(sample)).toEqual(w.needs.get(sample));
    expect(loaded.traits.get(sample)).toEqual(w.traits.get(sample));
    expect(loaded.profession.get(sample)).toBe(w.profession.get(sample));
    expect(loaded.memory.get(sample)).toEqual(w.memory.get(sample));
    expect(loaded.playerInputs).toEqual(w.playerInputs);
    expect(loaded.names.size).toBe(w.names.size);
  });

  it('preserves the shared relationship-edge invariant (both directions are one object)', () => {
    const loaded = roundTrip(builtWorld(7));
    let checked = 0;
    for (const [a, inner] of loaded.rels) {
      for (const [b, edge] of inner) {
        // the reverse edge must be the SAME object, not a copy
        expect(loaded.rels.get(b)!.get(a)).toBe(edge);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // we actually exercised some edges
  });

  it('refuses to load an unknown save version', () => {
    const s = serializeWorld(createWorld(1));
    expect(() => deserializeWorld({ ...s, version: 999 })).toThrow(/unsupported save version/);
  });

  it('player input log replays correctly after a reload', () => {
    // a possessed world reloaded mid-session keeps acting deterministically
    const w = createWorld(555);
    runYears(w, 5);
    const adult = fullActors(w).find((id) => w.lifecycle.get(id)!.ageYears >= 20)!;
    possess(w, adult);
    schedulePlayerIntent(w, w.tick + 7 - (w.tick % 7 || 7) + 7, { kind: 'work' }); // future tick
    const loaded = roundTrip(w);
    runYears(w, 3);
    runYears(loaded, 3);
    expect(hashWorld(loaded)).toBe(hashWorld(w));
  });
});
