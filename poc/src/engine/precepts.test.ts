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
import { ethicsWeightFor, ethicsTaboos, patronDeityOf, giveInclination, creedOf, CULTURES, SELF_THOUGHT_SPECS, type ValueAxis } from '../content/fixture';

// The roster is GENERATED per world-seed (content/cultureGen.ts) — a war-dominant creed is
// no longer always 'martial'. Seed 7 happens to generate all 6 possible dominant axes (see
// content/cultureGen.ts's AXIS_PRECEPTS/AXIS_STATE_PRECEPTS, one archetype per axis), so every
// test below resolves the culture it needs by AXIS instead of a hardcoded id.
const SEED = 7;
function cultureByAxis(axis: ValueAxis): string {
  createWorld(SEED); // (re)generates SEED's roster as a side effect — deterministic, idempotent
  const c = CULTURES.find((c) => c.dominantAxis === axis);
  if (!c) throw new Error(`seed ${SEED}'s roster has no ${axis}-dominant culture — pick a different seed`);
  return c.id;
}
// each generated culture's precept WEIGHTS are the axis archetype's base value scaled by a
// ±15% jitter (content/cultureGen.ts's scalePrecepts) — assert the base is in range, not
// an exact number, since the exact jittered value differs per seed's per-culture draw.
function expectNear(actual: number, base: number) {
  expect(actual).toBeGreaterThanOrEqual(Math.max(0.2, base * 0.85) - 1e-9);
  expect(actual).toBeLessThanOrEqual(Math.min(3, base * 1.15) + 1e-9);
}

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
  it('weights derive from precepts, matching each axis archetype within its jitter range', () => {
    expectNear(ethicsWeightFor(cultureByAxis('war'), 'bloodshed'), 0.5);
    expectNear(ethicsWeightFor(cultureByAxis('nature'), 'bloodshed'), 2.4);
    expectNear(ethicsWeightFor(cultureByAxis('tradition'), 'bloodshed'), 2.8);
    expectNear(ethicsWeightFor(cultureByAxis('craft'), 'violence'), 1.3);
    expect(ethicsWeightFor(cultureByAxis('war'), 'unknown_deed')).toBe(1.0);
  });

  it('taboo labels are stable (the jitter never crosses the 1.5 threshold)', () => {
    expect(ethicsTaboos(cultureByAxis('war'))).toHaveLength(0); // all weights < 1.5 even at +15%
    expect(ethicsTaboos(cultureByAxis('nature'))).toEqual(['shed blood', 'came to blows']); // ~2.4, ~1.8 ≥ 1.5; generosity ~1.2 excluded
  });

  it('every precept names a real self-thought kind (contract)', () => {
    createWorld(SEED);
    for (const c of CULTURES)
      for (const p of c.precepts ?? []) {
        if (p.witnessSelf) expect(SELF_THOUGHT_SPECS[p.witnessSelf]).toBeDefined();
        if (p.commitSelf) expect(SELF_THOUGHT_SPECS[p.commitSelf]).toBeDefined();
      }
  });
});

