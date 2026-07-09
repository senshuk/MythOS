/**
 * Precepts — the creed as data, and the CONSCIENCE it gives (design/23). These pin:
 * precepts subsume the old ethics map (weights + taboos derive identically — a
 * regression guard); a witnessed deed lays a SELF-thought on the doer (guilt) and on
 * witnesses (moral outrage) → mood, sourced to the deed; a martial creed that tolerates
 * killing lays neither; a SACRED precept is felt only by the faithful while a CIVIC one
 * is felt by all; and the whole thing moves mood (belief → feeling) without perturbing
 * determinism.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, hashWorld, runYears } from './sim';
import { witnessDeed } from './perception';
import { fullActors, emit } from './world';
import { computeMood } from './mood';
import { ethicsWeightFor, ethicsTaboos, patronDeityOf, CULTURES, SELF_THOUGHT_SPECS } from '../content/fixture';

/** Stage a public killing in a settlement of the given culture; return the cast. */
function stageKilling(seed: number, cultureId: string, townFaith?: string) {
  const w = createWorld(seed);
  w.settlements[w.focusedSettlementId].cultureId = cultureId;
  if (townFaith !== undefined) for (const id of fullActors(w)) w.faith.set(id, townFaith);
  const [culprit, victim] = fullActors(w);
  const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
  const witnesses = witnessDeed(w, eid, culprit, victim, 'bloodshed');
  return { w, culprit, victim, witnesses, eid };
}

const has = (arr: { kind: string }[] | undefined, kind: string) => !!arr?.some((t) => t.kind === kind);

describe('precepts — the creed as data (subsumes ethics)', () => {
  it('weights derive from precepts, unchanged from the old ethics map', () => {
    expect(ethicsWeightFor('martial', 'bloodshed')).toBe(0.5);
    expect(ethicsWeightFor('sylvan', 'bloodshed')).toBe(2.4);
    expect(ethicsWeightFor('devout', 'bloodshed')).toBe(2.8);
    expect(ethicsWeightFor('artisan', 'violence')).toBe(1.3);
    expect(ethicsWeightFor('martial', 'unknown_deed')).toBe(1.0);
  });

  it('taboo labels are unchanged (order + membership)', () => {
    expect(ethicsTaboos('martial')).toHaveLength(0); // all weights < 1.5
    expect(ethicsTaboos('sylvan')).toEqual(['shed blood', 'came to blows']); // 2.4, 1.8 ≥ 1.5; generosity 1.2 excluded
  });

  it('every precept names a real self-thought kind (contract)', () => {
    for (const c of CULTURES)
      for (const p of c.precepts ?? []) {
        if (p.witnessSelf) expect(SELF_THOUGHT_SPECS[p.witnessSelf]).toBeDefined();
        if (p.commitSelf) expect(SELF_THOUGHT_SPECS[p.commitSelf]).toBeDefined();
      }
  });
});

describe('precepts — the conscience', () => {
  it('a killing lays GUILT on a doer who holds the creed, sourced to the deed', () => {
    const patron = patronDeityOf('sylvan').id;
    const { w, culprit, eid } = stageKilling(42, 'sylvan', patron);
    const guilt = (w.selfThoughts.get(culprit) ?? []).find((t) => t.kind === 'guilt');
    expect(guilt).toBeDefined();
    expect(guilt!.cause).toBe(eid);
  });

  it('the same killing lays MORAL OUTRAGE on every faithful witness', () => {
    const { w, witnesses } = stageKilling(42, 'sylvan', patronDeityOf('sylvan').id);
    expect(witnesses.length).toBeGreaterThan(0);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'moral_outrage')).toBe(true);
  });

  it('a martial creed SHRUGS at bloodshed — no guilt, no outrage', () => {
    const { w, culprit, witnesses } = stageKilling(42, 'martial', patronDeityOf('martial').id);
    expect(has(w.selfThoughts.get(culprit), 'guilt')).toBe(false);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'moral_outrage')).toBe(false);
  });

  it('a SACRED precept is felt only by the faithful; a CIVIC one by all', () => {
    // sylvan bloodshed is SACRED → a faithless town feels no divine outrage
    const sacred = stageKilling(42, 'sylvan', ''); // whole town faithless
    expect(sacred.witnesses.length).toBeGreaterThan(0);
    expect(sacred.witnesses.every((x) => !has(sacred.w.selfThoughts.get(x), 'moral_outrage'))).toBe(true);

    // artisan bloodshed is CIVIC (order, not divinity) → even the faithless feel it
    const civic = stageKilling(42, 'artisan', '');
    expect(civic.witnesses.some((x) => has(civic.w.selfThoughts.get(x), 'moral_outrage'))).toBe(true);
  });

  it('belief → feeling: a killing darkens every faithful witness’s mood', () => {
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'sylvan';
    for (const id of fullActors(w)) w.faith.set(id, patronDeityOf('sylvan').id);
    const [culprit, victim] = fullActors(w);
    const before = new Map(fullActors(w).map((id) => [id, computeMood(w, id)]));
    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
    const witnesses = witnessDeed(w, eid, culprit, victim, 'bloodshed');
    expect(witnesses.length).toBeGreaterThan(0);
    // witnessDeed changes no needs, so any drop is the moral self-thought alone
    for (const x of witnesses) expect(computeMood(w, x)).toBeLessThan(before.get(x)!);
  });

  it('the conscience does not perturb determinism (two fresh worlds agree)', () => {
    const run = () => {
      const w = createWorld(9);
      runYears(w, 12); // exercises the live witnessDeed→precept path
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});
