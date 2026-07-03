/**
 * Subjectivity 1A — the LIVE world generates subjective reality.
 *
 * Belief v1 proved the primitive in isolation (belief.test.ts). This proves the milestone:
 * during an ordinary simulation, deaths are witnessed by SOME co-residents and not others,
 * so the running world now holds knowledge that DIVERGES across actors — with nothing else
 * consuming that fact yet. Heavy multi-year runs, so it lives in the determinism pool.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears } from './sim';
import { fullActors, allEvents } from './world';
import { computeBelief } from './belief';
import { type World } from './model';

/** Every (holder, subject) for which `holder` currently holds that a death is TRUE. */
function knownDeaths(w: World): { holder: number; subject: number }[] {
  const out: { holder: number; subject: number }[] = [];
  for (const [holder, beliefs] of w.beliefs) {
    for (const b of beliefs) {
      if (b.assertion === 'dead' && computeBelief(b, w.tick).stance === 'true') {
        out.push({ holder, subject: b.subject });
      }
    }
  }
  return out;
}

describe('Subjectivity 1A — the live world generates subjective reality', () => {
  it('deaths during simulation become knowledge held by SOME residents, not all', () => {
    const w = createWorld(20);
    runYears(w, 40); // long enough that residents die of old age and are witnessed

    // the running world now holds subjective knowledge at all
    expect(w.beliefs.size).toBeGreaterThan(0);

    const known = knownDeaths(w);
    expect(known.length).toBeGreaterThan(0); // someone came to know some death firsthand

    // DIVERGENCE: take a death that someone knows, and confirm NOT everyone living knows it.
    const subject = known[0].subject;
    const knowers = new Set(known.filter((k) => k.subject === subject).map((k) => k.holder));
    const living = fullActors(w).filter((id) => w.lifecycle.get(id)!.alive);
    const livingKnowers = living.filter((id) => knowers.has(id));
    // some residents hold this death true; others simply don't know — different realities, one world
    expect(livingKnowers.length).toBeLessThan(living.length);
  });

  it('belief formation is deterministic: two identical runs generate identical beliefs', () => {
    const beliefSignature = (seed: number): string => {
      const w = createWorld(seed);
      runYears(w, 30);
      return [...w.beliefs.entries()]
        .map(([holder, bs]) => `${holder}:${bs.map((b) => `${b.subject}/${b.assertion}/${b.evidence.length}`).sort().join(',')}`)
        .sort()
        .join('|');
    };
    expect(beliefSignature(20)).toBe(beliefSignature(20));
  });

  it('belief becomes DECISION: kin mourn deaths they come to believe, deterministically', () => {
    const mournCount = (seed: number): number => {
      const w = createWorld(seed);
      runYears(w, 60); // long enough for kin to witness kin deaths and act on the belief
      return allEvents(w).filter((e) => e.type === 'mourned').length;
    };
    const n = mournCount(20);
    expect(n).toBeGreaterThan(0); // the running world now produces belief-driven acts
    expect(mournCount(20)).toBe(n); // and does so deterministically
  });
});
