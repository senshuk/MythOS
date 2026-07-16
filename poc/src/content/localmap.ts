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
import { type Geography, GEO_MIN, GEO_SPAN, WATER_SEA, WATER_LAKE, WATER_RIVER, hillinessAt, wetnessAt, flowSpeedAt, temperatureAt, fertilityAt, HILL_HILLS, HILL_MOUNTAIN } from '../engine/geography';
import { archStyleFor } from './architecture';
import { biomeOf } from './biomes';
import { type SettlementView, type EventRef, type EventView, type HouseholdView } from '../engine/model';
import { Rng, mixSeed } from '../engine/rng';

// ------------------------------------------------------------ the plan model --

export interface PlanBuilding {
  kind: 'building';
  x: number; y: number; // centre, world units
  w: number; h: number; // world units
  rot: number; // radians
  role: 'house' | 'seat' | 'shrine' | 'tavern' | 'workshop' | 'warehouse' | 'boathouse' | 'minehead' | 'mill' | 'monument' | 'stone' | 'tomb' | 'shell' | 'well' | 'stall' | 'granary' | 'scaffold' | 'grave' | 'watchtower';
  /** a fortunes cue (design/28 §2): a roofless, weed-taken house in a settlement that has
   *  DECLINED — the town has pulled back to its core and its edges rot. Rendered ruined-ish. */
  derelict?: boolean;
  label: string; // hover text, in the pack's voice
  tone: 'plain' | 'grand' | 'sacred' | 'ruin';
  ref?: EventRef; // the shrine inspects its deity, the seat its ruler, a home its head
  eventId?: number; // a HISTORY MARK traces the event it remembers (design/24 §3.4)
  /** a roof with a KNOWN family under it (L2, focused settlement) — lit on the map. */
  inhabited?: boolean;
  /** age band (design/24 §8.3): 'old' weathered stone at the dense core, 'new' fresh
   *  timber at the growing edge — an approximate growth gradient, no pop history needed. */
  era?: 'old' | 'new';
  /** footprint shape (design/24 §8.4): a wealthy compound rings a yard; a row-house in
   *  the dense core is a plain block; the default is a ridged cot. */
  shape?: 'cot' | 'row' | 'compound';
  /** the culture's ARCHITECTURAL style id (design/28 §3) — drives wall/roof colour, roof
   *  silhouette and chimney in both renderers, so a people's dwellings read as their own. */
  arch?: string;
  /** set only on buildings the Interiors step furnished (design/32 §5) — the handle its
   *  `PlanInterior` fittings point back at, so the renderer knows which roof to fade. */
  id?: number;
}
export interface PlanPath {
  /** `precinct` is a district boundary (design/32 §6) — a shrine's enclosure, a seat's bailey.
   *  Drawn lighter than `wall`: it marks a zone, it does not hold one. */
  kind: 'street' | 'pier' | 'wall' | 'barricade' | 'packed' | 'bridge' | 'precinct';
  pts: { x: number; y: number }[];
  width: number; // world units
  label?: string;
}
export interface PlanPatch {
  kind: 'field' | 'terrace' | 'rubble' | 'square' | 'scorch';
  x: number; y: number; w: number; h: number; rot: number;
  label?: string;
  eventId?: number; // a scorch remembers the raid that made it
  ref?: EventRef; // the market square inspects its venue (L4)
  /** 0..1 — how far a scorch has healed (drives its fade) */
  age?: number;
  /** what a worked field GROWS (design/28 §5) — derived from the town's specialization and
   *  its biome, so a vineyard, a paddy and a grainfield read differently, not all furrows. */
  crop?: CropKind;
}
export type CropKind = 'grain' | 'vine' | 'paddy' | 'plain';
/** the SHAPE of a tree (design/28 §5) — biome-derived so the countryside reads as its climate:
 *  a pointed conifer in the taiga, a round broadleaf in the woodland, a palm in the jungle,
 *  low scrub in the dryland; `orchard` is a planted fruit tree (in rows), `reed` a waterside tuft. */
export type TreeForm = 'conifer' | 'broadleaf' | 'palm' | 'scrub' | 'orchard' | 'reed';
/** a tree in the countryside; `tone` (a fill colour) lets the pack draw biome-appropriate
 *  cover — dark conifers in the taiga, pale scrub at a desert oasis (design/24 §8.4); `form`
 *  gives it a biome-appropriate silhouette (design/28 §5). */
export interface PlanTree { kind: 'tree'; x: number; y: number; r: number; tone?: string; form?: TreeForm }
/** an INHABITANT — a static figure that makes the town read as peopled, not empty
 *  (design/27 §3). A derived reading: placed from the households + livelihood the plan
 *  already knows, stored nowhere. No movement, no pathing — presence, not simulation. */
export interface PlanPerson {
  kind: 'person';
  x: number; y: number; // world units
  tone: 'folk' | 'child' | 'notable' | 'mourner' | 'reveller';
  facing: number; // radians — a crowd faces the square, a mourner the pyre
  ref?: EventRef; // a notable figure inspects its actor
  label?: string; // hover text, in the pack's voice
}
/** a small piece of WORKING LIFE on the ground — the settlement's specialization made
 *  visible as ambient activity (design/28 §4.2): livestock in a herder's paddock, a
 *  boat drawn up at a fisher's pier, racks of drying catch by the boathouse. Derived
 *  purely from Specialization + what the plan already placed — nothing new tracked. */
export interface PlanProp {
  kind: 'prop';
  x: number; y: number; rot: number;
  /** `livestock`/`boat`/`rack` came with the ambient-life pass (design/28 §4.2); the rest are
   *  design/32 §5's clutter — each one an answer to "who works here?", read off the plan's own
   *  livelihood and household professions. `boulder` is countryside, not labour: stone where the
   *  land is steep, because the reference maps get half their character from rock. */
  propKind: 'livestock' | 'boat' | 'rack' | 'woodpile' | 'cart' | 'coal' | 'cargo' | 'boulder';
  label?: string;
  /** 0.6…1.6 — a per-prop size jitter so a row of woodpiles isn't a row of clones */
  scale?: number;
}
/** A FITTING inside a building (design/32 §5) — revealed when the view zooms past the roof.
 *  Derived: the beds are the household the plan ALREADY carries (L2), the workbench is the
 *  workshop's function, the altar the shrine's. Nothing new is tracked; this is the textual
 *  "hover a lit roof, meet the family" made visible. Local coords are baked to world here so
 *  the renderer stays a dumb draw. */
export interface PlanInterior {
  kind: 'interior';
  x: number; y: number; rot: number;
  fitting: 'hearth' | 'bed' | 'table' | 'bench' | 'cask' | 'altar' | 'anvil' | 'sack';
  /** the building this fitting sits in — the renderer fades that roof to show its floor */
  ofBuilding: number;
  label?: string;
}
/** a GROUND SURFACE under the town (design/32 §3) — packed earth where feet and carts strip
 *  the grass, a cobbled core where wealth has paved the heart, turned soil under the plots.
 *  Painted INTO the terrain canvas with hash-dithered edges (a material, not a gradient);
 *  the SVG overlay never draws it. Surface names and tones are this pack's vocabulary.
 *  A disc (`r`) or a rotated rect (`w`/`h`/`rot`), world units. */
export interface PlanGround {
  kind: 'ground';
  surface: 'packed' | 'cobble' | 'soil';
  x: number; y: number;
  r?: number; // disc
  w?: number; h?: number; rot?: number; // rotated rect
  tone: [number, number, number];
  /** 0..1 — per-cell brightness variation (individual cobbles, turned clods) */
  speckle?: number;
  /** 0..1 — how fully the surface replaces the land colour where it wins the dither */
  blend: number;
}
export type PlanItem = PlanBuilding | PlanPath | PlanPatch | PlanTree | PlanPerson | PlanProp | PlanGround | PlanInterior;

