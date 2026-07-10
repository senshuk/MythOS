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
import { type Geography, WATER_SEA, WATER_LAKE, WATER_RIVER, GEO_MIN, GEO_SPAN, GREAT_RIVER_FLUX, REF_N, isLand } from '../engine/geography';

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
 *  around it or the link becomes a sea lane), high and steep ground is dear, and gentle
 *  low land is cheap — so A* finds the natural pass/valley/coast route. */
function cellRoadCost(geo: Geography, ci: number): number {
  const w = geo.water[ci];
  if (w === WATER_SEA) return 60;
  if (w === WATER_LAKE) return 45;
  const base = w === WATER_RIVER ? 3.5 : 1; // a ford costs a little
  return base + geo.elevation[ci] * 3 + geo.hilliness[ci] * 1.6;
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
export function buildRoads(geo: Geography, nodes: RoadNode[], edges: RoadEdge[]): MapRoad[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roads: MapRoad[] = [];
  for (const e of edges) {
    if (e.relation <= -20) continue; // a hostile border is not a road
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b || a.ruined || b.ruined) continue;
    const width = 0.4 + Math.min(1.4, e.tradeVolume / 7);

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
      roads.push({ d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`, kind: 'sea', width: 0.3 });
      continue;
    }

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
    roads.push({ d: smoothPath(pts), kind: 'road', width });
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
export function paintTerrain(canvas: HTMLCanvasElement, geo: Geography, vb: ViewBox, theme: SurfaceTheme, labels?: TerrainLabel[]): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const N = geo.size;
  const E = geo.elevation;
  const M = geo.moisture;
  const T = geo.temperature;
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
  const detailOctaves = zoomK > 2 ? 6 : 4;
  const shadeDelta = 0.8 / zoomK;

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

  // 2) pixel loop. The land/water boundary is resolved PER PIXEL from the (bilinearly
  //    interpolated) elevation field, perturbed by sub-cell fractal noise near the waterline —
  //    so the coastline is a crisp, fractally-detailed line at every zoom instead of a soft
  //    ramp over a blocky one-cell step. Land interiors still bilinear-blend for smoothness.
  const img = ctx.createImageData(W, H);
  const data = img.data;
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
        // LAND — bilinear blend of land colours (no water contamination), then a waterline
        // beach, relief hillshade, ambient occlusion and fractal micro-detail.
        r = landR[i00] * w00 + landR[i10] * w10 + landR[i01] * w01 + landR[i11] * w11;
        g = landG[i00] * w00 + landG[i10] * w10 + landG[i01] * w01 + landG[i11] * w11;
        b = landB[i00] * w00 + landB[i10] * w10 + landB[i01] * w01 + landB[i11] * w11;
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
        const ex = bilinear(E, N, gxp, gy) - e;
        const ey = bilinear(E, N, gx, gyp) - e;
        let s = 1 + (-ex - ey) * theme.hillshade * (8 + HILL[nci] * 4);
        s = s < 0.6 ? 0.6 : s > 1.38 ? 1.38 : s;
        // AMBIENT OCCLUSION — a cell sunk below its surroundings (a valley/gorge) sits in
        // shadow; a convex ridge catches a touch more light. Reads the terrain's concavity.
        const concavity = (bilinear(E, N, gxp, gy) + bilinear(E, N, gxm, gy) + bilinear(E, N, gx, gyp) + bilinear(E, N, gx, gym)) / 4 - e;
        s *= 1 - Math.max(-0.12, Math.min(0.16, concavity * 6));
        // FRACTAL MICRO-DETAIL — multi-octave noise at frequencies FINER than a grid cell,
        // sampled in grid space. At low zoom it averages out; zoomed in it resolves into
        // terrain texture (roughness, mottling) so the map reads as detail, not smooth blobs.
        let d = 0;
        let amp = 0.5;
        let f = 0.9;
        for (let o = 0; o < detailOctaves; o++) {
          d += amp * (vnoise(gx * f + o * 17.3, gy * f + o * 9.1, 5150) - 0.5);
          amp *= 0.5;
          f *= 2.3;
        }
        const rough = (0.11 + HILL[nci] * 0.05) * (0.55 + zoomK * 0.45); // rougher up close
        s *= 1 + d * rough * 2;
        r *= s;
        g *= s;
        b *= s;
        // RIVERS run over land — keep them crisp AND a touch wider. Where the nearest OR an
        // adjacent cell is a river, pull toward the river colour (bilinear would wash a
        // one-cell river away). Only on land, so a river mouth doesn't tint open sea.
        const nearRiver = WTR[nci] === WATER_RIVER
          ? 0.68
          : WTR[i00] === WATER_RIVER || WTR[i10] === WATER_RIVER || WTR[i01] === WATER_RIVER || WTR[i11] === WATER_RIVER
            ? 0.34
            : 0;
        if (nearRiver > 0) {
          r = lerp(r, river[0], nearRiver);
          g = lerp(g, river[1], nearRiver);
          b = lerp(b, river[2], nearRiver);
        }
      }
      const i = (py * W + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
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
