/**
 * Subjectivity 1D-minimal — belief REVISES (status belief).
 *
 * Proves one property in isolation: a competitive belief can be overturned by later evidence,
 * resolved by computeStatusBelief WITHOUT any change to computeBelief. No kings, organizations,
 * succession, or allegiance — just one slot and two claimants. If this is as clean as
 * computeOpinion/computeBelief, the epistemic foundation is complete and politics is "just a
 * consumer".
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { computeBelief, beliefOf } from './belief';
import { learnCoronation, computeStatusBelief, slotAssertion } from './statusBelief';

const SLOT = 'king-of-thuba';

describe('Subjectivity 1D-minimal — a status belief revises', () => {
  it('a later coronation replaces the winner of the slot', () => {
    const w = createWorld(7);
    const [holder, aldric, beatrice] = fullActors(w);

    // Aldric is crowned; the holder comes to believe it → Aldric reigns
    learnCoronation(w, holder, aldric, SLOT, emit(w, 'crowned', [aldric], { slot: SLOT }));
    expect(computeStatusBelief(w, holder, SLOT).occupant).toBe(aldric);

    // Beatrice is crowned; the holder learns → the belief REVISES, Beatrice now reigns
    learnCoronation(w, holder, beatrice, SLOT, emit(w, 'crowned', [beatrice], { slot: SLOT }));
    expect(computeStatusBelief(w, holder, SLOT).occupant).toBe(beatrice);

    // …and the holder no longer believes Aldric reigns (displaced, not merely outranked)
    expect(computeBelief(beliefOf(w, holder, aldric, slotAssertion(SLOT))!, w.tick).stance).not.toBe('true');
  });

  it('revision is repeatable — the slot can change hands again', () => {
    const w = createWorld(7);
    const [holder, aldric, beatrice] = fullActors(w);
    learnCoronation(w, holder, aldric, SLOT, emit(w, 'crowned', [aldric], {}));
    learnCoronation(w, holder, beatrice, SLOT, emit(w, 'crowned', [beatrice], {}));
    learnCoronation(w, holder, aldric, SLOT, emit(w, 'crowned', [aldric], {})); // a restoration
    expect(computeStatusBelief(w, holder, SLOT).occupant).toBe(aldric);
  });

  it('an unheard-of slot has no occupant (vacant, so far as the holder knows)', () => {
    const w = createWorld(7);
    const [holder] = fullActors(w);
    expect(computeStatusBelief(w, holder, SLOT).occupant).toBeUndefined();
  });

  it('two holders can believe DIFFERENT things reign in the same slot (divergent timelines in miniature)', () => {
    const w = createWorld(7);
    const [aldric, beatrice, capital, frontier] = fullActors(w);
    // both learned Aldric was crowned…
    const first = emit(w, 'crowned', [aldric], { slot: SLOT });
    learnCoronation(w, capital, aldric, SLOT, first);
    learnCoronation(w, frontier, aldric, SLOT, first);
    // …but only the capital heard of Beatrice's coronation
    learnCoronation(w, capital, beatrice, SLOT, emit(w, 'crowned', [beatrice], { slot: SLOT }));

    expect(computeStatusBelief(w, capital, SLOT).occupant).toBe(beatrice); // capital: Beatrice reigns
    expect(computeStatusBelief(w, frontier, SLOT).occupant).toBe(aldric); // frontier: still Aldric
  });

  it('is deterministic', () => {
    const run = () => {
      const w = createWorld(7);
      const [holder, aldric, beatrice] = fullActors(w);
      learnCoronation(w, holder, aldric, SLOT, emit(w, 'crowned', [aldric], {}));
      learnCoronation(w, holder, beatrice, SLOT, emit(w, 'crowned', [beatrice], {}));
      return computeStatusBelief(w, holder, SLOT);
    };
    expect(run()).toEqual(run());
  });
});
