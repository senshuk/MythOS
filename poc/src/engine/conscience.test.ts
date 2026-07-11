/**
 * CONSCIENCE (design/26 P3) — choices wear the player's character. The same dilemma
 * tints differently and weighs differently on two souls of opposed values, derived
 * from their value profiles, never scripted.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, possess, playerTurn } from './sim';
import { evaluateDecisions } from './decision';
import { fullActors, getRel } from './world';
import { escalateAnimosity } from './social';
import { addThought } from './opinion';
import { moodReasons } from './mood';
import { maturityOf } from './pack';

/** A world with a possessed player who holds a chosen value at a set strength, and a
 *  fresh feud so the `feud` decision (war-tinted options) is on the table. */
function feudWorld(warValue: number) {
  const w = createWorld(123456);
  const adults = fullActors(w).filter((id) => {
    const lc = w.lifecycle.get(id)!;
    return lc.alive && lc.ageYears >= maturityOf(w.identity.get(id)!.speciesId) + 2;
  });
  const [p, foe] = adults;
  possess(w, p);
  // pin the player's WAR value directly (personalityOf caches it)
  const pers = w.personality.get(p)!;
  pers.values.war = warValue;
  // a real feud with `foe`
  const edge = getRel(w, p, foe);
  addThought(edge, 'slighted', w.tick, { value: -600 });
  escalateAnimosity(w, p, foe, edge);
  expect(edge.flags.feud).toBe(true);
  return { w, p, foe };
}

/** The self-thought kinds currently weighing on an actor's mood. */
function selfKinds(w: ReturnType<typeof createWorld>, id: number): string[] {
  return (w.selfThoughts.get(id) ?? []).map((t) => t.kind);
}

describe('choices wear the player\'s nature', () => {
  it('a warlike soul: confronting reads TRUE to nature, peace reads AGAINST', () => {
    const { w, p } = feudWorld(70);
    const feud = evaluateDecisions(w, p).find((d) => d.id.startsWith('feud:'))!;
    expect(feud).toBeDefined();
    const confront = feud.options.find((o) => o.intent.kind === 'provoke')!;
    const peace = feud.options.find((o) => o.intent.kind === 'give')!;
    expect(confront.nature).toEqual({ word: 'warlike', against: false });
    expect(peace.nature).toEqual({ word: 'peaceable', against: true });
  });

  it('a peaceable soul reads the SAME options the opposite way', () => {
    const { w, p } = feudWorld(-70);
    const feud = evaluateDecisions(w, p).find((d) => d.id.startsWith('feud:'))!;
    const confront = feud.options.find((o) => o.intent.kind === 'provoke')!;
    const peace = feud.options.find((o) => o.intent.kind === 'give')!;
    expect(confront.nature).toEqual({ word: 'warlike', against: true });
    expect(peace.nature).toEqual({ word: 'peaceable', against: false });
  });

  it('a soul with no strong feeling on the axis is untinted', () => {
    const { w, p } = feudWorld(10);
    const feud = evaluateDecisions(w, p).find((d) => d.id.startsWith('feud:'))!;
    for (const o of feud.options) expect(o.nature).toBeUndefined();
  });

  it('acting AGAINST a strong value lays a guilt self-thought; acting WITH it, pride', () => {
    // warlike player who chooses PEACE (against nature) → against_nature guilt
    const a = feudWorld(70);
    playerTurn(a.w, { kind: 'give', target: a.foe, conscience: { axis: 'war', dir: -1 } });
    expect(selfKinds(a.w, a.p)).toContain('against_nature');

    // warlike player who CONFRONTS (true to nature) → true_to_self pride
    const b = feudWorld(70);
    playerTurn(b.w, { kind: 'provoke', target: b.foe, conscience: { axis: 'war', dir: 1 } });
    expect(selfKinds(b.w, b.p)).toContain('true_to_self');
  });

  it('an untagged intent lays no conscience thought (plain actions are free)', () => {
    const { w, p, foe } = feudWorld(70);
    playerTurn(w, { kind: 'socialize', target: foe });
    const kinds = selfKinds(w, p);
    expect(kinds).not.toContain('against_nature');
    expect(kinds).not.toContain('true_to_self');
  });

  it('the guilt actually darkens mood (it flows through the precept machinery)', () => {
    const { w, p, foe } = feudWorld(70);
    playerTurn(w, { kind: 'give', target: foe, conscience: { axis: 'war', dir: -1 } });
    const reasons = moodReasons(w, p);
    expect(reasons.some((r) => r.value < 0 && /against your own nature/.test(r.label))).toBe(true);
  });
});
