/**
 * Legend Drift (design/30 §4.1) — a story CHANGES in the telling.
 *
 * Closes design/17 §9.6's open fork: what mutates when a testimony is retold is the ASSERTION,
 * once the tale has travelled far enough (hops) or long enough (years) from what happened. The
 * proof obligations: drift is real, drift is bounded, drift is a PURE HASH (a distorted legend is
 * as reproducible as clean history), drift is pack data, and drift never loses its why.
 *
 * Assertions are on ordering/identity, not exact floats — the confidence math is illustrative.
 * Chains are built inside ONE world (360 actors are available), so the suite stays fast.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { DAYS_PER_YEAR } from './model';
import {
  witnessBelief,
  tellBelief,
  retell,
  retoldAssertion,
  beliefOf,
  computeBelief,
  baseAssertion,
  driftVariant,
  beliefReasons,
  driftReasons,
} from './belief';
import { DRIFT_HOPS, DRIFT_YEARS, driftSpecsFor } from './pack';

type W = ReturnType<typeof createWorld>;

/** Every version of `subject`'s death that `holder` affirms. */
const versionsHeldBy = (w: W, holder: number, subject: number) =>
  (w.beliefs.get(holder) ?? [])
    .filter((b) => b.subject === subject && baseAssertion(b.assertion) === 'dead')
    .filter((b) => computeBelief(b, w.tick).stance === 'true')
    .map((b) => b.assertion);

/**
 * Pass one death down a long chain of mouths: a witness, then successive retellings, each mouth
 * passing on every version it holds (that is how a variant travels onward). `burn` spins the
 * shared world RNG first — a pure-hash draw must be deaf to it.
 */
function chainOfMouths(seed: number, len = 13, burn = 0) {
  const w = createWorld(seed);
  for (let i = 0; i < burn; i++) w.rng.next();
  const actors = fullActors(w);
  const dead = actors[0];
  const chain = actors.slice(1, len + 1);
  witnessBelief(w, chain[0], dead, 'dead', emit(w, 'died', [dead], {}));
  for (let i = 0; i < chain.length - 1; i++) {
    for (const assertion of versionsHeldBy(w, chain[i], dead)) {
      retell(w, chain[i], chain[i + 1], dead, assertion, 0.95);
    }
  }
  return { w, dead, chain, heard: versionsHeldBy(w, chain[chain.length - 1], dead) };
}

/** A chain that actually produced a legend, plus the drifted version it invented. */
function driftedChain(burn = 0) {
  const run = chainOfMouths(123, 13, burn);
  const drifted = run.heard.find((a) => driftVariant(a) !== undefined);
  if (!drifted) throw new Error('the chain produced no drift — the mechanism is not firing');
  return { ...run, drifted };
}

describe('Legend Drift — a story changes in the telling (design/30 §4.1)', () => {
  it('a story still close at hand is retold INTACT — drift is not noise', () => {
    const w = createWorld(123);
    const [king, alice, bob] = fullActors(w);
    witnessBelief(w, alice, king, 'dead', emit(w, 'died', [king], {}));

    // one hop, same year: far below both thresholds — retell is exactly tellBelief here
    expect(retoldAssertion(w, alice, king, 'dead')).toBe('dead');
    retell(w, alice, bob, king, 'dead', 0.95);
    expect(computeBelief(beliefOf(w, bob, king, 'dead')!, w.tick).stance).toBe('true');
    expect(versionsHeldBy(w, bob, king)).toEqual(['dead']); // no invented version
  });

  it('a story told far enough from the source arrives as a DIFFERENT assertion', () => {
    const { drifted } = driftedChain();
    expect(baseAssertion(drifted)).toBe('dead'); // still a version of the same proposition…
    expect(driftVariant(drifted)).toBeDefined(); // …but not the one anyone witnessed
  });

  it('TIME alone loosens a story: a short chain carried for a generation can drift', () => {
    // ONE hop — below DRIFT_HOPS — so only the years-since-the-event can qualify a retelling
    const drifts = (aged: boolean) => {
      const w = createWorld(31);
      const actors = fullActors(w);
      const dead = actors[0];
      const deathId = emit(w, 'died', [dead], {});
      if (aged) w.tick += (DRIFT_YEARS + 1) * DAYS_PER_YEAR;
      for (let i = 1; i + 1 < 120; i += 2) {
        const [alice, bob] = [actors[i], actors[i + 1]];
        witnessBelief(w, alice, dead, 'dead', deathId);
        tellBelief(w, alice, bob, dead, 'dead', 0.95); // bob now holds it at 1 hop
        const told = retoldAssertion(w, bob, dead, 'dead'); // …and would pass it on at 2
        if (told && driftVariant(told) !== undefined) return true;
      }
      return false;
    };
    expect(drifts(true)).toBe(true); // an ancient tale drifts…
    expect(drifts(false)).toBe(false); // …a fresh one, told exactly as often, does not
  });

  it('a drifted version is its OWN proposition — someone who was there still says otherwise', () => {
    const { w, dead, chain, drifted } = driftedChain();
    const ear = chain[chain.length - 1];
    expect(versionsHeldBy(w, ear, dead)).toContain(drifted); // the last ear holds the legend
    expect(versionsHeldBy(w, chain[0], dead)).toEqual(['dead']); // the witness holds what they saw
    expect(retoldAssertion(w, chain[0], dead, 'dead')).toBe('dead'); // and tells it plainly
    expect(computeBelief(beliefOf(w, ear, dead, drifted)!, w.tick).stance).toBe('true');
  });
});

