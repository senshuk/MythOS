/**
 * PLAYER DIPLOMACY (Phase 2E, design/26 P2's envoy). The org↔org negotiation pipeline runs
 * between NPC polities on its own; this makes a ruler-player a party to it. INCOMING: a
 * neighbour's real proposal addressed to the polity the player RULES is parked (not
 * auto-resolved) and answered at a throne-room audience — the player's will replaces the
 * recipient's evaluate(). OUTGOING: the player proposes a pact to a neighbour, whose OWN
 * bounded view decides. Everything flows through the same outcome machinery, so a pact the
 * player seals binds exactly as one the world negotiates without them. Player-only: an
 * NPC/spectator world never parks an envoy, so its diplomacy is byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, possess, playerTurn, focusSettlement, inspectSettlement } from './sim';
import { evaluateDecisions } from './decision';
import { fullActors } from './world';
import { getOrganization } from './organization';
import { neighbourPolities, activeAgreement, orgInteractionYearly } from './orgInteraction';
import { maturityOf } from './pack';
import { serializeWorld, deserializeWorld } from './persistence';
import type { OrgId } from './model';

/** A world where the player is SEATED at a governed settlement that has a governed neighbour —
 *  so there is someone to send/receive an envoy. Returns the player's polity P and a neighbour Q. */
function diploWorld(seed = 123456) {
  const w = createWorld(seed);
  runYears(w, 4); // let governance settle and relations develop
  // a living governed settlement with at least one living governed neighbour
  let home = -1;
  let Q: ReturnType<typeof getOrganization> | undefined;
  for (const s of w.settlements) {
    if (s.ruinedYear !== undefined || s.polityId === undefined) continue;
    const org = getOrganization(w, s.polityId);
    if (!org) continue;
    const nb = neighbourPolities(w, org);
    if (nb.length) { home = s.id; Q = nb[0]; break; }
  }
  expect(home).toBeGreaterThanOrEqual(0);
  focusSettlement(w, home); // materialize its actors
  const ruler = fullActors(w).find(
    (id) => w.homeSettlement.get(id) === home && w.lifecycle.get(id)!.alive &&
      w.lifecycle.get(id)!.ageYears >= maturityOf(w.identity.get(id)!.speciesId) + 2,
  )!;
  expect(ruler).toBeDefined();
  possess(w, ruler);
  w.settlements[home].currentRulerId = ruler; // seat the player (unit-level; claim.test owns the real path)
  const P = w.settlements[home].polityId!;
  // Q's id is stable across the focus shift (neighbours come from the region graph, not fidelity)
  return { w, ruler, home, P, Q: Q! };
}

/** Park an incoming trade-agreement envoy from Q to the player's polity P. */
function parkEnvoy(w: ReturnType<typeof createWorld>, from: OrgId, to: OrgId, defId = 'trade_agreement') {
  w.pendingEnvoy = { from, to, defId, terms: { years: 20 }, sinceTick: w.tick };
}

describe('an incoming envoy is parked for the player, not auto-resolved', () => {
  it('a neighbour whose proposal is addressed to the ruled polity parks an audience', () => {
    const { w, P, Q } = diploWorld();
    // only Q has a diplomatic intent this pass, and P is its friendliest neighbour
    w.currentIntent.clear();
    w.currentIntent.set(Q.id, { kind: 'trade' } as never);
    for (const e of w.edges) {
      if ((e.a === Q.seatId && e.b === w.settlements[/* home seat = P's seat */ getOrganization(w, P)!.seatId!].id) ||
          (e.b === Q.seatId && e.a === getOrganization(w, P)!.seatId)) {
        e.relation = 100; // make P unambiguously Q's friendliest
      }
    }
    orgInteractionYearly(w);
    expect(w.pendingEnvoy).toBeDefined();
    expect(w.pendingEnvoy!.to).toBe(P);
    // parked, NOT sealed — a considered proposal is not yet history
    expect(activeAgreement(w, 'trade_agreement', w.pendingEnvoy!.from, P)).toBeUndefined();
    expect(w.lastInteraction.get(P)).toBeUndefined();
  });

  it('a spectator/NPC world never parks an envoy (player-only)', () => {
    const w = createWorld(123456);
    runYears(w, 4);
    orgInteractionYearly(w); // no player possessed
    expect(w.pendingEnvoy).toBeUndefined();
  });
});

