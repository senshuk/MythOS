/**
 * THE MYTHIC FEEDBACK LOOP (design/34) — legends act on the world. These tests pin the
 * ADR's contract: one shared reducer (living legends, derived and decaying) feeding
 * three consumers — culture worldview drift, the 'emulate' ambition, and belief-founded
 * devotional orders — each traceable back to the specific held Belief.
 */
import { describe, it, expect } from 'vitest';
import { createWorld } from './sim';
import { fullActors, emit } from './world';
import { witnessBelief } from './belief';
import { livingLegendsAt, legendValueNudge, legendOrdersYearly } from './legend';
import { worldviewOf } from './orgReason';
import { renderEvent } from './render';
import { AMBITIONS } from '../content/ambitions';
import { ORG_CATEGORY_DEVOTIONAL, LEGEND_ORDER_HOLDERS } from '../content/fixture';

/** A world, its focused seat, some residents, and a remembered FIGURE to be legendary about. */
function stage() {
  const w = createWorld(123456);
  const seatId = w.focusedSettlementId;
  const residents = fullActors(w).filter((id) => w.homeSettlement.get(id) === seatId);
  const figure = w.figures.find((f) => w.names.get(f.id) !== undefined)!;
  const ev = emit(w, 'died', [figure.id], {});
  /** seed the drifted tale ("slain in battle") as a held-true belief on n residents */
  const seed = (n: number) => {
    for (const r of residents.slice(0, n)) witnessBelief(w, r, figure.id, 'dead#slain', ev);
  };
  return { w, seatId, residents, figure, ev, seed };
}

describe('the reducer — living legends, derived and local', () => {
  it('finds a broadly-held drifted tale, and only where its believers live', () => {
    const { w, seatId, seed, figure } = stage();
    expect(livingLegendsAt(w, seatId)).toEqual([]); // no tale yet
    seed(6);
    const legends = livingLegendsAt(w, seatId);
    expect(legends.length).toBe(1);
    expect(legends[0].subject).toBe(figure.id);
    expect(legends[0].variant).toBe('slain');
    expect(legends[0].holders.length).toBe(6);
    // subjectivity exists only where agency exists: an aggregate settlement holds none
    const other = w.settlements.find((s) => s.id !== seatId)!;
    expect(livingLegendsAt(w, other.id)).toEqual([]);
  });

  it('is a PURE read — it stores nothing and changes nothing', () => {
    const { w, seatId, seed } = stage();
    seed(6);
    const before = JSON.stringify([...w.beliefs]);
    livingLegendsAt(w, seatId);
    legendValueNudge(w, seatId);
    expect(JSON.stringify([...w.beliefs])).toBe(before);
  });
});

describe('consumer 1 — culture drift (worldviewOf gains a legend input)', () => {
  it('a widely-believed "slain in battle" reads the polity a little more militaristic', () => {
    const { w, seatId, seed } = stage();
    const polity = w.settlements[seatId].polityId!;
    const before = worldviewOf(w, polity).militaristic ?? 0;
    seed(3); // below LEGEND_MIN_HOLDERS: a story a few tell moves no institution
    expect(worldviewOf(w, polity).militaristic ?? 0).toBe(before);
    seed(12);
    const after = worldviewOf(w, polity).militaristic ?? 0;
    expect(after).toBeGreaterThan(before); // war-axis nudge → militaristic reads higher
  });
});

describe("consumer 2 — the 'emulate' ambition", () => {
  it('is offered to a believer whose own values the legend speaks to — and only them', () => {
    const { w, seed, residents, figure } = stage();
    seed(6);
    const emulate = AMBITIONS.find((a) => a.id === 'emulate')!;
    const believer = residents[0];
    w.personality.get(believer)!.values.war = 60; // the tale of the slain calls to the warlike
    expect(emulate.offerable(w, believer)).toEqual({ target: figure.id });
    // a believer the theme does not speak to is not called
    const cold = residents[1];
    w.personality.get(cold)!.values.war = -40;
    expect(emulate.offerable(w, cold)).toBeUndefined();
    // a non-believer, however warlike, has no tale to follow
    const stranger = residents[residents.length - 1];
    w.personality.get(stranger)!.values.war = 80;
    expect(emulate.offerable(w, stranger)).toBeUndefined();
  });
});

describe('consumer 3 — belief-founded devotional orders', () => {
  it('a legend held broadly enough founds an order — named, seated, led, and traceable', () => {
    const { w, seatId, seed, figure } = stage();
    seed(LEGEND_ORDER_HOLDERS + 2);
    legendOrdersYearly(w);
    const order = w.organizations.find((o) => o.category === ORG_CATEGORY_DEVOTIONAL)!;
    expect(order).toBeDefined();
    expect(order.legendSubjectId).toBe(figure.id);
    expect(order.name).toContain('the Sworn of'); // the pack's label for a slain-king tale
    expect(order.seatId).toBe(seatId);
    expect(order.leaderId).toBeDefined();
    const founding = w.events.find((e) => e.type === 'order_founded')!;
    expect(founding.causes.length).toBeGreaterThan(0); // traces to the founder's own evidence
    expect(renderEvent(w, founding)).toContain('was slain in battle'); // the tale, told in the prose
    // one order per legendary subject, ever — a second year founds nothing new
    legendOrdersYearly(w);
    expect(w.organizations.filter((o) => o.category === ORG_CATEGORY_DEVOTIONAL).length).toBe(1);
  });

  it('below the threshold, no institution forms — scarcity holds', () => {
    const { w, seed } = stage();
    seed(LEGEND_ORDER_HOLDERS - 2);
    legendOrdersYearly(w);
    expect(w.organizations.some((o) => o.category === ORG_CATEGORY_DEVOTIONAL)).toBe(false);
  });

  it('is deterministic: the same seeding founds the same order, every run', () => {
    const run = () => {
      const { w, seed } = stage();
      seed(LEGEND_ORDER_HOLDERS + 2);
      legendOrdersYearly(w);
      const o = w.organizations.find((x) => x.category === ORG_CATEGORY_DEVOTIONAL)!;
      return `${o.name}|${o.leaderId}|${o.legendSubjectId}`;
    };
    expect(run()).toBe(run());
  });
});
