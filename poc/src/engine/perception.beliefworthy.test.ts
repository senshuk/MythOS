/**
 * BELIEF_WORTHY — which events the world's people come to KNOW.
 *
 * The registry was deaths-only, which meant Legend Drift (design/30 §4.1) could only ever tell one
 * kind of story. Widened by exactly two rows that earn it: a RULER's death (the archetypal legend,
 * reusing the `dead` assertion) and an EXILE (public, rare, and — unlike a death — a thing whose
 * reason folk invent).
 *
 * The load-bearing guarantee here is LOCALITY: a witness draw reads `fullActors`, which is scoped
 * by fidelity and NOT by settlement, so a producer that fires world-wide (`ruler_died` sweeps every
 * settlement) must not let a distant king's death be "witnessed" at home. `perceiveEvent` takes the
 * place the event happened and enforces it, so bounded knowledge is structural, not a matter of
 * every caller remembering.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, focusSettlement } from './sim';
import { fullActors, emit } from './world';
import { perceiveEvent, BELIEF_WORTHY } from './perception';
import { beliefOf, computeBelief, baseAssertion, driftVariant, retell } from './belief';
import { reactToBeliefs } from './reactions';

type W = ReturnType<typeof createWorld>;

function firstGoverned(w: W) {
  for (const s of w.settlements) if (s.polityId !== undefined && s.ruinedYear === undefined) return s;
  return undefined;
}

/** Who came to believe `assertion` about `subject`, among the simulated actors. */
const knowers = (w: W, subject: number, assertion: string) =>
  fullActors(w).filter((id) => {
    const b = beliefOf(w, id, subject, assertion);
    return !!b && computeBelief(b, w.tick).stance === 'true';
  });

describe('BELIEF_WORTHY — a ruler’s death is knowable (the archetypal legend)', () => {
  it('a ruler dying at home becomes known to their own people, as an ordinary death', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const ruler = fullActors(w)[0];

    const ev = emit(w, 'ruler_died', [ruler], { settlement: seat.name, title: 'Lord' }, [], [seat.id]);
    const witnesses = perceiveEvent(w, ev, seat.id);

    expect(witnesses.length).toBeGreaterThan(0);
    // reuses the SAME assertion as any other death — a death is a death, whoever it happened to
    expect(BELIEF_WORTHY.ruler_died).toBe('dead');
    expect(knowers(w, ruler, 'dead').length).toBeGreaterThan(0);
  });

  it('a belief about a RULER survives the reaction pass — a figure is a record, not an actor', () => {
    // Regression: a ruler is a HistoricalFigure with no ECS components, so it has no kin ties.
    // Reactions ask "am I kin to what I believe about?" of every believed `dead` — which now
    // includes a figure. Nobody is a figure's kin (so nobody mourns it), but asking must not throw.
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const figure = w.figures[0]?.id;
    expect(figure).toBeDefined();
    expect(w.ties.get(figure!)).toBeUndefined(); // (guard: a figure genuinely has no ties)

    const ev = emit(w, 'ruler_died', [figure!], { settlement: seat.name, title: 'Lord' }, [], [seat.id]);
    const witnesses = perceiveEvent(w, ev, seat.id);
    expect(witnesses.length).toBeGreaterThan(0);
    expect(() => reactToBeliefs(w, witnesses)).not.toThrow();
  });

  it('a ruler dying TWO KINGDOMS AWAY is witnessed by no one at home (bounded knowledge)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const distant = w.settlements.find((s) => s.id !== seat.id)!;
    const theirRuler = fullActors(w)[0];

    // `ruler_died` fires in a pass over EVERY settlement — this is the case that would silently
    // make the whole world omniscient if perceiveEvent trusted its caller.
    const ev = emit(w, 'ruler_died', [theirRuler], { settlement: distant.name, title: 'Lord' }, [], [distant.id]);
    const witnesses = perceiveEvent(w, ev, distant.id);

    expect(witnesses).toEqual([]); // nobody here saw it
    expect(knowers(w, theirRuler, 'dead')).toEqual([]); // and so nobody here knows it
  });
});

