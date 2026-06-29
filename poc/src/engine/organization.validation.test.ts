/**
 * Validation sprint (between Phase 2B and 2C): before organizations gain INTENT, prove the
 * abstraction has earned the right to become intelligent. No new behaviour — this file only
 * interrogates what exists:
 *
 *  1. Historical queries — can the engine answer "who led this polity 300 years ago", "who
 *     has ever belonged", "which orgs has this actor served", and reconstruct the line of
 *     leaders, PURELY from the roster (no special-case code)?
 *  2. Ontology audit — does every field on Organization belong there? (population lives on
 *     Location, not Org; no treasury/goals yet.)
 *  3. Invariants under stress — across seeds and centuries, does leadership stay a single,
 *     contiguous, gapless chain, with the leaderId mirror always in lockstep?
 *  4. Dissolution — once an org dissolves, is its history still fully queryable?
 *
 * These runs are centuries long and slow; the file is excluded from the default config and
 * runs under `npm run test:full` only.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createWorld, runYears } from './sim';
import {
  roleHistory,
  membersWithRole,
  leaderAt,
  holderAt,
  membershipOf,
  organizationsServedBy,
  currentMembers,
  ROLE_LEADER,
  ROLE_FOUNDER,
} from './organization';
import type { World, Organization, OrgMember } from './model';

/** The leader records of an org, in the order held (by sinceTick). */
const leaderLine = (w: World, orgId: number): OrgMember[] =>
  [...roleHistory(w, orgId, ROLE_LEADER)].sort((a, b) => a.sinceTick - b.sinceTick);

/** Assert the leadership of one org is a clean, single, contiguous chain. */
function assertLeadershipChain(w: World, org: Organization): void {
  const line = leaderLine(w, org.id);
  if (line.length === 0) return; // an org with no leader recorded yet — nothing to check
  for (const m of line) if (m.untilTick !== undefined) expect(m.untilTick).toBeGreaterThanOrEqual(m.sinceTick);
  // consecutive holders hand over at the same tick — no gaps, no overlaps
  for (let i = 0; i + 1 < line.length; i++) expect(line[i].untilTick).toBe(line[i + 1].sinceTick);
  const open = line.filter((m) => m.untilTick === undefined);
  if (org.dissolvedYear === undefined) {
    expect(open.length).toBe(1); // a living org has exactly one sitting leader…
    expect(open[0].actorId).toBe(org.leaderId); // …and the mirror agrees
  } else {
    expect(open.length).toBe(0); // a dissolved org's whole line is closed, but remembered
  }
}

describe('Validation: historical queries (answerable from the roster alone)', () => {
  // one expensive world, shared across the read-only historical queries below.
  let w: World;
  let orgId: number;
  let line: OrgMember[];

  beforeAll(() => {
    for (let seed = 1; seed <= 12; seed++) {
      const cand = createWorld(seed);
      const s = cand.settlements[cand.focusedSettlementId];
      if (s.polityId === undefined) continue;
      runYears(cand, 200);
      const ll = leaderLine(cand, s.polityId);
      if (ll.length >= 2) {
        w = cand;
        orgId = s.polityId;
        line = ll;
        return;
      }
    }
    throw new Error('no focused polity reached a second leader within 200 years across 12 seeds');
  });

  it('answers "who led this polity at tick T"', () => {
    const past = line[0];
    const mid = past.untilTick !== undefined ? Math.floor((past.sinceTick + past.untilTick) / 2) : past.sinceTick;
    expect(leaderAt(w, orgId, mid)).toBe(past.actorId); // mid-tenure → that leader
    expect(leaderAt(w, orgId, past.sinceTick - 1)).toBeUndefined(); // before it existed → nobody
    expect(leaderAt(w, orgId, past.untilTick!)).toBe(line[1].actorId); // handover tick → successor
  });

  it('reconstructs the full line of leaders, and everyone who ever belonged', () => {
    const chain = line.map((m) => m.actorId); // Leader A → B → C …
    expect(new Set(chain).size).toBeGreaterThanOrEqual(2);
    const everyone = membershipOf(w, orgId);
    for (const id of chain) expect(everyone).toContain(id);
    const founder = membersWithRole(w, orgId, ROLE_FOUNDER, true)[0];
    expect(everyone).toContain(founder.actorId);
  });

  it('answers "which organizations has this actor served" (the reverse of the roster)', () => {
    const someLeader = line[0].actorId;
    const served = organizationsServedBy(w, someLeader);
    const here = served.find((r) => r.orgId === orgId && r.role === ROLE_LEADER);
    expect(here).toBeDefined();
    expect(here!.sinceTick).toBe(line[0].sinceTick); // reverse lookup agrees with the forward roster
  });
});

describe('Validation: invariants under stress', () => {
  it('leadership is a single contiguous chain across centuries (checked repeatedly)', () => {
    for (const seed of [1, 42]) {
      const w = createWorld(seed);
      for (let chunk = 0; chunk < 4; chunk++) {
        runYears(w, 30); // checkpoint every 30 years — stress the invariant repeatedly
        for (const org of w.organizations) assertLeadershipChain(w, org);
      }
    }
  });

  it('dissolved organizations remain fully queryable (history outlives the institution)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld(seed);
      runYears(w, 150);
      const dead = w.organizations.find((o) => o.dissolvedYear !== undefined && (w.orgMembers.get(o.id)?.length ?? 0) > 0);
      if (!dead) continue;
      expect(currentMembers(w, dead.id).length).toBe(0); // no sitting members…
      expect(membershipOf(w, dead.id).length).toBeGreaterThan(0); // …but the roster is intact
      const ll = leaderLine(w, dead.id);
      if (ll.length > 0) expect(holderAt(w, dead.id, ROLE_LEADER, ll[0].sinceTick)).toContain(ll[0].actorId);
      return;
    }
    throw new Error('no organization dissolved within 150 years across 20 seeds');
  });
});

describe('Validation: ontology audit (no misplaced fields, no god-object creep)', () => {
  it('Organization carries exactly the fields that belong to it', () => {
    const org = createWorld(1).organizations[0];
    const required = ['id', 'name', 'category', 'subtype', 'foundedYear', 'governanceId', 'seatHistory'];
    const optional = ['dissolvedYear', 'leaderId', 'seatId'];
    const allowed = new Set([...required, ...optional]);
    for (const k of required) expect(Object.keys(org)).toContain(k);
    for (const k of Object.keys(org)) expect(allowed.has(k)).toBe(true); // nothing unexpected
  });

  it('an org never holds state that belongs elsewhere (population/treasury/goals/intent)', () => {
    const w = createWorld(2);
    runYears(w, 40);
    for (const org of w.organizations) {
      const keys = Object.keys(org);
      // population lives on the Location (MacroPop), wealth/treasury on the economy — never the Org
      for (const misplaced of ['population', 'macro', 'pop', 'treasury', 'wealth', 'resources', 'goals', 'intent', 'worldview']) {
        expect(keys).not.toContain(misplaced);
      }
    }
  });
});
