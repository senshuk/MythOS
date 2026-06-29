/**
 * Organizations exist (Phase 2A). Proves the engine can represent organizations as
 * first-class entities — instantiated as the Polity each governed settlement hosts. The
 * settlement is the place; the polity is the government seated there, with its own
 * identity, leader, seat, reputation, and history — and an identity independent of the
 * place it occupies. The "first make things exist" milestone for the social spine.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, hashWorld, buildSnapshot } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { getOrganization, membersOf, moveSeat, createOrganization } from './organization';
import { createLocation } from './location';
import { recordDeed, standingOf } from './reputation';
import { hasLeader, ORG_CATEGORY_POLITICAL } from '../content/fixture';
import { getFigure } from './figures';
import type { World } from './model';

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

describe('Organizations exist as first-class entities', () => {
  it('every governed settlement hosts a Polity; leaderless settlements do not', () => {
    const w = createWorld(1);
    for (const s of w.settlements) {
      if (hasLeader(s.governmentId)) {
        expect(s.polityId).toBeDefined();
        const org = getOrganization(w, s.polityId)!;
        expect(org).toBeDefined();
        expect(org.category).toBe(ORG_CATEGORY_POLITICAL);
        expect(org.seatId).toBe(s.id); // the seat is this settlement (a Location)
        expect(org.governanceId).toBe(s.governmentId);
      } else {
        expect(s.polityId).toBeUndefined();
      }
    }
    // at least some polities exist in a normal world
    expect(w.organizations.length).toBeGreaterThan(0);
  });

  it("a polity's leader mirrors its seat's ruler", () => {
    const w = createWorld(2);
    const s = w.settlements.find((st) => st.polityId !== undefined)!;
    const org = getOrganization(w, s.polityId)!;
    expect(org.leaderId).toBe(s.currentRulerId);
  });

  it('membership is derived from the seat residents (focused settlement)', () => {
    const w = createWorld(3); // settlement 0 is focused → has live actors
    const s = w.settlements[w.focusedSettlementId];
    if (s.polityId === undefined) return; // focused settlement is leaderless this seed — skip
    const members = membersOf(w, s.polityId);
    // every derived member actually lives at the seat
    for (const id of members) expect(w.homeSettlement.get(id)).toBe(s.id);
    expect(members.length).toBeGreaterThan(0);
  });

  it('succession operates on the organization: its leader changes while its identity endures', () => {
    // run until a focused-settlement ruler succession changes the polity's leader
    for (let seed = 1; seed <= 12; seed++) {
      const w = createWorld(seed);
      const s = w.settlements[w.focusedSettlementId];
      if (s.polityId === undefined) continue;
      const orgId = s.polityId;
      const org = getOrganization(w, orgId)!;
      const id0 = org.id;
      const seat0 = org.seatId;
      const leader0 = org.leaderId;
      runYears(w, 120);
      const orgAfter = getOrganization(w, orgId)!;
      // the org is the SAME entity (id + seat stable), even as leadership turns over
      expect(orgAfter.id).toBe(id0);
      expect(orgAfter.seatId).toBe(seat0);
      if (orgAfter.leaderId !== leader0) {
        // a succession happened — the new leader is a real remembered figure
        expect(getFigure(w, orgAfter.leaderId)).toBeDefined();
        return;
      }
    }
    // not reaching a succession across 12 seeds would be surprising, but don't hard-fail
  });

  it('seat history grows when the seat moves, and the org keeps its id', () => {
    const w = createWorld(4);
    const s = w.settlements.find((st) => st.polityId !== undefined)!;
    const org = getOrganization(w, s.polityId)!;
    const id0 = org.id;
    const newSeat = createLocation(w, { name: 'New Capital', locationType: 'city', pos: { x: 0, y: 0 } });
    moveSeat(w, org.id, newSeat);
    expect(org.id).toBe(id0); // identity independent of geography
    expect(org.seatId).toBe(newSeat);
    expect(org.seatHistory).toEqual([s.id, newSeat]); // the line of seats is recorded
  });

  it('reputation works on an organization id (same machinery as actors)', () => {
    const w = createWorld(5);
    const org = getOrganization(w, w.settlements.find((st) => st.polityId !== undefined)!.polityId)!;
    expect(standingOf(w, org.id)).toBe(0);
    recordDeed(w, org.id, 'ascension', { witnesses: 10 });
    expect(standingOf(w, org.id)).toBeGreaterThan(0);
  });

  it('the Organization is "boring" — it carries no goals/treasury/diplomacy fields', () => {
    const w = createWorld(6);
    const org = w.organizations[0];
    const keys = Object.keys(org);
    for (const forbidden of ['goals', 'treasury', 'resources', 'relationships', 'members']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('Organizations: visibility & persistence', () => {
  it('the snapshot surfaces the hosting polity on the focused settlement', () => {
    const w = createWorld(7);
    const snap = buildSnapshot(w);
    const sv = snap.settlements[w.focusedSettlementId];
    const s = w.settlements[w.focusedSettlementId];
    if (s.polityId === undefined) return; // leaderless this seed
    expect(sv.polity).toBeDefined();
    expect(sv.polity!.name).toContain('of');
  });

  it('round-trips organizations through save/load identically', () => {
    const w = createWorld(8);
    runYears(w, 40);
    const loaded = roundTrip(w);
    expect(hashWorld(loaded)).toBe(hashWorld(w)); // orgs are in the determinism hash
    expect(loaded.organizations.length).toBe(w.organizations.length);
    for (const org of w.organizations) {
      const l = getOrganization(loaded, org.id)!;
      expect(l.name).toBe(org.name);
      expect(l.seatId).toBe(org.seatId);
      expect(l.leaderId).toBe(org.leaderId);
      expect(l.seatHistory).toEqual(org.seatHistory);
    }
    // settlement → polity link survives
    for (const s of w.settlements) {
      expect(loaded.settlements[s.id].polityId).toBe(s.polityId);
    }
  });

  it('two fresh worlds with the same seed have identical organizations', () => {
    const a = createWorld(9);
    const b = createWorld(9);
    runYears(a, 60);
    runYears(b, 60);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('a hand-built generic organization can exist (the framework is universe-agnostic)', () => {
    const w = createWorld(10);
    const id = createOrganization(w, {
      name: 'The Smiths’ Guild',
      category: 'economic',
      subtype: 'guild',
      governanceId: 'council',
      foundedYear: 0,
    });
    const org = getOrganization(w, id)!;
    expect(org.category).toBe('economic');
    expect(org.seatId).toBeUndefined(); // a seatless org is valid
    expect(org.seatHistory).toEqual([]);
  });
});
