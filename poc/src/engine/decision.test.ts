/**
 * Decisions are a pure, derived framing of a choice — these pin that a fresh slight surfaces as a
 * reactive turning point, ages out after the week it belongs to, that a standing feud surfaces on
 * its own, that the same person never yields two competing cards, and — the load-bearing safety
 * property — that evaluating decisions never mutates the world (so it cannot touch determinism).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, possess, hashWorld } from './sim';
import { fullActors, getRel, emit } from './world';
import { addThought } from './opinion';
import { evaluateDecisions } from './decision';

/** A populated world plus a possessed player and a distinct living neighbour. */
function seeded(seed: number, years = 8): { w: ReturnType<typeof createWorld>; player: number; other: number } {
  const w = createWorld(seed);
  runYears(w, years);
  const actors = fullActors(w);
  const player = actors[0];
  const other = actors.find((a) => a !== player && w.lifecycle.get(a)!.alive)!;
  possess(w, player);
  return { w, player, other };
}

describe('decisions', () => {
  it('a fresh slight against the player surfaces an "insult" decision with three answers', () => {
    const { w, player, other } = seeded(1);
    // someone slights the player THIS tick (subjects = [instigator, wronged])
    emit(w, 'dispute', [other, player]);

    const ds = evaluateDecisions(w, player);
    const insult = ds.find((d) => d.id === `insult:${other}`);
    expect(insult).toBeDefined();
    expect(insult!.options).toHaveLength(3);
    // the answers map to real verbs directed at the instigator (or idle)
    const kinds = insult!.options.map((o) => o.intent.kind).sort();
    expect(kinds).toEqual(['give', 'idle', 'provoke']);
    for (const o of insult!.options) {
      if (o.intent.kind !== 'idle') expect(o.intent.target).toBe(other);
    }
  });

  it('the insult ages out once its week has passed (reactive, stateless)', () => {
    const { w, player, other } = seeded(2);
    emit(w, 'dispute', [other, player]);
    expect(evaluateDecisions(w, player).some((d) => d.id === `insult:${other}`)).toBe(true);

    w.tick += 7; // a week later — last week's news is no longer this week's
    expect(evaluateDecisions(w, player).some((d) => d.id === `insult:${other}`)).toBe(false);
  });

  it('the player as the INSTIGATOR of a dispute is not prompted to answer it', () => {
    const { w, player, other } = seeded(3);
    emit(w, 'dispute', [player, other]); // player wronged the other, not the reverse
    expect(evaluateDecisions(w, player).some((d) => d.id.startsWith('insult:'))).toBe(false);
  });

  it('a standing feud surfaces on its own', () => {
    const { w, player, other } = seeded(4);
    const edge = getRel(w, player, other);
    for (let i = 0; i < 4; i++) addThought(edge, 'slighted', w.tick); // sour it well below zero
    edge.flags.feud = true;

    expect(evaluateDecisions(w, player).some((d) => d.id === `feud:${other}`)).toBe(true);
  });

  it('one person never yields two competing cards (insult wins over feud)', () => {
    const { w, player, other } = seeded(5);
    const edge = getRel(w, player, other);
    for (let i = 0; i < 4; i++) addThought(edge, 'slighted', w.tick);
    edge.flags.feud = true;        // standing feud with `other`
    emit(w, 'dispute', [other, player]); // AND a fresh slight from the same `other`

    const forOther = evaluateDecisions(w, player).filter((d) => d.id.endsWith(`:${other}`));
    expect(forOther).toHaveLength(1);
    expect(forOther[0].id).toBe(`insult:${other}`); // the more urgent (reactive) one
  });

  it('is a pure read — evaluating decisions never mutates the world', () => {
    const { w, player, other } = seeded(6);
    emit(w, 'dispute', [other, player]);
    const before = hashWorld(w);
    evaluateDecisions(w, player);
    evaluateDecisions(w, player);
    expect(hashWorld(w)).toBe(before);
    // idempotent: same state ⇒ same decisions
    expect(evaluateDecisions(w, player)).toEqual(evaluateDecisions(w, player));
  });
});
