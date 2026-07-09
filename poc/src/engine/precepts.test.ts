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
import { statePreceptsYearly } from './religion';
import { standingOf } from './reputation';
import { fullActors, emit } from './world';
import { computeMood } from './mood';
import { ethicsWeightFor, ethicsTaboos, patronDeityOf, giveInclination, creedOf, CULTURES, SELF_THOUGHT_SPECS } from '../content/fixture';

/** Stage a public deed of `kind` (doer=actor[0], other=actor[1]) in a settlement of the
 *  given culture; optionally set the whole town's faith. Returns the cast. */
function stageDeed(seed: number, cultureId: string, kind: string, townFaith?: string) {
  const w = createWorld(seed);
  w.settlements[w.focusedSettlementId].cultureId = cultureId;
  if (townFaith !== undefined) for (const id of fullActors(w)) w.faith.set(id, townFaith);
  const [culprit, victim] = fullActors(w);
  const eid = emit(w, 'deed', [culprit, victim], {});
  const witnesses = witnessDeed(w, eid, culprit, victim, kind);
  return { w, culprit, victim, witnesses, eid };
}

/** Stage a public killing (the canonical negative deed). */
function stageKilling(seed: number, cultureId: string, townFaith?: string) {
  return stageDeed(seed, cultureId, 'bloodshed', townFaith);
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

describe('precepts — virtues (belief produces PRIDE, each creed distinct)', () => {
  it('the Iron Creed REVERES valour — the hero feels righteous, the town edified', () => {
    const { w, culprit, witnesses } = stageDeed(42, 'martial', 'valor', patronDeityOf('martial').id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(true);
    expect(witnesses.length).toBeGreaterThan(0);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(true);
  });

  it('…but the Iron Creed is UNMOVED by peacemaking (no reconciliation precept)', () => {
    const { w, culprit, witnesses } = stageDeed(42, 'martial', 'reconciliation', patronDeityOf('martial').id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(false);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(false);
  });

  it('the Green Way REVERES peacemaking — a healed feud edifies the faithful', () => {
    const { w, culprit, witnesses } = stageDeed(42, 'sylvan', 'reconciliation', patronDeityOf('sylvan').id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(true);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(true);
  });

  it('a virtue lifts a witness’s mood (the positive twin of moral outrage)', () => {
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = 'sylvan';
    for (const id of fullActors(w)) w.faith.set(id, patronDeityOf('sylvan').id);
    const [a, b] = fullActors(w);
    const before = new Map(fullActors(w).map((id) => [id, computeMood(w, id)]));
    const witnesses = witnessDeed(w, emit(w, 'deed', [a, b], {}), a, b, 'reconciliation');
    expect(witnesses.length).toBeGreaterThan(0);
    for (const x of witnesses) expect(computeMood(w, x)).toBeGreaterThan(before.get(x)!);
  });

  it('warm hearts are inclined to give more (and none flood the town)', () => {
    expect(giveInclination(60)).toBeGreaterThan(giveInclination(-60));
    expect(giveInclination(-100)).toBeGreaterThanOrEqual(0);
    expect(giveInclination(100)).toBeLessThanOrEqual(0.16);
  });

  it('NPCs perform generous deeds organically — gifts leave generosity on the record', () => {
    // (a 'generosity' repute mark is gift-specific: the socialize path's chance-kindness
    //  never calls witnessDeed, so this proves the give branch actually fires in live play)
    const w = createWorld(11);
    runYears(w, 8);
    const gaveOpenly = [...w.reputation.values()].some((rep) => rep.marks.some((m) => m.kind === 'generosity'));
    expect(gaveOpenly).toBe(true);
  });
});

describe('precepts — state precepts (the creed judges how you LIVE)', () => {
  /** Put actor[0] into a life-state (mutate), run the yearly scan, return their self-thoughts. */
  function stageLife(cultureId: string, faithful: boolean, mutate: (w: ReturnType<typeof createWorld>, id: number) => void) {
    const w = createWorld(42);
    w.settlements[w.focusedSettlementId].cultureId = cultureId;
    const id = fullActors(w)[0];
    w.faith.set(id, faithful ? patronDeityOf(cultureId).id : '');
    mutate(w, id);
    statePreceptsYearly(w);
    return { w, id, thoughts: w.selfThoughts.get(id) ?? [] };
  }

  it('the Iron Creed blesses RENOWN — a renowned warrior lives at peace', () => {
    const { w, id, thoughts } = stageLife('martial', true, (w, id) => {
      for (let i = 0; i < 4; i++) w.reputation.get(id)!.marks.push({ kind: 'valor', value: 200, sinceTick: w.tick, witnesses: 8 });
    });
    expect(standingOf(w, id)).toBeGreaterThanOrEqual(220); // setup sanity
    expect(has(thoughts, 'at_peace')).toBe(true);
  });

  it('the Green Way frets at HOARDING (sacred) — only the faithful feel it', () => {
    const rich = (w: ReturnType<typeof createWorld>, id: number) => (w.needs.get(id)!.wealth = 950);
    expect(has(stageLife('sylvan', true, rich).thoughts, 'disquiet')).toBe(true);
    expect(has(stageLife('sylvan', false, rich).thoughts, 'disquiet')).toBe(false); // sacred → skips the faithless
  });

  it('the Maker Folk are at peace when PROSPEROUS (civic — felt even by the faithless)', () => {
    const prosperous = (w: ReturnType<typeof createWorld>, id: number) => (w.needs.get(id)!.wealth = 850);
    expect(has(stageLife('artisan', false, prosperous).thoughts, 'at_peace')).toBe(true);
  });

  it('the Old Faith grieves a CHILDLESS elder (sacred)', () => {
    const childlessElder = (w: ReturnType<typeof createWorld>, id: number) => {
      w.lifecycle.get(id)!.ageYears = 200;
      w.ties.get(id)!.children = [];
    };
    expect(has(stageLife('devout', true, childlessElder).thoughts, 'disquiet')).toBe(true);
  });

  it('a state precept FADES once the life-state passes', () => {
    const { w, id } = stageLife('artisan', false, (w, id) => (w.needs.get(id)!.wealth = 850));
    expect(has(w.selfThoughts.get(id), 'at_peace')).toBe(true);
    // leave the state and let the ongoing mood lapse (at_peace lasts 2 years)
    w.needs.get(id)!.wealth = 400;
    w.tick += 2 * 365 + 1;
    statePreceptsYearly(w); // re-scan: no longer prosperous, and the old mark has expired
    const active = (w.selfThoughts.get(id) ?? []).filter((t) => t.kind === 'at_peace' && (t.expiresTick === undefined || t.expiresTick > w.tick));
    expect(active).toHaveLength(0);
  });
});

describe('precepts — creedOf (moral character made legible)', () => {
  it('each creed reads as a distinct outlook of what it reveres and abhors', () => {
    const iron = creedOf('martial');
    expect(iron.reveres).toContain('renown');
    expect(iron.reveres).toContain('stood against the beast');
    expect(iron.abhors).toContain('obscurity');
    expect(iron.abhors).not.toContain('shed blood'); // the Iron Creed does not condemn killing

    const green = creedOf('sylvan');
    expect(green.abhors).toContain('shed blood');
    expect(green.abhors).toContain('hoarding');
    expect(green.reveres).toContain('made peace');
  });
});
