/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, hashWorld } from './sim';

describe('determinism', () => {
  it('is stable across several seeds', () => {
    for (const seed of [1, 7, 42, 99, 2024]) {
      expect(hashWorld(runHeadless(seed, 40))).toBe(hashWorld(runHeadless(seed, 40)));
    }
  });
});
