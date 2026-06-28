/**
 * Perception → memory → reputation → feud: the vertical slice.
 *
 * Proves the substrate end-to-end and, crucially, that it is DETERMINISTIC and does
 * NOT perturb the shared settlement RNG — the property the whole engine rests on.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { witnessWrongdoing } from './perception';
import { computeStanding } from './reputation';
import { computeOpinion, addThought } from './opinion';
import { fullActors, getRel, emit } from './world';
import { actWeekly } from '../systems/social';

describe('perception: a witnessed wrongdoing', () => {
  it('is remembered by bystanders, dents the culprit’s standing, and is felt as dread', () => {
    const w = createWorld(123); // focuses settlement 0 → live actors
    const actors = fullActors(w);
    expect(actors.length).toBeGreaterThan(3);
    const [culprit, victim] = actors;

    const eid = emit(w, 'died_brawl', [victim, culprit], { age: 30 });
    const witnesses = witnessWrongdoing(w, eid, culprit, victim, 'bloodshed');

    expect(witnesses.length).toBeGreaterThan(0);
    expect(witnesses).not.toContain(culprit);
    expect(witnesses).not.toContain(victim);

    for (const obs of witnesses) {
      // (b) it landed in episodic memory
      expect(w.memory.get(obs)).toContain(eid);
      // (c) it is felt: the bystander now fears the culprit
      const op = computeOpinion(getRel(w, obs, culprit), w.tick);
      expect(op).toBeLessThan(0);
    }

    // (c) the culprit's public standing has dropped, and is legible/sourced
    const rep = w.reputation.get(culprit)!;
    expect(computeStanding(rep, w.tick)).toBeLessThan(0);
    expect(rep.marks[0].kind).toBe('bloodshed');
    expect(rep.marks[0].witnesses).toBe(witnesses.length);
    expect(rep.marks[0].cause).toBe(eid);

    // someone who did NOT witness it bears the culprit no new grudge
    const nonWitness = actors.find((a) => a !== culprit && a !== victim && !witnesses.includes(a));
    if (nonWitness !== undefined) {
      expect(w.rels.get(nonWitness)?.get(culprit)).toBeUndefined();
    }
  });

  it('is off the shared RNG stream — same seed ⇒ identical witnesses & standing', () => {
    const build = () => {
      const w = createWorld(777);
      const [c, v] = fullActors(w);
      const rngBefore = w.rng.state;
      const witnesses = witnessWrongdoing(w, emit(w, 'died_brawl', [v, c], {}), c, v, 'bloodshed');
      return { w, c, witnesses, rngBefore };
    };
    const a = build();
    const b = build();

    expect(a.witnesses).toEqual(b.witnesses);
    expect(computeStanding(a.w.reputation.get(a.c)!, a.w.tick)).toBe(
      computeStanding(b.w.reputation.get(b.c)!, b.w.tick),
    );
    // perception never advanced the settlement stream
    expect(a.w.rng.state).toBe(a.rngBefore);
  });

  it('can seed a FEUD: dread + prior resentment curdles into open enmity, traceable to the deed', () => {
    const w = createWorld(7);
    const actors = fullActors(w);
    const [culprit, victim, bystander] = actors;

    // the bystander already privately resents the culprit (a prior slight)
    const edge = getRel(w, bystander, culprit);
    addThought(edge, 'slighted', w.tick);
    addThought(edge, 'slighted', w.tick);
    expect(computeOpinion(edge, w.tick)).toBeLessThan(0);
    expect(edge.flags.feud).toBeFalsy();
    expect(edge.flags.rival).toBeFalsy();

    // public killings, until this bystander happens to witness one (deterministic
    // given the seed — witness selection is a stable function of the event id)
    let saw = false;
    for (let i = 0; i < 60 && !saw; i++) {
      const eid = emit(w, 'died_brawl', [victim, culprit], { age: 25 });
      if (witnessWrongdoing(w, eid, culprit, victim, 'bloodshed').includes(bystander)) saw = true;
    }
    expect(saw).toBe(true);

    // the bond has tipped into open enmity…
    expect(edge.flags.rival || edge.flags.feud).toBe(true);
    // …recorded as a milestone that traces back through its causes to the deeds
    const enmity = w.events.find(
      (e) => (e.type === 'feud' || e.type === 'rivalry') && e.subjects.includes(bystander) && e.subjects.includes(culprit),
    );
    expect(enmity).toBeDefined();
    expect(enmity!.causes.length).toBeGreaterThan(0);
  });
});

describe('perception through the real resolver (the live weekly loop)', () => {
  // Drive the actual decide→resolve→brawl path (not witnessWrongdoing directly), so
  // this proves the wiring AND that the path stays deterministic. Kept light: only
  // the weekly social pass runs, so it's fast and not a 100-year simulation.
  const build = () => {
    const w = createWorld(99);
    const [a, b] = fullActors(w);
    // force a bitter feud so the brawl→perception path is actually exercised
    const edge = getRel(w, a, b);
    for (let i = 0; i < 8; i++) addThought(edge, 'slighted', w.tick);
    edge.flags.feud = true;
    edge.flags.rival = true;
    for (let week = 0; week < 400; week++) {
      w.tick += 7;
      actWeekly(w);
    }
    return w;
  };

  it('fires (brawls brand their perpetrators) and is reproducible', () => {
    const x = build();
    const y = build();

    // reproducible: identical standings on both runs (perception is deterministic
    // even when reached through the random social loop)
    const sig = (w: ReturnType<typeof build>) =>
      [...w.reputation.entries()]
        .map(([id, r]) => `${id}:${Math.round(computeStanding(r, w.tick))}`)
        .sort()
        .join('|');
    expect(sig(x)).toBe(sig(y));

    // the feud produced violence, and the violence left a notorious, still-living mark
    const brawls = x.events.filter((e) => e.type === 'brawl' || e.type === 'died_brawl').length;
    expect(brawls).toBeGreaterThan(0);
    const notorious = [...x.reputation.entries()].some(
      ([id, rep]) => computeStanding(rep, x.tick) < 0 && x.lifecycle.get(id)?.alive,
    );
    expect(notorious).toBe(true);
  });
});
