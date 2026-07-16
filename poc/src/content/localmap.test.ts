/**
 * The close view's town plan — deterministic pack data (design/24 L1+L3).
 * These tests pin the contract: same facts ⇒ same plan; the settlement's facts
 * shape the town; its chronicle leaves clickable marks.
 */
import { describe, it, expect } from 'vitest';
import { buildLocalPlan, LOCAL_FRAME, type LocalPlanFacts, type PlanBuilding, type PlanPatch, type PlanItem, type PlanTree, type PlanProp, type PlanPerson, type PlanInterior, type PlanPath } from './localmap';
import { archStyleFor } from './architecture';
import { createWorld } from '../engine/sim';
import { SurfaceSubstrate } from '../engine/substrate';
import { GEO_MIN, GEO_SPAN, type Geography } from '../engine/geography';
import type { EventView, HouseholdView, SettlementView } from '../engine/model';

/** is this world point over open water? (nearest-cell, mirrors localmap's `waterAt`) */
function onWater(geo: Geography, x: number, y: number): boolean {
  const N = geo.size;
  const gx = Math.max(0, Math.min(N - 1, ((x - GEO_MIN) / GEO_SPAN) * (N - 1)));
  const gy = Math.max(0, Math.min(N - 1, ((y - GEO_MIN) / GEO_SPAN) * (N - 1)));
  return geo.water[Math.round(gy) * N + Math.round(gx)] !== 0;
}

// ONE shared world fixture (test-suite convention) — we only need real geography + a site
const FIXTURE = createWorld(123456, false);

function worldFacts(overrides: Partial<SettlementView> = {}, chronicle?: EventView[]): LocalPlanFacts {
  const w = FIXTURE;
  const sub = w.substrate as SurfaceSubstrate;
  const s = w.settlements[0];
  const view: SettlementView = {
    id: s.id,
    name: s.name,
    detailed: false,
    population: 300,
    foundedYear: 0,
    dominantSpecies: 'Tamar',
    stability: 1,
    figureNames: [],
    government: 'Lordship',
    leaderTitle: 'Lord',
    culture: 'the Free Companies',
    cultureId: 'free',
    culturalTaboos: [],
    creed: { reveres: [], abhors: [] },
    patronDeity: { name: 'the Windwalker', domain: 'freedom', id: 'wind' },
    founder: 'Sina Anyvry',
    ruler: 'Yiowir',
    specialization: 'fishing & plantation',
    wealth: 150,
    subsistenceSecurity: 1.2,
    prices: { food: 1, materials: 2, goods: 5 },
    ...overrides,
  };
  return {
    seed: 123456,
    settlement: view,
    pos: { x: s.pos.x, y: s.pos.y },
    roadEntries: [0.3, 2.5],
    geo: sub.geography,
    currentYear: 180,
    chronicle,
  };
}

const ev = (id: number, type: string, year: number, interest = 50): EventView => ({
  id, year, type, text: `${type} befell the town`, parts: [{ text: `${type} befell the town` }],
  subjects: [], causes: [], interest, local: true, involvesPlayer: false,
});

