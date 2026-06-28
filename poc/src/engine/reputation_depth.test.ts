/**
 * Reputation DEPTH — more ways to earn standing, and a renown→opportunity loop.
 *
 * Proves the new positive sources (valour, ascension, reconciliation) and that renown
 * actually opens a door: a celebrated soul can be raised to lead.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { chooseHeir, figuresYearly } from './figures';
import { standAgainst } from './perception';
import { recordDeed, standingOf } from './reputation';
import { personalityOf } from './social';
import { computeOpinion, addThought } from './opinion';
import { fullActors, getRel } from './world';
import { resolveIntent } from '../systems/resolve';
import { Rng } from './rng';
import { governmentById, maturityOf } from '../content/fixture';

const isAdult = (w: ReturnType<typeof createWorld>, id: number) =>
  w.lifecycle.get(id)!.ageYears >= maturityOf(w.identity.get(id)!.speciesId);

describe('valour — standing against a beast earns renown', () => {
  it('the boldest resident steps up and is remembered for it', () => {
    const w = createWorld(11);

    // the hero is whoever has the most innate nerve (boldness), deterministically
    let expected: number | undefined;
    let max = 0;
    for (const id of fullActors(w)) {
      if (w.homeSettlement.get(id) !== 0) continue;
      const b = personalityOf(w, id).temperament.boldness ?? 0;
      if (b > max) {
        max = b;
        expected = id;
      }
    }

    const hero = standAgainst(w, 4242, 0);
    expect(hero).toBe(expected);
    expect(standingOf(w, hero!)).toBeGreaterThan(0);
    expect(w.reputation.get(hero!)!.marks.some((m) => m.kind === 'valor')).toBe(true);
    expect(w.reputation.get(hero!)!.marks.find((m) => m.kind === 'valor')!.cause).toBe(4242);
  });
});

describe('renown → opportunity: a celebrated soul can be raised to lead', () => {
  it('granting an eligible local enough renown makes them the heir', () => {
    const w = createWorld(3);
    const before = chooseHeir(w, 0);
    expect(before).toBeDefined();

    // a different eligible local, initially NOT the favoured heir…
    const other = fullActors(w).find((id) => id !== before && w.homeSettlement.get(id) === 0 && isAdult(w, id));
    expect(other).toBeDefined();
    expect(chooseHeir(w, 0)).not.toBe(other);

    // …becomes celebrated, and renown lifts them above the prior heir
    for (let i = 0; i < 8; i++) recordDeed(w, other!, 'ascension', { witnesses: 8 });
    expect(standingOf(w, other!)).toBeGreaterThan(0);
    expect(chooseHeir(w, 0)).toBe(other);
  });
});

describe('ascension — rising to a seat is a public elevation', () => {
  it('a real local actor crowned as ruler earns ascension renown', () => {
    // find a focused settlement with a hereditary seat, then end its ruler's reign
    let w!: ReturnType<typeof createWorld>;
    let ruler: ReturnType<typeof createWorld>['figures'][number] | undefined;
    for (let seed = 1; seed < 40 && !ruler; seed++) {
      w = createWorld(seed);
      const s = w.settlements[0];
      if (s.currentRulerId !== undefined && governmentById(s.governmentId).succession === 'hereditary') {
        ruler = w.figures.find((f) => f.id === s.currentRulerId);
      }
    }
    expect(ruler).toBeDefined();

    ruler!.reignEnd = Math.floor(w.tick / 365); // the reign ends now → succession fires
    figuresYearly(w);

    const newRuler = w.settlements[0].currentRulerId!;
    expect(w.identity.has(newRuler)).toBe(true); // a real local actor rose to the seat
    expect((w.reputation.get(newRuler)?.marks ?? []).some((m) => m.kind === 'ascension')).toBe(true);
    expect(standingOf(w, newRuler)).toBeGreaterThan(0);
  });
});

describe('reconciliation — making public peace earns renown', () => {
  it('warming out of an open feud into friendship marks both former enemies', () => {
    const w = createWorld(13);
    const [a, b] = fullActors(w);
    const edge = getRel(w, a, b);

    // an open feud, but warmth has quietly built past the friendship line
    edge.flags.feud = true;
    edge.flags.rival = true;
    for (let i = 0; i < 6; i++) addThought(edge, 'kindness', w.tick);
    expect(computeOpinion(edge, w.tick)).toBeGreaterThan(240);

    // they meet, and the feud resolves into friendship — a public reconciliation
    resolveIntent(w, a, { kind: 'socialize', target: b }, new Rng(123));
    expect(edge.flags.friend).toBe(true);
    expect(edge.flags.feud).toBe(false);

    for (const id of [a, b]) {
      expect((w.reputation.get(id)?.marks ?? []).some((m) => m.kind === 'reconciliation')).toBe(true);
      expect(standingOf(w, id)).toBeGreaterThan(0);
    }
  });
});