export interface LocalPlanFacts {
  seed: number;
  settlement: SettlementView;
  pos: { x: number; y: number }; // the settlement's world position
  roadEntries: number[]; // angles (radians) toward its road-graph neighbours
  geo: Geography;
  currentYear: number;
  /** the settlement's notable recorded history (oldest first) — the history-marks feed.
   *  Arrives out-of-band; the plan builds without it and re-builds when it lands. */
  chronicle?: EventView[];
  /** who lives under which roof (L2) — present only for the lived-in-full settlement.
   *  The Houses step names its roofs from these, densest hearths nearest the square. */
  households?: HouseholdView[];
  /** the settlement's PUBLIC VENUES (L4, design/25) — real Locations the sim's events
   *  happen at. The drawn shrine/square/tavern link to them (click = its history). */
  venues?: { id: number; name: string; meaning?: string; type: string }[];
  /** communal gatherings still fresh this year (design/27 §4) — the Gatherings step draws
   *  the crowd this already-simulated event produced (design/28 §4.3). Presentation only:
   *  nothing new is tracked, this is a narrow read of the settlement's own recent events. */
  gatherings?: { kind: string; venueId?: number; year: number }[];
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
/** How readily a structure can stand here, 0 (submerged/impossible) … 1 (flat dry ground).
 *  Steep or boggy ground builds hard but not never (terraces, stilts) — RimWorld's marsh
 *  "high fertility, difficult to build on" as a threshold, not a flag (design/24 §7.2). */
function buildability(geo: Geography, x: number, y: number): number {
  if (waterAt(geo, x, y) !== 0 || elevAt(geo, x, y) < geo.seaLevel) return 0; // in the water
  const slope = hillinessAt(geo, x, y) / HILL_MOUNTAIN; // 0 flat … 1 mountain
  const wet = wetnessAt(geo, x, y); // 0 firm … 1 mire
  return Math.max(0.12, 1 - slope * 0.6 - wet * 0.7);
}
/** is this spot dry, unflooded ground a building can stand on at all? */
function buildable(geo: Geography, x: number, y: number): boolean {
  return buildability(geo, x, y) > 0;
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

// -------------------------------------------------------- culture & terrain --

/** How a PEOPLE lays out a town (design/24 §8.1) — pack vocabulary, DERIVED (not authored)
 *  from the settlement's terrain, livelihood and a per-culture character, so a steppe herder
 *  folk and a mercantile coast folk build visibly differently, and a hill town terraces. */
interface TownForm {
  pattern: 'organic' | 'grid' | 'dispersed' | 'terraced';
  packing: number; // parcel spacing: <1 loose (dispersed) … >1 tight (a walled grid)
  bend: number; // how far streets wander from a straight run: ~0.12 grid … ~0.55 organic
}

/** a tiny stable string hash, so a culture's character is the same in every town it holds. */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function townFormFor(facts: LocalPlanFacts): TownForm {
  const { geo, pos, settlement } = facts;
  const spec = settlement.specialization.toLowerCase();
  // TERRAIN WINS: a town on steep ground terraces, whatever its people believe
  if (hillinessAt(geo, pos.x, pos.y) >= HILL_HILLS) return { pattern: 'terraced', packing: 1.1, bend: 0.5 };
  // herders and ranchers spread into loose compounds around their stock
  if (/herd|pastur|ranch|nomad/.test(spec)) return { pattern: 'dispersed', packing: 0.68, bend: 0.42 };
  // a trading/market town lays a tight, planned GRID around its broad plaza
  if (/trade|market|port|harbou?r/.test(spec)) return { pattern: 'grid', packing: 1.32, bend: 0.12 };
  // a fishing village strings loosely along its shore — an organic tangle
  if (/fish|whal|pearl/.test(spec)) return { pattern: 'organic', packing: 0.92, bend: 0.5 };
  // otherwise a per-culture character decides a tight grid vs an organic tangle
  return strHash(settlement.cultureId) % 2 === 0
    ? { pattern: 'grid', packing: 1.22, bend: 0.14 }
    : { pattern: 'organic', packing: 1.0, bend: 0.52 };
}

/** How a settlement is FARING (design/28 §2), derived from sim state the plan already has.
 *  `fortune` runs −1 (dying) … +1 (thriving) from stability, food security and wealth; the
 *  flags mark visible decline, boom and war. Everything here is read from SettlementView +
 *  chronicle — no new engine tracking. */
interface Fortunes { fortune: number; declining: boolean; prospering: boolean; atWar: boolean; deaths: number }
function settlementFortunes(facts: LocalPlanFacts): Fortunes {
  const s = facts.settlement;
  const wealthK = s.wealth > 260 ? 0.25 : s.wealth < 70 ? -0.22 : 0;
  const foodK = (Math.min(2, s.subsistenceSecurity) - 1) * 0.3;
  const fortune = Math.max(-1, Math.min(1, s.stability / 100 + wealthK + foodK));
  const recent = (facts.chronicle ?? []).filter((e) => facts.currentYear - e.year <= 18);
  const grief = recent.some((e) => /^(famine|plague|blight|hardship|raid)$/.test(e.type));
  const boom = recent.some((e) => /^(prosperity|milestone|wonder|boon)$/.test(e.type));
  const atWar = s.civilWarYear !== undefined
    || (s.polity?.wars?.length ?? 0) > 0
    || recent.some((e) => /^(raid|battle|conquest|civil_war)$/.test(e.type));
  const deaths = (facts.chronicle ?? []).filter((e) => /^(died|died_brawl|ruler_died|figure_passed|funeral)$/.test(e.type)).length;
  return {
    fortune,
    declining: (fortune < -0.18 || grief) && !boom,
    prospering: fortune > 0.35 && !grief,
    atWar,
    deaths,
  };
}

/** the cost of crossing the ground here (world coords) — high on steep, wet or high land,
 *  low in the valleys. Streets follow the low-cost grain (design/24 §8.2, `groundMoveCost`
 *  as a local sampler over this pack's bilinear terrain reads). */
function marchCostAt(geo: Geography, x: number, y: number): number {
  return elevAt(geo, x, y) * 3 + hillinessAt(geo, x, y) * 1.1 + wetnessAt(geo, x, y) * 2.2;
}

// ------------------------------------------------------------- shared state --

/** streets laid by TownPlan, consumed by Buildings/Parcels/Palisade (kept off the plan
 *  model — it's pipeline working state, threaded via this per-run context). */
interface TownCtx {
  streets: { angle: number; pts: { x: number; y: number }[]; reach: number }[];
  townRadius: number;
  houses: number; // budget remaining
  form: TownForm;
  /** claimed building footprints — nothing overlaps (design/24 §8.2 parcels). Every
   *  structure calls `claim()` before it is placed, so civic, homes and workshops all
   *  respect one another and back yards fall out of the spacing. */
  parcels: { x: number; y: number; r: number }[];
  /** fresh burn scars (HistoryMarks) — Houses leaves these lots empty, so a recent
   *  raid reads as a charred GAP in the town, not a patch painted over roofs. */
  scars: { x: number; y: number; r: number }[];
}
const ctxOf = new WeakMap<LocalPlan, TownCtx>();

/** claim a footprint of radius `r` at (x,y) if it clears every parcel already taken; returns
 *  false (place nothing) if it would overlap. The one gate all buildings pass through. */
function claim(ctx: TownCtx, x: number, y: number, r: number): boolean {
  for (const p of ctx.parcels) {
    const dx = x - p.x, dy = y - p.y;
    const rr = r + p.r;
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  ctx.parcels.push({ x, y, r });
  return true;
}

/** read-only test: does a disc of radius `r` at (x,y) touch any claimed footprint? Trees and
 *  other scatter consult this (without reserving) so nothing grows up through a roof. */
function occupied(ctx: TownCtx, x: number, y: number, r: number): boolean {
  for (const p of ctx.parcels) {
    const dx = x - p.x, dy = y - p.y, rr = r + p.r;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** the rotation that turns a building's long wall to face (tx,ty) — our buildings are drawn
 *  broadside-on, so "facing" a target is a +90° turn from the bearing to it. Used so civic and
 *  craft buildings ADDRESS the square/street they front, instead of pointing at random. */
function faceToward(x: number, y: number, tx: number, ty: number): number {
  return Math.atan2(ty - y, tx - x) + Math.PI / 2;
}

/** A CLAIMED frontage lot near the centre, along `angle` at `dist`, drawn onto the nearest
 *  street so the building LINES a lane/plaza rather than floating on open ground. Steps
 *  outward until it finds a lot that clears every parcel already taken (so civic buildings
 *  never sit on one another), reserves it, and returns the lot + a rotation facing back toward
 *  the centre (design/27 — legible, functional civic zoning). */
function frontage(ctx: TownCtx, geo: Geography, cx: number, cy: number, angle: number, dist: number, footR: number): { x: number; y: number; rot: number } {
  // snap a target toward the nearest street point, sitting just off it on the centre side
  const snap = (x: number, y: number): { x: number; y: number } => {
    let best: { x: number; y: number } | undefined;
    let bestD = 0.32 * 0.32; // only snap if a street runs genuinely close
    for (const st of ctx.streets) for (const p of st.pts) {
      const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dd < bestD) { bestD = dd; best = p; }
    }
    if (best) {
      const toC = Math.atan2(cy - best.y, cx - best.x);
      const ox = best.x + Math.cos(toC) * (footR + 0.03), oy = best.y + Math.sin(toC) * (footR + 0.03);
      if (buildable(geo, ox, oy)) return { x: ox, y: oy };
    }
    return { x, y };
  };
  // step outward along the bearing until a clear, buildable, non-overlapping lot claims
  for (let k = 0; k < 10; k++) {
    const d = dist + k * (footR * 1.5);
    const c = snap(cx + Math.cos(angle) * d, cy + Math.sin(angle) * d);
    if (buildable(geo, c.x, c.y) && claim(ctx, c.x, c.y, footR)) {
      return { x: c.x, y: c.y, rot: faceToward(c.x, c.y, cx, cy) };
    }
  }
  // last resort (nowhere clear): place at the base distance, still facing the centre
  const fx = cx + Math.cos(angle) * dist, fy = cy + Math.sin(angle) * dist;
  return { x: fx, y: fy, rot: faceToward(fx, fy, cx, cy) };
}

/** Nudge a point onto DRY, STANDABLE ground: if (x,y) is in water/impassable, search
 *  concentric rings around it for the NEAREST buildable land (in any direction — land may be
 *  any way from an offshore point). Returns the original if none is near. No claim. */
function toLand(geo: Geography, x: number, y: number, rings = 9, stepLen = 0.1): { x: number; y: number } {
  if (buildable(geo, x, y)) return { x, y };
  for (let k = 1; k <= rings; k++) {
    for (let s = 0; s < 8; s++) {
      const ang = (s / 8) * Math.PI * 2;
      const tx = x + Math.cos(ang) * k * stepLen, ty = y + Math.sin(ang) * k * stepLen;
      if (buildable(geo, tx, ty)) return { x: tx, y: ty };
    }
  }
  return { x, y };
}

/** A CLAIMED lot of radius r near (x,y) that is BOTH on land and clear of every reserved
 *  footprint — searching the spot itself, then concentric rings. `undefined` when nothing near
 *  qualifies, so an OPTIONAL structure (a stall, a shell) is skipped rather than dropped in the
 *  sea or on a neighbour. This is the one gate that fixes both bugs at once: water AND collisions. */
function findLot(ctx: TownCtx, geo: Geography, x: number, y: number, r: number, rings = 6): { x: number; y: number } | undefined {
  for (let k = 0; k <= rings; k++) {
    const steps = k === 0 ? 1 : 8;
    for (let s = 0; s < steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const tx = x + Math.cos(ang) * k * (r * 1.25), ty = y + Math.sin(ang) * k * (r * 1.25);
      if (buildable(geo, tx, ty) && claim(ctx, tx, ty, r)) return { x: tx, y: ty };
    }
  }
  return undefined;
}

/** A lot for a GUARANTEED structure (a history mark the chronicle says exists): a claimed,
 *  land, non-overlapping lot if one is near; else merely dry land; else the original spot.
 *  Always returns — the mark must appear — but tries hard to keep it off water and neighbours. */
function markLot(ctx: TownCtx, geo: Geography, x: number, y: number, r: number): { x: number; y: number } {
  return findLot(ctx, geo, x, y, r) ?? toLand(geo, x, y);
}

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
    const form = townFormFor(facts);
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
    // A TERRAIN-CONFORMING walk (design/24 §8.2): each step nudges the heading toward the
    // easiest nearby ground, so streets hug valleys and switchback a slope instead of
    // running dead-straight over a crag. `form.bend` sets how far a people lets its streets
    // wander (a grid stays near-straight; an organic tangle follows every contour). Where a
    // street meets a river, it BRIDGES to the far bank rather than stopping dead.
    const lay = (angle0: number, reach: number, width: number) => {
      const pts: { x: number; y: number }[] = [{ x: pos.x, y: pos.y }];
      const STEPS = 7;
      const stepLen = reach / STEPS;
      let a = angle0;
      let px = pos.x, py = pos.y;
      const arc = (rng.next() - 0.5) * form.bend; // this street's own gentle drift
      for (let i = 0; i < STEPS; i++) {
        let bestA = a + arc, bestCost = Infinity;
        const eHere = elevAt(geo, px, py);
        // wider steering (±0.7) so a lane can genuinely swing around a hill, not just nudge
        for (const da of [-0.7, -0.42, -0.2, 0, 0.2, 0.42, 0.7]) {
          const ta = a + arc + da * form.bend * 2.0;
          const tx = px + Math.cos(ta) * stepLen, ty = py + Math.sin(ta) * stepLen;
          if (!buildable(geo, tx, ty)) continue;
          // a real road hugs low ground AND SHUNS STEEP GRADES — it contours a slope, never
          // climbs straight up it. `grade` is the rise per unit run to the candidate step.
          const grade = Math.abs(elevAt(geo, tx, ty) - eHere) / Math.max(0.001, stepLen);
          const cost = marchCostAt(geo, tx, ty) + Math.abs(da) * 1.4 + grade * 7;
          if (cost < bestCost) { bestCost = cost; bestA = ta; }
        }
        a = bestA;
        const nx = px + Math.cos(a) * stepLen, ny = py + Math.sin(a) * stepLen;
        if (!buildable(geo, nx, ny)) {
          // blocked — if it's a RIVER (not the sea/a lake), throw a bridge across to dry land
          if (waterAt(geo, nx, ny) === WATER_RIVER) {
            let far: { x: number; y: number } | undefined;
            for (let d = stepLen; d <= stepLen * 4; d += stepLen * 0.5) {
              const fx = px + Math.cos(a) * d, fy = py + Math.sin(a) * d;
              if (buildable(geo, fx, fy)) { far = { x: fx, y: fy }; break; }
            }
            if (far) {
              plan.items.push({ kind: 'bridge', pts: [{ x: px, y: py }, far], width: width * 1.3, label: 'a bridge' });
              pts.push(far);
              px = far.x; py = far.y;
              continue;
            }
          }
          break; // the sea, a lake, or an impassable wall: the street ends here
        }
        px = nx; py = ny;
        pts.push({ x: px, y: py });
      }
      if (pts.length >= 2) {
        streets.push({ angle: angle0, pts, reach });
        plan.items.push({ kind: 'street', pts, width });
      }
    };
    for (const angle of angles.slice(0, 5)) lay(angle, townRadius + 1.6, 0.07);
    for (const angle of laneAngles) lay(angle, townRadius * 0.75, 0.045);
    // CROSS-LINKS (design/24 §8.2): tie neighbouring spokes together at a mid radius so the
    // core reads as a connected WEB with blocks, not a bare star. A grid folk links more.
    const links = form.pattern === 'grid' ? streets.length : Math.max(1, Math.floor(streets.length / 2));
    for (let i = 0; i < links && i + 1 < streets.length; i++) {
      const s0 = streets[i], s1 = streets[i + 1];
      const mid = (arr: { x: number; y: number }[]) => arr[Math.max(1, Math.floor(arr.length * 0.5))];
      const p0 = mid(s0.pts), p1 = mid(s1.pts);
      if (buildable(geo, p0.x, p0.y) && buildable(geo, p1.x, p1.y)) {
        plan.items.push({ kind: 'street', pts: [p0, p1], width: 0.04 });
        streets.push({ angle: Math.atan2((p0.y + p1.y) / 2 - pos.y, (p0.x + p1.x) / 2 - pos.x), pts: [p0, p1], reach: townRadius });
      }
    }
    plan.radius = townRadius;
    ctxOf.set(plan, { streets, townRadius, houses, form, parcels: [], scars: [] });
  },
};

/**
 * HISTORY MARKS (design/24 §3.4) — the settlement's own chronicle, stamped into the
 * ground. Runs BEFORE Houses so a fresh burn is a gap the town hasn't rebuilt yet.
 * Which event TYPES leave marks is this pack's vocabulary; every mark carries its
 * eventId, so the town is click-traceable: the burned quarter answers "why?".
 */
const HistoryMarks: LocalGenStep = {
  name: 'history',
  run(facts, _rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { settlement: s, pos, currentYear, chronicle, geo } = facts;
    if (!chronicle || chronicle.length === 0) return;

    // --- burned quarters: violence that reached the town itself (most recent few) ---
    const violent = chronicle.filter((ev) => /^(raid|battle|conquest|civil_war|ruined)$/.test(ev.type)).slice(-5);
    for (const ev of violent) {
      // each mark is seeded by ITS OWN event id — stable however the chronicle shifts
      const r = new Rng(mixSeed(facts.seed, s.id, ev.id, 0x5ca7));
      const years = Math.max(0, currentYear - ev.year);
      if (years > 60) continue; // three generations on, the land has forgotten
      const a = r.next() * Math.PI * 2;
      const d = 0.25 + r.next() * ctx.townRadius * 0.7;
      const size = 0.35 + Math.min(0.45, ev.interest / 160);
      // a burn scar belongs on the ground the town stood on — nudge it off water back toward centre
      const land = toLand(geo, pos.x + Math.cos(a) * d, pos.y + Math.sin(a) * d);
      const x = land.x, y = land.y;
      const age = Math.min(1, years / 60); // 0 = still smoking, 1 = healed
      plan.items.push({
        kind: 'scorch', x, y,
        w: size * (1.2 + r.next() * 0.4), h: size, rot: r.next() * Math.PI,
        label: `y${ev.year} — ${ev.text}`,
        eventId: ev.id,
        age,
      });
      if (age < 0.35) {
        ctx.scars.push({ x, y, r: size * 0.8 }); // too fresh to rebuild over
        // charred shells still standing in the scar (kept on the scarred ground, never adrift)
        for (let i = 0; i < 2; i++) {
          const sxp = x + (r.next() - 0.5) * size, syp = y + (r.next() - 0.5) * size, srot = r.next() * Math.PI;
          const sl = toLand(geo, sxp, syp);
          plan.items.push({
            kind: 'building',
            x: sl.x, y: sl.y, w: 0.13, h: 0.1, rot: srot,
            role: 'shell', label: `a burned shell — y${ev.year}`, tone: 'ruin', eventId: ev.id,
          });
        }
      }
    }

    // --- memorial stones: the hard years, remembered in stone by the roadside ---
    const griefs = chronicle.filter((ev) => /^(famine|plague|blight)$/.test(ev.type)).slice(-3);
    griefs.forEach((ev, i) => {
      const r = new Rng(mixSeed(facts.seed, s.id, ev.id, 0x57e1));
      const st = ctx.streets[i % Math.max(1, ctx.streets.length)];
      const along = 0.5 + r.next() * 0.35; // out along the road, where travellers pass
      const p = st ? st.pts[Math.min(st.pts.length - 1, Math.round(along * (st.pts.length - 1)))] : pos;
      const raw = { x: p.x + (r.next() - 0.5) * 0.12, y: p.y + (r.next() - 0.5) * 0.12 };
      const lot = markLot(ctx, geo, raw.x, raw.y, 0.05);
      plan.items.push({
        kind: 'building',
        x: lot.x, y: lot.y,
        w: 0.06, h: 0.09, rot: 0,
        role: 'stone', label: `the ${ev.type} stone, y${ev.year} — ${ev.text}`, tone: 'plain', eventId: ev.id,
      });
    });

    // --- a wonder still standing: the proudest thing the town ever raised ---
    const wonder = chronicle.filter((ev) => ev.type === 'wonder').slice(-1)[0];
    if (wonder && s.ruinedYear === undefined) {
      const r = new Rng(mixSeed(facts.seed, s.id, wonder.id, 0x3009));
      const a = r.next() * Math.PI * 2;
      const lot = markLot(ctx, geo, pos.x + Math.cos(a) * 0.3, pos.y + Math.sin(a) * 0.3, 0.08);
      plan.items.push({
        kind: 'building',
        x: lot.x, y: lot.y,
        w: 0.09, h: 0.2, rot: 0,
        role: 'monument', label: `y${wonder.year} — ${wonder.text}`, tone: 'grand', eventId: wonder.id,
      });
    }

    // --- the founder's tomb: an old town keeps its beginning ---
    const founding = chronicle.find((ev) => ev.type === 'settlement_founded');
    if (s.founder && currentYear - s.foundedYear > 70) {
      const r = new Rng(mixSeed(facts.seed, s.id, 0x70b));
      const a = r.next() * Math.PI * 2;
      const trot = r.next() * Math.PI;
      const lot = markLot(ctx, geo, pos.x + Math.cos(a) * (ctx.townRadius * 0.5), pos.y + Math.sin(a) * (ctx.townRadius * 0.5), 0.09);
      plan.items.push({
        kind: 'building',
        x: lot.x, y: lot.y,
        w: 0.11, h: 0.11, rot: trot,
        role: 'tomb', label: `the tomb of ${s.founder}, who founded ${s.name} in y${s.foundedYear}`,
        tone: 'sacred', eventId: founding?.id,
      });
    }

    // --- a town divided: the barricade line, while the conflict clock runs ---
    if (s.civilWarYear !== undefined && s.factionSplit) {
      const r = new Rng(mixSeed(facts.seed, s.id, 0xba22));
      const a = r.next() * Math.PI * 2;
      const pts: { x: number; y: number }[] = [];
      const len = ctx.townRadius * 0.9;
      for (let t = -1; t <= 1.001; t += 0.25) {
        // a jagged line THROUGH the town, perpendicular jitter — barricades, not masonry
        pts.push({
          x: pos.x + Math.cos(a) * len * t + Math.cos(a + Math.PI / 2) * (r.next() - 0.5) * 0.14,
          y: pos.y + Math.sin(a) * len * t + Math.sin(a + Math.PI / 2) * (r.next() - 0.5) * 0.14,
        });
      }
      plan.items.push({
        kind: 'barricade', pts, width: 0.05,
        label: `barricades — ${s.factionSplit.highName} against ${s.factionSplit.lowName}, since y${s.civilWarYear}`,
      });
    }
  },
};

const MarketSquare: LocalGenStep = {
  name: 'square',
  run(facts, rng, plan) {
    const s = facts.settlement;
    if (s.ruinedYear !== undefined) return;
    if (s.population < 60) return; // a hamlet has no market
    const ctx = ctxOf.get(plan)!;
    const spec = s.specialization.toLowerCase();
    const tradey = /trade|market|craft|weav|carv|glass|dye|port|harbou?r/.test(spec);
    const sz = tradey ? 0.62 : 0.48; // a trading town's plaza is broader
    const venue = facts.venues?.find((v) => v.type === 'square');
    ctx.parcels.push({ x: facts.pos.x, y: facts.pos.y, r: sz * 0.72 }); // keep the plaza clear
    plan.items.push({
      kind: 'square',
      x: facts.pos.x, y: facts.pos.y,
      w: sz, h: sz, rot: rng.next() * 0.4,
      label: venue?.name ?? 'the market square',
      ref: venue ? { kind: 'venue', id: venue.id } : undefined,
    });
    // a WELL just off the plaza centre — the town's daily gathering point (kept on dry ground)
    const wa = rng.next() * Math.PI * 2;
    const well = toLand(facts.geo, facts.pos.x + Math.cos(wa) * sz * 0.36, facts.pos.y + Math.sin(wa) * sz * 0.36);
    if (buildable(facts.geo, well.x, well.y)) {
      plan.items.push({
        kind: 'building',
        x: well.x, y: well.y,
        w: 0.05, h: 0.05, rot: 0, role: 'well', label: 'the town well', tone: 'plain',
      });
    }
    // MARKET STALLS ring a trading town's square — goods on display, the town at commerce
    if (tradey && s.wealth > 90) {
      const stalls = 3 + Math.min(4, Math.floor(s.wealth / 100));
      for (let i = 0; i < stalls; i++) {
        const a = (i / stalls) * Math.PI * 2 + rng.next() * 0.25;
        const x = facts.pos.x + Math.cos(a) * sz * 0.62, y = facts.pos.y + Math.sin(a) * sz * 0.62;
        if (!buildable(facts.geo, x, y)) continue; // a stall stands on the plaza cobbles, not the water
        plan.items.push({
          kind: 'building',
          x, y, w: 0.1, h: 0.07, rot: faceToward(x, y, facts.pos.x, facts.pos.y),
          role: 'stall', label: 'a market stall', tone: 'plain',
        });
      }
    }
  },
};

const CivicBuildings: LocalGenStep = {
  name: 'civic',
  run(facts, rng, plan) {
    const s = facts.settlement;
    const { geo, pos } = facts;
    const ctx = ctxOf.get(plan)!;
    const ruined = s.ruinedYear !== undefined;
    // the SEAT — a CITADEL on the highest, most defensible ground in reach (design/24 §8.4):
    // a lord raises the hall where the land itself helps hold it. Scan a ring of candidate
    // spots, take the highest that a footprint can claim; fall back near the square.
    if (s.leaderTitle) {
      let best: { x: number; y: number; e: number } | undefined;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const d = 0.4 + (k % 3) * 0.25;
        const x = pos.x + Math.cos(a) * d, y = pos.y + Math.sin(a) * d;
        if (!buildable(geo, x, y)) continue;
        const e = elevAt(geo, x, y) + hillinessAt(geo, x, y) * 0.02; // prefer high, steep ground
        if (!best || e > best.e) best = { x, y, e };
      }
      const seatA = rng.next() * Math.PI * 2; // rotation (kept in the stream for determinism)
      let sx = best?.x ?? pos.x + Math.cos(seatA) * 0.42;
      let sy = best?.y ?? pos.y + Math.sin(seatA) * 0.42;
      // keep the citadel clear of the plaza and any reserved lot — nudge outward until it claims
      const seatAway = Math.atan2(sy - pos.y, sx - pos.x) || seatA;
      for (let k = 0; k < 8; k++) {
        const tx = sx + Math.cos(seatAway) * k * 0.14, ty = sy + Math.sin(seatAway) * k * 0.14;
        if (buildable(geo, tx, ty) && claim(ctx, tx, ty, 0.24)) { sx = tx; sy = ty; break; }
      }
      plan.items.push({
        kind: 'building',
        x: sx, y: sy,
        w: 0.34, h: 0.26, rot: faceToward(sx, sy, pos.x, pos.y), // the hall addresses the town below it
        role: 'seat',
        label: ruined
          ? 'the fallen seat'
          : s.ruler ? `the seat of ${s.leaderTitle} ${s.ruler}` : `the ${s.leaderTitle}'s seat`,
        tone: ruined ? 'ruin' : 'grand',
        era: 'old',
        ref: !ruined && s.rulerId !== undefined ? { kind: 'figure', id: s.rulerId } : undefined,
      });
    }
    // the SHRINE — every people raises something to its patron. When the sim has
    // raised it as a real VENUE (L4), the building inspects that venue — every
    // wedding it has seen — rather than just the deity (one click deeper).
    if (s.patronDeity) {
      const venue = facts.venues?.find((v) => v.type === 'shrine');
      // the shrine fronts a main street a short way off the plaza, facing the square
      const a = ctx.streets.length ? ctx.streets[0].angle : rng.next() * Math.PI * 2;
      const spot = frontage(ctx, geo, pos.x, pos.y, a, 0.62, 0.18); // frontage claims the lot itself
      plan.items.push({
        kind: 'building',
        x: spot.x, y: spot.y,
        w: 0.22, h: 0.22, rot: spot.rot,
        role: 'shrine',
        label: venue?.name ?? `the shrine of ${s.patronDeity.name}`,
        tone: ruined ? 'ruin' : 'sacred',
        era: 'old',
        ref: venue ? { kind: 'venue', id: venue.id } : { kind: 'deity', id: s.patronDeity.id },
      });
    }
    // the TAVERN — the town's hearth, when the sim has raised one (L4)
    const tavern = facts.venues?.find((v) => v.type === 'tavern');
    if (tavern && !ruined) {
      // the tavern fronts a DIFFERENT main street than the shrine, also facing the square
      const a = ctx.streets.length > 1 ? ctx.streets[1].angle : (ctx.streets[0]?.angle ?? 0) + Math.PI;
      const spot = frontage(ctx, geo, pos.x, pos.y, a, 0.52, 0.16); // frontage claims the lot itself
      plan.items.push({
        kind: 'building',
        x: spot.x, y: spot.y,
        w: 0.26, h: 0.18, rot: spot.rot,
        role: 'tavern',
        label: `${tavern.name}${tavern.meaning ? ` — “${tavern.meaning}”` : ''} · the tavern`,
        tone: 'plain',
        ref: { kind: 'venue', id: tavern.id },
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
    // FORTUNES (design/28 §2): a declining town rots at its edges (derelict roofs, empty
    // lots); a thriving one raises fresh timber. Known households (the living) keep their roofs.
    const fort = ruined ? { fortune: 0, declining: false, prospering: false, atWar: false, deaths: 0 } : settlementFortunes(facts);
    const decay = fort.declining ? Math.min(0.5, 0.18 - fort.fortune * 0.32) : 0; // 0 … ~0.5 at the edge
    // ARCHITECTURE (design/28 §3): this people's building style — every dwelling wears it, so
    // the town reads as theirs and a foreign people's town reads apart.
    const archId = archStyleFor(settlement.cultureId).id;
    let budget = ctx.houses;
    const form = ctx.form;
    const spacing = 0.24 / form.packing; // dispersed folk spread out; a walled grid packs tight
    const baseOff = 0.15 / Math.sqrt(form.packing);
    // homes line the streets, densest near the square, thinning outward — and a house needs
    // dry, standable ground (the geography, not the plan, has the final word). Lots are laid
    // in a fixed order; the PARCEL gate (claim) keeps them from overlapping each other or the
    // civic buildings (design/24 §8.2), so back yards fall out of the spacing.
    // ROTATION DISCIPLINE (design/32 §6): half the difference between one people's village and
    // another's is rectilinearity, not ornament. A GRID people builds to the square — every
    // house squares to the compass, and the jitter that gives an organic town its charm is
    // exactly what stops a planned one reading as planned. An organic people keeps its wander.
    const disciplined = form.pattern === 'grid';
    const snap90 = (a: number) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    const jitter = disciplined ? 0 : 0.04;
    const lots: { x: number; y: number; rot: number; t: number }[] = [];
    for (const st of ctx.streets) {
      for (let t = spacing; t <= Math.min(st.reach, ctx.townRadius + 0.3); t += spacing) {
        // interpolate along the street polyline
        const f = Math.min(0.999, t / st.reach);
        const si = f * (st.pts.length - 1);
        const i0 = Math.floor(si);
        const p0 = st.pts[i0];
        const p1 = st.pts[Math.min(st.pts.length - 1, i0 + 1)];
        const fx = si - i0;
        const px = p0.x + (p1.x - p0.x) * fx;
        const py = p0.y + (p1.y - p0.y) * fx;
        const rawTangent = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        // the house squares to the street's DOMINANT run, not to every wobble in it
        const tangent = disciplined ? snap90(rawTangent) : rawTangent;
        for (const side of [-1, 1]) {
          // ALWAYS draw, then choose how to use it. Skipping a draw when disciplined would
          // shift the whole rng stream for grid towns — and everything downstream of Houses
          // (piers, boathouses, the drying racks beside them) would silently move with it.
          // A layout knob must change the layout, not the stream.
          const vary = rng.next();
          const off = baseOff + (disciplined ? 0.04 : vary * 0.08); // a planned people holds one set-back
          const lx = px + Math.cos(tangent + Math.PI / 2) * off * side;
          const ly = py + Math.sin(tangent + Math.PI / 2) * off * side;
          lots.push({ x: lx + (rng.next() - 0.5) * jitter, y: ly + (rng.next() - 0.5) * jitter, rot: tangent, t });
        }
      }
    }
    // near lots first (the town grew from its square), a lot only if the ground allows.
    // In the lived-in-full settlement, the KNOWN households take the roofs nearest the
    // square (both orders deterministic): hover a roof, meet the family; click, meet
    // its head. Roofs beyond the known families stay anonymous — the LOD made visible.
    lots.sort((a, b) => a.t - b.t);
    const households = facts.settlement.ruinedYear === undefined ? facts.households ?? [] : [];
    let nextHousehold = 0;
    for (const lot of lots) {
      if (budget <= 0) break;
      // graded buildable ground (§7.2): steep/boggy lots are cramped, the worst left empty
      const bild = buildability(geo, lot.x, lot.y);
      if (bild < 0.3) continue;
      // a fresh burn scar is a gap the town hasn't rebuilt yet (HistoryMarks)
      if (ctx.scars.some((sc) => (lot.x - sc.x) ** 2 + (lot.y - sc.y) ** 2 < sc.r * sc.r)) continue;
      // FORTUNES (design/28 §2): the anonymous EDGE of a shrinking town rots — empty lots and
      // derelict roofs — while the living (known households) keep their homes near the core.
      const anon = nextHousehold >= households.length;
      let derelict = false;
      if (decay > 0 && anon) {
        const edge = Math.min(1, lot.t / (ctx.townRadius * 1.05));
        if (rng.next() < decay * edge * 0.55) continue; // a lot the town no longer fills — empty
        derelict = rng.next() < decay * (0.35 + edge * 0.8);
      }
      // ZONING & AGE (§8.3): the wealthy raise walled COMPOUNDS in the weathered old core; the
      // dense heart packs ROW houses; the growing edge is plain new cots.
      const core = lot.t < ctx.townRadius * 0.55;
      const compound = !ruined && !derelict && wealthTier === 1 && core && rng.next() < 0.22;
      const shape: 'cot' | 'row' | 'compound' = compound ? 'compound' : core && form.pattern === 'grid' ? 'row' : 'cot';
      const fresh = fort.prospering && anon && lot.t > ctx.townRadius * 0.6; // a thriving town builds new at its edge
      const era: 'old' | 'new' | undefined = ruined || derelict ? undefined : lot.t < ctx.townRadius * 0.5 ? 'old' : lot.t > ctx.townRadius * 1.05 || fresh ? 'new' : undefined;
      const sizeBase = (0.11 + rng.next() * 0.06 + wealthTier * 0.03) * (0.72 + bild * 0.28) * (compound ? 1.5 : 1);
      const footR = Math.max(0.08, sizeBase * (compound ? 1.1 : 0.72));
      if (!claim(ctx, lot.x, lot.y, footR)) continue; // a neighbour already stands on this ground
      const hh = nextHousehold < households.length ? households[nextHousehold++] : undefined;
      plan.items.push({
        kind: 'building',
        x: lot.x, y: lot.y,
        w: sizeBase * (compound ? 1.2 : 1.1 + rng.next() * 0.5), h: sizeBase,
        rot: lot.rot,
        role: 'house',
        label: ruined
          ? 'a fallen roof'
          : derelict
            ? 'a derelict house — the town has pulled back to its heart'
            : hh
              ? `the ${hh.family} household — ${hh.members.map((m) => `${m.name} (${m.ageYears}y)`).join(' · ')}`
              : 'a household',
        tone: ruined || derelict ? 'ruin' : 'plain',
        era, shape,
        arch: ruined || derelict ? undefined : archId,
        derelict: derelict || undefined,
        ref: hh ? { kind: 'actor', id: hh.members[0].id } : undefined,
        inhabited: !!hh,
      });
      budget--;
    }
    // PROSPERITY (design/28 §2): fresh building underway — scaffolding rising on the edge.
    if (fort.prospering && !ruined) {
      const want = 1 + (settlement.population > 200 ? 1 : 0);
      let put = 0;
      for (let tries = 0; tries < 24 && put < want; tries++) {
        const a = rng.next() * Math.PI * 2, d = ctx.townRadius * (0.65 + rng.next() * 0.45);
        const x = facts.pos.x + Math.cos(a) * d, y = facts.pos.y + Math.sin(a) * d;
        if (!buildable(geo, x, y)) continue;
        if (!claim(ctx, x, y, 0.12)) continue;
        plan.items.push({ kind: 'building', x, y, w: 0.18, h: 0.14, rot: rng.next() * Math.PI, role: 'scaffold', label: 'a house rising — the town is growing', tone: 'plain', era: 'new' });
        put++;
      }
    }
  },
};

/** A BURIAL GROUND by the shrine (design/28 §2) — the dead the chronicle recorded, made
 *  ground. Rows of markers scaled by the town's age and its remembered deaths. Faith cue. */
const Graveyard: LocalGenStep = {
  name: 'graveyard',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const s = facts.settlement;
    if (s.ruinedYear !== undefined || !s.patronDeity || s.population < 60) return;
    const age = facts.currentYear - s.foundedYear;
    const fort = settlementFortunes(facts);
    const graves = Math.min(16, 2 + Math.floor(age / 22) + Math.min(8, fort.deaths));
    // sit the yard just outside the shrine (or, failing that, off the square), on the quiet edge
    const shrine = plan.items.find((it) => it.kind === 'building' && it.role === 'shrine') as PlanBuilding | undefined;
    const base = shrine ?? { x: facts.pos.x, y: facts.pos.y };
    // a clear patch near the shrine — spiral OUTWARD to the quieter edge until one is free
    let gx = base.x, gy = base.y, found = false;
    for (let tries = 0; tries < 48 && !found; tries++) {
      const a = rng.next() * Math.PI * 2, d = 0.24 + (tries / 48) * (ctx.townRadius * 0.8);
      const tx = base.x + Math.cos(a) * d, ty = base.y + Math.sin(a) * d;
      if (buildable(facts.geo, tx, ty) && claim(ctx, tx, ty, 0.15)) { gx = tx; gy = ty; found = true; }
    }
    if (!found) return;
    const rot = rng.next() * Math.PI * 2;
    const co = Math.cos(rot), si = Math.sin(rot);
    const cols = Math.max(2, Math.ceil(Math.sqrt(graves))), rowGap = 0.045, colGap = 0.05;
    for (let i = 0; i < graves; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const lx = (c - (cols - 1) / 2) * colGap, lz = (r - 0.5) * rowGap * 1.4;
      const x = gx + lx * co - lz * si, y = gy + lx * si + lz * co;
      if (!buildable(facts.geo, x, y)) continue;
      plan.items.push({ kind: 'building', x, y, w: 0.025, h: 0.03, rot, role: 'grave', label: 'a grave', tone: 'plain' });
    }
    // a low lychgate/marker at the yard head, inspecting the shrine's deity
    plan.items.push({ kind: 'building', x: gx, y: gy - 0.06 * co, w: 0.05, h: 0.04, rot, role: 'grave', label: `the burial ground of ${s.name}`, tone: 'sacred' });
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
          const tip = { x: sx + ox + Math.cos(wa) * (0.35 + rng.next() * 0.2), y: sy + oy + Math.sin(wa) * (0.35 + rng.next() * 0.2) };
          plan.items.push({
            kind: 'pier',
            pts: [
              { x: sx + ox - Math.cos(wa) * 0.15, y: sy + oy - Math.sin(wa) * 0.15 },
              tip,
            ],
            width: 0.05,
          });
          if (!ruined) {
            const bx = sx + ox - Math.cos(wa) * 0.28, by = sy + oy - Math.sin(wa) * 0.28;
            if (buildable(geo, bx, by) && claim(ctx, bx, by, 0.1)) { // a boathouse sits on the shore, not in the surf
              plan.items.push({
                kind: 'building',
                x: bx, y: by,
                w: 0.16, h: 0.12, rot: wa,
                role: 'boathouse', label: 'a boathouse', tone: 'plain',
              });
            }
            // DRYING RACKS on the shore beside the pier — the catch hung out to cure. Anchored
            // to the SHORE, not the boathouse: a cramped waterfront often has no room for a
            // boathouse, but a fishing town still dries its catch, so the cue must not vanish
            // with it. A rack is small and takes no parcel — it just needs dry, clear ground.
            // Search a small fan of spots rather than testing two and giving up: the waterfront
            // is the most contested ground in the town, and whether one exact point is free is
            // an accident of how the houses happened to fall. (It is: a layout change upstream
            // put a roof on the old spot and the racks silently vanished.)
            const rackA = wa + Math.PI / 2;
            let racked = false;
            for (const back of [0, 0.06, 0.12]) { // step landward, away from the crowded shore
              for (const side of [1, -1]) {
                for (const out of [0.13, 0.18, 0.09]) {
                  const rx = bx + Math.cos(rackA) * out * side - Math.cos(wa) * back;
                  const ry = by + Math.sin(rackA) * out * side - Math.sin(wa) * back;
                  if (!buildable(geo, rx, ry) || occupied(ctx, rx, ry, 0.03)) continue;
                  plan.items.push({ kind: 'prop', x: rx, y: ry, rot: wa, propKind: 'rack', label: 'drying racks — the catch hung out to cure' });
                  racked = true;
                  break;
                }
                if (racked) break;
              }
              if (racked) break;
            }
            // a BOAT moored at the pier's tip — the fleet at rest, not out on the water
            plan.items.push({ kind: 'prop', x: tip.x, y: tip.y, rot: wa + Math.PI / 2, propKind: 'boat', label: 'a boat moored at the pier' });
          }
        }
      }
    }

    if (/herd|pastur|ranch|nomad/.test(spec) && !ruined) {
      // LIVESTOCK grazing a paddock beyond the houses — a herding people's wealth on the hoof
      const herds = 1 + Math.min(2, Math.floor(settlement.population / 130));
      for (let h = 0; h < herds; h++) {
        const a = rng.next() * Math.PI * 2, d = ctx.townRadius + 0.4 + rng.next() * 1.2;
        const cx = pos.x + Math.cos(a) * d, cy = pos.y + Math.sin(a) * d;
        if (!buildable(geo, cx, cy)) continue;
        const count = 4 + Math.floor(rng.next() * 5);
        for (let i = 0; i < count; i++) {
          const lx = cx + (rng.next() - 0.5) * 0.5, ly = cy + (rng.next() - 0.5) * 0.5;
          if (!buildable(geo, lx, ly) || occupied(ctx, lx, ly, 0.03)) continue;
          plan.items.push({ kind: 'prop', x: lx, y: ly, rot: rng.next() * Math.PI * 2, propKind: 'livestock', label: 'grazing stock' });
        }
      }
    }

    if (/farm|plant|grain|herd|pasture|orchard|vine/.test(spec) || settlement.population >= 120) {
      // WHAT the fields grow (design/28 §5) — the specialization sets a town's INTENT (a
      // vineyard plants vines, an orchard fruit trees), but grain-vs-PADDY is read from each
      // PLOT'S OWN ground: a paddy is a flooded rice field, so it only stands where that patch
      // is genuinely wet, low, flat AND fertile — never on dry or barren land.
      const isVine = /vine|grape|wine|vineyard/.test(spec);
      const isOrchard = /orchard|fruit|olive|apple|cider|grove/.test(spec);
      const sowsGrain = /farm|plant|grain|rice|paddy/.test(spec); // a cereal-growing people
      const riceCulture = /rice|paddy/.test(spec); // rice-growers flood ground others wouldn't
      // FIELDS past the town's edge — strip-plots on the flat, but TERRACES banded across a
      // slope (design/24 §8.3): the land dictates how a people works it.
      const n = ruined ? 2 : 4 + Math.min(8, Math.floor(settlement.population / 60));
      let placed = 0;
      for (let tries = 0; tries < 60 && placed < n; tries++) {
        const a = rng.next() * Math.PI * 2;
        const d = ctx.townRadius + 0.5 + rng.next() * 1.6;
        const fx = pos.x + Math.cos(a) * d;
        const fy = pos.y + Math.sin(a) * d;
        if (!buildable(geo, fx, fy)) continue;
        const sloped = hillinessAt(geo, fx, fy) >= HILL_HILLS;
        // this plot's ground decides paddy vs dry grain
        const wet = moistureAt(geo, fx, fy) > 0.6, low = elevAt(geo, fx, fy) < geo.seaLevel + 0.14;
        const fertile = fertilityAt(geo, fx, fy) > (riceCulture ? 0.45 : 0.55);
        const paddyHere = !sloped && low && wet && fertile;
        const crop: CropKind = isVine ? 'vine' : sowsGrain || settlement.population >= 120 ? (paddyHere ? 'paddy' : 'grain') : 'plain';
        const fw = 0.55 + rng.next() * 0.4, fh = (sloped ? 0.22 : 0.32) + rng.next() * 0.2;
        const frot = a + Math.PI / 2 + (rng.next() - 0.5) * 0.3;
        plan.items.push({
          kind: sloped ? 'terrace' : 'field',
          x: fx, y: fy,
          w: fw, h: fh,
          rot: frot,
          crop,
          label: ruined ? 'fields gone to seed' : crop === 'vine' ? 'vineyard rows' : crop === 'paddy' ? 'flooded paddies' : sloped ? 'terraced fields' : 'worked fields',
        });
        // turned SOIL under the plot (design/32 §3) — dark worked earth painted into the
        // ground beneath the translucent field glyph. A ruin's plots have grassed over.
        if (!ruined) {
          plan.items.push({
            kind: 'ground', surface: 'soil',
            x: fx, y: fy, w: fw + 0.05, h: fh + 0.05, rot: frot,
            tone: [97, 78, 54], speckle: 0.22, blend: 0.5,
          });
        }
        placed++;
      }
      // ORCHARDS/VINEYARDS as TREES IN ROWS (design/28 §5) — a fruit or vine town plants a
      // regular grid, unmistakable from the scattered wild wood. Two or three tidy plots.
      if (!ruined && (isOrchard || isVine)) {
        const plots = 1 + Math.min(2, Math.floor(settlement.population / 140));
        for (let p = 0; p < plots; p++) {
          const a = rng.next() * Math.PI * 2, d = ctx.townRadius + 0.6 + rng.next() * 1.6;
          const ox = pos.x + Math.cos(a) * d, oy = pos.y + Math.sin(a) * d;
          if (!buildable(geo, ox, oy)) continue;
          const rot = a + (rng.next() - 0.5) * 0.4, cs = Math.cos(rot), sn = Math.sin(rot);
          const gap = isVine ? 0.16 : 0.22, rows = 4, cols = 5;
          const { tone } = treeTone(geo, ox, oy, moistureAt(geo, ox, oy));
          for (let r0 = 0; r0 < rows; r0++) {
            for (let c0 = 0; c0 < cols; c0++) {
              const lx = (c0 - (cols - 1) / 2) * gap, lz = (r0 - (rows - 1) / 2) * gap;
              const tx = ox + lx * cs - lz * sn, ty = oy + lx * sn + lz * cs;
              if (!buildable(geo, tx, ty) || occupied(ctx, tx, ty, 0.05)) continue;
              plan.items.push({ kind: 'tree', x: tx, y: ty, r: isVine ? 0.045 : 0.07, tone, form: isVine ? 'scrub' : 'orchard' });
            }
          }
        }
      }
      // a WATER-MILL where a brisk river runs by (design/24 §8.3, cellFlowSpeed) — the town
      // sets its wheel on the fast water, not a still pool.
      if (!ruined) {
        const rd = towardWater(geo, pos.x, pos.y, ctx.townRadius + 2, [WATER_RIVER]);
        if (rd !== undefined) {
          let bx = pos.x, by = pos.y;
          for (let d = 0; d < ctx.townRadius + 2; d += 0.15) {
            const tx = pos.x + Math.cos(rd) * d, ty = pos.y + Math.sin(rd) * d;
            if (!buildable(geo, tx, ty)) break;
            bx = tx; by = ty;
          }
          if (flowSpeedAt(geo, bx + Math.cos(rd) * 0.25, by + Math.sin(rd) * 0.25) > 0 && claim(ctx, bx, by, 0.13)) {
            plan.items.push({
              kind: 'building',
              x: bx, y: by, w: 0.2, h: 0.15, rot: rd + Math.PI / 2,
              role: 'mill', label: 'a water-mill', tone: 'plain',
            });
          }
        }
      }
      // a GRANARY at the town's edge, hard by the fields — the harvest stored (farm-town variety)
      if (!ruined && settlement.population >= 120) {
        for (let tries = 0; tries < 12; tries++) {
          const a = rng.next() * Math.PI * 2;
          const d = ctx.townRadius * 0.7 + rng.next() * 0.35;
          const gx = pos.x + Math.cos(a) * d, gy = pos.y + Math.sin(a) * d;
          if (!buildable(geo, gx, gy)) continue;
          if (!claim(ctx, gx, gy, 0.15)) continue;
          plan.items.push({
            kind: 'building',
            x: gx, y: gy, w: 0.24, h: 0.16, rot: faceToward(gx, gy, pos.x, pos.y),
            role: 'granary', label: 'the granary', tone: 'plain',
          });
          break;
        }
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
      // a CRAFT QUARTER: line the workshops (and a warehouse) along ONE lane near the square,
      // each parallel to the street — a legible maker's row, not scattered sheds (design/27).
      const n = 2 + Math.min(4, Math.floor(settlement.wealth / 110));
      const lane = ctx.streets[Math.min(2, ctx.streets.length - 1)] ?? ctx.streets[0];
      for (let i = 0; i < n; i++) {
        const isWarehouse = i === 0; // the warehouse anchors the quarter
        for (let tries = 0; tries < 10; tries++) {
          // walk out along the lane, workshops alternating sides of the street
          const t = Math.min(0.95, 0.28 + i * 0.13 + tries * 0.05);
          const idx = lane ? Math.max(1, Math.min(lane.pts.length - 1, Math.round(t * (lane.pts.length - 1)))) : 0;
          const seg = lane ? lane.pts[idx] : pos;
          const prev = lane ? lane.pts[idx - 1] : pos;
          const tang = Math.atan2(seg.y - prev.y, seg.x - prev.x);
          const side = i % 2 === 0 ? 1 : -1;
          const off = 0.15 + tries * 0.025;
          const wx = seg.x + Math.cos(tang + Math.PI / 2) * off * side;
          const wy = seg.y + Math.sin(tang + Math.PI / 2) * off * side;
          if (!buildable(geo, wx, wy)) continue;
          if (!claim(ctx, wx, wy, 0.13)) continue;
          plan.items.push({
            kind: 'building',
            x: wx, y: wy,
            w: isWarehouse ? 0.24 : 0.2, h: isWarehouse ? 0.17 : 0.15,
            rot: tang, // ranged along the lane, addressing the street
            role: isWarehouse ? 'warehouse' : 'workshop',
            label: isWarehouse ? 'the warehouse' : 'a workshop',
            tone: 'plain',
          });
          break;
        }
      }
    }
  },
};

const Palisade: LocalGenStep = {
  name: 'palisade',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const s = facts.settlement;
    // a town that is governed and grown walls itself; gates open where the streets run.
    // A town AT WAR walls at a lower threshold — a threat concentrates the mind (design/28 §2).
    const fort = settlementFortunes(facts);
    const wallPop = fort.atWar ? 130 : 220;
    if (s.ruinedYear !== undefined || s.population < wallPop || !s.leaderTitle) return;
    const wallW = fort.atWar ? 0.06 : 0.045; // a threatened town raises a heavier wall
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
    for (const seg of segs) plan.items.push({ kind: 'wall', pts: seg, width: wallW });
    // WATCHTOWERS at the gates when the town stands to arms (design/28 §2)
    if (fort.atWar) {
      for (const g of gateAngles) {
        const x = facts.pos.x + Math.cos(g) * r, y = facts.pos.y + Math.sin(g) * r;
        if (!buildable(facts.geo, x, y)) continue;
        if (!claim(ctx, x, y, 0.08)) continue;
        plan.items.push({ kind: 'building', x, y, w: 0.12, h: 0.12, rot: faceToward(x, y, facts.pos.x, facts.pos.y), role: 'watchtower', label: 'a watchtower — the town stands to arms', tone: 'grand' });
      }
    }
  },
};

