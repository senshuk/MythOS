/**
 * Map BACKDROP renderers — PRESENTATION ONLY. They paint the world the SIMULATION
 * actually generated: `paintTerrain` renders the engine's `Geography` (the same
 * elevation/water/rivers/fertility the sim used to place settlements and drive the
 * economy), coloured by a pack `SurfaceTheme`. So the map and the simulation are the
 * same world. `paintStarfield` renders a space setting. The clickable settlement
 * overlay (the SVG) is shared on top — only the backdrop changes.
 */
import type { SurfaceTheme, StarfieldStyle, RGB } from '../content/mapstyles';
import { biomeOf } from '../content/biomes';
import { type Geography, WATER_SEA, WATER_LAKE, WATER_RIVER, GEO_MIN, GEO_SPAN, RIVER_FLUX, GREAT_RIVER_FLUX, REF_N, isLand, groundMoveCost, cellFlowSpeed } from '../engine/geography';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// -------------------------------------------------------------- roads --------

/** A generated route between two settlements, as an SVG path. `road` = an overland
 *  road (hugs valleys, avoids water); `sea` = the neighbours are across water, so the
 *  link is a shipping lane, drawn differently. */
export interface MapRoad {
  d: string; // svg path in map (world) coordinates
  kind: 'road' | 'sea';
  width: number;
}
interface RoadNode {
  id: number;
  x: number;
  y: number;
  ruined: boolean;
}
interface RoadEdge {
  a: number;
  b: number;
  relation: number;
  tradeVolume: number;
}

interface Pt {
  x: number;
  y: number;
}

// world coord ↔ grid cell (the geography's native resolution)
function cellOfWorld(geo: Geography, x: number, y: number): number {
  const N = geo.size;
  const gx = Math.max(0, Math.min(N - 1, Math.round(((x - GEO_MIN) / GEO_SPAN) * (N - 1))));
  const gy = Math.max(0, Math.min(N - 1, Math.round(((y - GEO_MIN) / GEO_SPAN) * (N - 1))));
  return gy * N + gx;
}
function worldOfCell(geo: Geography, ci: number): Pt {
  const N = geo.size;
  return { x: GEO_MIN + ((ci % N) / (N - 1)) * GEO_SPAN, y: GEO_MIN + (((ci / N) | 0) / (N - 1)) * GEO_SPAN };
}

/** Cost of routing a road through a cell: open water is near-impassable (a road detours
 *  around it or the link becomes a sea lane), high and steep ground is dear, boggy ground
 *  drags, and a river is forded at its shallows — so A* finds the natural pass/valley/
 *  coast route and crosses rivers where they run thin. Shares `groundMoveCost` with local
 *  pathing (design/24 §7.2); a road just adds the water-crossing terms on top. */
function cellRoadCost(geo: Geography, ci: number): number {
  const w = geo.water[ci];
  if (w === WATER_SEA) return 60;
  if (w === WATER_LAKE) return 45;
  if (w === WATER_RIVER) {
    // a ford: cheap over a trickle, dear over a torrent (the road seeks the narrows)
    return 3.5 + cellFlowSpeed(geo, ci) * 22 + geo.elevation[ci] * 3 + geo.hilliness[ci] * 1.6;
  }
  return groundMoveCost(geo, ci);
}

// A* scratch buffers, reused across searches (generation-stamped so we never clear N²).
let _bufN = 0;
let _g!: Float32Array;
let _stamp!: Int32Array;
let _from!: Int32Array;
let _gen = 0;
const NEI8_R = [[-1, -1, 1.414], [0, -1, 1], [1, -1, 1.414], [-1, 0, 1], [1, 0, 1], [-1, 1, 1.414], [0, 1, 1], [1, 1, 1.414]] as const;

/** Least-cost path (cell indices) from `start` to `goal` over the terrain cost field, or
 *  null if unreachable within the explore budget. 8-connected A* with a Euclidean heuristic. */
