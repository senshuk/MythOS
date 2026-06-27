/**
 * Aspirations are a pure, deterministic function of actor state — these pin the
 * priority arc (survive → prosper → wed → family → …) and that it derives, not
 * scripts, the goal.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, runYears, possess, checkPlayerGoal } from './sim';
import { fullActors } from './world';
import { currentAspiration } from './aspiration';
import { ADULT_AGE } from './model';

describe('aspirations', () => {
  it('hunger overrides everything (survive)', () => {
    const w = createWorld(1);
    runYears(w, 5);
    const id = fullActors(w)[0];
    w.needs.get(id)!.food = 100;
    expect(currentAspiration(w, id).kind).toBe('survive');
  });

  it('poverty (when fed) drives prosper', () => {
    const w = createWorld(1);
    runYears(w, 5);
    const id = fullActors(w)[0];
    const n = w.needs.get(id)!;
    n.food = 900;
    n.wealth = 50;
    expect(currentAspiration(w, id).kind).toBe('prosper');
  });

  it('a well-provided unmarried adult seeks to wed', () => {
    const w = createWorld(1);
    runYears(w, 8);
    const id = fullActors(w).find(
      (i) => w.ties.get(i)!.spouse === undefined && w.lifecycle.get(i)!.ageYears >= ADULT_AGE,
    )!;
    const n = w.needs.get(id)!;
    n.food = 900;
    n.wealth = 900;
    n.belonging = 900;
    expect(currentAspiration(w, id).kind).toBe('wed');
  });

  it('is a pure function of state (same world ⇒ same aspiration)', () => {
    const w = createWorld(7);
    runYears(w, 20);
    for (const id of fullActors(w)) {
      expect(currentAspiration(w, id)).toEqual(currentAspiration(w, id));
    }
  });

  it("a 'wed' aspiration with a warm bond targets that person", () => {
    const w = createWorld(11);
    runYears(w, 30); // long enough for warm relationships to form
    const withCrush = fullActors(w).find((i) => {
      if (w.ties.get(i)!.spouse !== undefined) return false;
      const n = w.needs.get(i)!;
      n.food = 900;
      n.wealth = 900;
      const asp = currentAspiration(w, i);
      return asp.kind === 'wed' && asp.target !== undefined;
    });
    if (withCrush !== undefined) {
      const asp = currentAspiration(w, withCrush);
      expect(asp.action).toBe('court'); // pursues a known fondness via courting
      expect(w.lifecycle.get(asp.target!)!.alive).toBe(true);
    }
  });

  it('fulfilling a goal emits a celebratory goal_met event (player-only)', () => {
    const w = createWorld(5);
    runYears(w, 8);
    const single = fullActors(w).find(
      (i) => w.ties.get(i)!.spouse === undefined && w.lifecycle.get(i)!.ageYears >= ADULT_AGE,
    )!;
    const n = w.needs.get(single)!;
    n.food = 900;
    n.wealth = 900;
    n.belonging = 900;

    possess(w, single);
    checkPlayerGoal(w); // baseline — should NOT emit
    const before = w.events.filter((e) => e.type === 'goal_met').length;
    expect(currentAspiration(w, single).kind).toBe('wed');

    // force the fulfilment condition: they now have a spouse
    const someone = fullActors(w).find((i) => i !== single)!;
    w.ties.get(single)!.spouse = someone;

    checkPlayerGoal(w);
    const after = w.events.filter((e) => e.type === 'goal_met').length;
    expect(after).toBe(before + 1);
    const ev = w.events[w.events.length - 1];
    expect(ev.type).toBe('goal_met');
    expect(ev.data.goal).toBe('wed');
    expect(ev.subjects[0]).toBe(single);
  });

  it('does not fire goal_met without a possessed player', () => {
    const w = createWorld(6);
    runYears(w, 5);
    checkPlayerGoal(w);
    checkPlayerGoal(w);
    expect(w.events.some((e) => e.type === 'goal_met')).toBe(false);
  });
});
