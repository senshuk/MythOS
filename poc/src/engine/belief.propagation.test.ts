/**
 * Subjectivity 1C-local — conversation carries belief.
 *
 * Wires the proven `tellBelief` into the existing social loop (shareBelief). Knowledge now
 * spreads within a settlement through ordinary conversation — no new transport, storage, or
 * assertions. The payoff: conversation stops being cosmetic and becomes causal — a kinsman
 * who missed a death can learn of it from a neighbour and then mourn.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { witnessBelief, shareBelief, beliefOf, computeBelief } from './belief';
import { reactToBeliefs } from './reactions';

const mournedBy = (w: ReturnType<typeof createWorld>, actor: number) =>
  w.events.filter((e) => e.type === 'mourned' && e.subjects[0] === actor);

describe('Subjectivity 1C-local — conversation carries belief', () => {
  it('a teller passes news the hearer lacks', () => {
    const w = createWorld(123);
    const [dead, alice, bob] = fullActors(w);
    witnessBelief(w, alice, dead, 'dead', emit(w, 'died', [dead], {}));
    expect(beliefOf(w, bob, dead, 'dead')).toBeUndefined();

    shareBelief(w, alice, bob); // Alice tells Bob the news
    expect(computeBelief(beliefOf(w, bob, dead, 'dead')!, w.tick).stance).toBe('true');
  });

  it('does not re-tell news the hearer already has (bounded — no evidence pile-up)', () => {
    const w = createWorld(123);
    const [dead, alice, bob] = fullActors(w);
    witnessBelief(w, alice, dead, 'dead', emit(w, 'died', [dead], {}));
    shareBelief(w, alice, bob);
    const n1 = beliefOf(w, bob, dead, 'dead')!.evidence.length;
    shareBelief(w, alice, bob);
    shareBelief(w, alice, bob);
    expect(beliefOf(w, bob, dead, 'dead')!.evidence.length).toBe(n1); // repeated talk adds nothing
  });

  it('a teller who knows nothing definite says nothing', () => {
    const w = createWorld(123);
    const [dead, alice, bob] = fullActors(w);
    shareBelief(w, alice, bob); // Alice holds no belief
    expect(beliefOf(w, bob, dead, 'dead')).toBeUndefined();
  });

  it('conversation becomes CAUSAL: a kinsman who missed a death learns of it, then mourns', () => {
    const w = createWorld(123);
    const [dead, bystander, absentKin] = fullActors(w);
    w.ties.get(absentKin)!.parents.push(dead); // kin — but not present at the death
    const deathId = emit(w, 'died', [dead], {});
    witnessBelief(w, bystander, dead, 'dead', deathId); // the bystander saw it; the kinsman did not

    // the kinsman hasn't heard → carries on, does not mourn
    reactToBeliefs(w, [absentKin]);
    expect(mournedBy(w, absentKin)).toHaveLength(0);

    // …until a neighbour tells them — then grief follows knowledge
    shareBelief(w, bystander, absentKin);
    reactToBeliefs(w, [absentKin]);
    expect(mournedBy(w, absentKin)).toHaveLength(1);
  });
});
