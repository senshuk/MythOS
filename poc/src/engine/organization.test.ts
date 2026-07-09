/**
 * Organizations exist (Phase 2A). Proves the engine can represent organizations as
 * first-class entities — instantiated as the Polity each governed settlement hosts. The
 * settlement is the place; the polity is the government seated there, with its own
 * identity, leader, seat, reputation, and history — and an identity independent of the
 * place it occupies. The "first make things exist" milestone for the social spine.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, hashWorld, buildSnapshot, focusSettlement } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import {
  getOrganization,
  membersOf,
  moveSeat,
  createOrganization,
  enroll,
  appointLeader,
  vacateRole,
  membersWithRole,
  roleHistory,
  currentMembers,
  ROLE_LEADER,
  ROLE_FOUNDER,
} from './organization';
import { createLocation } from './location';
import { recordDeed, standingOf } from './reputation';
import { hasLeader, ORG_CATEGORY_POLITICAL } from '../content/fixture';
import { getFigure } from './figures';
import type { World } from './model';

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
const ORG_FIXTURE_SEED = 8;
const ORG_FIXTURE_YEARS = 1;

/**
 * The seed-8 world after one year, built ONCE and shared by every test that only
 * reads it (successions, dissolutions, snapshots, save/load round-trips — roundTrip
 * and hashWorld are pure). Fields that must be sampled BEFORE the run (the founding
 * polity's identity) are captured at build time. Rebuilding this world per test was
 * most of this file's runtime.
 */
interface OrgFixture {
  w: World;
  orgId: number;
  id0: number;
  seat0: number | undefined;
  leader0: number | undefined;
}
let fixture: OrgFixture | undefined;
function orgFixture(): OrgFixture {
  if (!fixture) {
    const w = createWorld(ORG_FIXTURE_SEED);
    // the default focused settlement may be leaderless (no polity) in some worlds — focus a
    // governed one that hosts a polity, so the snapshot's focused polity view is populated.
    if (w.settlements[w.focusedSettlementId].polityId === undefined) {
      focusSettlement(w, w.settlements.find((s) => s.polityId !== undefined)!.id);
    }
    const orgId = w.settlements[w.focusedSettlementId].polityId!;
    const org = getOrganization(w, orgId)!;
    fixture = { w, orgId, id0: org.id, seat0: org.seatId, leader0: org.leaderId };
    runYears(w, ORG_FIXTURE_YEARS);
  }
  return fixture;
}

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
    const { w, orgId, id0, seat0, leader0 } = orgFixture();
    const orgAfter = getOrganization(w, orgId)!;
    // the org is the SAME entity (id + seat stable), even as leadership turns over
    expect(orgAfter.id).toBe(id0);
    expect(orgAfter.seatId).toBe(seat0);
    expect(orgAfter.leaderId).not.toBe(leader0);
    // a succession happened — the new leader is a real remembered figure
    expect(getFigure(w, orgAfter.leaderId)).toBeDefined();
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
    const { w } = orgFixture();
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

  // 'two fresh worlds with the same seed have identical organizations' lives in
  // sim.determinism.orgs.test.ts — the fast suite excludes double 60-year runs.

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

describe('Organizations remember (Phase 2B: membership & roles)', () => {
  it('a founded polity records its founder as both founder and leader', () => {
    const w = createWorld(1);
    const s = w.settlements.find((st) => st.polityId !== undefined)!;
    const org = getOrganization(w, s.polityId)!;
    const founders = membersWithRole(w, org.id, ROLE_FOUNDER);
    const leaders = membersWithRole(w, org.id, ROLE_LEADER);
    expect(founders.length).toBe(1);
    expect(leaders.length).toBe(1);
    expect(founders[0].actorId).toBe(leaders[0].actorId); // founder is the first leader
    expect(leaders[0].actorId).toBe(org.leaderId); // and matches the convenience mirror
    expect(founders[0].untilTick).toBeUndefined(); // founder role is permanent/open
  });

  it('succession turns the leadership over: old record closes, the org remembers the line', () => {
    const { w, orgId } = orgFixture();
    const history = roleHistory(w, orgId, ROLE_LEADER);
    expect(history.length).toBeGreaterThanOrEqual(2);
    // exactly one leader is currently open; all earlier ones are closed
    const open = history.filter((m) => m.untilTick === undefined);
    expect(open.length).toBe(1);
    expect(open[0].actorId).toBe(getOrganization(w, orgId)!.leaderId);
    // closed records are remembered in order, each closing at-or-after it began
    for (const m of history) if (m.untilTick !== undefined) expect(m.untilTick).toBeGreaterThanOrEqual(m.sinceTick);
  });

  it('vacating a role closes it without deleting the record (institutional memory)', () => {
    const w = createWorld(3);
    const id = createOrganization(w, { name: 'Test Guild', category: 'economic', subtype: 'guild', governanceId: 'council', foundedYear: 0 });
    enroll(w, id, 101, 'master');
    expect(membersWithRole(w, id, 'master').length).toBe(1);
    w.tick += 100;
    vacateRole(w, id, 'master');
    expect(membersWithRole(w, id, 'master').length).toBe(0); // none currently held
    expect(roleHistory(w, id, 'master').length).toBe(1); // but remembered
    expect(roleHistory(w, id, 'master')[0].untilTick).toBe(w.tick);
  });

  it('appointLeader keeps the roster and the leaderId mirror in lockstep', () => {
    const w = createWorld(4);
    const id = createOrganization(w, { name: 'Test Polity', category: ORG_CATEGORY_POLITICAL, subtype: 'kingdom', governanceId: 'monarchy', foundedYear: 0, leaderId: 50 });
    enroll(w, id, 50, ROLE_LEADER);
    w.tick += 50;
    appointLeader(w, id, 60);
    expect(getOrganization(w, id)!.leaderId).toBe(60);
    expect(membersWithRole(w, id, ROLE_LEADER).map((m) => m.actorId)).toEqual([60]); // only the new one is open
    expect(roleHistory(w, id, ROLE_LEADER).length).toBe(2); // both remembered
  });

  it('bulk membership stays derived (residents), distinct from the role roster', () => {
    const w = createWorld(3);
    const s = w.settlements[w.focusedSettlementId];
    if (s.polityId === undefined) return;
    const derived = membersOf(w, s.polityId); // residents — many
    const roleRoster = currentMembers(w, s.polityId); // notable roles — few
    expect(derived.length).toBeGreaterThan(roleRoster.length);
  });

  it('dissolving an org closes its whole roster but keeps the records', () => {
    const { w } = orgFixture();
    const dissolved = w.organizations.find((o) => o.dissolvedYear !== undefined)!;
    const open = currentMembers(w, dissolved.id);
    expect(open.length).toBe(0); // nothing currently held
    expect((w.orgMembers.get(dissolved.id) ?? []).length).toBeGreaterThan(0); // but remembered
  });

  it('surfaces founder and leader-count in the snapshot polity view', () => {
    const { w } = orgFixture();
    const sv = buildSnapshot(w).settlements[w.focusedSettlementId];
    expect(sv.polity).toBeDefined();
    expect(sv.polity!.leaderCount).toBeGreaterThanOrEqual(1);
  });

  it('round-trips the membership roster through save/load identically', () => {
    const { w } = orgFixture(); // the succession test proves the fixture has ≥2 leaders
    const loaded = roundTrip(w);
    expect(hashWorld(loaded)).toBe(hashWorld(w)); // roster is in the determinism hash
    for (const org of w.organizations) {
      expect(loaded.orgMembers.get(org.id) ?? []).toEqual(w.orgMembers.get(org.id) ?? []);
    }
  });
});