function aStarRoad(geo: Geography, start: number, goal: number): number[] | null {
  const N = geo.size;
  const NN = N * N;
  if (_bufN !== NN) {
    _g = new Float32Array(NN);
    _stamp = new Int32Array(NN);
    _from = new Int32Array(NN);
    _bufN = NN;
  }
  const gen = ++_gen;
  const gx1 = goal % N;
  const gy1 = (goal / N) | 0;
  const heur = (c: number) => Math.hypot((c % N) - gx1, ((c / N) | 0) - gy1);
  // a compact binary min-heap over (cell, f-score)
  const hc: number[] = [];
  const hp: number[] = [];
  const push = (cell: number, p: number) => {
    hc.push(cell);
    hp.push(p);
    let i = hc.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (hp[par] <= hp[i]) break;
      [hp[par], hp[i]] = [hp[i], hp[par]];
      [hc[par], hc[i]] = [hc[i], hc[par]];
      i = par;
    }
  };
  const pop = (): number => {
    const top = hc[0];
    const lc = hc.pop() as number;
    const lp = hp.pop() as number;
    if (hc.length) {
      hc[0] = lc;
      hp[0] = lp;
      let i = 0;
      const n = hc.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < n && hp[l] < hp[m]) m = l;
        if (r < n && hp[r] < hp[m]) m = r;
        if (m === i) break;
        [hp[m], hp[i]] = [hp[i], hp[m]];
        [hc[m], hc[i]] = [hc[i], hc[m]];
        i = m;
      }
    }
    return top;
  };

  _g[start] = 0;
  _stamp[start] = gen;
  _from[start] = -1;
  push(start, heur(start));
  let explored = 0;
  const CAP = 26000;
  while (hc.length && explored++ < CAP) {
    const cur = pop();
    if (cur === goal) break;
    const cx = cur % N;
    const cy = (cur / N) | 0;
    const gcur = _g[cur];
    for (const [dx, dy, w] of NEI8_R) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      const ng = gcur + cellRoadCost(geo, nk) * w;
      if (_stamp[nk] !== gen || ng < _g[nk]) {
        _g[nk] = ng;
        _stamp[nk] = gen;
        _from[nk] = cur;
        push(nk, ng + heur(nk));
      }
    }
  }
  if (_stamp[goal] !== gen) return null;
  const path: number[] = [];
  for (let c = goal; c !== -1; c = _from[c]) path.push(c);
  path.reverse();
  return path;
}

/** A Catmull-Rom spline through `pts` as an SVG cubic-bezier path — a flowing curve, not a
 *  jagged polyline. */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Route roads along the region graph (design: RimWorld draws roads between world
 * settlements). Each peaceful edge is a least-cost A* path over the terrain — so the road
 * threads the passes, hugs the valleys and runs along the coast rather than climbing
 * straight over ridges — then smoothed to a flowing curve. A pair mostly separated by
 * water becomes a gently-curved `sea` lane instead. Pure function of geography + node
 * positions (deterministic), computed once per snapshot, never stored.
 */
/** Road GEOMETRY per settlement pair — the A* course and the sea-lane test depend only
 *  on the immutable geography and the pair's fixed positions, so they are computed ONCE
 *  per world and reused across every snapshot (and shared by the world map AND the close
 *  view, which read the same cached Geography instance). Relations, ruins and trade
 *  volume stay per-call — a road opens, closes and thickens without re-pathing. */
const roadGeomCache = new WeakMap<Geography, Map<string, { kind: 'sea' | 'road'; d: string }>>();

