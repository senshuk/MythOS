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
import { type Geography, WATER_SEA, WATER_LAKE, WATER_RIVER, GEO_MIN, GEO_SPAN, isLand } from '../engine/geography';

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
  const SD = geo.seaDist;
  const sea = geo.seaLevel;
  const water = theme.water ?? { deep: [18, 26, 40] as RGB, shallow: [40, 60, 80] as RGB, level: sea };
  const river: RGB = [Math.min(255, water.shallow[0] * 1.15 + 16), Math.min(255, water.shallow[1] * 1.15 + 16), Math.min(255, water.shallow[2] * 1.15 + 20)];
  // a turquoise kiss for the shallowest coastal water (blended in near shore)
  const shore: RGB = [Math.min(255, water.shallow[0] + 24), Math.min(255, water.shallow[1] + 44), Math.min(255, water.shallow[2] + 40)];

  // world coord → grid coord over the geography's full extent (the grid spans more than
  // the [0,100] settled plane, so the map's margin samples real terrain, never a smear).
  const gOf = (w: number) => Math.max(0, Math.min(N - 1, ((w - GEO_MIN) / GEO_SPAN) * (N - 1)));

  // 1) BASE COLOUR per cell (biome or water, with coast shallows + snow), computed once so
  //    the pixel loop can BILINEAR-BLEND cell colours — smooth coasts and biome transitions
  //    instead of the blocky nearest-neighbour squares of a low-res grid.
  const NN = N * N;
  const cellR = new Float32Array(NN);
  const cellG = new Float32Array(NN);
  const cellB = new Float32Array(NN);
  for (let ci = 0; ci < NN; ci++) {
    const w = WTR[ci];
    let c: RGB;
    if (w === WATER_SEA) {
      const depth = Math.max(0, Math.min(1, E[ci] / sea));
      const coast = Math.max(0, 1 - SD[ci] / 4);
      c = lerp3(water.deep, water.shallow, Math.max(depth, coast * 0.85));
      if (coast > 0) c = lerp3(c, shore, coast * coast * 0.5);
    } else if (w === WATER_LAKE) {
      c = lerp3(water.deep, water.shallow, 0.7);
    } else if (w === WATER_RIVER) {
      c = river;
    } else {
      const col = biomeOf({ temperature: T[ci], moisture: M[ci], elevation: E[ci] }).color;
      c = [col[0], col[1], col[2]];
      // SNOW on cold high ground — white-capped peaks near the poles and on tall ranges.
      const e = E[ci];
      const temp = T[ci];
      if (e > 0.72 && temp < 0.4) {
        const snow = Math.min(1, (e - 0.72) / 0.16) * Math.min(1, (0.4 - temp) / 0.4);
        c = [lerp(c[0], 236, snow), lerp(c[1], 240, snow), lerp(c[2], 245, snow)];
      }
    }
    cellR[ci] = c[0];
    cellG[ci] = c[1];
    cellB[ci] = c[2];
  }

  // 2) pixel loop: bilinear-blend the cell colours, apply relief hillshade, keep rivers crisp.
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
      let r = cellR[i00] * w00 + cellR[i10] * w10 + cellR[i01] * w01 + cellR[i11] * w11;
      let g = cellG[i00] * w00 + cellG[i10] * w10 + cellG[i01] * w01 + cellG[i11] * w11;
      let b = cellB[i00] * w00 + cellB[i10] * w10 + cellB[i01] * w01 + cellB[i11] * w11;
      // hillshade from the interpolated slope — mountainous ground casts a stronger shadow
      const nci = Math.round(gy) * N + Math.round(gx);
      const e = bilinear(E, N, gx, gy);
      const ex = bilinear(E, N, Math.min(N - 1, gx + 0.8), gy) - e;
      const ey = bilinear(E, N, gx, Math.min(N - 1, gy + 0.8)) - e;
      let s = 1 + (-ex - ey) * theme.hillshade * (8 + HILL[nci] * 4);
      s = s < 0.6 ? 0.6 : s > 1.38 ? 1.38 : s;
      r *= s;
      g *= s;
      b *= s;
      // keep RIVERS crisp — the bilinear blend would wash a one-cell river away, so where the
      // nearest cell is a river, pull the pixel back toward the river colour.
      if (WTR[nci] === WATER_RIVER) {
        r = lerp(r, river[0], 0.6);
        g = lerp(g, river[1], 0.6);
        b = lerp(b, river[2], 0.6);
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
