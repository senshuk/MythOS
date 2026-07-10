/**
 * The CLOSE VIEW's town plan — PACK DATA (design/24 §3.3, RimWorld's GenStepDef idea).
 * An ordered pipeline of pure LocalGenSteps turns a settlement's FACTS (population,
 * wealth, specialization, culture, faith, governance, ruin) plus the real geography
 * around it into a drawable plan: streets, houses, a seat, a shrine, fields or docks,
 * a palisade, trees. Deterministic from (world seed, settlement id) — the same town
 * always lays out the same way, on every machine, with nothing stored.
 *
 * The ENGINE knows none of this vocabulary. A sci-fi pack would replace these steps
 * with domes and landing pads; the UI only renders PlanItems.
 */
import { type Geography, GEO_MIN, GEO_SPAN, WATER_SEA, WATER_LAKE, WATER_RIVER } from '../engine/geography';
import { type SettlementView, type EventRef } from '../engine/model';
import { Rng, mixSeed } from '../engine/rng';

// ------------------------------------------------------------ the plan model --

export interface PlanBuilding {
  kind: 'building';
  x: number; y: number; // centre, world units
  w: number; h: number; // world units
  rot: number; // radians
  role: 'house' | 'seat' | 'shrine' | 'workshop' | 'warehouse' | 'boathouse' | 'minehead' | 'mill';
  label: string; // hover text, in the pack's voice
  tone: 'plain' | 'grand' | 'sacred' | 'ruin';
  ref?: EventRef; // the shrine inspects its deity, the seat its ruler…
}
export interface PlanPath {
  kind: 'street' | 'pier' | 'wall';
  pts: { x: number; y: number }[];
  width: number; // world units
}
export interface PlanPatch {
  kind: 'field' | 'rubble' | 'square';
  x: number; y: number; w: number; h: number; rot: number;
  label?: string;
}
export interface PlanTree { kind: 'tree'; x: number; y: number; r: number }
export type PlanItem = PlanBuilding | PlanPath | PlanPatch | PlanTree;

export interface LocalPlanFacts {
  seed: number;
  settlement: SettlementView;
  pos: { x: number; y: number }; // the settlement's world position
  roadEntries: number[]; // angles (radians) toward its road-graph neighbours
  geo: Geography;
  currentYear: number;
}

export interface LocalPlan {
  items: PlanItem[];
  /** the town's overall radius (world units) — the UI frames around it */
  radius: number;
}

/** One step of the pipeline: reads facts + the plan so far, appends what it lays out. */
export interface LocalGenStep {
  name: string;
  run(facts: LocalPlanFacts, rng: Rng, plan: LocalPlan): void;
}

// ------------------------------------------------------- geography sampling --

const gOf = (geo: Geography, w: number) => Math.max(0, Math.min(geo.size - 1, ((w - GEO_MIN) / GEO_SPAN) * (geo.size - 1)));

function elevAt(geo: Geography, x: number, y: number): number {
  const N = geo.size;
  const gx = gOf(geo, x);
  const gy = gOf(geo, y);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const E = geo.elevation;
  return (E[y0 * N + x0] * (1 - fx) + E[y0 * N + x1] * fx) * (1 - fy) + (E[y1 * N + x0] * (1 - fx) + E[y1 * N + x1] * fx) * fy;
}
function waterAt(geo: Geography, x: number, y: number): number {
  return geo.water[Math.round(gOf(geo, y)) * geo.size + Math.round(gOf(geo, x))];
}
function moistureAt(geo: Geography, x: number, y: number): number {
  const N = geo.size;
  return geo.moisture[Math.round(gOf(geo, y)) * N + Math.round(gOf(geo, x))];
}
/** is this spot dry, unflooded ground a building can stand on? */
function buildable(geo: Geography, x: number, y: number): boolean {
  return waterAt(geo, x, y) === 0 && elevAt(geo, x, y) >= geo.seaLevel;
}
/** the direction (angle) of the nearest water within `maxR`, or undefined. */
function towardWater(geo: Geography, x: number, y: number, maxR: number, kinds: number[]): number | undefined {
  for (let r = 0.4; r <= maxR; r += 0.4) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      if (kinds.includes(waterAt(geo, x + Math.cos(ang) * r, y + Math.sin(ang) * r))) return ang;
    }
  }
  return undefined;
}

