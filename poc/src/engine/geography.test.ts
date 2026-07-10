/**
 * Geography — the causal worldgen (wind → rain → rivers). These pin: determinism
 * (same seed twice ⇒ identical fields), that every river cell drains somewhere (a
 * downhill continuation, open water, or the map edge — no orphan puddles), that
 * fields stay in bounds, that rivers actually carry accumulated drainage, that
 * hilliness tracks relief, and that features (seas/ranges/rivers) are stable and
 * anchored inside the map.
 */
import { describe, it, expect } from 'vitest';
import {
  generateGeography,
  WATER_NONE,
  WATER_RIVER,
  WATER_SEA,
  WATER_LAKE,
  RIVER_FLUX,
  HILL_FLAT,
  HILL_MOUNTAIN,
  GEO_MIN,
  GEO_SPAN,
} from './geography';

describe('geography', () => {
  it('is a pure function of the seed (two generations are identical)', () => {
    const a = generateGeography(42);
    const b = generateGeography(42);
    expect([...a.elevation]).toEqual([...b.elevation]);
    expect([...a.moisture]).toEqual([...b.moisture]);
    expect([...a.water]).toEqual([...b.water]);
    expect([...a.flux]).toEqual([...b.flux]);
    expect([...a.hilliness]).toEqual([...b.hilliness]);
    expect(a.features).toEqual(b.features);
    expect(a.wind).toEqual(b.wind);
  });

  it('different seeds produce different worlds', () => {
    const a = generateGeography(1);
    const b = generateGeography(2);
    expect([...a.elevation]).not.toEqual([...b.elevation]);
  });

  it('all fields stay in bounds', () => {
    const g = generateGeography(7);
    for (let k = 0; k < g.size * g.size; k++) {
      expect(g.moisture[k]).toBeGreaterThanOrEqual(0);
      expect(g.moisture[k]).toBeLessThanOrEqual(1);
      expect(g.fertility[k]).toBeGreaterThanOrEqual(0);
      expect(g.fertility[k]).toBeLessThanOrEqual(1);
      expect(g.temperature[k]).toBeGreaterThanOrEqual(0);
      expect(g.temperature[k]).toBeLessThanOrEqual(1);
      expect([WATER_NONE, WATER_SEA, WATER_LAKE, WATER_RIVER]).toContain(g.water[k]);
      expect(g.hilliness[k]).toBeGreaterThanOrEqual(HILL_FLAT);
      expect(g.hilliness[k]).toBeLessThanOrEqual(HILL_MOUNTAIN);
    }
  });

  it('rivers exist and every river cell carries at least the river-making drainage', () => {
    const g = generateGeography(42);
    let riverCells = 0;
    for (let k = 0; k < g.size * g.size; k++) {
      if (g.water[k] !== WATER_RIVER) continue;
      riverCells++;
      expect(g.flux[k]).toBeGreaterThanOrEqual(RIVER_FLUX);
    }
    expect(riverCells).toBeGreaterThan(0);
  });

  it('every river cell drains: a neighbouring river/water cell or the map edge continues it', () => {
    const g = generateGeography(42);
    const N = g.size;
    for (let k = 0; k < N * N; k++) {
      if (g.water[k] !== WATER_RIVER) continue;
      const x = k % N;
      const y = (k / N) | 0;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) continue; // drains off-map
      let continues = false;
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        const nk = (y + dy) * N + (x + dx);
        if (g.water[nk] !== WATER_NONE) {
          continues = true;
          break;
        }
      }
      expect(continues).toBe(true);
    }
  });

  it('the wind is one of the 8 compass steps and moisture is not uniform (rain shadow exists)', () => {
    const g = generateGeography(42);
    expect(Math.abs(g.wind.dx) <= 1 && Math.abs(g.wind.dy) <= 1).toBe(true);
    expect(g.wind.dx !== 0 || g.wind.dy !== 0).toBe(true);
    // land moisture must vary meaningfully — a causal climate has wet and dry country
    let min = 1;
    let max = 0;
    for (let k = 0; k < g.size * g.size; k++) {
      if (g.water[k] !== WATER_NONE) continue;
      if (g.moisture[k] < min) min = g.moisture[k];
      if (g.moisture[k] > max) max = g.moisture[k];
    }
    expect(max - min).toBeGreaterThan(0.35);
  });

  it('features are identified, stable, and anchored inside the world plane', () => {
    const g = generateGeography(42);
    expect(g.features.length).toBeGreaterThan(0);
    for (const f of g.features) {
      expect(['sea', 'lake', 'range', 'river']).toContain(f.kind);
      expect(f.cells).toBeGreaterThan(0);
      expect(f.center.x).toBeGreaterThanOrEqual(GEO_MIN);
      expect(f.center.x).toBeLessThanOrEqual(GEO_MIN + GEO_SPAN);
      expect(f.center.y).toBeGreaterThanOrEqual(GEO_MIN);
      expect(f.center.y).toBeLessThanOrEqual(GEO_MIN + GEO_SPAN);
    }
    // indices are dense and stable (deterministic naming seeds hang off them)
    expect(g.features.map((f) => f.index)).toEqual(g.features.map((_, i) => i));
  });

  it('nearestFeatureAt finds a feature membership cell and its ring distance', async () => {
    const { nearestFeatureAt } = await import('./geography');
    const g = generateGeography(42);
    // a cell that IS a feature member reports itself at distance 0
    let memberCell = -1;
    for (let k = 0; k < g.size * g.size; k++) {
      if (g.featureOf[k] >= 0) {
        memberCell = k;
        break;
      }
    }
    expect(memberCell).toBeGreaterThanOrEqual(0);
    const N = g.size;
    const wOf = (i: number) => GEO_MIN + (i / (N - 1)) * GEO_SPAN;
    const hit = nearestFeatureAt(g, wOf(memberCell % N), wOf((memberCell / N) | 0), 6);
    expect(hit).toBeDefined();
    expect(hit!.dist).toBe(0);
    expect(g.features[hit!.feature.index]).toBe(hit!.feature);
  });

  it('features are named deterministically in the old tongue, with a meaning', async () => {
    const { featureName } = await import('../content/languages');
    const g = generateGeography(42);
    for (const f of g.features) {
      const a = featureName(42, f);
      const b = featureName(42, f);
      expect(a).toEqual(b); // stable for the world's lifetime
      expect(a.name.length).toBeGreaterThan(1);
      expect(a.name[0]).toBe(a.name[0].toUpperCase());
      expect(a.meaning).toMatch(/^the /);
    }
    // a different world speaks a different old tongue (names differ somewhere)
    const other = g.features.map((f) => featureName(43, f).name);
    expect(other.join()).not.toBe(g.features.map((f) => featureName(42, f).name).join());
  });

  it('a single map spans a range of climate bands (RimWorld-like latitude gradient)', () => {
    // temperature must run cold→hot across the map, so one world holds many biomes
    const g = generateGeography(42, 208, 0.46, 0.05, 0, 0);
    const N = g.size;
    // sample the coldest and hottest land bands (top vs bottom rows, away from the poles' edge)
    let coldMin = 1;
    let hotMax = 0;
    for (let k = 0; k < N * N; k++) {
      if (g.water[k] !== WATER_NONE) continue;
      const y = (k / N) | 0;
      if (y < N * 0.2) coldMin = Math.min(coldMin, g.temperature[k]);
      if (y > N * 0.8) hotMax = Math.max(hotMax, g.temperature[k]);
    }
    // the far pole is genuinely cold and the far tropics genuinely warm — a real gradient
    expect(hotMax - coldMin).toBeGreaterThan(0.4);
  });

  it('roads route between peaceful settlements, classifying overland vs sea links', async () => {
    const { buildRoads } = await import('../ui/terrain');
    const g = generateGeography(42);
    // find two land points and one land + one across water, to exercise both classes
    const N = g.size;
    const wOf = (i: number) => GEO_MIN + (i / (N - 1)) * GEO_SPAN;
    let landA = -1;
    let landB = -1;
    let seaCell = -1;
    for (let k = 0; k < N * N && (landA < 0 || landB < 0 || seaCell < 0); k++) {
      if (g.water[k] === WATER_NONE) {
        if (landA < 0) landA = k;
        else if (landB < 0 && Math.abs(k - landA) > N * 3) landB = k;
      } else if (g.water[k] === WATER_SEA && seaCell < 0) seaCell = k;
    }
    const node = (id: number, k: number) => ({ id, x: wOf(k % N), y: wOf((k / N) | 0), ruined: false });
    const nodes = [node(0, landA), node(1, landB), node(2, seaCell >= 0 ? seaCell : landB)];
    const roads = buildRoads(g, nodes, [
      { a: 0, b: 1, relation: 20, tradeVolume: 5 },
      { a: 0, b: 2, relation: 10, tradeVolume: 0 },
      { a: 0, b: 1, relation: -50, tradeVolume: 0 }, // hostile — NOT a road
    ]);
    expect(roads.length).toBe(2); // the hostile edge produced no road
    for (const rd of roads) {
      expect(rd.d.startsWith('M ')).toBe(true); // a valid svg path
      expect(['road', 'sea']).toContain(rd.kind);
      expect(rd.width).toBeGreaterThan(0);
    }
  });

  it('hilliness tracks relief: mountains sit on high or steep ground, flats on gentle ground', () => {
    const g = generateGeography(11);
    const N = g.size;
    for (let k = 0; k < N * N; k++) {
      if (g.hilliness[k] !== HILL_MOUNTAIN) continue;
      // mountainous cells are high, or have a steep neighbour contrast
      const x = k % N;
      const y = (k / N) | 0;
      let relief = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        relief = Math.max(relief, Math.abs(g.elevation[ny * N + nx] - g.elevation[k]));
      }
      expect(g.elevation[k] > 0.82 || relief > 0.075).toBe(true);
    }
  });
});