describe('the envoy audience', () => {
  it('surfaces the parked proposal to the seated ruler with accept/refuse', () => {
    const { w, ruler, P, Q } = diploWorld();
    parkEnvoy(w, Q.id, P);
    const d = evaluateDecisions(w, ruler).find((d) => d.id.startsWith('aud:envoy:'));
    expect(d).toBeDefined();
    expect(d!.options.length).toBe(2);
    expect(d!.options[0].intent).toMatchObject({ kind: 'answer_envoy', mode: 'accept' });
    expect(d!.options[1].intent).toMatchObject({ kind: 'answer_envoy', mode: 'reject' });
  });

  it('accepting seals the pact, clears the envoy, and writes both courts\' records', () => {
    const { w, P, Q } = diploWorld();
    parkEnvoy(w, Q.id, P);
    const before = w.events.length;
    playerTurn(w, { kind: 'answer_envoy', mode: 'accept' });
    expect(w.pendingEnvoy).toBeUndefined();
    expect(activeAgreement(w, 'trade_agreement', Q.id, P)).toBeDefined();
    // one event both cite, and each side keeps its own record
    const sealed = w.events.slice(before).find((e) => e.type === 'pact_sealed');
    expect(sealed).toBeDefined();
    expect(w.lastInteraction.get(P)?.role).toBe('recipient');
    expect(w.lastInteraction.get(Q.id)?.role).toBe('proposer');
  });

  it('refusing declines the pact and still clears the envoy (an answer is an answer)', () => {
    const { w, P, Q } = diploWorld();
    parkEnvoy(w, Q.id, P);
    const before = w.events.length;
    playerTurn(w, { kind: 'answer_envoy', mode: 'reject' });
    expect(w.pendingEnvoy).toBeUndefined();
    expect(activeAgreement(w, 'trade_agreement', Q.id, P)).toBeUndefined();
    expect(w.events.slice(before).some((e) => e.type === 'pact_refused')).toBe(true);
  });

  it('is withdrawn (no audience) once it has gone stale, and does not resolve on its own', () => {
    const { w, ruler, P, Q } = diploWorld();
    parkEnvoy(w, Q.id, P);
    w.pendingEnvoy!.sinceTick = w.tick - 6 * 365; // older than the interaction cooldown window
    expect(evaluateDecisions(w, ruler).some((d) => d.id.startsWith('aud:envoy:'))).toBe(false);
  });

  it('round-trips through a save (player-only diplomatic state)', () => {
    const { w, P, Q } = diploWorld();
    parkEnvoy(w, Q.id, P, 'non_aggression');
    const restored = deserializeWorld(serializeWorld(w));
    expect(restored.pendingEnvoy).toEqual({ from: Q.id, to: P, defId: 'non_aggression', terms: { years: 20 }, sinceTick: w.tick });
  });
});

describe('the player proposes a pact (outgoing)', () => {
  it('the settlement inspector offers proposable pacts on a neighbour polity\'s seat', () => {
    const { w, Q } = diploWorld();
    const detail = inspectSettlement(w, Q.seatId!);
    expect(detail?.diplomacy).toBeDefined();
    expect(detail!.diplomacy!.canTrade).toBe(true); // no pact yet in a fresh world
    expect(detail!.diplomacy!.canPeace).toBe(true);
    expect(detail!.diplomacy!.otherName).toBe(Q.name);
  });

  it('offers nothing on a neighbour once a pact is already in force', () => {
    const { w, P, Q } = diploWorld();
    playerTurn(w, { kind: 'propose_pact', target: Q.seatId, mode: 'non_aggression' });
    // if the neighbour swore peace, the inspector no longer offers that same pact
    if (w.lastInteraction.get(P)?.accepted) {
      expect(inspectSettlement(w, Q.seatId!)?.diplomacy?.canPeace).toBe(false);
    }
  });

  it('addresses a neighbour polity, whose own bounded view decides — recorded either way', () => {
    const { w, P, Q } = diploWorld();
    playerTurn(w, { kind: 'propose_pact', target: Q.seatId, mode: 'trade_agreement' });
    // the interaction was attempted: the player's polity kept a proposer record
    const rec = w.lastInteraction.get(P);
    expect(rec?.role).toBe('proposer');
    expect(rec?.withOrg).toBe(Q.id);
    // and if the neighbour accepted, the pact is now in force (else it is legibly refused)
    if (rec?.accepted) expect(activeAgreement(w, 'trade_agreement', P, Q.id)).toBeDefined();
  });
});