// ------------------------------------------------------------- shared state --

/** streets laid by TownPlan, consumed by Buildings/Palisade (kept off the plan model —
 *  it's pipeline working state, threaded via this per-run context). */
interface TownCtx {
  streets: { angle: number; pts: { x: number; y: number }[]; reach: number }[];
  townRadius: number;
  houses: number; // budget remaining
}
const ctxOf = new WeakMap<LocalPlan, TownCtx>();

// --------------------------------------------------------------- the steps --

const TerrainStreets: LocalGenStep = {
  name: 'streets',
  run(facts, rng, plan) {
    const { pos, geo, settlement } = facts;
    // the town's scale breathes with its population (a ruin uses its lifespan as a proxy
    // for the town it once was — the sim keeps no population history yet).
    const pop = settlement.ruinedYear !== undefined
      ? Math.min(400, 60 + (settlement.ruinedYear - settlement.foundedYear) * 2)
      : settlement.population;
    const townRadius = Math.min(2.6, 0.9 + Math.sqrt(pop) * 0.075);
    const houses = Math.max(6, Math.min(150, Math.round(pop / 3.2)));
    // streets run toward the real road-graph neighbours; a hermit village still has a lane
    const angles = facts.roadEntries.length > 0 ? [...facts.roadEntries] : [rng.next() * Math.PI * 2];
    if (angles.length === 1) angles.push(angles[0] + Math.PI + (rng.next() - 0.5) * 0.8); // a through-road
    // beyond the through-roads, a grown town sprouts its own MINOR LANES between them —
    // one line of houses reads as a hamlet, not a town
    const lanes = 1 + Math.min(3, Math.floor(pop / 160));
    const laneAngles: number[] = [];
    for (let i = 0; i < lanes; i++) {
      laneAngles.push(rng.next() * Math.PI * 2);
    }
    const streets: TownCtx['streets'] = [];
    const lay = (angle: number, reach: number, width: number) => {
      const pts: { x: number; y: number }[] = [];
      const bend = (rng.next() - 0.5) * 0.5; // each street carries its own gentle arc
      for (let t = 0; t <= 1.001; t += 0.2) {
        const d = t * reach;
        const a = angle + bend * t;
        const px = pos.x + Math.cos(a) * d;
        const py = pos.y + Math.sin(a) * d;
        pts.push({ x: px, y: py });
        if (!buildable(geo, px, py)) break; // a street stops at the water's edge
      }
      if (pts.length >= 2) {
        streets.push({ angle, pts, reach });
        plan.items.push({ kind: 'street', pts, width });
      }
    };
    for (const angle of angles.slice(0, 5)) lay(angle, townRadius + 1.6, 0.07);
    for (const angle of laneAngles) lay(angle, townRadius * 0.75, 0.045);
    plan.radius = townRadius;
    ctxOf.set(plan, { streets, townRadius, houses });
  },
};

const MarketSquare: LocalGenStep = {
  name: 'square',
  run(facts, rng, plan) {
    if (facts.settlement.ruinedYear !== undefined) return;
    if (facts.settlement.population < 60) return; // a hamlet has no market
    plan.items.push({
      kind: 'square',
      x: facts.pos.x, y: facts.pos.y,
      w: 0.5, h: 0.5, rot: rng.next() * 0.4,
      label: 'the market square',
    });
  },
};

