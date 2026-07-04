/**
 * Subjectivity 1B — belief-triggered reactions (mourning).
 *
 * The first CONSUMER of belief: an actor acts on what it believes, not on what objectively
 * happened. Proves the full loop — Reality → Belief → Decision → Act — on the assertion
 * shipped in 1A ('dead'). Reaction state lives outside Belief; reactions fire once.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { witnessBelief } from './belief';
import { reactToBeliefs } from './reactions';
import { serializeWorld, deserializeWorld } from './persistence';

const mournedBy = (w: ReturnType<typeof createWorld>, actor: number) =>
  w.events.filter((e) => e.type === 'mourned' && e.subjects[0] === actor);

describe('Subjectivity 1B — belief-triggered reactions (mourning)', () => {
  it('an actor mourns kin it believes dead — and a stranger does not', () => {
    const w = createWorld(123);
    const [dead, child, stranger] = fullActors(w);
    w.ties.get(child)!.parents.push(dead); // child is kin to `dead`; stranger is unrelated

    const deathId = emit(w, 'died', [dead], {});
    witnessBelief(w, child, dead, 'dead', deathId); // the child learns
    witnessBelief(w, stranger, dead, 'dead', deathId); // a stranger also learns

    reactToBeliefs(w, [child, stranger]);

    expect(mournedBy(w, child)).toHaveLength(1); // kin who believes → mourns
    expect(mournedBy(w, stranger)).toHaveLength(0); // a stranger who believes → does not
  });

  it('mourning fires exactly once, however many weeks the belief stays true (edge-triggered)', () => {
    const w = createWorld(123);
    const [dead, child] = fullActors(w);
    w.ties.get(child)!.parents.push(dead);
    witnessBelief(w, child, dead, 'dead', emit(w, 'died', [dead], {}));

    reactToBeliefs(w, [child]);
    reactToBeliefs(w, [child]);
    reactToBeliefs(w, [child]);
    expect(mournedBy(w, child)).toHaveLength(1);
  });

  it('an actor who does not believe the death does not mourn (the unaware carry on)', () => {
    const w = createWorld(123);
    const [dead, child] = fullActors(w);
    w.ties.get(child)!.parents.push(dead);
    emit(w, 'died', [dead], {}); // it happened, objectively…
    reactToBeliefs(w, [child]); // …but the child never learned
    expect(mournedBy(w, child)).toHaveLength(0);
  });

  it('the act traces back to the death it learned of (the loop is legible)', () => {
    const w = createWorld(123);
    const [dead, child] = fullActors(w);
    w.ties.get(child)!.parents.push(dead);
    const deathId = emit(w, 'died', [dead], {});
    witnessBelief(w, child, dead, 'dead', deathId);
    reactToBeliefs(w, [child]);
    expect(mournedBy(w, child)[0].causes).toContain(deathId);
  });

  it('reaction state survives save/load — no double-mourning after a reload', () => {
    const w = createWorld(55);
    const [dead, child] = fullActors(w);
    w.ties.get(child)!.parents.push(dead);
    witnessBelief(w, child, dead, 'dead', emit(w, 'died', [dead], {}));
    reactToBeliefs(w, [child]);
    expect(mournedBy(w, child)).toHaveLength(1);

    const reloaded = deserializeWorld(serializeWorld(w));
    reactToBeliefs(reloaded, [child]); // the reload must remember it already mourned
    expect(reloaded.events.filter((e) => e.type === 'mourned' && e.subjects[0] === child)).toHaveLength(1);
  });
});
