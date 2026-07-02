/**
 * Organizations Phase 2C — orgs WANT (derived goals), OWN (a treasury fed by a real
 * tithe and spent on goal-driven action), and RELATE (institutional thoughts on the
 * shared relationship graph, whose grudges outlive the people who caused them).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, forgeWorld, hashWorld } from './sim';
import { organizationsYearly, orgGoalOf, orgRel, orgOpinionOf, noteOrgThought, getOrganization, seatSettlement } from './organization';
import { computeOpinion } from './opinion';
import { serializeWorld, deserializeWorld } from './persistence';
import { standingOf } from './reputation';
import { ORG_ECONOMY, ORG_GOALS } from '../content/fixture';

/** First settlement (by id) that hosts a polity. */
function firstGoverned(w: ReturnType<typeof createWorld>) {
  for (const s of w.settlements) {
    if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  }
  return undefined;
}

describe('the tithe — a polity funds itself from its seat (a transfer, not minting)', () => {
  it('fills the treasury from the seat wealth, conserving the sum', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    s.econ.wealth = 400;
    s.macro.stability = 50; // secure → no relief
    org.treasury = 0;

    // borders calm + rich seat → goal is 'expand', but the treasury is below the
    // patronage cost, so nothing is spent this year: the tithe is the whole story.
    for (const e of w.edges) if (e.a === s.id || e.b === s.id) e.relation = 0;
    s.econ.wealth = 400;

    const before = s.econ.wealth + org.treasury;
    organizationsYearly(w);
    expect(org.treasury).toBeCloseTo(400 * ORG_ECONOMY.titheRate, 6);
    // conservation: whatever left the seat entered the treasury — nothing was minted
    expect(s.econ.wealth + org.treasury).toBeCloseTo(before, 6);
  });

  it('accrues over forged history — polities end the pre-history holding wealth', () => {
    const w = forgeWorld(7, 60);
    const funded = w.organizations.filter((o) => o.dissolvedYear === undefined && o.treasury > 0);
    expect(funded.length).toBeGreaterThan(0);
  });
});

describe('goals — derived from world state, never stored', () => {
  it('reads survive/defend/prosper/expand off the seat state', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    expect(seatSettlement(w, org)).toBe(s);

    // survive: destabilized seat
    s.macro.stability = ORG_GOALS.surviveStability - 10;
    expect(orgGoalOf(w, org)).toBe('survive');

    // defend: stable, but a hostile border
    s.macro.stability = 40;
    const edge = w.edges.find((e) => e.a === s.id || e.b === s.id)!;
    const savedRel = edge.relation;
    edge.relation = ORG_GOALS.defendRelation - 5;
    expect(orgGoalOf(w, org)).toBe('defend');
    edge.relation = savedRel;

    // prosper: calm borders, poor seat
    for (const e of w.edges) if (e.a === s.id || e.b === s.id) e.relation = 0;
    s.econ.wealth = ORG_GOALS.prosperWealth - 50;
    expect(orgGoalOf(w, org)).toBe('prosper');

    // expand: secure and rich
    s.econ.wealth = ORG_GOALS.prosperWealth + 500;
    expect(orgGoalOf(w, org)).toBe('expand');
  });
});

describe('goal-driven spending', () => {
  it('survive → relief: treasury buys stability and earns a benevolence mark', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    s.macro.stability = ORG_GOALS.surviveStability - 20;
    org.treasury = ORG_ECONOMY.reliefCost + 10;
    s.econ.wealth = 0; // no tithe noise

    const stabBefore = s.macro.stability;
    organizationsYearly(w);
    expect(s.macro.stability).toBe(stabBefore + ORG_ECONOMY.reliefStability);
    expect(org.treasury).toBeCloseTo(10, 6);
    expect(standingOf(w, org.id)).toBeGreaterThan(0);
    expect(w.reputation.get(org.id)!.marks.some((m) => m.kind === 'benevolence')).toBe(true);
    expect(w.events.some((e) => e.type === 'org_relief' && e.subjects.includes(org.id))).toBe(true);
  });

  it('prosper → patronage: works return wealth to the seat and earn a patronage mark', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    s.macro.stability = 40;
    for (const e of w.edges) if (e.a === s.id || e.b === s.id) e.relation = 0; // calm borders
    s.econ.wealth = 100; // poor → prosper
    org.treasury = ORG_ECONOMY.patronageCost;

    organizationsYearly(w);
    const tithe = 100 * ORG_ECONOMY.titheRate;
    expect(s.econ.wealth).toBeCloseTo(100 - tithe + ORG_ECONOMY.patronageWealth, 6);
    expect(org.treasury).toBeCloseTo(tithe, 6);
    expect(w.reputation.get(org.id)!.marks.some((m) => m.kind === 'patronage')).toBe(true);
  });

  it('defend → hoard: a war chest is held, not spent', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    s.macro.stability = 40;
    const edge = w.edges.find((e) => e.a === s.id || e.b === s.id)!;
    edge.relation = ORG_GOALS.defendRelation - 10; // hostile border
    s.econ.wealth = 100;
    org.treasury = ORG_ECONOMY.patronageCost + 500; // plenty — but it must not be spent

    organizationsYearly(w);
    expect(org.treasury).toBeCloseTo(ORG_ECONOMY.patronageCost + 500 + 100 * ORG_ECONOMY.titheRate, 6);
  });
});