describe('precepts — the conscience', () => {
  it('a killing lays GUILT on a doer who holds the creed, sourced to the deed', () => {
    const natureCulture = cultureByAxis('nature');
    const patron = patronDeityOf(natureCulture).id;
    const { w, culprit, eid } = stageKilling(SEED, natureCulture, patron);
    const guilt = (w.selfThoughts.get(culprit) ?? []).find((t) => t.kind === 'guilt');
    expect(guilt).toBeDefined();
    expect(guilt!.cause).toBe(eid);
  });

  it('the same killing lays MORAL OUTRAGE on every faithful witness', () => {
    const natureCulture = cultureByAxis('nature');
    const { w, witnesses } = stageKilling(SEED, natureCulture, patronDeityOf(natureCulture).id);
    expect(witnesses.length).toBeGreaterThan(0);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'moral_outrage')).toBe(true);
  });

  it('a war-dominant creed SHRUGS at bloodshed — no guilt, no outrage', () => {
    const warCulture = cultureByAxis('war');
    const { w, culprit, witnesses } = stageKilling(SEED, warCulture, patronDeityOf(warCulture).id);
    expect(has(w.selfThoughts.get(culprit), 'guilt')).toBe(false);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'moral_outrage')).toBe(false);
  });

  it('a SACRED precept is felt only by the faithful; a CIVIC one by all', () => {
    // nature-led bloodshed is SACRED → a faithless town feels no divine outrage
    const natureCulture = cultureByAxis('nature');
    const sacred = stageKilling(SEED, natureCulture, ''); // whole town faithless
    expect(sacred.witnesses.length).toBeGreaterThan(0);
    expect(sacred.witnesses.every((x) => !has(sacred.w.selfThoughts.get(x), 'moral_outrage'))).toBe(true);

    // craft-led bloodshed is CIVIC (order, not divinity) → even the faithless feel it
    const craftCulture = cultureByAxis('craft');
    const civic = stageKilling(SEED, craftCulture, '');
    expect(civic.witnesses.some((x) => has(civic.w.selfThoughts.get(x), 'moral_outrage'))).toBe(true);
  });

  it('belief → feeling: a killing darkens every faithful witness’s mood', () => {
    const natureCulture = cultureByAxis('nature');
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = natureCulture;
    for (const id of fullActors(w)) w.faith.set(id, patronDeityOf(natureCulture).id);
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
  it('a war-dominant creed REVERES valour — the hero feels righteous, the town edified', () => {
    const warCulture = cultureByAxis('war');
    const { w, culprit, witnesses } = stageDeed(SEED, warCulture, 'valor', patronDeityOf(warCulture).id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(true);
    expect(witnesses.length).toBeGreaterThan(0);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(true);
  });

  it('…but a war-dominant creed is UNMOVED by peacemaking (no reconciliation precept)', () => {
    const warCulture = cultureByAxis('war');
    const { w, culprit, witnesses } = stageDeed(SEED, warCulture, 'reconciliation', patronDeityOf(warCulture).id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(false);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(false);
  });

  it('a nature-dominant creed REVERES peacemaking — a healed feud edifies the faithful', () => {
    const natureCulture = cultureByAxis('nature');
    const { w, culprit, witnesses } = stageDeed(SEED, natureCulture, 'reconciliation', patronDeityOf(natureCulture).id);
    expect(has(w.selfThoughts.get(culprit), 'righteous')).toBe(true);
    for (const x of witnesses) expect(has(w.selfThoughts.get(x), 'edified')).toBe(true);
  });

  it('a virtue lifts a witness’s mood (the positive twin of moral outrage)', () => {
    const natureCulture = cultureByAxis('nature');
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = natureCulture;
    for (const id of fullActors(w)) w.faith.set(id, patronDeityOf(natureCulture).id);
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
    const w = createWorld(SEED);
    w.settlements[w.focusedSettlementId].cultureId = cultureId;
    const id = fullActors(w)[0];
    w.faith.set(id, faithful ? patronDeityOf(cultureId).id : '');
    mutate(w, id);
    statePreceptsYearly(w);
    return { w, id, thoughts: w.selfThoughts.get(id) ?? [] };
  }

  it('a war-dominant creed blesses RENOWN — a renowned warrior lives at peace', () => {
    const { w, id, thoughts } = stageLife(cultureByAxis('war'), true, (w, id) => {
      for (let i = 0; i < 4; i++) w.reputation.get(id)!.marks.push({ kind: 'valor', value: 200, sinceTick: w.tick, witnesses: 8 });
    });
    expect(standingOf(w, id)).toBeGreaterThanOrEqual(220); // setup sanity
    expect(has(thoughts, 'at_peace')).toBe(true);
  });

  it('a nature-dominant creed frets at HOARDING (sacred) — only the faithful feel it', () => {
    const natureCulture = cultureByAxis('nature');
    const rich = (w: ReturnType<typeof createWorld>, id: number) => (w.needs.get(id)!.wealth = 950);
    expect(has(stageLife(natureCulture, true, rich).thoughts, 'disquiet')).toBe(true);
    expect(has(stageLife(natureCulture, false, rich).thoughts, 'disquiet')).toBe(false); // sacred → skips the faithless
  });

  it('a craft-dominant creed is at peace when PROSPEROUS (civic — felt even by the faithless)', () => {
    const prosperous = (w: ReturnType<typeof createWorld>, id: number) => (w.needs.get(id)!.wealth = 850);
    expect(has(stageLife(cultureByAxis('craft'), false, prosperous).thoughts, 'at_peace')).toBe(true);
  });

  it('a tradition-dominant creed grieves a CHILDLESS elder (sacred)', () => {
    const childlessElder = (w: ReturnType<typeof createWorld>, id: number) => {
      w.lifecycle.get(id)!.ageYears = 200;
      w.ties.get(id)!.children = [];
    };
    expect(has(stageLife(cultureByAxis('tradition'), true, childlessElder).thoughts, 'disquiet')).toBe(true);
  });

  it('a state precept FADES once the life-state passes', () => {
    const { w, id } = stageLife(cultureByAxis('craft'), false, (w, id) => (w.needs.get(id)!.wealth = 850));
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
    const warCreed = creedOf(cultureByAxis('war'));
    expect(warCreed.reveres).toContain('renown');
    expect(warCreed.reveres).toContain('stood against the beast');
    expect(warCreed.abhors).toContain('obscurity');
    expect(warCreed.abhors).not.toContain('shed blood'); // a war-dominant creed does not condemn killing

    const natureCreed = creedOf(cultureByAxis('nature'));
    expect(natureCreed.abhors).toContain('shed blood');
    expect(natureCreed.abhors).toContain('hoarding');
    expect(natureCreed.reveres).toContain('made peace');
  });
});