/** the tree SILHOUETTE a biome grows (design/28 §5) — cold forests are conifers, the jungle
 *  is palms, dryland is low scrub, everything temperate is round broadleaf. Pack vocabulary:
 *  a sci-fi pack would map its biomes to its own forms. */
function treeFormFor(biomeId: string): TreeForm {
  if (biomeId === 'taiga' || biomeId === 'alpine') return 'conifer';
  if (biomeId === 'jungle') return 'palm';
  if (biomeId === 'desert' || biomeId === 'steppe' || biomeId === 'tundra' || biomeId === 'savanna') return 'scrub';
  return 'broadleaf'; // grassland, woodland, wetland
}

/** the biome tone a tree takes — its foliage darkened from the land colour so canopy reads
 *  against ground. Shared by wild trees, orchards and reeds. */
function treeTone(geo: Geography, x: number, y: number, m: number): { tone: string; biomeId: string } {
  const b = biomeOf({ temperature: temperatureAt(geo, x, y), moisture: m, elevation: elevAt(geo, x, y) });
  const c = b.color;
  return { tone: `rgb(${Math.round(c[0] * 0.5)}, ${Math.round(c[1] * 0.62)}, ${Math.round(c[2] * 0.46)})`, biomeId: b.id };
}

const TreesAndRuin: LocalGenStep = {
  name: 'trees',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { geo, pos, settlement } = facts;
    const ruined = settlement.ruinedYear !== undefined;
    // the countryside: tree cover follows real moisture, and each tree takes its BIOME's
    // hue AND silhouette (design/24 §8.4, design/28 §5) — pointed conifers in the taiga,
    // round broadleaf in the woodland, palms in the jungle, low scrub at a desert oasis —
    // so the land around a town reads as its true climate.
    const n = 160;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = (ruined ? 0.2 : ctx.townRadius * 0.9) + rng.next() * (5 - ctx.townRadius);
      const tx = pos.x + Math.cos(a) * d;
      const ty = pos.y + Math.sin(a) * d;
      if (!buildable(geo, tx, ty)) continue;
      const m = moistureAt(geo, tx, ty);
      if (rng.next() > m * 0.85) continue; // dry land is open land
      const r = (0.03 + rng.next() * 0.035) * (0.7 + m * 0.5);
      if (occupied(ctx, tx, ty, r + 0.04)) continue; // no tree grows up through a roof or wall
      const { tone, biomeId } = treeTone(geo, tx, ty, m);
      plan.items.push({ kind: 'tree', x: tx, y: ty, r, tone, form: treeFormFor(biomeId) });
    }
    // REEDS at the water's edge (design/28 §5) — tufts on the wet margin where land meets a
    // river or the shallows, so a shoreline reads as living, not a bare line. Only where the
    // ground is genuinely damp (moist land / marsh), never on a dry desert coast.
    if (!ruined) {
      const reeds = 26;
      for (let i = 0; i < reeds; i++) {
        const a = rng.next() * Math.PI * 2;
        const d = ctx.townRadius * 0.7 + rng.next() * 3;
        const rx = pos.x + Math.cos(a) * d, ry = pos.y + Math.sin(a) * d;
        if (!buildable(geo, rx, ry)) continue; // stand on the bank, not in open water
        if (moistureAt(geo, rx, ry) < 0.5) continue; // reeds want a wet margin
        // is open water within a step? (a true shore, not the dry interior)
        let shore = false;
        for (let k = 0; k < 6 && !shore; k++) {
          const wa = (k / 6) * Math.PI * 2;
          if (waterAt(geo, rx + Math.cos(wa) * 0.18, ry + Math.sin(wa) * 0.18) !== 0) shore = true;
        }
        if (!shore) continue;
        if (occupied(ctx, rx, ry, 0.06)) continue;
        plan.items.push({ kind: 'tree', x: rx, y: ry, r: 0.05 + rng.next() * 0.03, tone: 'rgb(96, 116, 66)', form: 'reed' });
      }
    }
    if (ruined) {
      // rubble where the town square was, and the years written in scattered stone
      const decades = Math.max(1, Math.floor((facts.currentYear - settlement.ruinedYear!) / 10));
      for (let i = 0; i < Math.min(8, 2 + decades); i++) {
        const a = rng.next() * Math.PI * 2;
        const d = rng.next() * ctx.townRadius;
        const rx = pos.x + Math.cos(a) * d, ry = pos.y + Math.sin(a) * d;
        const rw = 0.14 + rng.next() * 0.16, rh = 0.1 + rng.next() * 0.1, rrot = rng.next() * Math.PI;
        if (!buildable(geo, rx, ry)) continue; // rubble lies on the old town ground, not the water
        plan.items.push({ kind: 'rubble', x: rx, y: ry, w: rw, h: rh, rot: rrot });
      }
    }
  },
};

