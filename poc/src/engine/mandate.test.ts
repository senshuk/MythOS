/**
 * STEERING THE POLITY (design/26 P4) — a seated ruler is a heavier vote on their own
 * polity, never a god-hand. The org still reasons with bounded knowledge; a mandate is
 * honoured only while it names an intent the org itself rates a real contender, and it
 * lapses if the ruler stops renewing it. A spectator/NPC world never has a mandate, so
 * org behaviour there is byte-identical (guarded by the determinism suite).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, focusSettlement, possess, playerTurn } from './sim';
import { evaluateDecisions } from './decision';
import { evaluateIntent, orgIntentYearly } from './orgReason';
import { fullActors } from './world';
import { serializeWorld, deserializeWorld } from './persistence';
import { maturityOf } from './pack';

const VIABLE = 0.6; // must match orgReason's MANDATE_VIABLE_FRACTION

/** A world in which the player is SEATED at a settlement whose council has a real
 *  contender to its chosen course — so the steer has something to turn to. Runs a few
 *  years so the world develops the frictions (borders, trade) that make councils differ,
 *  then seats a local adult and focuses there (so its actors are full-fidelity). */
function ruledWorld() {
  const w = createWorld(123456);
  runYears(w, 12); // let inter-settlement frictions develop
  orgIntentYearly(w);
  // find a living, governed settlement whose org rates a second course a real contender
  const pick = w.settlements.find((s) => {
    if (s.ruinedYear !== undefined || s.polityId === undefined) return false;
    const it = w.currentIntent.get(s.polityId);
    if (!it) return false;
    return it.alternatives.some((a) => a.kind !== it.kind && a.score >= it.score * VIABLE && a.score > 0);
  })!;
  expect(pick).toBeDefined();
  focusSettlement(w, pick.id);
  orgIntentYearly(w); // re-reason now the settlement is detailed
  const ruler = fullActors(w).find((id) => {
    const lc = w.lifecycle.get(id)!;
    return w.homeSettlement.get(id) === pick.id && lc.alive && lc.ageYears >= maturityOf(w.identity.get(id)!.speciesId) + 2;
  })!;
  possess(w, ruler);
  pick.currentRulerId = ruler;
  return { w, ruler, orgId: pick.polityId! };
}

describe('the steer decision', () => {
  it('offers the ruler the council\'s course plus its top alternatives', () => {
    const { w, ruler, orgId } = ruledWorld();
    const steer = evaluateDecisions(w, ruler).find((d) => d.id.startsWith('aud:steer:'));
    expect(steer).toBeDefined();
    // every option is a steer intent naming an org intent kind
    for (const o of steer!.options) expect(o.intent.kind).toBe('steer_polity');
    // the chosen course is on the menu (the "hold" option)
    const chosen = w.currentIntent.get(orgId)!.kind;
    expect(steer!.options.some((o) => o.intent.mode === chosen)).toBe(true);
  });

  it('picking a contender sets a mandate the council then honours', () => {
    const { w, orgId } = ruledWorld();
    const intent = w.currentIntent.get(orgId)!;
    const alt = intent.alternatives
      .filter((a) => a.kind !== intent.kind && a.score >= intent.score * 0.6 && a.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    // only meaningful if a real contender exists; the fixture town has one
    expect(alt).toBeDefined();

    playerTurn(w, { kind: 'steer_polity', mode: alt.kind });
    expect(w.orgMandate.get(orgId)?.kind).toBe(alt.kind);
    // the council re-reasons and now lands on the mandated intent, its steer recorded
    const steered = evaluateIntent(w, orgId);
    expect(steered.kind).toBe(alt.kind);
    expect(steered.factors.some((f) => f.id === 'ruler_mandate')).toBe(true);
  });

  it('a mandate for an intent the org does NOT rate is ignored (bounded vote)', () => {
    const { w, orgId } = ruledWorld();
    const intent = w.currentIntent.get(orgId)!;
    // find the org's WORST-scored intent (well below its top choice)
    const worst = [...intent.alternatives].sort((a, b) => a.score - b.score)[0];
    if (worst.score >= intent.score * 0.6) return; // no clearly-unviable option; skip
    w.orgMandate.set(orgId, { kind: worst.kind, sinceTick: w.tick });
    const steered = evaluateIntent(w, orgId);
    expect(steered.kind).not.toBe(worst.kind); // the org kept its own counsel
  });

  it('a stale mandate lapses — the org reverts to its own course', () => {
    const { w, orgId } = ruledWorld();
    const intent = w.currentIntent.get(orgId)!;
    const alt = intent.alternatives
      .filter((a) => a.kind !== intent.kind && a.score >= intent.score * 0.6 && a.score > 0)[0];
    expect(alt).toBeDefined();
    // set it far in the past (beyond the 1.5-year lapse window)
    w.orgMandate.set(orgId, { kind: alt.kind, sinceTick: w.tick - 1000 });
    const steered = evaluateIntent(w, orgId);
    expect(steered.kind).toBe(intent.kind); // the org's own choice, unmandated
  });

  it('the mandate round-trips through a save', () => {
    const { w, orgId } = ruledWorld();
    w.orgMandate.set(orgId, { kind: 'trade', sinceTick: w.tick });
    const restored = deserializeWorld(serializeWorld(w));
    expect(restored.orgMandate.get(orgId)).toEqual({ kind: 'trade', sinceTick: w.tick });
  });

  it('an unseated player is offered no steer', () => {
    const w = createWorld(123456);
    possess(w, fullActors(w)[0]);
    orgIntentYearly(w);
    expect(evaluateDecisions(w, fullActors(w)[0]).some((d) => d.id.startsWith('aud:steer:'))).toBe(false);
  });
});
