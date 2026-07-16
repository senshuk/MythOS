/**
 * Legend Drift's CONSUMER (design/30 §4.1) — a people's history is what its people believe.
 *
 * Chronicle/annals rendering for a culture reads that culture's currently-held belief about an
 * event, not the objective Event. The payoff this exists for: two peoples' oral histories of the
 * SAME death genuinely diverge once retelling has drifted one of them — and the annals stop being
 * a single omniscient record that every culture agrees on.
 *
 * The culture reducer obeys the law orgBeliefOf already obeys: subjectivity exists only where
 * agency exists, so a people with no simulated subjects tells no version at all.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit, fullName } from './world';
import { type WorldEvent } from './model';
import { witnessBelief, retell, beliefOf, computeBelief, baseAssertion, driftVariant } from './belief';
import { cultureLegendOf, renderLegend, renderLegendFor } from './chronicle';
import { driftSpecsFor } from './pack';

type W = ReturnType<typeof createWorld>;

const holdsTrue = (w: W, holder: number, subject: number, assertion: string) => {
  const b = beliefOf(w, holder, subject, assertion);
  return !!b && computeBelief(b, w.tick).stance === 'true';
};

/**
 * One death, carried down a long chain of mouths until the tale turns. Returns the world, the
 * death event, the version the chain invented, and the two groups it leaves behind: those who
 * still hold what happened, and those who hold only the legend.
 */
function aDeathAndItsLegend() {
  const w = createWorld(123);
  const actors = fullActors(w);
  const dead = actors[0];
  const chain = actors.slice(1, 14);
  const deathId = emit(w, 'died', [dead], {});
  witnessBelief(w, chain[0], dead, 'dead', deathId);
  for (let i = 0; i < chain.length - 1; i++) {
    const versions = (w.beliefs.get(chain[i]) ?? [])
      .filter((b) => b.subject === dead && baseAssertion(b.assertion) === 'dead')
      .filter((b) => computeBelief(b, w.tick).stance === 'true')
      .map((b) => b.assertion);
    for (const a of versions) retell(w, chain[i], chain[i + 1], dead, a, 0.95);
  }

  const ev = w.events.find((e) => e.id === deathId) as WorldEvent;
  const drifted = (w.beliefs.get(chain[chain.length - 1]) ?? [])
    .map((b) => b.assertion)
    .find((a) => baseAssertion(a) === 'dead' && driftVariant(a) !== undefined);
  if (!drifted) throw new Error('the chain produced no legend — the drift mechanism is not firing');

  // those who hold ONLY the legend, and those who still hold the plain truth
  const legendFolk = chain.filter((c) => holdsTrue(w, c, dead, drifted) && !holdsTrue(w, c, dead, 'dead'));
  const truthFolk = chain.filter((c) => holdsTrue(w, c, dead, 'dead'));
  return { w, dead, ev, drifted, legendFolk, truthFolk };
}

/** Settle `folk` in a settlement of their own, under a culture of their own — so the two groups
 *  are two PEOPLES, and each reads through the culture reducer separately. */
function resettle(w: W, folk: number[], cultureId: string) {
  const home = w.settlements[w.homeSettlement.get(folk[0])!];
  const far = w.settlements.find((s) => s.id !== home.id)!;
  far.cultureId = cultureId;
  for (const id of folk) w.homeSettlement.set(id, far.id);
  return { home, far };
}

describe("Legend Drift's consumer — a culture's history is what its people believe", () => {
  it('two peoples tell the SAME death differently once one of their tales has drifted', () => {
    const { w, ev, drifted, legendFolk, truthFolk } = aDeathAndItsLegend();
    expect(legendFolk.length).toBeGreaterThan(0); // someone carries only the legend
    expect(truthFolk.length).toBeGreaterThan(0); // someone still remembers what happened

    const { home } = resettle(w, legendFolk, 'the-far-folk');

    // each people's version, derived from its own members — never stored on the culture
    expect(cultureLegendOf(w, home.cultureId, ev)!.assertion).toBe('dead'); // the folk at home remember
    expect(cultureLegendOf(w, 'the-far-folk', ev)!.assertion).toBe(drifted); // the folk far off embellish

    // …and the annals render each people's own history. ONE death, TWO oral histories.
    const nearTold = renderLegendFor(w, ev, home.cultureId);
    const farTold = renderLegendFor(w, ev, 'the-far-folk');
    expect(farTold).not.toBe(nearTold);
    expect(nearTold).toBe(renderLegend(w, ev)); // a people holding the truth tells the plain record
  });

  it('the divergence is in WHAT IS CLAIMED, not in incidental phrasing (same grammar draw)', () => {
    const { w, ev, dead, drifted, legendFolk } = aDeathAndItsLegend();
    resettle(w, legendFolk, 'the-far-folk');
    const farTold = renderLegendFor(w, ev, 'the-far-folk');

    // the legend is still told about the same person…
    const who = fullName(w, dead);
    expect(who.length).toBeGreaterThan(0); // (guard: the name resolves, so the check below bites)
    expect(farTold).toContain(who);
    // …and it carries the claim this people's version actually makes — the pack's own words
    const spec = driftSpecsFor(baseAssertion(drifted)).find((s) => s.id === driftVariant(drifted))!;
    expect(farTold).toContain(spec.label);
    // …but it no longer says what happened
    expect(farTold).not.toBe(renderLegend(w, ev));
  });

  it('a people with no simulated subjects tells no version — the objective record stands', () => {
    const { w, ev } = aDeathAndItsLegend();
    // subjectivity exists only where agency exists (the law orgBeliefOf obeys)
    expect(cultureLegendOf(w, 'a-people-who-do-not-exist', ev)).toBeUndefined();
    expect(renderLegendFor(w, ev, 'a-people-who-do-not-exist')).toBe(renderLegend(w, ev));
  });

  it('a people who witnessed nothing tell the plain record, not an invented one', () => {
    const w = createWorld(123);
    const [dead] = fullActors(w);
    const deathId = emit(w, 'died', [dead], {});
    const ev = w.events.find((e) => e.id === deathId) as WorldEvent;
    const home = w.settlements[w.focusedSettlementId];
    // nobody holds any belief about this death → no folk version → the record stands
    expect(cultureLegendOf(w, home.cultureId, ev)).toBeUndefined();
    expect(renderLegendFor(w, ev, home.cultureId)).toBe(renderLegend(w, ev));
  });

  it('is deterministic: the same world tells the same history twice', () => {
    const tell = () => {
      const { w, ev, legendFolk } = aDeathAndItsLegend();
      resettle(w, legendFolk, 'the-far-folk');
      return renderLegendFor(w, ev, 'the-far-folk');
    };
    expect(tell()).toBe(tell());
  });

  it('reading a culture legend is a PURE read — it stores nothing on the culture', () => {
    const { w, ev, legendFolk } = aDeathAndItsLegend();
    resettle(w, legendFolk, 'the-far-folk');
    const beliefsBefore = JSON.stringify([...w.beliefs]);
    const eventsBefore = w.events.length;
    cultureLegendOf(w, 'the-far-folk', ev);
    renderLegendFor(w, ev, 'the-far-folk');
    expect(JSON.stringify([...w.beliefs])).toBe(beliefsBefore); // no evidence stack on the culture
    expect(w.events.length).toBe(eventsBefore); // inert, like every belief read (invariant 8)
  });
});