const CivicBuildings: LocalGenStep = {
  name: 'civic',
  run(facts, rng, plan) {
    const s = facts.settlement;
    const ruined = s.ruinedYear !== undefined;
    // the SEAT — where the settlement is governed from (grand, near the square)
    if (s.leaderTitle) {
      const a = rng.next() * Math.PI * 2;
      plan.items.push({
        kind: 'building',
        x: facts.pos.x + Math.cos(a) * 0.42, y: facts.pos.y + Math.sin(a) * 0.42,
        w: 0.34, h: 0.26, rot: a + Math.PI / 2,
        role: 'seat',
        label: ruined
          ? 'the fallen seat'
          : s.ruler ? `the seat of ${s.leaderTitle} ${s.ruler}` : `the ${s.leaderTitle}'s seat`,
        tone: ruined ? 'ruin' : 'grand',
        ref: !ruined && s.rulerId !== undefined ? { kind: 'figure', id: s.rulerId } : undefined,
      });
    }
    // the SHRINE — every people raises something to its patron
    if (s.patronDeity) {
      const a = rng.next() * Math.PI * 2;
      plan.items.push({
        kind: 'building',
        x: facts.pos.x + Math.cos(a) * 0.6, y: facts.pos.y + Math.sin(a) * 0.6,
        w: 0.22, h: 0.22, rot: rng.next() * Math.PI,
        role: 'shrine',
        label: `the shrine of ${s.patronDeity.name}`,
        tone: ruined ? 'ruin' : 'sacred',
        ref: { kind: 'deity', id: s.patronDeity.id },
      });
    }
  },
};

const Houses: LocalGenStep = {
  name: 'houses',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { geo, settlement } = facts;
    const ruined = settlement.ruinedYear !== undefined;
    const wealthTier = settlement.wealth > 220 ? 1 : settlement.wealth > 90 ? 0.5 : 0;
    let budget = ctx.houses;
    // homes line the streets, densest near the square, thinning outward — and a house
    // needs dry, standable ground (the geography, not the plan, has the final word).
    const lots: { x: number; y: number; rot: number; t: number }[] = [];
    for (const st of ctx.streets) {
      for (let t = 0.28; t <= Math.min(st.reach, ctx.townRadius + 0.3); t += 0.24) {
        // interpolate along the street polyline
        const f = Math.min(0.999, t / st.reach);
        const si = f * (st.pts.length - 1);
        const i0 = Math.floor(si);
        const p0 = st.pts[i0];
        const p1 = st.pts[Math.min(st.pts.length - 1, i0 + 1)];
        const fx = si - i0;
        const px = p0.x + (p1.x - p0.x) * fx;
        const py = p0.y + (p1.y - p0.y) * fx;
        const tangent = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        for (const side of [-1, 1]) {
          const off = 0.16 + rng.next() * 0.1;
          const lx = px + Math.cos(tangent + Math.PI / 2) * off * side;
          const ly = py + Math.sin(tangent + Math.PI / 2) * off * side;
          lots.push({ x: lx + (rng.next() - 0.5) * 0.05, y: ly + (rng.next() - 0.5) * 0.05, rot: tangent, t });
        }
      }
    }
    // near lots first (the town grew from its square), a lot only if the ground allows
    lots.sort((a, b) => a.t - b.t);
    for (const lot of lots) {
      if (budget <= 0) break;
      if (!buildable(geo, lot.x, lot.y)) continue;
      const sizeBase = 0.11 + rng.next() * 0.07 + wealthTier * 0.03;
      plan.items.push({
        kind: 'building',
        x: lot.x, y: lot.y,
        w: sizeBase * (1.1 + rng.next() * 0.5), h: sizeBase,
        rot: lot.rot,
        role: 'house',
        label: ruined ? 'a fallen roof' : 'a household',
        tone: ruined ? 'ruin' : 'plain',
      });
      budget--;
    }
  },
};

/** what a place LIVES ON, read from its pack specialization string — fields for the
 *  farmers, piers for the fishers, mine heads for the miners. */
