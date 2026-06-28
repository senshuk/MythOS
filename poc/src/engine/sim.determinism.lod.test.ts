/**
 * Part of the determinism suite (split across sibling files so vitest runs them in
 * parallel). See ./determinism.helpers.ts for the rationale and shared fixtures.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless, buildSnapshot, createWorld, runYears, focusSettlement } from './sim';
import { summaryActors } from './world';
import { BASE_PRICE } from '../content/fixture';
import { type World } from './model';

describe('level-of-detail / scale', () => {
  it('world population vastly exceeds the count simulated in detail', () => {
    const w = runHeadless(42, 30);
    const snap = buildSnapshot(w);
    expect(snap.settlements.length).toBeGreaterThanOrEqual(6); // a region of several settlements
    expect(snap.settlements.filter((s) => s.detailed).length).toBe(1);
    expect(snap.worldPopulation).toBeGreaterThan(snap.simulatedInDetail * 3);
    // live entities stay bounded to the focused settlement only
    expect(w.entities.length).toBeLessThan(snap.worldPopulation);
  });

  it('aggregate settlements actually evolve over time', () => {
    const w = createWorld(42);
    const before = w.settlements[5].macro.population; // settlement 5 is aggregate
    runYears(w, 50);
    expect(w.settlements[5].detailed).toBe(false);
    expect(w.settlements[5].macro.population).not.toBe(before);
  });

  it('demote/promote keeps live-entity count bounded after many focus shifts', () => {
    const w = createWorld(99);
    for (let i = 0; i < 6; i++) {
      runYears(w, 10);
      focusSettlement(w, (i * 3 + 2) % 10);
    }
    const snap = buildSnapshot(w);
    const alive = w.entities.filter((id) => w.lifecycle.get(id)!.alive).length;
    // live actors are only the focused settlement (full) + named people (summary),
    // never the whole world
    expect(alive).toBe(snap.simulatedInDetail + snap.namedPeople);
    expect(alive).toBeLessThan(snap.worldPopulation);
    expect(snap.namedPeople).toBeLessThan(snap.settlements.length * 8); // summary tier bounded per settlement, not the whole world
  });

  it('notable individuals persist as summary actors after you focus away', () => {
    const w = createWorld(2024);
    runYears(w, 30);
    focusSettlement(w, 5);
    expect(w.settlements[0].detailed).toBe(false);
    const residents = summaryActors(w).filter((id) => w.homeSettlement.get(id) === 0);
    expect(residents.length).toBeGreaterThan(0);
  });
});

describe('region geography', () => {
  // components over LIVING settlements only — ancient ruins sit outside the trade network.
  function connectedComponents(w: World): number {
    const live = w.settlements.filter((s) => s.ruinedYear === undefined).map((s) => s.id);
    const parent = new Map<number, number>(live.map((i) => [i, i]));
    const find = (x: number): number => {
      const p = parent.get(x)!;
      if (p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    for (const e of w.edges) if (parent.has(e.a) && parent.has(e.b)) parent.set(find(e.a), find(e.b));
    return new Set(live.map(find)).size;
  }

  it('the settlement graph is connected and every living settlement has a neighbour', () => {
    let w = createWorld(42);
    for (let seed = 42; w.substrate.kind !== 'surface'; seed++) w = createWorld(seed); // a land region
    const living = w.settlements.filter((s) => s.ruinedYear === undefined);
    expect(w.edges.length).toBeGreaterThanOrEqual(living.length - 1);
    const seen = new Set<number>();
    for (const e of w.edges) {
      seen.add(e.a);
      seen.add(e.b);
    }
    expect(seen.size).toBe(living.length); // no isolated living settlement (ruins are off-network)
    expect(connectedComponents(w)).toBe(1); // one connected region
  });

  it('edge relations stay in range and goods flow along the routes', () => {
    let w = createWorld(42);
    for (let seed = 42; w.substrate.kind !== 'surface'; seed++) w = createWorld(seed); // a land world (galaxies are food-uniform → no trade)
    runYears(w, 60);
    for (const e of w.edges) {
      expect(e.relation).toBeGreaterThanOrEqual(-100);
      expect(e.relation).toBeLessThanOrEqual(100);
    }
    // goods actually move along the routes (in a big region trade spreads across many
    // routes, so the chronicle's single busiest-route event may not fire every run — the
    // accumulated trade volume is the real proof that goods flow).
    expect(w.edges.reduce((s, e) => s + e.tradeVolume, 0)).toBeGreaterThan(0);
  });

  it('migration prefers nearer settlements (geography shapes movement)', () => {
    const w = createWorld(7);
    runYears(w, 80);
    const focused = w.settlements[w.focusedSettlementId];
    const distTo = (id: number) =>
      Math.hypot(focused.pos.x - w.settlements[id].pos.x, focused.pos.y - w.settlements[id].pos.y);
    const nameToId = new Map(w.settlements.map((s) => [s.name, s.id]));

    const emigrantDists: number[] = [];
    for (const ev of w.events) {
      if (ev.type !== 'emigrated') continue;
      const toId = nameToId.get(String(ev.data.to));
      if (toId !== undefined) emigrantDists.push(distTo(toId));
    }
    expect(emigrantDists.length).toBeGreaterThan(3);
    const emigrantAvg = emigrantDists.reduce((a, b) => a + b, 0) / emigrantDists.length;

    let total = 0;
    let count = 0;
    for (const s of w.settlements) if (s.id !== focused.id) { total += distTo(s.id); count++; }
    const allAvg = total / count;

    expect(emigrantAvg).toBeLessThan(allAvg); // emigrants land closer than chance
  });
});

describe('economy', () => {
  it('local food production drives prices: rich-farmland towns have cheaper food', () => {
    // a CLIMATICALLY MIXED surface world — some lush (food-surplus) towns and some poor
    // ones — so prices actually spread; a uniformly desert/grassland world (or a galaxy)
    // floors or ceilings every food price, where this scarcity property doesn't apply.
    let w = createWorld(42);
    for (let seed = 42; seed < 400; seed++) {
      w = createWorld(seed);
      if (w.substrate.kind !== 'surface') continue;
      const foods = w.settlements.map((s) => s.econ.production.food);
      if (Math.max(...foods) > 1.1 && Math.min(...foods) < 0.85) break;
    }
    runYears(w, 30);
    const live = w.settlements.filter((s) => !s.detailed && s.macro.population > 0);
    // The PROPERTY is "more local food production ⇒ cheaper food". Measured as the
    // correlation between production and price across ALL towns — robust to a few towns
    // nudged either way by trade (comparing only extreme thirds can flip on one seed).
    const prod = live.map((s) => s.econ.production.food);
    const price = live.map((s) => s.econ.price.food);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mp = mean(prod), mq = mean(price);
    let cov = 0, vp = 0;
    for (let i = 0; i < live.length; i++) {
      cov += (prod[i] - mp) * (price[i] - mq);
      vp += (prod[i] - mp) ** 2;
    }
    expect(vp).toBeGreaterThan(0); // production really does vary in this world
    expect(cov / vp).toBeLessThan(0); // negative slope: surplus → cheap, scarcity → dear

    // prices always stay within the clamp bounds
    for (const s of w.settlements) {
      expect(s.econ.price.food).toBeGreaterThanOrEqual(BASE_PRICE.food * 0.4 - 1e-6);
      expect(s.econ.price.food).toBeLessThanOrEqual(BASE_PRICE.food * 3.5 + 1e-6);
    }
  });

  it('the world runs a real economy: production, wealth, and trade volume', () => {
    const w = createWorld(7);
    const stockBefore = w.settlements.map((s) => ({ ...s.econ.stock }));
    runYears(w, 40);
    const snap = buildSnapshot(w);

    expect(snap.worldWealth).toBeGreaterThan(0);
    // at least one settlement's stocks changed from the initial state (production ran)
    const changed = w.settlements.some(
      (s, i) =>
        s.econ.stock.food !== stockBefore[i].food ||
        s.econ.stock.materials !== stockBefore[i].materials ||
        s.econ.stock.goods !== stockBefore[i].goods,
    );
    expect(changed).toBe(true);
    expect(w.edges.some((e) => e.tradeVolume > 0)).toBe(true);
  });

  it('trade keeps most settlements fed (the routes do their job)', () => {
    const w = createWorld(42);
    runYears(w, 50);
    const fed = w.settlements.filter((s) => s.macro.population > 0 && s.econ.stock.food / s.macro.population >= 0.5);
    const alive = w.settlements.filter((s) => s.macro.population > 0);
    expect(fed.length).toBeGreaterThan(alive.length / 2); // famine is the exception, not the rule
  });
});
