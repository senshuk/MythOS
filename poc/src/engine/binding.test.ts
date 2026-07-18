/**
 * BINDINGS v1 (design/36) — oaths that outlive their swearers. These tests pin the
 * ADR's laws: the organic producer (kin slain → the honor-driven swear), the reasoning
 * gates (forbid + urge, never firing an action), inheritance at birth outliving the
 * swearer (the v1 proof), resolution as history, save round-trip, and stream safety
 * for every unsworn soul.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit, killActor, createActor, getRel } from './world';
import { witnessBelief } from './belief';
import { reactToBeliefs } from './reactions';
import { swearBinding, bindingsOn, bindingForbids, bindingUrge, inheritBindings, bindingsYearly } from './binding';
import { decideCourse, isAdult } from '../systems/decide';
import { serializeWorld, deserializeWorld } from './persistence';
import { OATH_HONOR_THRESHOLD } from '../content/fixture';

/** A world with a slain kinsman, his killer, and an honor-driven survivor. */
function feudWorld() {
  const w = createWorld(123456);
  const adults = fullActors(w).filter((id) => isAdult(w, id));
  const [victim, killer, survivor] = adults;
  // the survivor is the victim's child — kin who will learn of the killing
  w.ties.get(victim)!.children.push(survivor);
  w.ties.get(survivor)!.parents.push(victim);
  const brawl = emit(w, 'died_brawl', [victim, killer], {});
  killActor(w, victim, w.tick, 'died', [], []);
  return { w, victim, killer, survivor, brawl, adults };
}

describe('the organic producer — a slain kinsman, an honor-driven survivor', () => {
  it('swears vengeance once the survivor BELIEVES, traceably to the brawl', () => {
    const { w, victim, killer, survivor, brawl } = feudWorld();
    w.personality.get(survivor)!.values.honor = OATH_HONOR_THRESHOLD + 20;
    witnessBelief(w, survivor, victim, 'dead', brawl);
    reactToBeliefs(w, [survivor]);
    const bound = bindingsOn(w, survivor);
    expect(bound.length).toBe(1);
    expect(bound[0].kind).toBe('vengeance');
    expect(bound[0].subject).toBe(killer);
    expect(bound[0].cause).toBe(brawl); // "why?" resolves to the sworn moment's cause
    expect(w.events.some((e) => e.type === 'oath_sworn')).toBe(true);
    // …and reacting again swears nothing twice
    reactToBeliefs(w, [survivor]);
    expect(bindingsOn(w, survivor).length).toBe(1);
  });

  it('a mild soul mourns but does not swear — the sworn are the exceptional few', () => {
    const { w, victim, survivor, brawl } = feudWorld();
    w.personality.get(survivor)!.values.honor = OATH_HONOR_THRESHOLD - 20;
    witnessBelief(w, survivor, victim, 'dead', brawl);
    reactToBeliefs(w, [survivor]);
    expect(bindingsOn(w, survivor)).toEqual([]);
    expect(w.events.some((e) => e.type === 'mourned')).toBe(true);
  });
});

describe('the reasoning gates — a binding weights or forbids, never fires', () => {
  it('FORBIDS warmth toward the sworn quarry: the decider never socializes with them', () => {
    const { w, killer, survivor, adults } = feudWorld();
    swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    // make the quarry the survivor's most likely partner, and remove need pressure
    getRel(w, survivor, killer);
    const needs = w.needs.get(survivor)!;
    needs.food = 900;
    needs.wealth = 900;
    expect(bindingForbids(w, survivor, { kind: 'socialize', target: killer })).toBeDefined();
    for (let i = 0; i < 300; i++) {
      const intent = decideCourse(w, survivor, adults);
      if (intent.target === killer) expect(intent.kind).toBe('provoke'); // the only permitted approach
    }
  });

  it('URGES the confrontation: a sworn avenger, given time, faces their quarry', () => {
    const { w, killer, survivor, adults } = feudWorld();
    swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    const needs = w.needs.get(survivor)!;
    needs.food = 900;
    needs.wealth = 900;
    expect(bindingUrge(w, survivor)?.intent).toEqual({ kind: 'provoke', target: killer });
    let provoked = false;
    for (let i = 0; i < 300 && !provoked; i++) {
      const intent = decideCourse(w, survivor, adults);
      provoked = intent.kind === 'provoke' && intent.target === killer;
    }
    expect(provoked).toBe(true);
  });

  it('leaves every UNSWORN soul byte-identical — the urge rolls no die for the unbound', () => {
    const { w, killer, survivor, adults } = feudWorld();
    const bystander = adults[4];
    const run = () => {
      const s0 = w.rng.state;
      const intents: string[] = [];
      for (let i = 0; i < 40; i++) intents.push(JSON.stringify(decideCourse(w, bystander, adults)));
      const s1 = w.rng.state;
      w.rng.state = s0; // rewind for the comparison run
      return { intents: intents.join('|'), consumed: s1 };
    };
    const before = run();
    swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    const after = run();
    expect(after.intents).toBe(before.intents);
    expect(after.consumed).toBe(before.consumed);
  });
});

describe('inheritance — the oath outlives its swearer (the v1 proof)', () => {
  it('a child born to a carrier is enrolled; the dead swearer binds the living heir', () => {
    const { w, killer, survivor } = feudWorld();
    const b = swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    const child = createActor(w, {
      given: 'Heir', family: 'Test', sex: 'female', speciesId: w.identity.get(survivor)!.speciesId,
      profession: 'farmer', traits: [], ageYears: 0, parents: [survivor],
    });
    inheritBindings(w, child, [survivor]);
    expect(b.carriers).toContain(child);
    // the swearer dies; the constraint lives on in their line
    killActor(w, survivor, w.tick, 'died', [], []);
    expect(bindingsOn(w, child).length).toBe(1);
    expect(bindingForbids(w, child, { kind: 'give', target: killer })).toBeDefined();
  });
});

describe('resolution and persistence', () => {
  it('the quarry dies → the oath resolves as history, and the constraint lifts', () => {
    const { w, killer, survivor } = feudWorld();
    swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    killActor(w, killer, w.tick, 'died', [], []);
    bindingsYearly(w);
    expect(w.bindings[0].resolvedTick).toBe(w.tick);
    expect(w.events.some((e) => e.type === 'oath_fulfilled')).toBe(true);
    expect(bindingsOn(w, survivor)).toEqual([]); // released
    expect(bindingForbids(w, survivor, { kind: 'socialize', target: killer })).toBeUndefined();
    bindingsYearly(w); // resolves once, not yearly
    expect(w.events.filter((e) => e.type === 'oath_fulfilled').length).toBe(1);
  });

  it('bindings round-trip through a save', () => {
    const { w, killer, survivor } = feudWorld();
    swearBinding(w, { kind: 'vengeance', swearer: survivor, subject: killer, inheritable: true });
    const w2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(w2.bindings).toEqual(w.bindings);
    expect(bindingForbids(w2, survivor, { kind: 'court', target: killer })).toBeDefined();
  });
});
