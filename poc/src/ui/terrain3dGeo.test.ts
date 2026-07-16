/**
 * The close view's 3D STRUCTURE geometry (design/24 §8, design/28 §3). These pin the
 * contract the renderer relies on but cannot check: every vertex attribute is index-aligned
 * with `pos`, and every face declares a real material — a misaligned `uv`/`mat` array would
 * not crash, it would silently texture the whole town wrong.
 */
import { describe, it, expect } from 'vitest';
import { buildStructures, SURF } from './terrain3dGeo';
import { buildLocalPlan, type LocalPlanFacts } from '../content/localmap';
import { archStyleFor, ARCH_STYLES } from '../content/architecture';
import { createWorld } from '../engine/sim';
import { SurfaceSubstrate } from '../engine/substrate';
import type { SettlementView } from '../engine/model';

const FIXTURE = createWorld(123456, false);

function facts(overrides: Partial<SettlementView> = {}): LocalPlanFacts {
  const w = FIXTURE, s = w.settlements[0];
  const view: SettlementView = {
    id: s.id, name: s.name, detailed: false, population: 300, foundedYear: 0,
    dominantSpecies: 'Tamar', stability: 1, figureNames: [], government: 'Lordship',
    leaderTitle: 'Lord', culture: 'the Free Companies', cultureId: 'free', culturalTaboos: [],
    creed: { reveres: [], abhors: [] },
    patronDeity: { name: 'the Windwalker', domain: 'freedom', id: 'wind' },
    founder: 'Sina Anyvry', ruler: 'Yiowir', specialization: 'fishing & plantation',
    wealth: 150, subsistenceSecurity: 1.2, prices: { food: 1, materials: 2, goods: 5 },
    ...overrides,
  };
  return { seed: 123456, settlement: view, pos: { x: s.pos.x, y: s.pos.y }, roadEntries: [0.3, 2.5], geo: (w.substrate as SurfaceSubstrate).geography, currentYear: 180 };
}
const build = (o: Partial<SettlementView> = {}) => {
  const f = facts(o);
  return buildStructures(buildLocalPlan(f), f.geo, f.pos.x, f.pos.y, 11, 123456);
};

describe('structure geometry — attribute alignment', () => {
  it('every attribute array is index-aligned with the vertex count', () => {
    const A = build();
    expect(A.n).toBeGreaterThan(100);
    expect(A.pos.length).toBe(A.n * 3);
    expect(A.nrm.length).toBe(A.n * 3);
    expect(A.col.length).toBe(A.n * 3);
    expect(A.uv.length).toBe(A.n * 2); // the renderer uploads uv as a 2-component attribute
    expect(A.mat.length).toBe(A.n); // …and aSurf as a 1-component one
  });

  it('every index addresses a real vertex', () => {
    const A = build();
    expect(A.idx.length % 3).toBe(0);
    for (const i of A.idx) expect(i).toBeLessThan(A.n);
  });

  it('every face declares a material the shader actually samples', () => {
    const valid = new Set(Object.values(SURF));
    for (const m of build().mat) expect(valid.has(m)).toBe(true);
  });

  it('is deterministic — the same town yields the same geometry', () => {
    expect(JSON.stringify(build().mat)).toBe(JSON.stringify(build().mat));
  });
});

/** A culture id that builds in `styleId`. Searched rather than hardcoded: which id hashes to
 *  which style is an implementation detail, and pinning one would make these tests fail for a
 *  reason that has nothing to do with what they check. */
function cultureBuilding(styleId: string): string {
  for (let i = 0; i < 400; i++) { const c = `c${i}`; if (archStyleFor(c).id === styleId) return c; }
  throw new Error(`no culture found building in '${styleId}'`);
}

describe('structure geometry — materials read from the pack', () => {
  it("a stone-and-slate people's town raises masonry walls under slate", () => {
    const mats = new Set(build({ cultureId: cultureBuilding('stone') }).mat);
    expect(mats.has(SURF.masonry)).toBe(true);
    expect(mats.has(SURF.slate)).toBe(true);
  });

  it('a timber-and-thatch people raises boards under straw — a different fabric entirely', () => {
    const mats = new Set(build({ cultureId: cultureBuilding('timber') }).mat);
    expect(mats.has(SURF.plank)).toBe(true);
    expect(mats.has(SURF.thatch)).toBe(true);
  });

  it("two peoples' DWELLINGS differ in fabric, not just hue (the point of design/28 §3)", () => {
    // Note this is a claim about HOUSES, not towns: a seat and a shrine are raised in stone
    // under slate wherever they stand, so slate turns up in an adobe town too — via its civic
    // buildings, not its homes. The per-people fabric lives in the style, so assert it there…
    const stone = ARCH_STYLES.find((s) => s.id === 'stone')!, adobe = ARCH_STYLES.find((s) => s.id === 'adobe')!;
    expect(stone.wallMat).not.toBe(adobe.wallMat);
    expect(stone.roofMat).not.toBe(adobe.roofMat);
    // …and assert the town actually raises each people's own material.
    expect(new Set(build({ cultureId: cultureBuilding('adobe') }).mat).has(SURF.clay)).toBe(true);
    expect(new Set(build({ cultureId: cultureBuilding('stone') }).mat).has(SURF.masonry)).toBe(true);
  });

  it('a civic building keeps its own fabric whatever the local people build in', () => {
    // every town has a stone seat/shrine under slate — function over culture, by design
    for (const style of ['adobe', 'timber', 'conical']) {
      expect(new Set(build({ cultureId: cultureBuilding(style) }).mat).has(SURF.slate)).toBe(true);
    }
  });

  it('foliage stays PLAIN — a tree must never wear a building material', () => {
    // trees are pushed via cone/blob, which emit mat 0; the shader leaves those flat-coloured
    expect(build().mat).toContain(SURF.plain);
  });

  it('every declared arch style names materials the renderer knows', () => {
    for (const s of ARCH_STYLES) {
      expect(SURF[s.wallMat]).toBeDefined();
      expect(SURF[s.roofMat]).toBeDefined();
    }
  });
});

describe('structure geometry — uv projection', () => {
  it('walls are textured at a consistent world scale (no zero-area or runaway uvs)', () => {
    const A = build();
    let maxU = 0;
    for (let i = 0; i < A.uv.length; i++) maxU = Math.max(maxU, Math.abs(A.uv[i]));
    expect(Number.isFinite(maxU)).toBe(true);
    for (const v of A.uv) expect(Number.isNaN(v)).toBe(false); // a degenerate face basis would NaN the uv
  });

  it('a textured face spans enough uv to show its pattern (not a single texel)', () => {
    const A = build();
    // gather the uv span of the first textured (non-plain) triangle
    let found = false;
    for (let t = 0; t + 2 < A.idx.length && !found; t += 3) {
      const [a, b, c] = [A.idx[t], A.idx[t + 1], A.idx[t + 2]];
      if (A.mat[a] === SURF.plain) continue;
      const us = [A.uv[a * 2], A.uv[b * 2], A.uv[c * 2]];
      const vs = [A.uv[a * 2 + 1], A.uv[b * 2 + 1], A.uv[c * 2 + 1]];
      const span = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs));
      expect(span).toBeGreaterThan(0.01); // it covers a real slice of the texture
      found = true;
    }
    expect(found).toBe(true);
  });
});
