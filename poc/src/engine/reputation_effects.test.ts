/**
 * Reputation EFFECTS — proving the recorded standing actually MATTERS in the live
 * loop: it colours social reception, the esteem need, and courtship, and renown is
 * an earnable thing (a positive source), not just notoriety.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { witnessDeed } from './perception';
import { addMark, computeStanding, standingOf, emptyReputation } from './reputation';
import { computeOpinion, addThought } from './opinion';
import { bestSuitor } from './social';
import { fullActors, getRel, createActor, emit } from './world';
import { needsDaily } from '../systems/needs';
import { ESTEEM_NEED } from '../content/fixture';

const adult = (sex: string) => ({
  given: 'T',
  family: 'Kin',
  sex,
  speciesId: 'tamar',
  profession: 'farmer',
  traits: [] as string[],
  ageYears: 25,
});

describe('reputation is an earnable thing (a positive source, not only notoriety)', () => {
  it('witnessed generosity raises standing and earns admiration', () => {
    const w = createWorld(31);
    const [giver, recipient] = fullActors(w);

    const eid = emit(w, 'kindness', [giver, recipient]);
    const witnesses = witnessDeed(w, eid, giver, recipient, 'generosity');

    expect(witnesses.length).toBeGreaterThan(0);
    expect(standingOf(w, giver)).toBeGreaterThan(0); // renown, not notoriety
    expect(w.reputation.get(giver)!.marks[0].kind).toBe('generosity');
    for (const obs of witnesses) {
      expect(computeOpinion(getRel(w, obs, giver), w.tick)).toBeGreaterThan(0); // they admire them
    }
  });
});

describe('reputation colours courtship — who you pine for', () => {
  it('a notorious match is shunned; a renowned one is sought', () => {
    const w = createWorld(41);
    const a = createActor(w, adult('f'));
    const b = createActor(w, adult('m'));
    const c = createActor(w, adult('m'));

    // a is equally fond of b and c (same warmth, both above the "crush" line)
    for (const t of [b, c]) {
      addThought(getRel(w, a, t), 'kindness', w.tick);
      addThought(getRel(w, a, t), 'kindness', w.tick);
    }
    expect(computeOpinion(getRel(w, a, b), w.tick)).toBe(computeOpinion(getRel(w, a, c), w.tick));

    // tarnish c's name: now a should prefer the unblemished b
    const cRep = w.reputation.get(c) ?? emptyReputation();
    w.reputation.set(c, cRep);
    for (let i = 0; i < 3; i++) addMark(cRep, 'bloodshed', w.tick, { witnesses: 8 });
    expect(standingOf(w, c)).toBeLessThan(0);
    expect(bestSuitor(w, a)).toBe(b);

    // now make c renowned instead — a is drawn to the celebrated suitor
    w.reputation.set(c, emptyReputation());
    for (let i = 0; i < 4; i++) addMark(w.reputation.get(c)!, 'generosity', w.tick, { witnesses: 8, value: 200 });
    expect(standingOf(w, c)).toBeGreaterThan(0);
    expect(bestSuitor(w, a)).toBe(c);
  });
});

describe('reputation colours the esteem need — renown feels good, notoriety gnaws', () => {
  it('a notorious actor’s esteem sinks below an otherwise-identical clean one', () => {
    const w = createWorld(53);
    const notorious = createActor(w, adult('m')); // no ties, unwed
    const clean = createActor(w, adult('m')); // identical social standing, clean name

    for (let i = 0; i < 3; i++) addMark(w.reputation.get(notorious)!, 'bloodshed', w.tick, { witnesses: 8 });

    // let the esteem need drift toward its (reputation-coloured) target
    for (let day = 0; day < 300; day++) needsDaily(w, fullActors(w));

    const e = (id: number) => w.needs.get(id)![ESTEEM_NEED];
    expect(e(notorious)).toBeLessThan(e(clean));
  });
});

describe('reputation effects stay deterministic', () => {
  it('same seed ⇒ identical standings after a focused run touching the effects', () => {
    const run = () => {
      const w = createWorld(64);
      const giver = fullActors(w)[0];
      // earn some renown so the effect paths (reception/esteem/courtship) are live
      witnessDeed(w, emit(w, 'kindness', [giver, fullActors(w)[1]]), giver, fullActors(w)[1], 'generosity');
      for (let day = 0; day < 200; day++) needsDaily(w, fullActors(w));
      return [...w.reputation.entries()]
        .map(([id, r]) => `${id}:${Math.round(computeStanding(r, w.tick))}`)
        .sort()
        .join('|');
    };
    expect(run()).toBe(run());
  });
});