describe('Legend Drift — the draw is a pure hash, never the RNG (design/30 §4.1 law)', () => {
  it('same seed + same chain of tellers ⇒ the same distorted legend, every run', () => {
    const a = driftedChain();
    const b = driftedChain();
    expect(a.heard).toEqual(b.heard);
    expect(a.drifted).toBe(b.drifted);
  });

  it('burning the world RNG does not change what the tale becomes (no live-RNG dependency)', () => {
    const straight = driftedChain(0);
    const burned = driftedChain(50); // the identical chain, with the shared stream spun first
    expect(burned.heard).toEqual(straight.heard);
    expect(burned.drifted).toBe(straight.drifted);
    expect(driftVariant(straight.drifted)).toBeDefined(); // (guard: this chain really did drift)
  });

  it('a teller tells THEIR version the same way to everyone — a legend spreads coherently', () => {
    const { w, dead, chain, drifted } = driftedChain();
    const teller = chain[chain.length - 1];
    // the draw keys on the retelling chain, not on who is listening
    expect(retoldAssertion(w, teller, dead, drifted)).toBe(retoldAssertion(w, teller, dead, drifted));
  });
});

describe('Legend Drift — bounded, pack-owned, and legible', () => {
  it('an assertion this universe has no table for never drifts (the table is PACK data)', () => {
    const w = createWorld(7);
    const [king, alice, bob] = fullActors(w);
    // `wed` has no DRIFT_SPECS row — this universe tells it straight, so no threshold can loosen
    // it. (Picked by ASKING the pack rather than naming a row believed to be absent: `exiled` was
    // this test's original subject until it gained a table of its own, at which point the test
    // still passed — for the wrong reason, on a chance faithful draw.)
    expect(driftSpecsFor('wed')).toEqual([]);
    witnessBelief(w, alice, king, 'wed', emit(w, 'married', [king], {}));
    w.tick += (DRIFT_YEARS + 50) * DAYS_PER_YEAR; // long past every threshold
    expect(retoldAssertion(w, alice, king, 'wed')).toBe('wed');
    retell(w, alice, bob, king, 'wed', 0.95);
    expect(beliefOf(w, bob, king, 'wed')).toBeDefined(); // told, and told faithfully
    expect(driftVariant(beliefOf(w, bob, king, 'wed')!.assertion)).toBeUndefined();
  });

  it('a denial has no story to embellish — only an affirmed tale grows', () => {
    const w = createWorld(9);
    const [king, alice, bob] = fullActors(w);
    // Alice is sincerely convinced the king LIVES (polarity −1 ⇒ stance false)
    witnessBelief(w, alice, king, 'dead', emit(w, 'died', [king], {}));
    beliefOf(w, alice, king, 'dead')!.evidence[0].polarity = -1;
    w.tick += (DRIFT_YEARS + 50) * DAYS_PER_YEAR;
    expect(computeBelief(beliefOf(w, alice, king, 'dead')!, w.tick).stance).toBe('false');
    expect(retoldAssertion(w, alice, king, 'dead')).toBe('dead'); // "he is not dead", undistorted
    retell(w, alice, bob, king, 'dead', 0.95);
    expect(computeBelief(beliefOf(w, bob, king, 'dead')!, w.tick).stance).toBe('false');
  });

  it('hops count the mouths between a hearer and the event', () => {
    const w = createWorld(11);
    const [king, ...rest] = fullActors(w);
    witnessBelief(w, rest[0], king, 'dead', emit(w, 'died', [king], {}));
    expect(beliefOf(w, rest[0], king, 'dead')!.evidence[0].hops).toBe(0); // firsthand
    tellBelief(w, rest[0], rest[1], king, 'dead', 0.95);
    expect(beliefOf(w, rest[1], king, 'dead')!.evidence[0].hops).toBe(1);
    tellBelief(w, rest[1], rest[2], king, 'dead', 0.95);
    expect(beliefOf(w, rest[2], king, 'dead')!.evidence[0].hops).toBe(2);
  });

  it('a legend names the exact retelling where it changed (design/17 §8 — never lose the why)', () => {
    const { w, dead, chain, drifted } = driftedChain();
    const ear = chain[chain.length - 1];
    const belief = beliefOf(w, ear, dead, drifted)!;

    // the drift is inspectable through the SHARED Reason infrastructure, not a bespoke surface
    const rows = driftReasons(belief, w.tick);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].label).toContain('became');
    expect(rows[0].label).toContain(drifted);
    expect(rows[0].value).toBeGreaterThanOrEqual(DRIFT_HOPS); // the hop the tale turned on

    // and the belief itself reads as a tale, not as news
    expect(beliefReasons(belief, w.tick)[0].label).toContain('told as a tale that had changed');
  });

  it('an intact belief has no drift to explain (the common case stays quiet)', () => {
    const w = createWorld(123);
    const [king, alice] = fullActors(w);
    witnessBelief(w, alice, king, 'dead', emit(w, 'died', [king], {}));
    expect(driftReasons(beliefOf(w, alice, king, 'dead')!, w.tick)).toEqual([]);
    expect(beliefReasons(beliefOf(w, alice, king, 'dead')!, w.tick)[0].label).toBe('saw it happen');
  });
});