/**
 * WEAR (design/24 §7.2) — traffic packs the earth. A trodden band underlies every street,
 * widest on the through-roads where feet fall most; a ruin's paths have healed back to
 * grass. Derived from where movement actually concentrates (the streets the plan already
 * laid), so a desire-path reads as legible cause→effect — nothing stored, no RNG. Runs
 * right after the streets so it sits BENEATH the roads, buildings and marks drawn over it.
 */
const Wear: LocalGenStep = {
  name: 'wear',
  run(facts, _rng, plan) {
    const ctx = ctxOf.get(plan)!;
    if (facts.settlement.ruinedYear !== undefined) return;
    for (const st of ctx.streets) {
      if (st.pts.length < 2) continue;
      // main roads (the longer reaches) wear a wider apron than minor lanes
      const width = 0.11 + Math.min(0.09, st.reach * 0.03);
      plan.items.push({ kind: 'packed', pts: st.pts, width });
    }
  },
};

/**
 * GROUND SURFACES (design/32 §3) — the town's floor, read from facts the plan already has:
 * packed earth under the whole built town (feet, carts and stock strip the grass), and a
 * cobbled core where wealth has paved the market heart. Turned field soil is laid by
 * Livelihood beside each plot. DRAWS NO RNG — inserting it must not reshuffle any town.
 * A ruin lays nothing: its ground has healed back to country.
 */