describe('BELIEF_WORTHY — an exile is knowable, and its REASON is not', () => {
  it('the town that casts someone out comes to know it', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const loser = fullActors(w)[0];

    const ev = emit(w, 'exile', [loser], { from: seat.name, to: 'elsewhere' }, [], [seat.id]);
    const witnesses = perceiveEvent(w, ev, seat.id);

    expect(witnesses.length).toBeGreaterThan(0);
    expect(knowers(w, loser, 'exiled').length).toBeGreaterThan(0);
  });

  it('an exile elsewhere is not witnessed here', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const distant = w.settlements.find((s) => s.id !== seat.id)!;
    const loser = fullActors(w)[0];

    const ev = emit(w, 'exile', [loser], { from: distant.name, to: 'elsewhere' }, [], [distant.id]);
    expect(perceiveEvent(w, ev, distant.id)).toEqual([]);
    expect(knowers(w, loser, 'exiled')).toEqual([]);
  });

  it('feeds Legend Drift: retold far enough, the town invents WHY they were cast out', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const actors = fullActors(w);
    const loser = actors[0];

    const ev = emit(w, 'exile', [loser], { from: seat.name, to: 'elsewhere' }, [], [seat.id]);
    const chain = perceiveEvent(w, ev, seat.id).slice(0, 1); // start from one witness…
    expect(chain.length).toBe(1);
    // …then pass it down a long chain of mouths, each telling every version it holds
    const mouths = [chain[0], ...actors.filter((a) => a !== loser && a !== chain[0]).slice(0, 14)];
    for (let i = 0; i < mouths.length - 1; i++) {
      const versions = (w.beliefs.get(mouths[i]) ?? [])
        .filter((b) => b.subject === loser && baseAssertion(b.assertion) === 'exiled')
        .filter((b) => computeBelief(b, w.tick).stance === 'true')
        .map((b) => b.assertion);
      for (const a of versions) retell(w, mouths[i], mouths[i + 1], loser, a, 0.95);
    }

    const heard = (w.beliefs.get(mouths[mouths.length - 1]) ?? [])
      .filter((b) => b.subject === loser && baseAssertion(b.assertion) === 'exiled')
      .map((b) => b.assertion);
    // the far end of the chain holds a REASON nobody ever witnessed — a legend about an exile
    expect(heard.some((a) => driftVariant(a) !== undefined)).toBe(true);
  });
});

describe('BELIEF_WORTHY stays TINY — volume without drama is not knowledge', () => {
  it('a birth spawns no belief: every peasant birth would flood the evidence graph', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const [child, parent] = fullActors(w);

    expect(BELIEF_WORTHY.born).toBeUndefined();
    const ev = emit(w, 'born', [child, parent], {}, [], [seat.id]);
    expect(perceiveEvent(w, ev, seat.id)).toEqual([]); // not belief-worthy → no evidence at all
  });

  it('a private crisis of faith is never witnessed (apostasy is spontaneous and private)', () => {
    const w = createWorld(5);
    const seat = firstGoverned(w)!;
    focusSettlement(w, seat.id);
    const soul = fullActors(w)[0];

    expect(BELIEF_WORTHY.apostasy).toBeUndefined();
    const ev = emit(w, 'apostasy', [soul], { deity: 'someone' }, [], [seat.id]);
    expect(perceiveEvent(w, ev, seat.id)).toEqual([]);
  });
});

describe('BELIEF_WORTHY — widening perturbs no dice', () => {
  it('perceiveEvent is deterministic and never touches the shared RNG stream', () => {
    const build = (burn: number) => {
      const w = createWorld(5);
      const seat = firstGoverned(w)!;
      focusSettlement(w, seat.id);
      for (let i = 0; i < burn; i++) w.rng.next(); // spin the shared stream
      const ruler = fullActors(w)[0];
      const ev = emit(w, 'ruler_died', [ruler], { settlement: seat.name, title: 'Lord' }, [], [seat.id]);
      return perceiveEvent(w, ev, seat.id);
    };
    expect(build(0)).toEqual(build(0)); // deterministic run-to-run…
    expect(build(50)).toEqual(build(0)); // …and deaf to the shared stream (a LOCAL draw)
  });
});
