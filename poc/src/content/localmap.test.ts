/**
 * The close view's town plan — deterministic pack data (design/24 L1+L3).
 * These tests pin the contract: same facts ⇒ same plan; the settlement's facts
 * shape the town; its chronicle leaves clickable marks.
 */
import { describe, it, expect } from 'vitest';
import { buildLocalPlan, type LocalPlanFacts, type PlanBuilding, type PlanPatch } from './localmap';
import { createWorld } from '../engine/sim';
import { SurfaceSubstrate } from '../engine/substrate';
import type { EventView, HouseholdView, SettlementView } from '../engine/model';

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