const Livelihood: LocalGenStep = {
  name: 'livelihood',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { geo, pos, settlement } = facts;
    const spec = settlement.specialization.toLowerCase();
    const ruined = settlement.ruinedYear !== undefined;

    if (/fish|whal|pearl/.test(spec)) {
      // PIERS run out into the nearest water; boathouses crowd the shore
      const wa = towardWater(geo, pos.x, pos.y, 6, [WATER_SEA, WATER_LAKE, WATER_RIVER]);
      if (wa !== undefined) {
        // walk to the shoreline
        let sx = pos.x, sy = pos.y;
        for (let d = 0; d < 6; d += 0.15) {
          sx = pos.x + Math.cos(wa) * d;
          sy = pos.y + Math.sin(wa) * d;
          if (!buildable(geo, sx, sy)) break;
        }
        const piers = ruined ? 1 : 1 + Math.min(2, Math.floor(settlement.population / 150));
        for (let p = 0; p < piers; p++) {
          const perp = wa + Math.PI / 2;
          const ox = Math.cos(perp) * (p - (piers - 1) / 2) * 0.35;
          const oy = Math.sin(perp) * (p - (piers - 1) / 2) * 0.35;
          plan.items.push({
            kind: 'pier',
            pts: [
              { x: sx + ox - Math.cos(wa) * 0.15, y: sy + oy - Math.sin(wa) * 0.15 },
              { x: sx + ox + Math.cos(wa) * (0.35 + rng.next() * 0.2), y: sy + oy + Math.sin(wa) * (0.35 + rng.next() * 0.2) },
            ],
            width: 0.05,
          });
          if (!ruined) {
            plan.items.push({
              kind: 'building',
              x: sx + ox - Math.cos(wa) * 0.28, y: sy + oy - Math.sin(wa) * 0.28,
              w: 0.16, h: 0.12, rot: wa,
              role: 'boathouse', label: 'a boathouse', tone: 'plain',
            });
          }
        }
      }
    }

    if (/farm|plant|grain|herd|pasture|orchard|vine/.test(spec) || settlement.population >= 120) {
      // FIELDS on flat dry ground past the town's edge, strip-plots facing the square
      const n = ruined ? 2 : 4 + Math.min(8, Math.floor(settlement.population / 60));
      let placed = 0;
      for (let tries = 0; tries < 60 && placed < n; tries++) {
        const a = rng.next() * Math.PI * 2;
        const d = ctx.townRadius + 0.5 + rng.next() * 1.6;
        const fx = pos.x + Math.cos(a) * d;
        const fy = pos.y + Math.sin(a) * d;
        if (!buildable(geo, fx, fy)) continue;
        plan.items.push({
          kind: 'field',
          x: fx, y: fy,
          w: 0.55 + rng.next() * 0.4, h: 0.32 + rng.next() * 0.2,
          rot: a + Math.PI / 2 + (rng.next() - 0.5) * 0.3,
          label: ruined ? 'fields gone to seed' : 'worked fields',
        });
        placed++;
      }
    }

    if (/mine|ore|stone|quarr|smith|forge|iron|gem/.test(spec)) {
      // MINE HEADS toward the highest ground in reach
      let best = { x: pos.x, y: pos.y, e: -1 };
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2;
        const mx = pos.x + Math.cos(ang) * (ctx.townRadius + 1.2);
        const my = pos.y + Math.sin(ang) * (ctx.townRadius + 1.2);
        const e = elevAt(facts.geo, mx, my);
        if (e > best.e && buildable(geo, mx, my)) best = { x: mx, y: my, e };
      }
      if (best.e >= 0) {
        plan.items.push({
          kind: 'building',
          x: best.x, y: best.y, w: 0.18, h: 0.14, rot: rng.next() * Math.PI,
          role: 'minehead', label: ruined ? 'a caved-in working' : 'the mine head', tone: ruined ? 'ruin' : 'plain',
        });
        plan.items.push({ kind: 'rubble', x: best.x + 0.2, y: best.y + 0.1, w: 0.25, h: 0.18, rot: rng.next() });
      }
    }

    if (/trade|market|weav|craft|carv|glass|dye|scrimshaw/.test(spec) && !ruined) {
      // WORKSHOPS and a warehouse near the square — the maker's quarter
      const n = 2 + Math.min(3, Math.floor(settlement.wealth / 120));
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2;
        const d = 0.5 + rng.next() * 0.5;
        const wx = pos.x + Math.cos(a) * d;
        const wy = pos.y + Math.sin(a) * d;
        if (!buildable(geo, wx, wy)) continue;
        plan.items.push({
          kind: 'building',
          x: wx, y: wy, w: 0.2, h: 0.15, rot: a + Math.PI / 2,
          role: i === 0 ? 'warehouse' : 'workshop',
          label: i === 0 ? 'the warehouse' : 'a workshop',
          tone: 'plain',
        });
      }
    }
  },
};

