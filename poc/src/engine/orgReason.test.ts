/**
 * Phase 2C: organizations REASON, understandably. These tests hold the line that makes the
 * milestone valuable — not that decisions are smart, but that they are bounded,
 * deterministic, and fully explainable:
 *
 *  - Perception is bounded (own seat + neighbours + own events) and confidence-tagged.
 *  - Worldview is the mean of LIVING members' values (the dead don't vote).
 *  - Every intent is a complete justification: factors sum to the score, the winner is the
 *    argmax, alternatives cover every candidate, ids are stable, scores finite, evaluator
 *    version stamped. (A minimal "intent validator" — the seed of a future pack lint.)
 *  - The whole pass is deterministic and round-trips through save/load.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, hashWorld } from './sim';
import { serializeWorld, deserializeWorld } from './persistence';
import { perceive, worldviewOf, evaluateIntent, orgIntentYearly } from './orgReason';
import { INTENTS, EVALUATOR_VERSION, VALUES, worldviewFromValues, type ValueAxis } from '../content/fixture';
import type { World } from './model';

const roundTrip = (w: World): World => deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));

/** A world whose FOCUSED settlement hosts a polity (so it has both a seat and residents). */
function focusedPolityWorld(): { w: World; orgId: number; seatId: number } {
  for (let seed = 1; seed <= 20; seed++) {
    const w = createWorld(seed);
    const s = w.settlements[w.focusedSettlementId];
    if (s.polityId !== undefined) return { w, orgId: s.polityId, seatId: s.id };
  }
  throw new Error('no focused settlement hosted a polity across 20 seeds');
}

describe('Perception is bounded and confidence-tagged (no omniscience)', () => {
  it('every fact carries a source in the allowed set and a confidence in [0,1]', () => {
    const { w, orgId } = focusedPolityWorld();
    const facts = perceive(w, orgId);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(['seat', 'neighbours', 'events']).toContain(f.source);
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.id.length).toBeGreaterThan(0);
    }
  });

  it('own facts are certain (confidence 1); neighbour estimates are uncertain (< 1)', () => {
    const { w, orgId } = focusedPolityWorld();
    const facts = perceive(w, orgId);
    for (const f of facts.filter((x) => x.source === 'seat')) expect(f.confidence).toBe(1);
    for (const f of facts.filter((x) => x.source === 'neighbours')) expect(f.confidence).toBeLessThan(1);
  });
});

describe('Worldview is the living-member value aggregate', () => {
  it('matches the mean of resident value profiles (the dead are not in the aggregate)', () => {
    const { w, orgId, seatId } = focusedPolityWorld();
    // manual mean over LIVING residents with a personality (world.entities = living only)
    const sums = {} as Record<ValueAxis, number>;
    for (const axis of VALUES) sums[axis] = 0;
    let n = 0;
    for (const id of w.entities) {
      if (w.homeSettlement.get(id) !== seatId) continue;
      const pers = w.personality.get(id);
      if (!pers) continue;
      for (const axis of VALUES) sums[axis] += pers.values[axis] ?? 0;
      n++;
    }
    expect(n).toBeGreaterThan(0); // the focused settlement has simulated residents
    const mean = {} as Record<ValueAxis, number>;
    for (const axis of VALUES) mean[axis] = sums[axis] / n;
    expect(worldviewOf(w, orgId)).toEqual(worldviewFromValues(mean));
  });
});

describe('Every intent is a complete, valid justification (intent validator)', () => {
  it('a fresh decision passes the lint: factors sum to score, argmax wins, ids stable', () => {
    const { w, orgId } = focusedPolityWorld();
    const d = evaluateIntent(w, orgId);

    // factors sum to the reported score
    expect(d.factors.reduce((s, f) => s + f.value, 0)).toBe(d.score);
    // alternatives cover EVERY candidate intent, exactly
    expect(new Set(d.alternatives.map((a) => a.kind))).toEqual(new Set(INTENTS.map((i) => i.id)));
    // the chosen kind is the argmax (no alternative scores higher)
    for (const a of d.alternatives) expect(d.score).toBeGreaterThanOrEqual(a.score);
    expect(d.alternatives.find((a) => a.kind === d.kind)!.score).toBe(d.score);
    // every factor has a stable id; all scores finite; evaluator stamped
    for (const f of d.factors) expect(f.id.length).toBeGreaterThan(0);
    for (const a of d.alternatives) expect(Number.isFinite(a.score)).toBe(true);
    expect(d.evaluatorVersion).toBe(EVALUATOR_VERSION);
    // perception + worldview embedded → the decision explains itself standalone
    expect(d.perception.length).toBeGreaterThan(0);
    expect(Object.keys(d.worldview).length).toBeGreaterThan(0);
  });

  it('ties resolve deterministically to the first-defined intent', () => {
    const { w, orgId } = focusedPolityWorld();
    const a = evaluateIntent(w, orgId);
    const b = evaluateIntent(w, orgId); // same state → identical choice
    expect(b.kind).toBe(a.kind);
    expect(b.score).toBe(a.score);
  });
});

describe('Reasoning is deterministic and persisted', () => {
  // 'two fresh worlds with the same seed reason identically' lives in
  // sim.determinism.orgs.test.ts — the fast suite excludes double 60-year runs.

  it('round-trips currentIntent through save/load identically', () => {
    const w = createWorld(8);
    runYears(w, 40);
    expect(w.currentIntent.size).toBeGreaterThan(0); // reasoning ran
    const loaded = roundTrip(w);
    expect(hashWorld(loaded)).toBe(hashWorld(w)); // intent digest is in the hash
    for (const [id, intent] of w.currentIntent) {
      expect(loaded.currentIntent.get(id)).toEqual(intent);
    }
  });

  it('is a silent overlay: it updates currentIntent but emits no events (no perturbation)', () => {
    const { w, orgId } = focusedPolityWorld();
    runYears(w, 1); // populate currentIntent
    const truth = w.currentIntent.get(orgId)!;
    // the yearly pass recomputes the decision over any stale value — and adds no events
    w.currentIntent.set(orgId, { ...truth, kind: truth.kind === 'trade' ? 'expand' : 'trade' });
    const eventsBefore = w.events.length;
    orgIntentYearly(w);
    expect(w.events.length).toBe(eventsBefore); // reasoning emits nothing
    expect(w.currentIntent.get(orgId)!.kind).toBe(truth.kind); // recomputed back to the real choice
  });
});