describe('org relationships — institutional thoughts on the shared graph', () => {
  it('an org-scale thought moves the institutional stance, and decays like any thought', () => {
    const w = createWorld(3);
    const govs = w.settlements.filter((s) => s.polityId !== undefined);
    expect(govs.length).toBeGreaterThan(1);
    const [a, b] = [govs[0].polityId!, govs[1].polityId!];

    expect(orgOpinionOf(w, a, b)).toBe(0);
    noteOrgThought(w, a, b, 'raided', 42);
    expect(orgOpinionOf(w, a, b)).toBeLessThan(0);
    // symmetric edge: one object, both directions (blood between the PAIR)
    expect(orgOpinionOf(w, b, a)).toBe(orgOpinionOf(w, a, b));
    // the grudge is sourced (traceable to the raid event)
    expect(orgRel(w, a, b).thoughts.some((t) => t.kind === 'raided' && t.cause === 42)).toBe(true);
    // and it FADES: past the thought's duration (~a generation) the grudge is gone
    expect(computeOpinion(orgRel(w, a, b), w.tick)).toBeLessThan(0);
    expect(computeOpinion(orgRel(w, a, b), w.tick + 26 * 365)).toBe(0);
  });

  it('history sows grudges: forged worlds where polities raided each other carry org thoughts', () => {
    // scan a few seeds — raids are seed-dependent, but SOME history always bleeds
    let found = false;
    for (let seed = 1; seed <= 8 && !found; seed++) {
      const w = forgeWorld(seed, 80);
      for (const o of w.organizations) {
        const edges = w.rels.get(o.id);
        if (!edges) continue;
        for (const [, e] of edges) {
          if (e.thoughts.some((t) => t.kind === 'raided' || t.kind === 'wartorn' || t.kind === 'goodTrade')) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    expect(found).toBe(true);
  });
});

describe('persistence — 2C state survives the round trip and old saves default cleanly', () => {
  it('treasury and org relationship edges round-trip byte-identically', () => {
    const w = forgeWorld(11, 60);
    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(hashWorld(restored)).toBe(hashWorld(w));
  });

  it('a v12 save (no treasury, no org rels) loads with clean defaults', () => {
    const w = forgeWorld(11, 40);
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    save.version = 12;
    for (const org of save.organizations) delete org.treasury; // v12 orgs had no treasury
    // v12 rels held only actor adjacency — strip org entries
    const orgIds = new Set(save.organizations.map((o: { id: number }) => o.id));
    save.relAdj = save.relAdj.filter(([id]: [number, unknown]) => !orgIds.has(id));

    const restored = deserializeWorld(save);
    for (const org of restored.organizations) {
      expect(org.treasury).toBe(0);
      expect(restored.rels.has(org.id)).toBe(true);
    }
  });
});

describe('determinism — the 2C passes are RNG-free and reproducible', () => {
  it('two forges of the same seed agree on treasuries, goals, and org stances', () => {
    const a = forgeWorld(17, 60);
    const b = forgeWorld(17, 60);
    expect(hashWorld(a)).toBe(hashWorld(b));
    for (let i = 0; i < a.organizations.length; i++) {
      expect(a.organizations[i].treasury).toBe(b.organizations[i].treasury);
      expect(orgGoalOf(a, a.organizations[i])).toBe(orgGoalOf(b, b.organizations[i]));
    }
  });
});
