/**
 * Organizations Phase 2C — orgs OWN (a treasury fed by a real tithe, spent by the
 * action layer) and RELATE (institutional thoughts on the shared relationship graph,
 * whose grudges outlive the people who caused them). Reasoning is orgReason.ts's
 * business (tested there); execution is orgAction.ts's (tested there) — these tests
 * cover the resources + relationships substrate and its fusion with the action layer.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, forgeWorld, hashWorld } from './sim';
import { orgTitheYearly, treasuryOf, adjustTreasury, orgRel, orgOpinionOf, noteOrgThought, getOrganization } from './organization';
import { applyEffects } from './orgAction';
import { actionById, ORG_ECONOMY } from '../content/fixture';
import { computeOpinion } from './opinion';
import { serializeWorld, deserializeWorld } from './persistence';

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
    w.orgTreasury.set(org.id, 0);

    const before = s.econ.wealth + treasuryOf(w, org.id);
    orgTitheYearly(w);
    expect(treasuryOf(w, org.id)).toBeCloseTo(400 * ORG_ECONOMY.titheRate, 6);
    // conservation: whatever left the seat entered the treasury — nothing was minted
    expect(s.econ.wealth + treasuryOf(w, org.id)).toBeCloseTo(before, 6);
  });

  it('accrues over forged history — polities end the pre-history holding wealth', () => {
    const w = forgeWorld(7, 60);
    const funded = w.organizations.filter((o) => o.dissolvedYear === undefined && treasuryOf(w, o.id) > 0);
    expect(funded.length).toBeGreaterThan(0);
  });

  it('keeps the Organization record itself boring — funds live off-record', () => {
    const w = createWorld(5);
    const org = getOrganization(w, firstGoverned(w)!.polityId)!;
    expect(Object.keys(org)).not.toContain('treasury');
    expect(w.orgTreasury.has(org.id)).toBe(true);
  });
});

describe('the treasury bounds the action layer (2C ⇄ 2D fusion)', () => {
  it('fortify is infeasible for a penniless org, feasible once the tithe has fed it', () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    const fortify = actionById('fortify')!;

    w.orgTreasury.set(org.id, 0);
    expect(fortify.feasible(w, org, w.operationalState.get(org.id)!).ok).toBe(false);

    w.orgTreasury.set(org.id, 25);
    expect(fortify.feasible(w, org, w.operationalState.get(org.id)!).ok).toBe(true);
  });

  it("a 'treasury' effect debits the org's own funds, not the seat's economy", () => {
    const w = createWorld(5);
    const s = firstGoverned(w)!;
    const org = getOrganization(w, s.polityId)!;
    w.orgTreasury.set(org.id, 100);
    s.econ.wealth = 500;

    applyEffects(w, org, [{ target: 'treasury', delta: -25 }]);
    expect(treasuryOf(w, org.id)).toBe(75);
    expect(s.econ.wealth).toBe(500); // untouched — the institution paid, not the town
  });

  it('adjustTreasury floors at zero (no institutional debt yet)', () => {
    const w = createWorld(5);
    const org = getOrganization(w, firstGoverned(w)!.polityId)!;
    w.orgTreasury.set(org.id, 10);
    adjustTreasury(w, org.id, -50);
    expect(treasuryOf(w, org.id)).toBe(0);
  });
});

describe('org relationships — institutional thoughts on the shared graph', () => {
  it('an org-scale thought moves the institutional stance, and fades like any thought', () => {
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
  it('treasuries and org relationship edges round-trip byte-identically', () => {
    const w = forgeWorld(11, 60);
    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(hashWorld(restored)).toBe(hashWorld(w));
  });

  it('a pre-2C save (no treasuries, no org rels) loads with clean defaults', () => {
    const w = forgeWorld(11, 40);
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    save.version = 14; // the shape before OrgResources/OrgRelationships
    delete save.orgTreasury;
    // pre-v15 rels held only actor adjacency — strip org entries
    const orgIds = new Set(save.organizations.map((o: { id: number }) => o.id));
    save.relAdj = save.relAdj.filter(([id]: [number, unknown]) => !orgIds.has(id));

    const restored = deserializeWorld(save);
    for (const org of restored.organizations) {
      expect(treasuryOf(restored, org.id)).toBe(0);
      expect(restored.rels.has(org.id)).toBe(true);
    }
  });
});

describe('determinism — the 2C passes are RNG-free and reproducible', () => {
  it('two forges of the same seed agree on treasuries and org stances', () => {
    const a = forgeWorld(17, 60);
    const b = forgeWorld(17, 60);
    expect(hashWorld(a)).toBe(hashWorld(b));
    for (const o of a.organizations) {
      expect(treasuryOf(a, o.id)).toBe(treasuryOf(b, o.id));
    }
  });
});
