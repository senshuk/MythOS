/**
 * Organizational interaction (Phase 2E) — organizations INTERACT through negotiation,
 * never mutation. Proves the pipeline (proposal → evaluation → outcome), the two-histories
 * principle, the standing-agreement residue and its teeth (a sworn peace stays raids;
 * tribute moves real treasury), and determinism.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, forgeWorld, hashWorld, runDays } from './sim';
import { resolveProposal, interactionById, activeAgreement, sealAgreement, pruneAgreements, neighbourPolities } from './orgInteraction';
import { emit } from './world';
import { getOrganization, treasuryOf, orgOpinionOf } from './organization';
import { serializeWorld, deserializeWorld } from './persistence';
import { ORG_INTERACTION } from '../content/fixture';
import { DAYS_PER_YEAR, type World, type Organization } from './model';

/** Two neighbouring polities (via the region graph), for direct pipeline tests. */
function twoPolities(w: World): [Organization, Organization] {
  for (const s of w.settlements) {
    if (s.polityId === undefined || s.ruinedYear !== undefined) continue;
    const from = getOrganization(w, s.polityId)!;
    const ns = neighbourPolities(w, from);
    if (ns.length > 0) return [from, ns[0]];
  }
  throw new Error('no neighbouring polities in this seed');
}

describe('the pipeline — proposal → evaluation → outcome, never mutation', () => {
  it('an accepted pact seals an agreement, and both courts remember it their own way', () => {
    const w = createWorld(5);
    const [a, b] = twoPolities(w);
    const def = interactionById('non_aggression')!;

    // make acceptance certain: a battered recipient welcomes peace. Raids on its seat
    // enter its PERCEPTION (border_raids counts recent raid events), and battered
    // borders outweigh even a proud, militaristic court's reluctance.
    for (let i = 0; i < 4; i++) emit(w, 'raid', [], { raider: 'the wilds', victim: w.settlements[b.seatId!].name }, [], [b.seatId!]);
    const accepted = resolveProposal(w, def, a, b, { years: 20 });
    expect(accepted).toBe(true);

    // the residue: one standing agreement…
    expect(activeAgreement(w, 'non_aggression', a.id, b.id)).toBeDefined();
    // …one event both subjects cite…
    const ev = w.events.find((e) => e.type === 'pact_sealed');
    expect(ev).toBeDefined();
    expect(ev!.subjects).toContain(a.id);
    expect(ev!.subjects).toContain(b.id);
    // …and TWO histories: each side's own record of the same moment
    const ra = w.lastInteraction.get(a.id)!;
    const rb = w.lastInteraction.get(b.id)!;
    expect(ra.eventId).toBe(ev!.id);
    expect(rb.eventId).toBe(ev!.id);
    expect(ra.role).toBe('proposer');
    expect(rb.role).toBe('recipient');
    // a sealed accord warms the institutional stance (2C relationships)
    expect(orgOpinionOf(w, a.id, b.id)).toBeGreaterThan(0);
  });

  it('a refused demand wounds the pair instead', () => {
    const w = createWorld(5);
    const [a, b] = twoPolities(w);
    const def = interactionById('demand_tribute')!;

    // menace far below the target's own strength → fear is negative → defiance
    const accepted = resolveProposal(w, def, a, b, { amount: 30, menace: 1 });
    expect(accepted).toBe(false);
    expect(w.events.some((e) => e.type === 'tribute_refused')).toBe(true);
    expect(orgOpinionOf(w, a.id, b.id)).toBeLessThan(0); // spurned — a wound between courts
    expect(activeAgreement(w, 'non_aggression', a.id, b.id)).toBeUndefined();
  });

  it('tribute moves REAL treasury — a transfer between institutions, not minting', () => {
    const w = createWorld(5);
    const [a, b] = twoPolities(w);
    const def = interactionById('demand_tribute')!;
    w.orgTreasury.set(a.id, 10);
    w.orgTreasury.set(b.id, 100);

    // overwhelming menace → submission
    const accepted = resolveProposal(w, def, a, b, { amount: 30, menace: 1_000_000 });
    expect(accepted).toBe(true);
    expect(treasuryOf(w, b.id)).toBe(70);
    expect(treasuryOf(w, a.id)).toBe(40);
  });
});