const Grounds: LocalGenStep = {
  name: 'grounds',
  run(facts, _rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const s = facts.settlement;
    if (s.ruinedYear !== undefined) return;
    plan.items.push({
      kind: 'ground', surface: 'packed',
      x: facts.pos.x, y: facts.pos.y, r: ctx.townRadius * 0.85,
      tone: [134, 110, 78], blend: 0.5,
    });
    if (s.wealth > 200 && s.population >= 120) {
      plan.items.push({
        kind: 'ground', surface: 'cobble',
        x: facts.pos.x, y: facts.pos.y, r: ctx.townRadius * 0.4,
        tone: [128, 122, 112], speckle: 0.55, blend: 0.66,
      });
    }
  },
};

/** INHABITANTS (design/27 §3) — scatter static figures so the town reads as peopled:
 *  folk in the yards of the lived-in houses, hands at the workshops/piers/fields, and a
 *  little knot around the market square. Derived from what the plan already placed;
 *  runs LAST so its RNG draws perturb nothing before it. A ruin stays empty. */
const Inhabitants: LocalGenStep = {
  name: 'inhabitants',
  run(facts, rng, plan) {
    if (facts.settlement.ruinedYear !== undefined) return;
    const CAP = 40; // a city shouldn't become a crowd of dots
    let placed = 0;
    const add = (x: number, y: number, tone: PlanPerson['tone'], facing: number, ref?: EventRef, label?: string) => {
      if (placed >= CAP) return;
      if (!buildable(facts.geo, x, y)) return; // no one stands out on the open water
      plan.items.push({ kind: 'person', x, y, tone, facing, ref, label });
      placed++;
    };
    const byHead = new Map<number, HouseholdView>();
    for (const hh of facts.households ?? []) byHead.set(hh.members[0].id, hh);

    // snapshot the placed structures first (we push persons as we go, so iterate a copy)
    const structures = plan.items.slice();

    // 1) AT HOME — folk in the doorway/yard of each inhabited house
    for (const it of structures) {
      if (placed >= CAP) break;
      if (it.kind !== 'building' || it.role !== 'house' || !it.inhabited) continue;
      const hh = it.ref?.kind === 'actor' ? byHead.get(it.ref.id) : undefined;
      const members = hh?.members ?? [];
      const doorA = it.rot + Math.PI / 2; // out the long side
      const n = members.length ? Math.min(3, members.length) : 1;
      for (let k = 0; k < n; k++) {
        const m = members[k];
        const off = it.h * 0.55 + 0.04 + rng.next() * 0.03;
        const spread = (k - (n - 1) / 2) * 0.06;
        const px = it.x + Math.cos(doorA) * off + Math.cos(it.rot) * spread;
        const py = it.y + Math.sin(doorA) * off + Math.sin(it.rot) * spread;
        const head = k === 0 && !!m;
        add(px, py, m?.role === 'child' ? 'child' : head ? 'notable' : 'folk', doorA + Math.PI,
          head ? { kind: 'actor', id: m.id } : undefined,
          m ? `${m.name}${m.profession ? `, ${m.profession}` : ''}` : undefined);
      }
    }

    // 2) AT WORK — a hand at each livelihood building, the pier's end, and in the fields
    for (const it of structures) {
      if (placed >= CAP) break;
      if (it.kind === 'building' && (it.role === 'workshop' || it.role === 'mill' || it.role === 'minehead' || it.role === 'boathouse')) {
        const a = it.rot - Math.PI / 2;
        add(it.x + Math.cos(a) * (it.h * 0.6 + 0.04), it.y + Math.sin(a) * (it.h * 0.6 + 0.04), 'folk', a + Math.PI);
      } else if (it.kind === 'pier' && it.pts.length) {
        // a fisher at the FOOT of the pier (on the shore), gazing out along it to the water
        const foot = it.pts[0], tip = it.pts[it.pts.length - 1];
        const landward = Math.atan2(foot.y - tip.y, foot.x - tip.x);
        add(foot.x + Math.cos(landward) * 0.04, foot.y + Math.sin(landward) * 0.04, 'folk', Math.atan2(tip.y - foot.y, tip.x - foot.x));
      } else if (it.kind === 'field' || it.kind === 'terrace') {
        add(it.x + (rng.next() - 0.5) * it.w * 0.5, it.y + (rng.next() - 0.5) * it.h * 0.5, 'folk', rng.next() * Math.PI * 2);
      }
    }

    // 3) AT THE SQUARE — a small knot of folk facing in, the public heart occupied
    const square = structures.find((p) => p.kind === 'square') as PlanPatch | undefined;
    if (square) {
      const crowd = Math.min(6, 2 + Math.floor(facts.settlement.population / 120));
      for (let i = 0; i < crowd; i++) {
        const ang = (i / crowd) * Math.PI * 2 + rng.next() * 0.3;
        const rad = square.w * 0.26 + rng.next() * square.w * 0.12;
        add(square.x + Math.cos(ang) * rad, square.y + Math.sin(ang) * rad, 'folk', ang + Math.PI);
      }
    }
  },
};

