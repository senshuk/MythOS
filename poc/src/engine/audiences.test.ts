/**
 * AUDIENCES (design/26 P2) — Warsim's throne room from real state. A seated player
 * receives petitions GENERATED from the systems already running (a real feud pair,
 * a real treasury), and every verdict acts through existing mechanism (thoughts,
 * repute witnesses, the org treasury) and lands as a traceable event. Even the
 * refusal is an outcome — recorded, and suppressing the petition for a season.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runDays, possess, playerTurn } from './sim';
import { evaluateDecisions } from './decision';
import { fullActors, getRel } from './world';
import { addThought, computeOpinion } from './opinion';
import { escalateAnimosity, isRuler } from './social';
import { adjustTreasury, treasuryOf } from './organization';
import { maturityOf } from './pack';

/** A fixture town with a seated PLAYER and one bitter feud between two neighbours. */
function courtWorld() {
  const w = createWorld(123456);
  const adults = fullActors(w).filter((id) => {
    const lc = w.lifecycle.get(id)!;
    return lc.alive && lc.ageYears >= maturityOf(w.identity.get(id)!.speciesId) + 2;
  });
  const [ruler, a, b] = adults;
  possess(w, ruler);
  // seat the player (unit-level state setup — rulership's real path is claim.test's job)
  const home = w.homeSettlement.get(ruler)!;
  w.settlements[home].currentRulerId = ruler;
  expect(isRuler(w, ruler)).toBe(true);
  // a REAL feud: drive the pair's opinion deep negative and escalate through the one rule
  const edge = getRel(w, a, b);
  addThought(edge, 'slighted', w.tick, { value: -600 });
  escalateAnimosity(w, a, b, edge);
  expect(edge.flags.feud).toBe(true);
  return { w, ruler, a, b, home };
}

describe('the feud judgment', () => {
  it('the bitterest feud petitions the seat; a truce softens it and both warm to the judge', () => {
    const { w, ruler, a, b } = courtWorld();
    const petition = evaluateDecisions(w, ruler).find((d) => d.id.startsWith('aud:judgment:'));
    expect(petition).toBeDefined();
    expect(petition!.options.map((o) => o.intent.kind)).toContain('adjudicate');

    const before = computeOpinion(getRel(w, a, b), w.tick);
    playerTurn(w, { kind: 'adjudicate', target: a, mode: 'reconcile' });

    const judgment = [...w.events].reverse().find((ev) => ev.type === 'judgment');
    expect(judgment).toBeDefined();
    expect(judgment!.data.verdict).toBe('reconcile');
    expect(judgment!.subjects[0]).toBe(ruler);
    // the truce lands between the parties…
    expect(computeOpinion(getRel(w, a, b), w.tick)).toBeGreaterThan(before);
    // …and both think better of the judge
    expect(getRel(w, ruler, a).thoughts.some((t) => t.kind === 'judgment_favor')).toBe(true);
    expect(getRel(w, ruler, b).thoughts.some((t) => t.kind === 'judgment_favor')).toBe(true);
    // the petition is answered — gone for the season
    expect(evaluateDecisions(w, ruler).some((d) => d.id.startsWith('aud:judgment:'))).toBe(false);
  });

  it('ruling FOR one party warms them and embitters the other — toward judge and rival both', () => {
    const { w, ruler, a, b } = courtWorld();
    playerTurn(w, { kind: 'adjudicate', target: a, mode: 'favor' });
    expect(getRel(w, ruler, a).thoughts.some((t) => t.kind === 'judgment_favor')).toBe(true);
    expect(getRel(w, ruler, b).thoughts.some((t) => t.kind === 'judgment_wrong')).toBe(true);
  });

  it('a dismissal is itself an outcome: recorded, resented, and suppressing for the season', () => {
    const { w, ruler, a } = courtWorld();
    playerTurn(w, { kind: 'dismiss_petition', target: a, mode: 'judgment' });
    expect([...w.events].reverse().some((ev) => ev.type === 'petition_dismissed')).toBe(true);
    expect(evaluateDecisions(w, ruler).some((d) => d.id.startsWith('aud:judgment:'))).toBe(false);
    // …and the quarrel returns to the seat when a NEW season opens (a fresh id → time holds)
    runDays(w, 92);
    expect(evaluateDecisions(w, ruler).some((d) => d.id.startsWith('aud:judgment:'))).toBe(true);
  });

  it('no seat, no audience: an unseated player receives no petitions', () => {
    const w = createWorld(123456);
    const p = fullActors(w)[0];
    possess(w, p);
    expect(evaluateDecisions(w, p).some((d) => d.id.startsWith('aud:'))).toBe(false);
  });
});

describe('the shrine endowment', () => {
  it('a full coffer draws the keepers; granting moves REAL treasury and the faithful warm', () => {
    const { w, ruler, home } = courtWorld();
    const orgId = w.settlements[home].polityId!;
    expect(orgId).toBeDefined();
    adjustTreasury(w, orgId, 200);
    const funds = treasuryOf(w, orgId);

    const ask = evaluateDecisions(w, ruler).find((d) => d.id.startsWith('aud:shrine:'));
    expect(ask).toBeDefined();

    playerTurn(w, { kind: 'fund_shrine' });
    expect(treasuryOf(w, orgId)).toBeLessThan(funds); // a real transfer, not minted away
    const ev = [...w.events].reverse().find((e) => e.type === 'shrine_funding');
    expect(ev).toBeDefined();
    expect(ev!.data.amount).toBe(30);
    // answered — gone for the season
    expect(evaluateDecisions(w, ruler).some((d) => d.id.startsWith('aud:shrine:'))).toBe(false);
  });
});