function roadGeometry(geo: Geography, a: RoadNode, b: RoadNode): { kind: 'sea' | 'road'; d: string } {
  let perGeo = roadGeomCache.get(geo);
  if (!perGeo) {
    perGeo = new Map();
    roadGeomCache.set(geo, perGeo);
  }
  const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  const hit = perGeo.get(key);
  if (hit) return hit;

  let geom: { kind: 'sea' | 'road'; d: string };
  // is the pair mostly separated by open water? then it's a sea lane, not a road.
  let water = 0;
  const SEA_SAMPLES = 12;
  for (let s = 0; s <= SEA_SAMPLES; s++) {
    const t = s / SEA_SAMPLES;
    if (!isLand(geo, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) water++;
  }
  if (water / (SEA_SAMPLES + 1) > 0.42) {
    // a gently-bowed shipping lane (perpendicular midpoint offset), dashed when drawn
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(6, len * 0.12);
    const cx = mx + (-dy / len) * bow;
    const cy = my + (dx / len) * bow;
    geom = { kind: 'sea', d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}` };
  } else {
    // an overland road: least-cost path through the terrain, downsampled and smoothed.
    const path = aStarRoad(geo, cellOfWorld(geo, a.x, a.y), cellOfWorld(geo, b.x, b.y));
    let pts: Pt[];
    if (path && path.length >= 2) {
      const step = Math.max(2, Math.floor(path.length / 14)); // ~14 control points max
      pts = [];
      for (let i = 0; i < path.length; i += step) pts.push(worldOfCell(geo, path[i]));
      pts[pts.length - 1] = worldOfCell(geo, path[path.length - 1]); // always land exactly on b
    } else {
      pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }]; // unreachable → a straight fallback
    }
    geom = { kind: 'road', d: smoothPath(pts) };
  }
  perGeo.set(key, geom);
  return geom;
}

export function buildRoads(geo: Geography, nodes: RoadNode[], edges: RoadEdge[]): MapRoad[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roads: MapRoad[] = [];
  for (const e of edges) {
    if (e.relation <= -20) continue; // a hostile border is not a road
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b || a.ruined || b.ruined) continue;
    const geom = roadGeometry(geo, a, b); // cached: A* runs once per pair per world
    roads.push(
      geom.kind === 'sea'
        ? { d: geom.d, kind: 'sea', width: 0.3 }
        : { d: geom.d, kind: 'road', width: 0.4 + Math.min(1.4, e.tradeVolume / 7) },
    );
  }
  return roads;
}

/** A great river traced as a smoothed SVG polyline, with a stroke width scaled by its
 *  discharge — a trunk reads visibly broader than a headwater. Drawn as a vector in the
 *  zoom-transformed overlay so it meanders crisply at any zoom (the per-pixel canvas paint
 *  still fills the fine tributary network). */
export interface MapRiver {
  d: string;
  width: number;
}

/** A river course within the CLOSE VIEW frame, for the animated current overlay. `speed`
 *  (0 still … 1 torrent, from flux) drives how fast the ripple travels and `width` its
 *  weight — so the eye reads a fast great river differently from a sluggish brook. The
 *  polyline runs source→mouth, so animating the dash offset carries the current downstream. */
export interface LocalRiver {
  d: string;
  width: number;
  speed: number;
}

/**
 * Trace the GREAT rivers of a world into meandering polylines. Each is followed DOWNSTREAM
 * along the drainage tree (`geo.flowTo`) from a headwater — a great-river cell no other great
 * cell feeds — to its mouth (or to where it merges into an already-traced trunk). Because the
 * trunk is claimed by the first headwater to reach it and later tributaries stop at the
 * confluence, the set is properly dendritic with no full overdraw. Pure function of geography.
 */
export function buildRivers(geo: Geography): MapRiver[] {
  const N = geo.size;
  const NN = N * N;
  const { flux, water, flowTo } = geo;
  const greatFlux = (GREAT_RIVER_FLUX * (N * N)) / (REF_N * REF_N);
  const isGreat = (k: number) => water[k] === WATER_RIVER && flux[k] >= greatFlux;
  // mark cells a great cell drains INTO, so a headwater is a great cell nothing great feeds.
  const fedByGreat = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    if (!isGreat(k)) continue;
    const d = flowTo[k];
    if (d >= 0) fedByGreat[d] = 1;
  }
  const visited = new Uint8Array(NN);
  const rivers: MapRiver[] = [];
  for (let s = 0; s < NN; s++) {
    if (!isGreat(s) || fedByGreat[s] || visited[s]) continue;
    const cells: number[] = [];
    let c = s;
    while (c >= 0 && isGreat(c) && !visited[c]) {
      visited[c] = 1;
      cells.push(c);
      c = flowTo[c];
    }
    if (c >= 0) cells.push(c); // one step into the mouth/merge so the line reaches the water
    if (cells.length < 3) continue;
    // gauge the width from the flux ~60% down the course, so an upper reach isn't drawn at the
    // (much larger) mouth width; √discharge is the natural width law.
    const gauge = flux[cells[Math.floor(cells.length * 0.6)]];
    const width = Math.max(0.5, Math.min(2.6, Math.sqrt(gauge / greatFlux) * 1.05));
    const step = Math.max(1, Math.floor(cells.length / 18)); // ~18 control points, then smooth
    const pts: Pt[] = [];
    for (let i = 0; i < cells.length; i += step) pts.push(worldOfCell(geo, cells[i]));
    pts[pts.length - 1] = worldOfCell(geo, cells[cells.length - 1]);
    rivers.push({ d: smoothPath(pts), width });
  }
  rivers.sort((a, b) => b.width - a.width); // widest trunks first; tributaries drawn on top
  return rivers;
}

/** River courses passing through the CLOSE VIEW frame — every river, not just the great
 *  trunks, so a brook-side hamlet still shows its water moving. Each carries a `speed` from
 *  its discharge (design/24 §7, `cellFlowSpeed`) so the overlay can ripple a torrent fast
 *  and a sluggish reach slow. Traced source→mouth from the drainage tree (`flowTo`), the
 *  same authoritative course the terrain canvas paints — the ripple rides the real river. */
export function buildLocalRivers(geo: Geography, vb: ViewBox): LocalRiver[] {
  const N = geo.size;
  const NN = N * N;
  const { flux, water, flowTo } = geo;
  const scale = NN / (REF_N * REF_N); // flux thresholds are tuned at REF_N; scale to this grid
  const riverFlux = RIVER_FLUX * scale;
  const greatFlux = GREAT_RIVER_FLUX * scale;
  const isRiver = (k: number) => water[k] === WATER_RIVER;
  // a chain HEAD is a river cell no other river cell drains into (a headwater)
  const fed = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    if (!isRiver(k)) continue;
    const d = flowTo[k];
    if (d >= 0 && isRiver(d)) fed[d] = 1;
  }
  const pad = 1.5; // keep a little course beyond the frame so a river enters, not pops in
  const inFrame = (p: Pt) => p.x >= vb.x - pad && p.x <= vb.x + vb.w + pad && p.y >= vb.y - pad && p.y <= vb.y + vb.h + pad;
  const visited = new Uint8Array(NN);
  const out: LocalRiver[] = [];
  for (let s = 0; s < NN; s++) {
    if (!isRiver(s) || fed[s] || visited[s]) continue;
    const cells: number[] = [];
    let c = s;
    while (c >= 0 && isRiver(c) && !visited[c]) {
      visited[c] = 1;
      cells.push(c);
      c = flowTo[c];
    }
    if (c >= 0) cells.push(c); // one step into the mouth/merge so the line reaches the water
    if (cells.length < 3) continue;
    if (!cells.some((k) => inFrame(worldOfCell(geo, k)))) continue; // not in this frame
    const gauge = flux[cells[Math.floor(cells.length * 0.6)]];
    const width = Math.max(0.02, Math.min(0.13, Math.sqrt(gauge / greatFlux) * 0.1 + 0.02));
    const speed = Math.min(1, Math.max(0, (gauge - riverFlux) / Math.max(1, greatFlux - riverFlux)));
    const step = Math.max(1, Math.floor(cells.length / 24));
    const pts: Pt[] = [];
    for (let i = 0; i < cells.length; i += step) pts.push(worldOfCell(geo, cells[i]));
    pts[pts.length - 1] = worldOfCell(geo, cells[cells.length - 1]);
    out.push({ d: smoothPath(pts), width, speed });
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** bilinear sample of a grid field at grid coords (gx, gy). */
function bilinear(arr: Float32Array, N: number, gx: number, gy: number): number {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(N - 1, x0 + 1);
  const y1 = Math.min(N - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const a = arr[y0 * N + x0];
  const b = arr[y0 * N + x1];
  const c = arr[y1 * N + x0];
  const d = arr[y1 * N + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** A named geographic feature to letter onto the map (name from the pack's tongue). */
export interface TerrainLabel {
  x: number; // world coords
  y: number;
  text: string;
  kind: 'sea' | 'lake' | 'range' | 'river';
}

/** Paint the engine's geography, coloured by the pack theme. `vb` matches the overlay
 *  SVG viewBox so settlements land exactly on the terrain that bred them. `labels`
 *  (optional) letters the named features — seas, ranges, great rivers — onto the map. */
/** The subset of `Geography` the terrain pixel loop reads — a plain bag of typed arrays, so it
 *  can be structured-cloned to a Web Worker (a class instance / methods would not survive). */
export type GeoFields = Pick<Geography, 'size' | 'elevation' | 'moisture' | 'temperature' | 'fertility' | 'water' | 'hilliness' | 'seaLevel'>;

/** The heavy per-pixel terrain computation — canvas-free, so it can run OFF the main thread in a
 *  Web Worker (see terrainWorker.ts). At the close view it evaluates dozens of noise octaves per
 *  pixel over millions of pixels (~2s), which would freeze the UI if run inline. Returns a W*H*4
 *  RGBA buffer; the caller does the cheap putImageData + vignette + labels via `paintTerrainOverlay`. */
export function computeTerrainImage(geo: GeoFields, vb: ViewBox, theme: SurfaceTheme, W: number, H: number): Uint8ClampedArray {
  const N = geo.size;
  const E = geo.elevation;
  const M = geo.moisture;
  const T = geo.temperature;
  const F = geo.fertility;
  const WTR = geo.water;
  const HILL = geo.hilliness;
  const sea = geo.seaLevel;
  const water = theme.water ?? { deep: [18, 26, 40] as RGB, shallow: [40, 60, 80] as RGB, level: sea };
  const river: RGB = [Math.min(255, water.shallow[0] * 1.15 + 16), Math.min(255, water.shallow[1] * 1.15 + 16), Math.min(255, water.shallow[2] * 1.15 + 20)];
  // a turquoise kiss for the shallowest coastal water (blended in near shore)
  const shore: RGB = [Math.min(255, water.shallow[0] + 24), Math.min(255, water.shallow[1] + 44), Math.min(255, water.shallow[2] + 40)];
  const sand: RGB = [216, 205, 168]; // a warm beach at the waterline

  // world coord → grid coord over the geography's full extent (the grid spans more than
  // the [0,100] settled plane, so the map's margin samples real terrain, never a smear).
  const gOf = (w: number) => Math.max(0, Math.min(N - 1, ((w - GEO_MIN) / GEO_SPAN) * (N - 1)));

  // ZOOM-ADAPTIVE AMPLIFICATION (design/24 §3.2): when the view rectangle is small (the
  // CLOSE VIEW's ~11-unit frame), the bilinear fields alone read as watercolour blobs.
  // Scale up the fractal micro-detail and tighten the hillshade radius so nearness
  // resolves into ground texture — deterministic, so the same hill always looks the same.
  // The world map (vb.w ≈ 190, max zoom ≈ 32) is left untouched by the ≤30 gate.
  const zoomK = Math.max(1, Math.min(3, 30 / vb.w));
  const shadeDelta = 0.8 / zoomK;
  // the COARSE hillshade/AO (from the smooth interpolated elevation grid) reads as real
  // relief at world scale, but as meaningless soft blobs once you zoom past the grid's
  // resolution — so fade it out as the frame tightens, leaving clean ground under the crisp
  // texture (design/24 §8). And SCREEN-ANCHOR that texture's base frequency so its grain stays
  // a fixed ~20px on screen at every zoom (world-anchored phase, so it doesn't swim on a pan).
  const reliefFade = Math.min(1, vb.w / 16);
  const texBase = Math.min(40, Math.max(3, 34 / vb.w));
  // the per-CELL river tint reads as a fine thread on the world map, but as ugly blocky
  // squares once zoomed past the grid (each river cell spans many pixels). So fade it out for
  // the close view — there the crisp SVG river RIBBON (LocalMapView) carries the water instead.
  const riverTintK = Math.max(0, Math.min(1, (vb.w - 18) / 30)); // 0 at close view, 1 on the world map

  // 1) LAND COLOUR per cell — the biome tint (+ snow) for EVERY cell, even submerged ones.
  //    Water is NOT baked in here: it is decided per-pixel in the loop (see below) so the
  //    coastline stays crisp at any zoom. Computing a land colour for water cells too means
  //    the bilinear land blend near a shore interpolates land↔land (never land↔water), so a
  //    beach never bleeds a muddy ramp of sea-colour up the shore.
  const NN = N * N;
  const landR = new Float32Array(NN);
  const landG = new Float32Array(NN);
  const landB = new Float32Array(NN);
  for (let ci = 0; ci < NN; ci++) {
    const col = biomeOf({ temperature: T[ci], moisture: M[ci], elevation: E[ci] }).color;
    let c: RGB = [col[0], col[1], col[2]];
    const e = E[ci];
    const temp = T[ci];
    if (e > 0.72 && temp < 0.4) {
      // SNOW on cold high ground — white-capped peaks near the poles and on tall ranges.
      const snow = Math.min(1, (e - 0.72) / 0.16) * Math.min(1, (0.4 - temp) / 0.4);
      c = [lerp(c[0], 236, snow), lerp(c[1], 240, snow), lerp(c[2], 245, snow)];
    }
    landR[ci] = c[0];
    landG[ci] = c[1];
    landB[ci] = c[2];
  }

  // 1b) CHANNEL DEPTH per cell — a shallow valley stamped around every river cell, so the
  //     close-view relief carries the watercourse as a carved trench (design/24 §8). Sparse
  //     (only river cells stamp), then bilinear-sampled per pixel like elevation. Faded with
  //     the same zoom gate as the river tint so it never disturbs the world map.
  const chan = new Float32Array(NN);
  const CHANNEL_DEPTH = 0.02 * Math.max(0, Math.min(1, 1 - (vb.w - 6) / 18)); // strongest zoomed-in, gone by world scale
  if (CHANNEL_DEPTH > 0) {
    for (let ci = 0; ci < NN; ci++) {
      if (WTR[ci] !== WATER_RIVER) continue;
      const cx0 = ci % N, cy0 = (ci / N) | 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const x = cx0 + di, y = cy0 + dj;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const f = Math.max(0, 1 - Math.hypot(di, dj) / 2.0);
        const k = y * N + x;
        if (f > chan[k]) chan[k] = f;
      }
    }
  }
  const chanDepth = (gx: number, gy: number) => bilinear(chan, N, gx, gy) * CHANNEL_DEPTH;

  // 2) pixel loop. The land/water boundary is resolved PER PIXEL from the (bilinearly
  //    interpolated) elevation field, perturbed by sub-cell fractal noise near the waterline —
  //    so the coastline is a crisp, fractally-detailed line at every zoom instead of a soft
  //    ramp over a blocky one-cell step. Land interiors still bilinear-blend for smoothness.
  const data = new Uint8ClampedArray(W * H * 4);
  for (let py = 0; py < H; py++) {
    const gy = gOf(vb.y + (py / H) * vb.h);
    const y0 = Math.floor(gy);
    const y1 = Math.min(N - 1, y0 + 1);
    const fy = gy - y0;
    for (let px = 0; px < W; px++) {
      const gx = gOf(vb.x + (px / W) * vb.w);
      const x0 = Math.floor(gx);
      const x1 = Math.min(N - 1, x0 + 1);
      const fx = gx - x0;
      const i00 = y0 * N + x0;
      const i10 = y0 * N + x1;
      const i01 = y1 * N + x0;
      const i11 = y1 * N + x1;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const nci = Math.round(gy) * N + Math.round(gx);

      // continuous elevation, then a crisp fractal coastline: perturb the elevation only
      // NEAR the waterline (so deep water and high land are untouched — no inland puddles or
      // phantom offshore isles), letting the shore wander at sub-cell scale.
      const ePlain = bilinear(E, N, gx, gy);
      const nearShore = 1 - Math.abs(ePlain - sea) / 0.06;
      let eP = ePlain;
      if (nearShore > 0) {
        let cd = 0;
        let camp = 0.5;
        let cf = 1.6;
        for (let o = 0; o < 4; o++) {
          cd += camp * (vnoise(gx * cf + o * 31.7, gy * cf + o * 13.3, 917) - 0.5);
          camp *= 0.5;
          cf *= 2.15;
        }
        eP = ePlain + cd * 0.06 * nearShore;
      }

      // is this pixel over a LAKE? a bilinear lake-fraction gives a crisp-enough edge for a
      // small body. Highland lakes sit ABOVE sea level, so the eP<sea sea test can't find them —
      // the water classification decides them.
      const lakeFrac =
        (WTR[i00] === WATER_LAKE ? w00 : 0) + (WTR[i10] === WATER_LAKE ? w10 : 0) +
        (WTR[i01] === WATER_LAKE ? w01 : 0) + (WTR[i11] === WATER_LAKE ? w11 : 0);
      const lakeHere = lakeFrac >= 0.5;

      let r: number;
      let g: number;
      let b: number;
      if (eP < sea || lakeHere) {
        // WATER — crisp per-pixel. The ocean shades by depth and brightens to a turquoise
        // shallow near shore; a lake (sea-level or highland) is calm standing water.
        const anySea = WTR[i00] === WATER_SEA || WTR[i10] === WATER_SEA || WTR[i01] === WATER_SEA || WTR[i11] === WATER_SEA;
        const anyLake = WTR[i00] === WATER_LAKE || WTR[i10] === WATER_LAKE || WTR[i01] === WATER_LAKE || WTR[i11] === WATER_LAKE;
        let c: RGB;
        if (lakeHere || (anyLake && !anySea)) {
          const shoreLift = lakeHere ? (1 - Math.min(1, lakeFrac)) * 0.45 : 0; // lighten the fringe
          c = lerp3(water.deep, water.shallow, 0.66 + shoreLift);
        } else {
          const below = sea - eP;
          const coast = Math.max(0, 1 - below / 0.05);
          const depth = Math.max(0, Math.min(1, eP / sea));
          c = lerp3(water.deep, water.shallow, Math.max(depth, coast * 0.85));
          if (coast > 0) c = lerp3(c, shore, coast * coast * 0.5);
        }
        r = c[0];
        g = c[1];
        b = c[2];
      } else {
        // LAND — a CLEAN bilinear blend of the biome colours (no domain warp: warping a few
        // cells just swirled them into clouds). The terrain's RICHNESS at close zoom comes from
        // SYNTHESISED relief + hillshade (below), not from mottling the colour, so flat farmland
        // stays a clean field and hill country gains real shaded relief.
        r = bilinear(landR, N, gx, gy);
        g = bilinear(landG, N, gx, gy);
        b = bilinear(landB, N, gx, gy);
        // a sandy BEACH on warm low land right at the waterline (crisp, per-pixel).
        const temp = T[nci];
        if (eP < sea + 0.018 && temp > 0.34) {
          const beach = Math.max(0, 1 - (eP - sea) / 0.018);
          r = lerp(r, sand[0], beach * 0.7);
          g = lerp(g, sand[1], beach * 0.7);
          b = lerp(b, sand[2], beach * 0.7);
        }
        const e = ePlain;
        const gxp = Math.min(N - 1, gx + shadeDelta);
        const gyp = Math.min(N - 1, gy + shadeDelta);
        const gxm = Math.max(0, gx - shadeDelta);
        const gym = Math.max(0, gy - shadeDelta);
        // AMPLIFIED RELIEF (design/24 §3.2): the real elevation grid is smooth over the few
        // cells this frame spans, so at close zoom we SYNTHESISE sub-grid relief — coherent
        // fbm modulated by the local hilliness (crags in the mountains, gentle swells in
        // farmland) — and hillshade THAT, so the close view reads as a real 3-D landscape (the
        // world map's quality, generated below the grid). Faded in by zoom; the coarse relief
        // fades out (it's blobby up close). The synth height drives SHADING/ROCK/SNOW only —
        // never the water line, which stays the real coastline, so no phantom lakes appear.
        const hillN = HILL[nci];
        const grain = Math.max(0, Math.min(1, (zoomK - 1) / 1.7));
        const synthAmp = (0.010 + hillN * 0.012) * grain; // world-height of the synth relief
        const synth = (ux: number, uy: number) => {
          let v = 0;
          let a = 0.5;
          let fr = 1.15;
          let nrm = 0;
          for (let o = 0; o < 5; o++) {
            v += a * (vnoise(ux * fr + o * 13.1, uy * fr + o * 7.7, 3110) - 0.5);
            nrm += a;
            a *= 0.5;
            fr *= 2.15;
          }
          return (v / nrm) * synthAmp;
        };
        const sh0 = synth(gx, gy);
        // gradient of (coarse·fade + synth): the coarse term is the hill the town sits on, the
        // synth term the crisp micro-relief that appears as you zoom in.
        // the coarse hill, the synth micro-relief, AND the carved river channel all shade here
        const chG = chanDepth(gx, gy);
        const ex = (bilinear(E, N, gxp, gy) - e) * reliefFade + (synth(gxp, gy) - sh0) - (chanDepth(gxp, gy) - chG);
        const ey = (bilinear(E, N, gx, gyp) - e) * reliefFade + (synth(gx, gyp) - sh0) - (chanDepth(gx, gyp) - chG);
        let s = 1 + (-ex - ey) * theme.hillshade * (8 + hillN * 4);
        s = s < 0.5 ? 0.5 : s > 1.5 ? 1.5 : s;
        // ambient occlusion on the SAME amplified surface — hollows shadow, ridges catch light
        const eC = e + sh0;
        const concavity = ((bilinear(E, N, gxp, gy) + synth(gxp, gy)) + (bilinear(E, N, gxm, gy) + synth(gxm, gy)) + (bilinear(E, N, gx, gyp) + synth(gx, gyp)) + (bilinear(E, N, gx, gym) + synth(gx, gym))) / 4 - eC;
        s *= 1 - Math.max(-0.14, Math.min(0.18, concavity * 6));
        r *= s;
        g *= s;
        b *= s;
        // the channel floor sits in cool, damp shadow — so the trench reads even where its
        // banks are gentle (the crisp SVG river ribbon rides the centre on top of this).
        if (CHANNEL_DEPTH > 0) {
          const chRaw = bilinear(chan, N, gx, gy);
          if (chRaw > 0) { r *= 1 - chRaw * 0.30; g *= 1 - chRaw * 0.22; b *= 1 - chRaw * 0.10; }
        }
        // ROCK & SNOW on the synth CRESTS (close zoom) — high steep ground bares stone, and
        // cold high ground catches snow, exactly as the world map paints its real peaks.
        if (hillN >= 2 && synthAmp > 0) {
          const crest = Math.max(0, sh0 / synthAmp); // 0 in the hollows … ~0.5 on the high side
          const bare = crest * grain * (hillN >= 3 ? 1 : 0.55);
          if (bare > 0) {
            r = lerp(r, 150, bare * 0.5);
            g = lerp(g, 150, bare * 0.5);
            b = lerp(b, 152, bare * 0.5);
            const temp = T[nci];
            if (temp < 0.42) {
              const snow = bare * Math.min(1, (0.42 - temp) / 0.3);
              r = lerp(r, 236, snow * 0.7);
              g = lerp(g, 240, snow * 0.7);
              b = lerp(b, 245, snow * 0.7);
            }
          }
        }
        // FINE GROUND GRAIN (screen-anchored, texBase ∝ 1/vb.w so it stays ~20px on screen at
        // every zoom) — a subtle surface texture so even level ground isn't a dead wash. Gentle
        // now that the synth relief carries the real detail.
        if (grain > 0) {
          let d = 0;
          let amp = 0.5;
          let fr = texBase;
          let norm = 0;
          for (let o = 0; o < 4; o++) {
            d += amp * (vnoise(gx * fr + o * 17.3, gy * fr + o * 9.1, 5150) - 0.5);
            norm += amp;
            amp *= 0.5;
            fr *= 2.0;
          }
          d /= norm;
          const tex = 1 + d * (0.16 + hillN * 0.08) * grain;
          r *= tex;
          g *= tex;
          b *= tex;
          const cm = (vnoise(gx * texBase * 1.7 + 7.7, gy * texBase * 1.7 + 2.3, 2718) - 0.5) * grain * 0.4;
          const lush = M[nci] * 0.5 + F[nci] * 0.5;
          g += cm * (7 + lush * 12);
          r += cm * 3;
          b -= cm * 3;
        }
        // RIVERS run over land — keep them crisp AND a touch wider. Where the nearest OR an
        // adjacent cell is a river, pull toward the river colour (bilinear would wash a
        // one-cell river away). Only on land, so a river mouth doesn't tint open sea.
        const nearRiver = WTR[nci] === WATER_RIVER
          ? 0.68
          : WTR[i00] === WATER_RIVER || WTR[i10] === WATER_RIVER || WTR[i01] === WATER_RIVER || WTR[i11] === WATER_RIVER
            ? 0.34
            : 0;
        if (nearRiver > 0 && riverTintK > 0) {
          const t = nearRiver * riverTintK; // faded out in the close view (the SVG ribbon takes over)
          r = lerp(r, river[0], t);
          g = lerp(g, river[1], t);
          b = lerp(b, river[2], t);
        }
      }
      const i = (py * W + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Cheap main-thread finish: blit the computed RGBA buffer, then draw the vignette and the
 *  named-feature labels (text needs a real 2D context, so it stays on the main thread). */
export function paintTerrainOverlay(ctx: CanvasRenderingContext2D, buf: Uint8ClampedArray, vb: ViewBox, theme: SurfaceTheme, W: number, H: number, labels?: TerrainLabel[]): void {
  const img = ctx.createImageData(W, H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);

  const v = theme.vignette;
  const grd = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.32, W / 2, H / 2, H * 0.74);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(${v[0]},${v[1]},${v[2]},0.5)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  // letter the named features onto the land — an atlas, not a heatmap. Seas get the
  // largest hand; ranges and great rivers a smaller one. Skips labels outside the view.
  if (labels && labels.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of labels) {
      const px = ((l.x - vb.x) / vb.w) * W;
      const py = ((l.y - vb.y) / vb.h) * H;
      if (px < 24 || py < 10 || px > W - 24 || py > H - 10) continue;
      const size = l.kind === 'sea' ? 15 : l.kind === 'range' ? 12 : 11;
      ctx.font = `italic ${size}px Spectral, Georgia, serif`;
      const ink = l.kind === 'sea' || l.kind === 'lake' ? 'rgba(214, 228, 240, 0.72)' : 'rgba(240, 232, 214, 0.78)';
      ctx.strokeStyle = 'rgba(10, 14, 20, 0.55)';
      ctx.lineWidth = 3;
      ctx.strokeText(l.text, px, py);
      ctx.fillStyle = ink;
      ctx.fillText(l.text, px, py);
    }
  }
}

/** Synchronous terrain paint — computes the pixels inline then finishes. Used by the world map
 *  (cheap at world zoom, where the per-pixel synth relief is disabled) and as a worker fallback.
 *  The CLOSE view offloads `computeTerrainImage` to a Web Worker instead (see LocalMapView). */
export function paintTerrain(canvas: HTMLCanvasElement, geo: Geography, vb: ViewBox, theme: SurfaceTheme, labels?: TerrainLabel[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const buf = computeTerrainImage(geo, vb, theme, W, H);
  paintTerrainOverlay(ctx, buf, vb, theme, W, H, labels);
}

// --- starfield (space setting) — its own noise for nebulae + stars ----------
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  const sx = smooth(fx);
  const sy = smooth(fy);
  return (v00 + (v10 - v00) * sx) * (1 - sy) + (v01 + (v11 - v01) * sx) * sy;
}
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function paintStarfield(canvas: HTMLCanvasElement, seed: number, field: StarfieldStyle): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = ctx.createImageData(W, H);
  const data = img.data;
  const NF = 0.012;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let [r, g, b] = field.voidColor;
      for (let k = 0; k < field.nebula.length; k++) {
        const n = fbm(px * NF + k * 30, py * NF + k * 30, seed + 200 + k * 50, 4);
        const a = Math.max(0, n - 0.55) * 1.4;
        const c = field.nebula[k];
        r = lerp(r, c[0], a * 0.5);
        g = lerp(g, c[1], a * 0.5);
        b = lerp(b, c[2], a * 0.5);
      }
      const i = (py * W + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const [sr, sg, sb] = field.star;
  const count = Math.floor((W * H) / 260);
  for (let s = 0; s < count; s++) {
    const px = hash2(s, 1, seed + 11) * W;
    const py = hash2(s, 2, seed + 11) * H;
    const br = hash2(s, 3, seed + 11);
    const size = br > 0.96 ? 1.5 : br > 0.8 ? 1 : 0.6;
    ctx.fillStyle = `rgba(${sr},${sg},${sb},${0.25 + br * 0.7})`;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