const Palisade: LocalGenStep = {
  name: 'palisade',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const s = facts.settlement;
    // a town that is governed and grown walls itself; gates open where the streets run
    if (s.ruinedYear !== undefined || s.population < 220 || !s.leaderTitle) return;
    // the wall HUGS the built town (houses thin out well inside townRadius) — a ring
    // out at the fields reads as absurd, not defensive
    const r = ctx.townRadius * 0.62;
    const gateAngles = ctx.streets.map((st) => st.angle);
    const segs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 48) {
      const nearGate = gateAngles.some((g) => {
        const d = Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return d < 0.13;
      });
      const px = facts.pos.x + Math.cos(a) * (r + (rng.next() - 0.5) * 0.04);
      const py = facts.pos.y + Math.sin(a) * (r + (rng.next() - 0.5) * 0.04);
      if (nearGate || !buildable(facts.geo, px, py)) {
        if (cur.length > 2) segs.push(cur);
        cur = [];
      } else cur.push({ x: px, y: py });
    }
    if (cur.length > 2) segs.push(cur);
    for (const seg of segs) plan.items.push({ kind: 'wall', pts: seg, width: 0.045 });
  },
};

const TreesAndRuin: LocalGenStep = {
  name: 'trees',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { geo, pos, settlement } = facts;
    const ruined = settlement.ruinedYear !== undefined;
    // the countryside: tree cover follows real moisture; a ruin's own streets are overgrown
    const n = 160;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = (ruined ? 0.2 : ctx.townRadius * 0.9) + rng.next() * (5 - ctx.townRadius);
      const tx = pos.x + Math.cos(a) * d;
      const ty = pos.y + Math.sin(a) * d;
      if (!buildable(geo, tx, ty)) continue;
      const m = moistureAt(geo, tx, ty);
      if (rng.next() > m * 0.85) continue; // dry land is open land
      plan.items.push({ kind: 'tree', x: tx, y: ty, r: 0.03 + rng.next() * 0.035 });
    }
    if (ruined) {
      // rubble where the town square was, and the years written in scattered stone
      const decades = Math.max(1, Math.floor((facts.currentYear - settlement.ruinedYear!) / 10));
      for (let i = 0; i < Math.min(8, 2 + decades); i++) {
        const a = rng.next() * Math.PI * 2;
        const d = rng.next() * ctx.townRadius;
        plan.items.push({ kind: 'rubble', x: pos.x + Math.cos(a) * d, y: pos.y + Math.sin(a) * d, w: 0.14 + rng.next() * 0.16, h: 0.1 + rng.next() * 0.1, rot: rng.next() * Math.PI });
      }
    }
  },
};

/** The fantasy pack's pipeline, in order. A pack composes/replaces these (design/24 §3.3). */
export const LOCAL_GEN_STEPS: LocalGenStep[] = [
  TerrainStreets,
  MarketSquare,
  CivicBuildings,
  Houses,
  Livelihood,
  Palisade,
  TreesAndRuin,
];

/** Build the deterministic town plan for one settlement. Pure: same facts ⇒ same plan. */
export function buildLocalPlan(facts: LocalPlanFacts): LocalPlan {
  const plan: LocalPlan = { items: [], radius: 1 };
  const rng = new Rng(mixSeed(facts.seed, facts.settlement.id, 0x70c1));
  for (const step of LOCAL_GEN_STEPS) step.run(facts, rng, plan);
  return plan;
}
