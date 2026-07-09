/**
 * The PACK BOUNDARY contract: the engine consumes a universe through engine/pack's live
 * bindings, so binding a different pack at world creation changes the WORLD — and rebinding
 * the default restores the fantasy universe byte-identically. This is the seam a Tolkien or
 * sci-fi pack plugs into; these tests hold it shut.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld } from './sim';
import { FANTASY_PACK, type UniversePack } from './pack';

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
});