describe('agreements — bounded residue with teeth', () => {
  it('expire and are pruned; history keeps the event', () => {
    const w = createWorld(5);
    const [a, b] = twoPolities(w);
    sealAgreement(w, 'non_aggression', a.id, b.id, 2);
    expect(activeAgreement(w, 'non_aggression', a.id, b.id)).toBeDefined();
    w.tick += 3 * DAYS_PER_YEAR;
    expect(activeAgreement(w, 'non_aggression', a.id, b.id)).toBeUndefined();
    pruneAgreements(w);
    expect(w.orgAgreements.length).toBe(0);
  });

  it('a sworn peace stays the raiders: no raid/battle/conquest between the pact pair', () => {
    // seal peace between EVERY polity pair, then run years: the pact pairs stay bloodless
    const w = forgeWorld(3, 0);
    const polities = w.settlements.filter((s) => s.polityId !== undefined && s.ruinedYear === undefined);
    for (let i = 0; i < polities.length; i++) {
      for (let j = i + 1; j < polities.length; j++) {
        sealAgreement(w, 'non_aggression', polities[i].polityId!, polities[j].polityId!, 60);
      }
    }
    const before = w.events.length;
    runDays(w, 50 * DAYS_PER_YEAR);
    const namesWithPolity = new Set(polities.map((s) => s.name));
    for (const ev of w.events.slice(before)) {
      if (ev.type !== 'raid' && ev.type !== 'battle' && ev.type !== 'conquest') continue;
      // violence involving two POLITY seats would violate the sworn peace. (Freefolk
      // settlements host no polity and swear nothing — they may still bleed.)
      const parties = [ev.data.raider, ev.data.victim, ev.data.a, ev.data.b, ev.data.victor, ev.data.fallen]
        .filter((x): x is string => typeof x === 'string');
      const sworn = parties.filter((p) => namesWithPolity.has(p));
      expect(sworn.length).toBeLessThan(2);
    }
  });
});

describe('the yearly pass — diplomacy emerges from reasoning', () => {
  it('forged history produces negotiated outcomes without any scripting', () => {
    // some seed among these forges at least one interaction event — driven purely by
    // org intents (trade/protect_border/expand) meeting the pipeline
    let found = false;
    for (let seed = 1; seed <= 8 && !found; seed++) {
      const w = forgeWorld(seed, 120);
      found = w.events.some(
        (e) => e.type === 'pact_sealed' || e.type === 'pact_refused' || e.type === 'tribute_paid' || e.type === 'tribute_refused',
      ) || w.orgAgreements.length > 0 || w.lastInteraction.size > 0;
    }
    expect(found).toBe(true);
  });
});

describe('persistence & determinism', () => {
  it('agreements and negotiation memory round-trip byte-identically', () => {
    const w = forgeWorld(11, 100);
    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(hashWorld(restored)).toBe(hashWorld(w));
  });

  it('a pre-2E save loads with no agreements and empty negotiation memory', () => {
    const w = forgeWorld(11, 40);
    const save = JSON.parse(JSON.stringify(serializeWorld(w)));
    save.version = 15;
    delete save.orgAgreements;
    delete save.lastInteraction;
    const restored = deserializeWorld(save);
    expect(restored.orgAgreements).toEqual([]);
    expect(restored.lastInteraction.size).toBe(0);
  });

  it('two forges of the same seed negotiate identically', () => {
    const a = forgeWorld(17, 100);
    const b = forgeWorld(17, 100);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
});

// referenced only for the cooldown constant's existence — keeps the pack contract visible
void ORG_INTERACTION;