/** GATHERINGS rendered (design/27 §4, design/28 §4.3): a wedding/funeral/feast/rite that
 *  happened THIS YEAR draws its crowd at the venue it was actually held — drawing what the
 *  sim already simulated, nothing new tracked. A funeral's crowd mourns; the rest revel. */
const Gatherings: LocalGenStep = {
  name: 'gatherings',
  run(facts, rng, plan) {
    if (facts.settlement.ruinedYear !== undefined) return;
    const gatherings = facts.gatherings;
    if (!gatherings || gatherings.length === 0) return;
    const structures = plan.items;
    for (const g of gatherings) {
      if (g.venueId === undefined) continue;
      const venue = structures.find((it): it is PlanBuilding | PlanPatch =>
        (it.kind === 'building' || it.kind === 'square') && it.ref?.kind === 'venue' && it.ref.id === g.venueId);
      if (!venue) continue;
      const mourning = g.kind === 'funeral';
      const tone: PlanPerson['tone'] = mourning ? 'mourner' : 'reveller';
      const crowd = 4 + Math.floor(rng.next() * 5);
      for (let i = 0; i < crowd; i++) {
        const ang = (i / crowd) * Math.PI * 2 + rng.next() * 0.3;
        const rad = venue.w * 0.3 + rng.next() * venue.w * 0.15;
        const px = venue.x + Math.cos(ang) * rad, py = venue.y + Math.sin(ang) * rad;
        if (!buildable(facts.geo, px, py)) continue;
        plan.items.push({
          kind: 'person', x: px, y: py, tone, facing: ang + Math.PI,
          label: mourning ? 'a mourner, come to grieve' : 'a reveller, come to celebrate',
        });
      }
    }
  },
};

