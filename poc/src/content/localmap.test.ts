/**
 * The close view's town plan — deterministic pack data (design/24 L1+L3).
 * These tests pin the contract: same facts ⇒ same plan; the settlement's facts
 * shape the town; its chronicle leaves clickable marks.
 */
import { describe, it, expect } from 'vitest';
import { buildLocalPlan, type LocalPlanFacts, type PlanBuilding, type PlanPatch, type PlanItem, type PlanTree, type PlanProp, type PlanPerson } from './localmap';
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
