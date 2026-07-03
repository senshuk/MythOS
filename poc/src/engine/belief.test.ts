/**
 * Subjectivity 1A.1 — Belief EXISTS.
 *
 * The first proof that actors inhabit DIFFERENT subjective realities of the SAME
 * objective event. Witness producer only — no testimony, no rumor, no distortion.
 * If this passes, Subjectivity exists.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { serializeWorld, deserializeWorld } from './persistence';
import { computeBelief, witnessBelief, tellBelief, acquireEvidence, beliefOf } from './belief';

describe('Subjectivity 1A.1 — belief exists (witness)', () => {
  it('two actors derive different beliefs from the same objective death', () => {
    const w = createWorld(123);
    const [king, alice, bob] = fullActors(w);

    const kingDies = emit(w, 'died', [king], {});
    witnessBelief(w, alice, king, 'dead', kingDies); // Alice saw it; Bob did not.

    // Alice, having witnessed, holds it TRUE at (near) full confidence.
    const A = computeBelief(beliefOf(w, alice, king, 'dead')!, w.tick);
    expect(A.stance).toBe('true');
    expect(A.confidence).toBeGreaterThan(0.9);

    // Bob has no evidence → no belief → Unknown. A different reality from the same world.
    expect(beliefOf(w, bob, king, 'dead')).toBeUndefined();
  });

  it('is inert: forming a belief emits no Event (invariant 8 — belief is not history)', () => {
    const w = createWorld(123);
    const [king, alice] = fullActors(w);
    const kingDies = emit(w, 'died', [king], {});
    const afterEmit = w.events.length;
    witnessBelief(w, alice, king, 'dead', kingDies);
    expect(w.events.length).toBe(afterEmit); // witnessBelief added nothing to history
  });

  it('Unknown is the baseline: an actor with no evidence holds no stance', () => {
    const w = createWorld(123);
    const [king, , bob] = fullActors(w);
    emit(w, 'died', [king], {}); // it happened, objectively…
    expect(beliefOf(w, bob, king, 'dead')).toBeUndefined(); // …but Bob simply doesn't know
  });

  it('a belief survives a save/load round-trip intact', () => {
    const w = createWorld(55);
    const [king, alice] = fullActors(w);
    witnessBelief(w, alice, king, 'dead', emit(w, 'died', [king], {}));
    const before = computeBelief(beliefOf(w, alice, king, 'dead')!, w.tick);

    const reloaded = deserializeWorld(serializeWorld(w));
    const after = beliefOf(reloaded, alice, king, 'dead');
    expect(after).toBeDefined();
    expect(computeBelief(after!, reloaded.tick)).toEqual(before);
  });
});

describe('Subjectivity 1A.2 — belief spreads (testimony)', () => {
  it('testimony spreads belief with attenuated confidence; contradiction returns it to Unknown', () => {
    const w = createWorld(123);
    const [king, alice, bob, charlie, fraudster] = fullActors(w);

    const kingDies = emit(w, 'died', [king], {});
    witnessBelief(w, alice, king, 'dead', kingDies); // Alice saw it firsthand
    tellBelief(w, alice, bob, king, 'dead'); // Alice tells Bob

    const A = computeBelief(beliefOf(w, alice, king, 'dead')!, w.tick);
    const B = computeBelief(beliefOf(w, bob, king, 'dead')!, w.tick);
    expect(A.stance).toBe('true');
    expect(B.stance).toBe('true');
    expect(B.confidence).toBeLessThan(A.confidence); // secondhand is less certain than firsthand
    expect(B.confidence).toBeGreaterThan(0.5);

    // Charlie heard nothing → Unknown. Three actors, three different realities of one death.
    expect(beliefOf(w, charlie, king, 'dead')).toBeUndefined();

    // The fraudster is sincerely (and wrongly) convinced the king lives — and tells Bob so.
    // No "lie" mechanic: just a mistaken source's contrary testimony (polarity −1).
    acquireEvidence(w, fraudster, king, 'dead', {
      kind: 'witness', polarity: -1, observationConfidence: 1, sourceTrust: 1, sinceTick: w.tick, cause: kingDies,
    });
    expect(computeBelief(beliefOf(w, fraudster, king, 'dead')!, w.tick).stance).toBe('false');
    tellBelief(w, fraudster, bob, king, 'dead'); // "the king lives" — Bob trusts him ~as much as Alice

    // Bob, with equal-and-opposite testimony, no longer knows what to believe.
    expect(computeBelief(beliefOf(w, bob, king, 'dead')!, w.tick).stance).toBe('unknown');
  });

  it('a teller who holds no belief says nothing (no evidence transferred)', () => {
    const w = createWorld(123);
    const [king, alice, bob] = fullActors(w);
    tellBelief(w, alice, bob, king, 'dead'); // Alice knows nothing of the king
    expect(beliefOf(w, bob, king, 'dead')).toBeUndefined();
  });

  it('is deterministic across identical runs', () => {
    const build = () => {
      const w = createWorld(77);
      const [king, alice, bob] = fullActors(w);
      witnessBelief(w, alice, king, 'dead', emit(w, 'died', [king], {}));
      tellBelief(w, alice, bob, king, 'dead');
      return computeBelief(beliefOf(w, bob, king, 'dead')!, w.tick);
    };
    expect(build()).toEqual(build());
  });
});