/** TERRACES (design/32 §6) — the `claim()` circle-parcel model produces detached scatter; a real
 *  dense core reads as CLUSTERS. This is a fold over the plan, not a new placement pass: it finds
 *  runs of `row` houses that already line the same lane at the same angle and pulls them into
 *  contact, so they share walls instead of each keeping a polite gap. Every house stays its own
 *  item — its household, its label, its lit window are untouched — which is why this is a nudge
 *  and not a merge: merging the footprints would merge the families with them. */
const Terraces: LocalGenStep = {
  name: 'terraces',
  run(facts, _rng, plan) {
    if (facts.settlement.ruinedYear !== undefined) return;
    const rows = plan.items.filter((i): i is PlanBuilding => i.kind === 'building' && i.role === 'house' && i.shape === 'row' && !i.derelict);
    if (rows.length < 2) return;
    // Group by the line they front: same heading, then same offset across it. The `across`
    // grouping CLUSTERS BY TOLERANCE rather than rounding into fixed buckets — with buckets,
    // two neighbours a hair apart can fall either side of an edge and never be compared, which
    // is exactly the pair a terrace is made of.
    const head = (b: PlanBuilding) => ((b.rot % Math.PI) + Math.PI) % Math.PI; // mod a half-turn
    const byHead = new Map<number, PlanBuilding[]>();
    for (const b of rows) {
      const k = Math.round(head(b) / 0.15);
      let g = byHead.get(k);
      if (!g) byHead.set(k, (g = []));
      g.push(b);
    }
    const runs: PlanBuilding[][] = [];
    for (const group of byHead.values()) {
      const a = head(group[0]);
      const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
      const across = (b: PlanBuilding) => b.x * nx + b.y * ny;
      group.sort((p, q) => across(p) - across(q));
      let cur: PlanBuilding[] = [];
      for (const b of group) {
        if (cur.length && Math.abs(across(b) - across(cur[cur.length - 1])) > 0.07) { runs.push(cur); cur = []; }
        cur.push(b);
      }
      if (cur.length) runs.push(cur);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      // one heading for the whole run — a house at rot π and one at rot 0 front the same line
      const a = head(run[0]);
      const ux = Math.cos(a), uy = Math.sin(a); // along the terrace
      run.sort((p, q) => (p.x * ux + p.y * uy) - (q.x * ux + q.y * uy));
      // walk the run, seating each house against its neighbour's wall
      for (let i = 1; i < run.length; i++) {
        const prev = run[i - 1], cur = run[i];
        const along = (p: PlanBuilding) => p.x * ux + p.y * uy;
        const want = along(prev) + prev.w * 0.5 + cur.w * 0.5; // touching, wall to wall
        const gap = along(cur) - want;
        // The tolerance has to match the gap the pipeline ACTUALLY leaves, which is ~0.16–0.20:
        // `claim()`'s footprint radius is wider than half the lot spacing, so the parcel gate
        // rejects every other lot along a street. That rejection is precisely the detached
        // scatter this fold exists to undo — so the reach must clear it, while still refusing
        // the half-unit gaps that mean two genuinely separate rows.
        if (gap <= 0 || gap > 0.24) continue;
        cur.x -= ux * gap;
        cur.y -= uy * gap;
      }
    }
  },
};

/** DISTRICT WALLS (design/32 §6) — the town already ZONES (a craft row, a burial ground beside
 *  the shrine) without ENCLOSING, and enclosure is what makes a zone legible at a glance. A
 *  shrine keeps its precinct; a lord's seat keeps its bailey. Low walls, drawn lighter than the
 *  town's own palisade — a boundary, not a defence. */
