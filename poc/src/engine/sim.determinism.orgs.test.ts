/**
 * Determinism: the organization stack (Phases 2A–2D). Two fresh worlds with the same
 * seed must exist, remember, reason, and execute identically. These assertions lived
 * inline in organization/orgReason/orgAction .test.ts, each paying its own double
 * 60-year run; they are consolidated here onto ONE shared pair of worlds so the fast
 * suite (which excludes *.determinism* — see vitest.config.ts) doesn't re-simulate
 * 360 years on every incremental change. test:full / test:det-full pick this file up
 * by the filename convention, like the rest of the determinism suite.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears, hashWorld } from './sim';
import { getOrganization } from './organization';
import type { World } from './model';

describe('organization stack determinism (two fresh worlds, same seed)', () => {
  let a: World;
  let b: World;

  beforeAll(() => {
    a = createWorld(7);
    b = createWorld(7);
    runYears(a, 60);
    runYears(b, 60);
  });

  it('worlds hash identically (orgs, rosters, intents, and actions are in the hash)', () => {
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('organizations match identity-for-identity', () => {
    expect(b.organizations.length).toBe(a.organizations.length);
    for (const org of a.organizations) {
      const other = getOrganization(b, org.id)!;
      expect(other.name).toBe(org.name);
      expect(other.seatId).toBe(org.seatId);
      expect(other.leaderId).toBe(org.leaderId);
      expect(other.seatHistory).toEqual(org.seatHistory);
    }
  });

  it('reasoning matches: stored decisions are equal object-for-object', () => {
    for (const org of a.organizations) {
      expect(b.currentIntent.get(org.id)).toEqual(a.currentIntent.get(org.id));
    }
  });

  it('execution matches: operational state and last actions are equal', () => {
    for (const org of a.organizations) {
      expect(b.operationalState.get(org.id)).toEqual(a.operationalState.get(org.id));
      expect(b.lastAction.get(org.id)).toEqual(a.lastAction.get(org.id));
    }
  });
});
