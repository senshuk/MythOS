/**
 * The PACK BOUNDARY contract: the engine consumes a universe through engine/pack's live
 * bindings, so binding a different pack at world creation changes the WORLD — and rebinding
 * the default restores the fantasy universe byte-identically. This is the seam a Tolkien or
 * sci-fi pack plugs into; these tests hold it shut.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, hashWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { allEvents } from './world';
import { FANTASY_PACK, setPack, type UniversePack } from './pack';

describe('the pack boundary (engine ⇄ universe)', () => {
  it('binds a variant universe at runtime, and rebinds the default byte-identically', () => {
    const baseline = hashWorld(createWorld(3, false));
    try {
      // a variant universe: identical but for ONE member — every settlement gets one name.
      // If the engine consumed the pack through stale/direct imports this would change nothing.
      const variant: UniversePack = {
        ...FANTASY_PACK,
        placeName: () => ({ name: 'Outpost', meaning: 'the same name everywhere' }),
      };
      const w = createWorld(3, false, variant);
      expect(w.settlements.length).toBeGreaterThan(0);
      expect(w.settlements.every((s) => s.name === 'Outpost')).toBe(true);
      expect(hashWorld(w)).not.toBe(baseline);
    } finally {
      // rebinding the default must restore the fantasy universe EXACTLY (live bindings
      // leave no residue) — the byte-identical guarantee the whole refactor rests on.
      expect(hashWorld(createWorld(3, false, FANTASY_PACK))).toBe(baseline);
    }
  });

  it('a pack chooses its MODULES — a secular universe runs no religion, no creed factions', () => {
    try {
      const secular: UniversePack = {
        ...FANTASY_PACK,
        MODULES: { ...FANTASY_PACK.MODULES, religion: false, factions: false },
      };
      const w = createWorld(5, true, secular);
      runYears(w, 30);
      // the gated yearly layers never ran: no conversions/apostasy, no faction strife
      const kinds = new Set(allEvents(w).map((e) => e.type));
      for (const k of kinds) {
        expect(/^(converted|apostasy|faction_|civil_war|exile)/.test(k), `gated event '${k}' fired`).toBe(false);
      }
    } finally {
      setPack(FANTASY_PACK);
    }
  });

  it('a save is STAMPED with its universe, and only loads under it', () => {
    const w = createWorld(3, false);
    const save = serializeWorld(w);
    expect(save.packId).toBe('fantasy');
    expect(typeof save.packVersion).toBe('number');
    // loads under its own pack
    expect(() => deserializeWorld(JSON.parse(JSON.stringify(save)))).not.toThrow();
    // refuses another universe's save with a legible error
    const foreign = { ...JSON.parse(JSON.stringify(save)), packId: 'scifi' };
    expect(() => deserializeWorld(foreign)).toThrow(/belongs to the 'scifi' universe/);
    // a pre-boundary save (no stamp) is a fantasy world — still loads
    const old = JSON.parse(JSON.stringify(save));
    delete old.packId;
    delete old.packVersion;
    expect(() => deserializeWorld(old)).not.toThrow();
  });
});