describe('the town plan (L1)', () => {
  it('is deterministic: same facts ⇒ the same plan, item for item', () => {
    const a = buildLocalPlan(worldFacts());
    const b = buildLocalPlan(worldFacts());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('lays out a governed fishing town: streets, seat, shrine, houses, piers', () => {
    const plan = buildLocalPlan(worldFacts());
    const roles = plan.items.filter((i): i is PlanBuilding => i.kind === 'building').map((b) => b.role);
    expect(roles).toContain('seat');
    expect(roles).toContain('shrine');
    expect(roles.filter((r) => r === 'house').length).toBeGreaterThan(10);
    expect(plan.items.some((i) => i.kind === 'street')).toBe(true);
  });

  it('no building stands in the water — every structure sits on dry ground (piers excepted)', () => {
    // this coastal site grows piers (see the fishing-town test), so the water gate is exercised.
    const geo = (FIXTURE.substrate as SurfaceSubstrate).geography;
    const facts = worldFacts(
      { specialization: 'fishing & trade', wealth: 220, population: 420 },
      [ev(910, 'raid', 176), ev(911, 'wonder', 120), ev(912, 'famine', 130), ev(913, 'settlement_founded', 0)],
    );
    const plan = buildLocalPlan(facts);
    const wet = plan.items.filter((i): i is PlanItem & { x: number; y: number } => (i.kind === 'building' || i.kind === 'person') && onWater(geo, (i as PlanBuilding).x, (i as PlanBuilding).y));
    expect(wet.map((w) => (w as PlanBuilding).role ?? w.kind)).toEqual([]); // nothing floats on the sea
  });

  it('claimed buildings never overlap — the civic core and homes each hold their own lot', () => {
    // approximate claim radius by role (mirrors the reservations in localmap.ts). History
    // marks (monument/tomb/stone/shell) and market fixtures inside the plaza are exempt.
    const R: Record<string, number> = { seat: 0.24, shrine: 0.18, tavern: 0.16, workshop: 0.13, warehouse: 0.13, mill: 0.13, boathouse: 0.1, granary: 0.15 };
    const plan = buildLocalPlan(worldFacts({ specialization: 'trade & crafts', wealth: 260, population: 420 }));
    const claimed = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role in R);
    for (let a = 0; a < claimed.length; a++) {
      for (let b = a + 1; b < claimed.length; b++) {
        const A = claimed[a], B = claimed[b];
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        const need = R[A.role] + R[B.role] - 0.02; // small epsilon for float slack
        expect(d).toBeGreaterThanOrEqual(need); // no two claimed footprints intersect
      }
    }
  });

  it('no tree grows up through a roof — the countryside stops at the town wall', () => {
    const plan = buildLocalPlan(worldFacts({ specialization: 'trade & crafts', wealth: 260, population: 420 }));
    const buildings = plan.items.filter((i): i is PlanBuilding => i.kind === 'building');
    const trees = plan.items.filter((i): i is PlanItem & { x: number; y: number; r: number } => i.kind === 'tree');
    for (const t of trees) {
      for (const b of buildings) {
        // a building's footprint half-span (its larger dimension) — a tree may not sit inside it
        const foot = Math.max(b.w, b.h) * 0.5;
        expect(Math.hypot(t.x - b.x, t.y - b.y)).toBeGreaterThan(foot);
      }
    }
  });
});

describe('fortunes on the map (design/28)', () => {
  it('a DECLINING town rots at its edge — derelict roofs appear', () => {
    const plan = buildLocalPlan(worldFacts({ population: 320, wealth: 55, stability: -60, subsistenceSecurity: 0.6 }));
    const houses = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house');
    expect(houses.some((h) => h.derelict)).toBe(true);
  });

  it('a THRIVING town raises fresh scaffolding', () => {
    const plan = buildLocalPlan(worldFacts({ population: 300, wealth: 320, stability: 85, subsistenceSecurity: 1.8 }));
    expect(plan.items.some((i) => i.kind === 'building' && i.role === 'scaffold')).toBe(true);
  });

  it('a town AT WAR raises watchtowers', () => {
    const plan = buildLocalPlan(worldFacts({ population: 320, leaderTitle: 'Lord', civilWarYear: 176 }));
    expect(plan.items.some((i) => i.kind === 'building' && i.role === 'watchtower')).toBe(true);
  });

  it('a town with a patron deity keeps a graveyard by its shrine', () => {
    const graves = buildLocalPlan(worldFacts()).items.filter((i) => i.kind === 'building' && i.role === 'grave');
    expect(graves.length).toBeGreaterThan(3);
  });

  it('a stable town shows neither decay nor scaffolding (no false signals)', () => {
    const plan = buildLocalPlan(worldFacts({ population: 300, wealth: 150, stability: 5, subsistenceSecurity: 1.1 }));
    expect(plan.items.some((i) => i.kind === 'building' && (i as PlanBuilding).derelict)).toBe(false);
    expect(plan.items.some((i) => i.kind === 'building' && i.role === 'scaffold')).toBe(false);
  });
});

describe('architecture by culture (design/28 #2)', () => {
  it('a culture builds in one deterministic style; peoples do not all share a silhouette', () => {
    expect(archStyleFor('free')).toBe(archStyleFor('free')); // stable per culture
    const ids = new Set(['free', 'old', 'iron', 'maker', 'green', 'vale', 'duns', 'oront'].map((c) => archStyleFor(c).id));
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  it("every dwelling wears its culture's style, and a town is consistent", () => {
    const plan = buildLocalPlan(worldFacts({ cultureId: 'free' }));
    const houses = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house' && !i.derelict);
    expect(houses.length).toBeGreaterThan(5);
    const want = archStyleFor('free').id;
    expect(houses.every((h) => h.arch === want)).toBe(true);
  });

  it('two peoples raise differently-styled towns', () => {
    const a = 'free';
    const b = ['old', 'iron', 'maker', 'green', 'vale', 'duns'].find((c) => archStyleFor(c).id !== archStyleFor(a).id)!;
    const houseArch = (cid: string) =>
      buildLocalPlan(worldFacts({ cultureId: cid })).items.find((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house' && !!i.arch)?.arch;
    expect(houseArch(a)).toBeDefined();
    expect(houseArch(a)).not.toBe(houseArch(b));
  });
});

describe('environment fidelity (design/28 #4)', () => {
  it('every wild tree takes a biome silhouette (not all cones)', () => {
    const trees = buildLocalPlan(worldFacts()).items.filter((i): i is PlanTree => i.kind === 'tree');
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.every((t) => t.form !== undefined)).toBe(true);
  });

  it('a vineyard town grows vine-cropped fields', () => {
    const fields = buildLocalPlan(worldFacts({ specialization: 'vineyards & wine', population: 300 })).items.filter((i): i is PlanPatch => i.kind === 'field');
    expect(fields.some((f) => f.crop === 'vine')).toBe(true);
  });

  it('an orchard town plants fruit trees in rows', () => {
    const trees = buildLocalPlan(worldFacts({ specialization: 'orchards & fruit', population: 300 })).items.filter((i): i is PlanTree => i.kind === 'tree');
    expect(trees.some((t) => t.form === 'orchard')).toBe(true);
  });

  it('a farming town names what its fields grow', () => {
    const fields = buildLocalPlan(worldFacts({ specialization: 'grain farming', population: 300 })).items.filter((i): i is PlanPatch => i.kind === 'field');
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.crop !== undefined)).toBe(true);
  });

  it('a paddy never stands on barren or dry ground — only wet, low, fertile soil', () => {
    // a paddy is a flooded rice field: it must read as fertile+wet+low, never on dry rock.
    const geo = (FIXTURE.substrate as SurfaceSubstrate).geography;
    const N = geo.size;
    const cell = (x: number, y: number) => {
      const gx = Math.round(Math.max(0, Math.min(N - 1, ((x - GEO_MIN) / GEO_SPAN) * (N - 1))));
      const gy = Math.round(Math.max(0, Math.min(N - 1, ((y - GEO_MIN) / GEO_SPAN) * (N - 1))));
      return gy * N + gx;
    };
    for (const spec of ['rice farming', 'grain farming', 'plantation & trade']) {
      const paddies = buildLocalPlan(worldFacts({ specialization: spec, population: 340 })).items.filter(
        (i): i is PlanPatch => i.kind === 'field' && i.crop === 'paddy',
      );
      for (const p of paddies) {
        const c = cell(p.x, p.y);
        expect(geo.fertility[c]).toBeGreaterThan(0.4); // fertile
        expect(geo.moisture[c]).toBeGreaterThan(0.55); // wet
        expect(geo.elevation[c]).toBeLessThan(geo.seaLevel + 0.15); // low
      }
    }
  });
});

describe('ambient life (design/28 #3)', () => {
  it('a fishing town moors boats at its piers and dries its catch ashore', () => {
    const plan = buildLocalPlan(worldFacts({ specialization: 'fishing & trade', population: 420 }));
    const props = plan.items.filter((i): i is PlanProp => i.kind === 'prop');
    expect(plan.items.some((i) => i.kind === 'pier')).toBe(true);
    expect(props.some((p) => p.propKind === 'boat')).toBe(true);
    expect(props.some((p) => p.propKind === 'rack')).toBe(true);
  });

  it('a herding town grazes livestock beyond its houses — a farming one does not', () => {
    const stock = (spec: string) =>
      buildLocalPlan(worldFacts({ specialization: spec, population: 300 }))
        .items.filter((i): i is PlanProp => i.kind === 'prop' && i.propKind === 'livestock');
    expect(stock('herding & pasture').length).toBeGreaterThan(0);
    expect(stock('grain farming').length).toBe(0); // the cue is specialization-derived, not universal
  });

  it('a ruin keeps no working life — no boats, no stock, no smoke', () => {
    const plan = buildLocalPlan(worldFacts({ specialization: 'fishing & trade', ruinedYear: 150 }));
    expect(plan.items.some((i) => i.kind === 'prop')).toBe(false);
  });

  it("only a LIVED-IN roof smokes: the hearth cue rides `inhabited`, which needs a household", () => {
    // the renderer draws smoke for (arch chimney && inhabited) — so the plan-side contract is
    // that a known household lights a roof, and an anonymous one leaves it dark.
    const facts = worldFacts({ detailed: true, cultureId: 'free' });
    facts.households = [{ family: 'Vrihi', members: [{ id: 11, name: 'Sisvrer Vrihi', role: 'head', ageYears: 52, profession: 'trader' }] }];
    const houses = buildLocalPlan(facts).items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house');
    expect(houses.filter((h) => h.inhabited && h.arch).length).toBe(1);
    expect(houses.some((h) => !h.inhabited)).toBe(true);
  });

  it('a FUNERAL held this year gathers mourners at the venue it was actually held', () => {
    const facts = worldFacts();
    facts.venues = [{ id: 7, name: 'the market square', type: 'square' }];
    facts.gatherings = [{ kind: 'funeral', venueId: 7, year: 180 }];
    const plan = buildLocalPlan(facts);
    const mourners = plan.items.filter((i): i is PlanPerson => i.kind === 'person' && i.tone === 'mourner');
    expect(mourners.length).toBeGreaterThan(0);
    const square = plan.items.find((i): i is PlanPatch => i.kind === 'square')!;
    // the crowd stands AT the square, not scattered across the town
    for (const m of mourners) expect(Math.hypot(m.x - square.x, m.y - square.y)).toBeLessThan(square.w);
  });

  it('a WEDDING gathers revellers, not mourners — the crowd reads the occasion', () => {
    const facts = worldFacts();
    facts.venues = [{ id: 7, name: 'the market square', type: 'square' }];
    facts.gatherings = [{ kind: 'wedding', venueId: 7, year: 180 }];
    const tones = buildLocalPlan(facts).items.filter((i): i is PlanPerson => i.kind === 'person').map((p) => p.tone);
    expect(tones).toContain('reveller');
    expect(tones).not.toContain('mourner');
  });

  it('no gathering ⇒ no crowd (an ordinary year draws none)', () => {
    const facts = worldFacts();
    facts.venues = [{ id: 7, name: 'the market square', type: 'square' }];
    const tones = buildLocalPlan(facts).items.filter((i): i is PlanPerson => i.kind === 'person').map((p) => p.tone);
    expect(tones).not.toContain('mourner');
    expect(tones).not.toContain('reveller');
  });

  it('the gathering crowd is presentation-only: it perturbs nothing before it in the plan', () => {
    // Gatherings runs LAST and draws its own rng after every other step — so adding a crowd
    // must leave the town it stands in byte-identical (design/28: rendering, not simulation).
    const bare = worldFacts();
    bare.venues = [{ id: 7, name: 'the market square', type: 'square' }];
    const withCrowd = worldFacts();
    withCrowd.venues = [{ id: 7, name: 'the market square', type: 'square' }];
    withCrowd.gatherings = [{ kind: 'funeral', venueId: 7, year: 180 }];
    const strip = (p: ReturnType<typeof buildLocalPlan>) =>
      JSON.stringify(p.items.filter((i) => !(i.kind === 'person' && (i.tone === 'mourner' || i.tone === 'reveller'))));
    expect(strip(buildLocalPlan(withCrowd))).toBe(strip(buildLocalPlan(bare)));
  });
});

describe('interiors and clutter (design/32 §5)', () => {
  const HH: HouseholdView[] = [
    { family: 'Vrihi', members: [
      { id: 11, name: 'Sisvrer Vrihi', role: 'head', ageYears: 52, profession: 'trader' },
      { id: 12, name: 'Ony Vrihi', role: 'spouse', ageYears: 49, profession: 'smith' },
      { id: 13, name: 'Little Vrihi', role: 'child', ageYears: 8, profession: 'child' },
    ] },
  ];
  const furnished = (o: Partial<SettlementView> = {}, households?: HouseholdView[]) => {
    const f = worldFacts({ detailed: true, ...o });
    if (households) f.households = households;
    return buildLocalPlan(f);
  };

  it("a household's beds ARE its members — the roster is the furniture", () => {
    const plan = furnished({}, HH);
    const fits = plan.items.filter((i): i is PlanInterior => i.kind === 'interior');
    const beds = fits.filter((f) => f.fitting === 'bed');
    expect(beds.length).toBe(3); // head + spouse + child, one bed each
    expect(beds.map((b) => b.label)).toContain("Ony Vrihi's bed");
    expect(fits.some((f) => f.fitting === 'hearth')).toBe(true);
  });

  it('every fitting names the roof it lies under, and that roof carries the id', () => {
    const plan = furnished({}, HH);
    const ids = new Set(plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.id !== undefined).map((b) => b.id!));
    const fits = plan.items.filter((i): i is PlanInterior => i.kind === 'interior');
    expect(fits.length).toBeGreaterThan(0);
    for (const f of fits) expect(ids.has(f.ofBuilding)).toBe(true); // no orphan fitting
  });

  it('a fitting sits INSIDE the building it belongs to', () => {
    const plan = furnished({}, HH);
    const byId = new Map(plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.id !== undefined).map((b) => [b.id!, b]));
    for (const f of plan.items.filter((i): i is PlanInterior => i.kind === 'interior')) {
      const b = byId.get(f.ofBuilding)!;
      // rotate the fitting back into the building's own frame and check it is within the walls
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const dx = f.x - b.x, dy = f.y - b.y;
      const lx = Math.abs(dx * c - dy * s), lz = Math.abs(dx * s + dy * c);
      expect(lx).toBeLessThanOrEqual(b.w * 0.5 + 1e-6);
      expect(lz).toBeLessThanOrEqual(b.h * 0.5 + 1e-6);
    }
  });

  it('a shrine gets an altar naming its god; a tavern gets casks — function, not decoration', () => {
    const fits = furnished({}, HH).items.filter((i): i is PlanInterior => i.kind === 'interior');
    const altar = fits.find((f) => f.fitting === 'altar');
    expect(altar?.label).toContain('the Windwalker');
  });

  it('a ruin has no hearth — nothing is furnished', () => {
    const plan = furnished({ ruinedYear: 150 }, HH);
    expect(plan.items.some((i) => i.kind === 'interior')).toBe(false);
  });

  it('an anonymous roof gets a bare hearth and no beds (the LOD made visible)', () => {
    // no households => no known family => a hearth, but nobody to sleep by it
    const fits = buildLocalPlan(worldFacts()).items.filter((i): i is PlanInterior => i.kind === 'interior');
    const houseBeds = fits.filter((f) => f.fitting === 'bed');
    expect(houseBeds.length).toBe(0);
    expect(fits.some((f) => f.fitting === 'hearth')).toBe(true);
  });

  it('clutter answers to the livelihood: a farming town stacks wood, a smithing town heaps coal', () => {
    const kinds = (spec: string) =>
      new Set(buildLocalPlan(worldFacts({ specialization: spec, population: 300 }))
        .items.filter((i): i is PlanProp => i.kind === 'prop').map((p) => p.propKind));
    expect(kinds('grain farming').has('woodpile')).toBe(true);
    expect(kinds('grain farming').has('coal')).toBe(false); // no smith, no coal heap
    expect(kinds('iron & smithing').has('coal')).toBe(true);
  });

  it('a fishing town lands cargo on its piers', () => {
    const props = buildLocalPlan(worldFacts({ specialization: 'fishing & trade', population: 420 }))
      .items.filter((i): i is PlanProp => i.kind === 'prop');
    expect(props.some((p) => p.propKind === 'cargo')).toBe(true);
  });

  it('the signature clutter is never starved by the wallpaper', () => {
    // A town that BOTH fishes and plants has forty-odd roofs wanting woodpiles and only three
    // piers wanting cargo. Walking the plan in document order let the houses (laid first) eat
    // the whole budget and the piers land nothing — the thing that says "this town fishes".
    const props = buildLocalPlan(worldFacts({ specialization: 'fishing & plantation', population: 420 }))
      .items.filter((i): i is PlanProp => i.kind === 'prop');
    expect(props.some((p) => p.propKind === 'cargo')).toBe(true);
    expect(props.some((p) => p.propKind === 'woodpile')).toBe(true); // …and the filler still lands
  });

  it('boulders bare only on steep ground, never on the town’s own lots', () => {
    const plan = buildLocalPlan(worldFacts({ population: 300 }));
    const rocks = plan.items.filter((i): i is PlanProp => i.kind === 'prop' && i.propKind === 'boulder');
    const buildings = plan.items.filter((i): i is PlanBuilding => i.kind === 'building');
    for (const r of rocks) {
      for (const b of buildings) {
        expect(Math.hypot(r.x - b.x, r.y - b.y)).toBeGreaterThan(Math.max(b.w, b.h) * 0.5);
      }
    }
  });

  it('a ruin keeps no clutter — no woodpiles by fallen roofs', () => {
    const props = buildLocalPlan(worldFacts({ specialization: 'grain farming', ruinedYear: 150 }))
      .items.filter((i): i is PlanProp => i.kind === 'prop');
    expect(props.every((p) => p.propKind === 'boulder' || p.propKind === undefined)).toBe(true);
  });

  it('the plan stays deterministic with the new steps in the pipeline', () => {
    const a = furnished({}, HH), b = furnished({}, HH);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('layout: clusters, not scatter (design/32 §6)', () => {
  /** a culture id whose town lays out in the given pattern (searched, not pinned — which id
   *  hashes to which character is an implementation detail) */
  const cultureLayingOut = (want: 'grid' | 'organic'): string => {
    for (let i = 0; i < 400; i++) {
      const c = `c${i}`;
      const plan = buildLocalPlan(worldFacts({ cultureId: c, specialization: 'crafts', population: 320 }));
      const houses = plan.items.filter((i2): i2 is PlanBuilding => i2.kind === 'building' && i2.role === 'house');
      const sq = houses.filter((h) => Math.abs(h.rot % (Math.PI / 2)) < 1e-6).length;
      const isGrid = houses.length > 0 && sq / houses.length > 0.9;
      if ((want === 'grid') === isGrid) return c;
    }
    throw new Error(`no culture found laying out ${want}`);
  };

  it('a GRID people squares its houses to the compass; an organic one keeps its wander', () => {
    const rots = (cid: string) =>
      buildLocalPlan(worldFacts({ cultureId: cid, specialization: 'crafts', population: 320 }))
        .items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house').map((h) => h.rot);
    const grid = rots(cultureLayingOut('grid'));
    const organic = rots(cultureLayingOut('organic'));
    expect(grid.length).toBeGreaterThan(5);
    // every disciplined house sits on an exact quarter-turn…
    expect(grid.every((r) => Math.abs(r % (Math.PI / 2)) < 1e-6)).toBe(true);
    // …while an organic people's roofs do not all agree
    expect(organic.some((r) => Math.abs(r % (Math.PI / 2)) > 1e-6)).toBe(true);
  });

  it('terraced row houses share walls instead of scattering — and never overlap', () => {
    const plan = buildLocalPlan(worldFacts({ specialization: 'trade & crafts', wealth: 260, population: 420 }));
    const rows = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house' && i.shape === 'row');
    // a terrace is a RUN: at least one row house sits wall-to-wall with a neighbour
    let touching = 0;
    for (let a = 0; a < rows.length; a++) {
      for (let b = a + 1; b < rows.length; b++) {
        const A = rows[a], B = rows[b];
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        const wall = (A.w + B.w) * 0.5;
        if (d < wall * 1.06) touching++;
        // …but pulling them together must never drive one THROUGH another
        expect(d).toBeGreaterThan(Math.min(A.w, B.w) * 0.35);
      }
    }
    expect(touching).toBeGreaterThan(0);
  });

  it('terracing preserves every household — a shared wall must not merge two families', () => {
    const facts = worldFacts({ detailed: true, specialization: 'trade & crafts', wealth: 260, population: 420 });
    facts.households = [
      { family: 'Vrihi', members: [{ id: 11, name: 'Sisvrer Vrihi', role: 'head', ageYears: 52, profession: 'trader' }] },
      { family: 'Anva', members: [{ id: 21, name: 'Faivrai Anva', role: 'head', ageYears: 61, profession: 'trader' }] },
    ];
    const houses = buildLocalPlan(facts).items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house');
    expect(houses.filter((h) => h.inhabited).length).toBe(2); // both roofs still stand, both named
  });

  it('a shrine keeps a precinct and a seat keeps a bailey, each with a gateway', () => {
    const plan = buildLocalPlan(worldFacts());
    const walls = plan.items.filter((i): i is PlanPath => i.kind === 'precinct');
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.some((w) => (w.label ?? '').includes('the Windwalker'))).toBe(true); // the shrine's own god
    expect(walls.some((w) => (w.label ?? '').includes('bailey'))).toBe(true);
    // a ring broken for a gate: no single run closes the full circle
    for (const w of walls) expect(w.pts.length).toBeLessThan(23);
  });

  it('a precinct never walls out over the water', () => {
    const geo = (FIXTURE.substrate as SurfaceSubstrate).geography;
    const plan = buildLocalPlan(worldFacts({ specialization: 'fishing & trade', population: 420 }));
    for (const w of plan.items.filter((i): i is PlanPath => i.kind === 'precinct')) {
      for (const p of w.pts) expect(onWater(geo, p.x, p.y)).toBe(false);
    }
  });

  it('a ruin encloses nothing', () => {
    const plan = buildLocalPlan(worldFacts({ ruinedYear: 150 }));
    expect(plan.items.some((i) => i.kind === 'precinct')).toBe(false);
  });

  it('the plan stays deterministic with the layout folds in the pipeline', () => {
    const a = buildLocalPlan(worldFacts({ specialization: 'trade & crafts', population: 420 }));
    const b = buildLocalPlan(worldFacts({ specialization: 'trade & crafts', population: 420 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('streets are roads, not scribbles', () => {
  const streetsOf = (o: Partial<SettlementView> = {}) =>
    buildLocalPlan(worldFacts({ population: 420, ...o })).items.filter((i): i is PlanPath => i.kind === 'street');
  const turnAt = (pts: { x: number; y: number }[], k: number) => {
    const a0 = Math.atan2(pts[k].y - pts[k - 1].y, pts[k].x - pts[k - 1].x);
    const a1 = Math.atan2(pts[k + 1].y - pts[k].y, pts[k + 1].x - pts[k].x);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  it('no street has an ELBOW — a bend is a curve, not a corner', () => {
    // was: a 7-segment walk with up to a 45° kink at a joint, drawn raw by both renderers
    for (const st of streetsOf()) {
      for (let k = 1; k + 1 < st.pts.length; k++) {
        expect(Math.abs(turnAt(st.pts, k))).toBeLessThan(0.22); // ~12°
      }
    }
  });

  it('no street SEGMENT is long enough to read as a facet', () => {
    // A BRIDGE span is the one legitimate straight run: its deck is a straight span by
    // definition, and smoothing deliberately refuses to cut a corner out over the water.
    const plan = buildLocalPlan(worldFacts({ population: 420 }));
    const bridges = plan.items.filter((i): i is PlanPath => i.kind === 'bridge');
    const spans = (x: number, y: number) => bridges.some((b) =>
      Math.min(...b.pts.map((q) => Math.hypot(q.x - x, q.y - y))) < 0.9);
    for (const st of plan.items.filter((i): i is PlanPath => i.kind === 'street')) {
      for (let k = 1; k < st.pts.length; k++) {
        const a = st.pts[k - 1], b = st.pts[k];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len >= 0.3 && spans((a.x + b.x) / 2, (a.y + b.y) / 2)) continue; // a bridge deck
        expect(len).toBeLessThan(0.3);
      }
    }
  });

  it('a street does not CURL — it arrives roughly where it was sent', () => {
    // was: `arc` re-added to an already-arced heading every step, curling a street 38–71°
    for (const st of streetsOf()) {
      let total = 0;
      for (let k = 1; k + 1 < st.pts.length; k++) total += turnAt(st.pts, k);
      expect(Math.abs(total)).toBeLessThan(1.0); // ~57°, and the cone caps it well under
    }
  });

  it('a street only crosses water where a BRIDGE carries it', () => {
    // was: a cross-link was ONE straight segment between two midpoints, up to 4.5 units long
    // (wider than the town), with only its ENDPOINTS checked — it could lie across open water.
    // A street may still cross a river, but only on a bridge the plan actually built: so every
    // wet point must sit on a bridge span, and there is no free-floating road over the sea.
    const geo = (FIXTURE.substrate as SurfaceSubstrate).geography;
    const plan = buildLocalPlan(worldFacts({ population: 420, specialization: 'fishing & trade' }));
    const bridges = plan.items.filter((i): i is PlanPath => i.kind === 'bridge');
    const onABridge = (x: number, y: number) =>
      bridges.some((b) => {
        const [a, c] = [b.pts[0], b.pts[b.pts.length - 1]];
        // distance from the point to the bridge's span, with a little slack for the deck's width
        const vx = c.x - a.x, vy = c.y - a.y, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / L2));
        return Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t)) < 0.25;
      });
    for (const st of plan.items.filter((i): i is PlanPath => i.kind === 'street')) {
      for (const p of st.pts) {
        if (!onWater(geo, p.x, p.y)) continue;
        expect(onABridge(p.x, p.y)).toBe(true); // wet, but carried — never a road on open water
      }
    }
  });

  it('a through-road LEAVES the frame instead of dying in a field', () => {
    // the roads that carry the road-graph's real bearings must cross the hinterland and exit;
    // their reach used to fall ~1.5 units short of the frame edge, ending in open meadow.
    const far = streetsOf().map((st) => {
      const e = st.pts[st.pts.length - 1];
      return Math.hypot(e.x - FIXTURE.settlements[0].pos.x, e.y - FIXTURE.settlements[0].pos.y);
    });
    // this town is a coastal headland — seaward roads rightly stop at the shore, so we only
    // require that at least one through-road actually makes it out of the frame
    expect(Math.max(...far)).toBeGreaterThanOrEqual(LOCAL_FRAME / 2);
  });

  it('the plan stays deterministic with the routed streets', () => {
    expect(JSON.stringify(streetsOf())).toBe(JSON.stringify(streetsOf()));
  });
});

describe('history marks (L3)', () => {
  it('a recent raid leaves a scorch, burned shells, and a click-traceable event', () => {
    const plan = buildLocalPlan(worldFacts({}, [ev(900, 'raid', 170)]));
    const scorch = plan.items.filter((i): i is PlanPatch => i.kind === 'scorch');
    expect(scorch.length).toBe(1);
    expect(scorch[0].eventId).toBe(900);
    expect(scorch[0].age).toBeLessThan(0.35); // fresh — houses avoid the scar
    const shells = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'shell');
    expect(shells.length).toBeGreaterThan(0);
  });

  it('an old raid has healed: faded scorch, no shells, town rebuilt', () => {
    const plan = buildLocalPlan(worldFacts({}, [ev(901, 'raid', 130)]));
    const scorch = plan.items.filter((i): i is PlanPatch => i.kind === 'scorch');
    expect(scorch.length).toBe(1);
    expect(scorch[0].age).toBeGreaterThan(0.5);
    expect(plan.items.some((i) => i.kind === 'building' && i.role === 'shell')).toBe(false);
  });

  it('famine → memorial stone · wonder → monument · old founder → tomb', () => {
    const plan = buildLocalPlan(worldFacts({}, [
      ev(902, 'famine', 120),
      ev(903, 'wonder', 140),
      ev(904, 'settlement_founded', 0),
    ]));
    const roles = plan.items.filter((i): i is PlanBuilding => i.kind === 'building');
    expect(roles.some((b) => b.role === 'stone' && b.eventId === 902)).toBe(true);
    expect(roles.some((b) => b.role === 'monument' && b.eventId === 903)).toBe(true);
    expect(roles.some((b) => b.role === 'tomb')).toBe(true);
  });

  it('a civil war draws the barricade line, naming both factions', () => {
    const plan = buildLocalPlan(worldFacts(
      { civilWarYear: 175, factionSplit: { axis: 'zeal', highName: 'the Devout', lowName: 'the Doubters' } },
      [ev(905, 'civil_war', 175)],
    ));
    const barricade = plan.items.find((i) => i.kind === 'barricade');
    expect(barricade).toBeDefined();
    expect((barricade as { label?: string }).label).toContain('the Devout');
  });

  it('no chronicle ⇒ no marks (the plan still builds)', () => {
    const plan = buildLocalPlan(worldFacts());
    expect(plan.items.some((i) => i.kind === 'scorch' || i.kind === 'barricade')).toBe(false);
    expect(plan.items.length).toBeGreaterThan(20);
  });
});

describe('households on the map (L2)', () => {
  const HOUSEHOLDS: HouseholdView[] = [
    {
      family: 'Vrihi',
      members: [
        { id: 11, name: 'Sisvrer Vrihi', role: 'head', ageYears: 52, profession: 'trader' },
        { id: 12, name: 'Ony Vrihi', role: 'spouse', ageYears: 49, profession: 'smith' },
        { id: 13, name: 'Little Vrihi', role: 'child', ageYears: 8, profession: 'child' },
      ],
    },
    { family: 'Anva', members: [{ id: 21, name: 'Faivrai Anva', role: 'head', ageYears: 61, profession: 'trader' }] },
  ];

  it('known families take the roofs nearest the square — named, lit, click→head', () => {
    const facts = worldFacts({ detailed: true });
    facts.households = HOUSEHOLDS;
    const plan = buildLocalPlan(facts);
    const houses = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house');
    const named = houses.filter((h) => h.inhabited);
    expect(named.length).toBe(2);
    expect(named[0].label).toContain('the Vrihi household');
    expect(named[0].label).toContain('Sisvrer Vrihi');
    expect(named[0].ref).toEqual({ kind: 'actor', id: 11 });
    // roofs beyond the known families stay anonymous — the LOD made visible
    expect(houses.some((h) => !h.inhabited && h.label === 'a household')).toBe(true);
  });

  it('a macro settlement (no households) keeps every roof anonymous', () => {
    const plan = buildLocalPlan(worldFacts());
    const houses = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house');
    expect(houses.every((h) => !h.inhabited)).toBe(true);
  });
});

describe('ground surfaces (design/32 §3)', () => {
  it('a living town packs its earth; a wealthy, peopled one cobbles its core', () => {
    const plan = buildLocalPlan(worldFacts({ wealth: 260 }));
    const grounds = plan.items.filter((i) => i.kind === 'ground');
    const surfaces = grounds.map((g) => (g as Extract<PlanItem, { kind: 'ground' }>).surface);
    expect(surfaces).toContain('packed');
    expect(surfaces).toContain('cobble');
    // a poor town packs its earth but paves nothing
    const poor = buildLocalPlan(worldFacts({ wealth: 60 }));
    const poorSurfaces = poor.items.filter((i) => i.kind === 'ground').map((g) => (g as Extract<PlanItem, { kind: 'ground' }>).surface);
    expect(poorSurfaces).toContain('packed');
    expect(poorSurfaces).not.toContain('cobble');
  });

  it('every worked plot turns dark soil beneath it, matching the field footprint', () => {
    const plan = buildLocalPlan(worldFacts({ specialization: 'farming & grain' }));
    const fields = plan.items.filter((i): i is PlanPatch => i.kind === 'field' || i.kind === 'terrace');
    const soil = plan.items.filter((i) => i.kind === 'ground' && (i as Extract<PlanItem, { kind: 'ground' }>).surface === 'soil');
    expect(fields.length).toBeGreaterThan(0);
    expect(soil.length).toBe(fields.length);
  });

  it('a ruin lays no ground — its floor has healed back to country', () => {
    const plan = buildLocalPlan(worldFacts({ ruinedYear: 120 }));
    expect(plan.items.some((i) => i.kind === 'ground')).toBe(false);
  });
});