const Districts: LocalGenStep = {
  name: 'districts',
  run(facts, rng, plan) {
    const s = facts.settlement;
    if (s.ruinedYear !== undefined) return;
    const ring = (b: PlanBuilding, r: number, label: string) => {
      const pts: { x: number; y: number }[] = [];
      const SEG = 22;
      // the gate faces the town centre, so the precinct opens toward the people it serves
      const toC = Math.atan2(facts.pos.y - b.y, facts.pos.x - b.x);
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const d = Math.abs(((a - toC + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < 0.42) { // the gateway gap
          if (pts.length > 2) plan.items.push({ kind: 'precinct', pts: [...pts], width: 0.022, label });
          pts.length = 0;
          continue;
        }
        const px = b.x + Math.cos(a) * r * (1 + (rng.next() - 0.5) * 0.04);
        const py = b.y + Math.sin(a) * r * (1 + (rng.next() - 0.5) * 0.04);
        if (!buildable(facts.geo, px, py)) { // never wall out over the water
          if (pts.length > 2) plan.items.push({ kind: 'precinct', pts: [...pts], width: 0.022, label });
          pts.length = 0;
          continue;
        }
        pts.push({ x: px, y: py });
      }
      if (pts.length > 2) plan.items.push({ kind: 'precinct', pts, width: 0.022, label });
    };
    const shrine = plan.items.find((i): i is PlanBuilding => i.kind === 'building' && i.role === 'shrine');
    if (shrine) ring(shrine, Math.max(shrine.w, shrine.h) * 1.35, s.patronDeity ? `the precinct of ${s.patronDeity.name}` : 'the shrine precinct');
    const seat = plan.items.find((i): i is PlanBuilding => i.kind === 'building' && i.role === 'seat' && i.tone !== 'ruin');
    if (seat) ring(seat, Math.max(seat.w, seat.h) * 1.3, s.ruler ? `the bailey of ${s.leaderTitle} ${s.ruler}` : 'the bailey');
  },
};

/** CLUTTER (design/32 §5) — the props that say *someone works here*. Every one is read off a
 *  building the pipeline already placed plus the town's own livelihood: a woodpile and cart by
 *  the homes of a farming people, a coal heap at the smith's workshop, cargo stacked on the
 *  piers. (The livestock/boats/racks of design/28 §4.2 already cover the herder and fisher; this
 *  fills the gap for everyone else.) Runs after Livelihood so the workshops and piers exist. */
const Clutter: LocalGenStep = {
  name: 'clutter',
  run(facts, rng, plan) {
    const ctx = ctxOf.get(plan)!;
    const { geo, settlement } = facts;
    if (settlement.ruinedYear !== undefined) return;
    const spec = settlement.specialization.toLowerCase();
    const farming = /farm|plant|grain|orchard|vine|rice|paddy/.test(spec);
    const smithy = /smith|forge|iron|ore|mine/.test(spec);
    const structures = plan.items.slice();
    let put = 0;
    const CAP = 30; // clutter is seasoning; a town buried in woodpiles reads as a junkyard
    /** `onDeck` props ride a structure that is ITSELF over water (a pier's boards), so they are
     *  exempt from the dry-ground gate every other prop passes. */
    const add = (x: number, y: number, rot: number, propKind: PlanProp['propKind'], label: string, scale?: number, onDeck = false) => {
      if (put >= CAP) return;
      if (!onDeck && !buildable(geo, x, y)) return;
      plan.items.push({ kind: 'prop', x, y, rot, propKind, label, scale });
      put++;
    };
    // TWO PASSES, and the order is the point. The SIGNATURE clutter — cargo on the piers, coal
    // at the works — is what tells you what this town does, and there is only ever a handful of
    // it. The ambient house clutter is wallpaper and there are forty roofs of it. One shared cap
    // walked in document order let the wallpaper eat the whole budget before the piers were
    // reached (houses are laid before Livelihood), so a fishing town landed no cargo at all.
    // Characterful first; filler takes what's left.
    for (const it of structures) {
      if (put >= CAP) break;
      if (it.kind === 'building' && (it.role === 'workshop' || it.role === 'minehead') && smithy) {
        // a smithing/mining people raises a MINEHEAD, not a craft workshop — the coal belongs
        // wherever this town actually does its hot work.
        const a = it.rot - Math.PI / 2;
        add(it.x + Math.cos(a) * (it.h * 0.5 + 0.05), it.y + Math.sin(a) * (it.h * 0.5 + 0.05), a, 'coal', 'a coal heap — the smith’s fire', 0.7 + rng.next() * 0.4);
      } else if (it.kind === 'pier' && it.pts.length >= 2) {
        // cargo stacked ON the boards, near the landward end where a boat's load is put down.
        // It rides the pier, so it is over water by design — hence `onDeck`.
        const foot = it.pts[0], tip = it.pts[it.pts.length - 1];
        const along = Math.atan2(tip.y - foot.y, tip.x - foot.x);
        const perp = along + Math.PI / 2;
        for (let k = 0; k < 2; k++) {
          const t = 0.14 + k * 0.13;
          const cx2 = foot.x + (tip.x - foot.x) * t + Math.cos(perp) * 0.03;
          const cy2 = foot.y + (tip.y - foot.y) * t + Math.sin(perp) * 0.03;
          add(cx2, cy2, along, 'cargo', 'cargo landed from the boats', 0.75 + rng.next() * 0.4, true);
        }
      }
    }
    if (farming) {
      for (const it of structures) {
        if (put >= CAP) break;
        if (it.kind !== 'building' || it.role !== 'house' || it.derelict) continue;
        // NOT every house: a woodpile at each of forty roofs is wallpaper, not detail
        const side = it.rot + Math.PI / 2;
        if (rng.next() < 0.34) {
          add(it.x + Math.cos(it.rot) * (it.w * 0.5 + 0.03), it.y + Math.sin(it.rot) * (it.w * 0.5 + 0.03), it.rot, 'woodpile', 'a woodpile — the winter’s fuel', 0.7 + rng.next() * 0.5);
        }
        if (it.inhabited && rng.next() < 0.4) {
          add(it.x + Math.cos(side) * (it.h * 0.5 + 0.07), it.y + Math.sin(side) * (it.h * 0.5 + 0.07), side, 'cart', 'a cart', 0.8 + rng.next() * 0.4);
        }
      }
    }
    // BOULDERS in the countryside where the land is steep — the reference maps get half their
    // terrain character from stone, and ours varied only by tree. Never inside the town's lots.
    const rocks = 34;
    for (let i = 0; i < rocks; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = ctx.townRadius * 0.85 + rng.next() * 3.2;
      const bx = facts.pos.x + Math.cos(a) * d, by = facts.pos.y + Math.sin(a) * d;
      if (!buildable(geo, bx, by)) continue;
      if (hillinessAt(geo, bx, by) < HILL_HILLS) continue; // stone bares on steep ground, not lawns
      if (occupied(ctx, bx, by, 0.06)) continue;
      if (rng.next() > 0.55) continue;
      plan.items.push({ kind: 'prop', x: bx, y: by, rot: rng.next() * Math.PI, propKind: 'boulder', scale: 0.6 + rng.next() * 1.0 });
    }
  },
};

/** INTERIORS (design/32 §5) — what is under each roof, revealed when the view zooms past it.
 *  Every fitting is DERIVED from what the plan already knows: the beds are the household's own
 *  members (L2), the anvil is the workshop's function, the altar the shrine's. A dwelling with
 *  no known family gets a bare hearth — the LOD made visible, exactly as its dark roof already
 *  says. Runs after every building exists; draws no rng that anything before it depends on. */
const Interiors: LocalGenStep = {
  name: 'interiors',
  // rng-free on purpose: a fitting's place is fixed by its building and its household, so
  // furnishing the town draws nothing from the stream and perturbs nothing after it.
  run(facts, _rng, plan) {
    if (facts.settlement.ruinedYear !== undefined) return; // a ruin has no hearth
    const byHead = new Map<number, HouseholdView>();
    for (const hh of facts.households ?? []) byHead.set(hh.members[0].id, hh);
    let nextId = 0;
    // local (along-wall, across-wall) → world, so the renderer never has to know the rotation
    const place = (b: PlanBuilding, lx: number, lz: number): { x: number; y: number } => {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      return { x: b.x + lx * c - lz * s, y: b.y + lx * s + lz * c };
    };
    for (const it of plan.items.slice()) {
      if (it.kind !== 'building' || it.derelict) continue;
      const fits: { fitting: PlanInterior['fitting']; lx: number; lz: number; label?: string }[] = [];
      const hw = it.w * 0.5, hh = it.h * 0.5;
      if (it.role === 'house') {
        // the hearth sits against the back wall (the chimney end); the family's beds line the
        // other. A household of five beds five — the roster IS the furniture.
        fits.push({ fitting: 'hearth', lx: hw * 0.55, lz: -hh * 0.5, label: 'the hearth' });
        const hh2 = it.ref?.kind === 'actor' ? byHead.get(it.ref.id) : undefined;
        const beds = hh2 ? Math.min(4, hh2.members.length) : 0;
        for (let k = 0; k < beds; k++) {
          const m = hh2!.members[k];
          fits.push({ fitting: 'bed', lx: -hw * 0.55 + (k % 2) * hw * 0.5, lz: -hh * 0.45 + Math.floor(k / 2) * hh * 0.7, label: `${m.name}'s bed` });
        }
        if (hh2) fits.push({ fitting: 'table', lx: 0, lz: hh * 0.4, label: 'the table' });
      } else if (it.role === 'workshop' || it.role === 'minehead') {
        fits.push({ fitting: 'anvil', lx: 0, lz: -hh * 0.3, label: 'a workbench' });
        fits.push({ fitting: 'hearth', lx: hw * 0.5, lz: -hh * 0.45, label: 'the forge' });
      } else if (it.role === 'tavern') {
        fits.push({ fitting: 'hearth', lx: hw * 0.55, lz: -hh * 0.5, label: 'the tavern hearth' });
        for (let k = 0; k < 3; k++) fits.push({ fitting: 'bench', lx: -hw * 0.5 + k * hw * 0.5, lz: hh * 0.3, label: 'a bench' });
        fits.push({ fitting: 'cask', lx: -hw * 0.6, lz: -hh * 0.5, label: 'the casks' });
      } else if (it.role === 'shrine') {
        fits.push({ fitting: 'altar', lx: 0, lz: -hh * 0.45, label: facts.settlement.patronDeity ? `the altar of ${facts.settlement.patronDeity.name}` : 'the altar' });
      } else if (it.role === 'seat') {
        fits.push({ fitting: 'hearth', lx: hw * 0.6, lz: -hh * 0.5, label: 'the great hearth' });
        fits.push({ fitting: 'table', lx: 0, lz: 0, label: 'the high table' });
        for (let k = 0; k < 2; k++) fits.push({ fitting: 'bench', lx: -hw * 0.3 + k * hw * 0.6, lz: hh * 0.4, label: 'a bench' });
      } else if (it.role === 'granary' || it.role === 'warehouse') {
        for (let k = 0; k < 4; k++) fits.push({ fitting: 'sack', lx: -hw * 0.5 + (k % 2) * hw, lz: -hh * 0.4 + Math.floor(k / 2) * hh * 0.8, label: 'stores' });
      } else continue;
      if (fits.length === 0) continue;
      const id = nextId++;
      it.id = id;
      for (const f of fits) {
        const p = place(it, f.lx, f.lz);
        plan.items.push({ kind: 'interior', x: p.x, y: p.y, rot: it.rot, fitting: f.fitting, ofBuilding: id, label: f.label });
      }
    }
  },
};

/** The fantasy pack's pipeline, in order. A pack composes/replaces these (design/24 §3.3).
 *  HistoryMarks runs BEFORE Houses so fresh burn scars read as gaps, not overlays. */
export const LOCAL_GEN_STEPS: LocalGenStep[] = [
  TerrainStreets,
  Wear,
  Grounds, // draws no rng — the towns lay out exactly as they did before it existed
  MarketSquare,
  CivicBuildings,
  HistoryMarks,
  Houses,
  Livelihood,
  Graveyard, // after the shrine + houses exist; claims a clear plot beside the shrine
  Terraces, // a fold over the houses just laid — pulls the row cores into shared-wall runs
  Districts, // …then encloses the shrine/seat, once nothing will move again
  Palisade,
  TreesAndRuin,
  Clutter, // after every building/pier exists — its props hang off what the town actually has
  Interiors, // …and after Clutter, so furnishing a roof perturbs no yard around it
  Inhabitants, // draws no plan RNG that anything before it depends on
  Gatherings, // last — a crowd drawn from this year's own gathering events
];

/** Build the deterministic town plan for one settlement. Pure: same facts ⇒ same plan. */
export function buildLocalPlan(facts: LocalPlanFacts): LocalPlan {
  const plan: LocalPlan = { items: [], radius: 1 };
  const rng = new Rng(mixSeed(facts.seed, facts.settlement.id, 0x70c1));
  for (const step of LOCAL_GEN_STEPS) step.run(facts, rng, plan);
  return plan;
}
