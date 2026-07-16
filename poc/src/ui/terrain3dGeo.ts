/**
 * CLOSE-VIEW 3D GEOMETRY — pure data, renderer-agnostic (design/24 §8).
 *
 * Builds the settlement's neighbourhood as raw vertex arrays: the terrain heightfield (the
 * world's real elevation continued with coherent fbm), and the town PLAN extruded onto it
 * (roofed buildings, monuments, walls, trees, draped streets/fields). No WebGL, no three.js —
 * a renderer feeds these arrays into whatever geometry type it uses.
 */
import { type Geography, GEO_MIN, GEO_SPAN, WATER_RIVER, REF_N, GREAT_RIVER_FLUX, temperatureAt, moistureAt, hillinessAt } from '../engine/geography';
import { biomeOf } from '../content/biomes';
import type { LocalPlan } from '../content/localmap';
import { ARCH_BY_ID, type ArchStyle, type SurfaceMat } from '../content/architecture';

export const RES = 200; // terrain vertices per side
/**
 * Vertical exaggeration. Real relief IS subtle over a few km, so some is needed — but this was
 * 26, and measured against the world it renders that made the MEDIAN acre of land a 24° slope
 * (p90 50°, p99 67°) on ground the simulation itself calls flat or rolling. 93% of land is
 * flat/rolling and every settlement sits on it; the world was never mountainous, it was drawn
 * that way. At 8 the same terrain reads median 8°, p90 20°, p99 36° — gentle farmland, real
 * hills, the occasional crag. (Reference: farmland is <5%, rolling ~8%, hilly 10–15%.)
 *
 * Presentation only: VSCALE exists nowhere but this file, so no seed, save, or sim hash moves.
 */
export const VSCALE = 8;

export interface Accum { pos: number[]; nrm: number[]; col: number[]; idx: number[]; n: number; sea?: number[]; uv: number[]; mat: number[] }
const newAccum = (): Accum => ({ pos: [], nrm: [], col: [], idx: [], n: 0, uv: [], mat: [] });

/** the structures material's texture slots — index matches the sampler order in the renderer's
 *  shader. `PLAIN` (0) is untextured: vertex colour only, for foliage and folk. */
export const SURF: Record<SurfaceMat, number> = { plain: 0, plank: 1, masonry: 2, adobe: 3, thatch: 4, slate: 5, clay: 6 };
/** world units per texture repeat. A cottage wall is ~0.2 units, so this shows ~6 boards or
 *  ~3 courses across it — dense enough to read as built, coarse enough not to shimmer. */
const ARCH_TEX = 0.4;

/**
 * UVs are derived from the FACE'S OWN basis rather than authored per call site, which keeps
 * texel density identical on every building and needs no unwrapping:
 *  - a WALL (near-vertical face): u runs level along the wall, v straight up — so planks stand
 *    upright and masonry courses lie flat, whatever way the house is turned.
 *  - a PITCHED ROOF: u runs level along the ridge, v up the slope — so slate courses lap
 *    downhill the way real ones do.
 * Projecting WORLD position (not a local corner) means neighbours don't all share one phase.
 */
function faceBasis(n: number[]): [number[], number[]] {
  const ay = Math.abs(n[1]);
  const nrm3 = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (ay < 0.7) return [nrm3(cross([0, 1, 0], n)), [0, 1, 0]]; // wall
  if (ay > 0.985) return [[1, 0, 0], [0, 0, 1]]; // level: flat roof, ground
  const t = nrm3(cross(n, [0, 1, 0])); // pitched roof: along the ridge…
  return [t, nrm3(cross(n, t))]; // …then up the slope
}
function pushUV(A: Accum, p: number[], t: number[], b: number[], m: number) {
  A.uv.push((p[0] * t[0] + p[1] * t[1] + p[2] * t[2]) / ARCH_TEX, (p[0] * b[0] + p[1] * b[1] + p[2] * b[2]) / ARCH_TEX);
  A.mat.push(m);
}

// --- coherent sub-grid noise (continues the terrain below the 450² grid) ---
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v00 = hash2(ix, iy, seed), v10 = hash2(ix + 1, iy, seed), v01 = hash2(ix, iy + 1, seed), v11 = hash2(ix + 1, iy + 1, seed);
  const sx = smooth(fx), sy = smooth(fy);
  return (v00 + (v10 - v00) * sx) * (1 - sy) + (v01 + (v11 - v01) * sx) * sy;
}
function detailFbm(x: number, y: number, seed: number): number {
  let v = 0, amp = 0.5, fr = 0.9, norm = 0;
  for (let o = 0; o < 6; o++) { v += amp * (vnoise(x * fr + o * 13.1, y * fr + o * 7.7, seed) - 0.5); norm += amp; amp *= 0.5; fr *= 2.1; }
  return v / norm;
}

function bilinearElev(geo: Geography, wx: number, wy: number): number {
  const N = geo.size;
  const gx = Math.max(0, Math.min(N - 1, ((wx - GEO_MIN) / GEO_SPAN) * (N - 1)));
  const gy = Math.max(0, Math.min(N - 1, ((wy - GEO_MIN) / GEO_SPAN) * (N - 1)));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0, E = geo.elevation;
  return (E[y0 * N + x0] * (1 - fx) + E[y0 * N + x1] * fx) * (1 - fy) + (E[y1 * N + x0] * (1 - fx) + E[y1 * N + x1] * fx) * fy;
}
// --- rivers as CONNECTED courses (not disjoint cells) --------------------------
export const CHANNEL_DEPTH = 0.02; // valley depth at the centreline, in elevation units
export interface RiverChain { pts: { x: number; y: number }[]; width: number }

const cellToWorld = (geo: Geography, k: number): { x: number; y: number } => {
  const N = geo.size, i = k % N, j = (k / N) | 0;
  return { x: GEO_MIN + (i / (N - 1)) * GEO_SPAN, y: GEO_MIN + (j / (N - 1)) * GEO_SPAN };
};

/** Trace the river CELLS into connected source→mouth polylines (the drainage tree, `flowTo`),
 *  keeping any chain that passes through the frame. This is the same authoritative course the
 *  2D map draws — so the 3D channel is a continuous trough, not a string of disjoint pits. */
export function riverChains(geo: Geography, cx: number, cy: number, span: number): RiverChain[] {
  const N = geo.size, NN = N * N;
  const { flux, water, flowTo } = geo;
  const scale = NN / (REF_N * REF_N);
  const greatFlux = GREAT_RIVER_FLUX * scale;
  const isRiver = (k: number) => water[k] === WATER_RIVER;
  const fed = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) { if (!isRiver(k)) continue; const d = flowTo[k]; if (d >= 0 && isRiver(d)) fed[d] = 1; }
  const half = span / 2, pad = span * 0.25;
  const inFrame = (p: { x: number; y: number }) => p.x >= cx - half - pad && p.x <= cx + half + pad && p.y >= cy - half - pad && p.y <= cy + half + pad;
  const visited = new Uint8Array(NN);
  const out: RiverChain[] = [];
  for (let s = 0; s < NN; s++) {
    if (!isRiver(s) || fed[s] || visited[s]) continue;
    const cells: number[] = [];
    let c = s;
    while (c >= 0 && isRiver(c) && !visited[c]) { visited[c] = 1; cells.push(c); c = flowTo[c]; }
    if (c >= 0) cells.push(c); // one step into the mouth so the course reaches the water
    if (cells.length < 2) continue;
    const pts = cells.map((k) => cellToWorld(geo, k));
    if (!pts.some(inFrame)) continue;
    const gauge = flux[cells[Math.floor(cells.length * 0.5)]];
    const width = Math.max(0.05, Math.min(0.2, Math.sqrt(gauge / greatFlux) * 0.15 + 0.05));
    out.push({ pts, width });
  }
  return out;
}

/** squared distance from (px,py) to segment a→b, plus the closest-point param t. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** How deep in the channel a world point sits: 0 (bank) … 1 (on the course), from the distance
 *  to the nearest river SEGMENT — so the trough is continuous along the whole watercourse. */
export function channelAt(chains: RiverChain[], wx: number, wy: number): number {
  let best = 1e9, w = 0.08;
  for (const ch of chains) {
    for (let i = 0; i + 1 < ch.pts.length; i++) {
      const d = distToSeg(wx, wy, ch.pts[i].x, ch.pts[i].y, ch.pts[i + 1].x, ch.pts[i + 1].y);
      if (d < best) { best = d; w = ch.width; }
    }
  }
  const R = w * 1.5 + 0.16; // channel half-width in world units: the water plus its banks
  return best < R ? 1 - best / R : 0;
}

/** The surface elevation with the river channel carved in: the real grid + sub-grid fbm, but
 *  the fbm is PLANED FLAT inside the channel (a river beds itself smooth) and the trough is dug
 *  by ch². Returns the elevation and the channel factor. Terrain, structures and the water
 *  ribbon all read THIS, so the bed is smooth and the water is never buried under fbm bumps. */
export function channeledElev(geo: Geography, chains: RiverChain[], wx: number, wy: number, seed: number): { elev: number; ch: number } {
  const ch = channelAt(chains, wx, wy);
  const amp = (0.004 + hillinessAt(geo, wx, wy) * 0.02) * (1 - ch * 0.9); // the riverbed is planed smooth
  const elev = bilinearElev(geo, wx, wy) + detailFbm(wx, wy, seed ^ 0x7e33a1) * amp - ch * ch * CHANNEL_DEPTH;
  return { elev, ch };
}

export interface TriMesh { pos: Float32Array; col: Float32Array; nrm: Float32Array; idx: Uint32Array; mat: Float32Array }

/** The terrain mesh — the FULL heightfield (below sea too, so the coast is a smooth line
 *  where it dips under the water plane), coloured by biome / snow / seabed. `mat` carries a
 *  per-vertex material class (sand, mud, snow-bias, gravel) so the 3D splat is BIOME-AWARE, not
 *  just slope+altitude: a desert lays down sand, a marsh mud, a tundra snow, a river gravel
 *  shingle on its banks (design/28 #4). Slope-driven scree is added in the shader. */
export function buildTerrain(geo: Geography, cx: number, cy: number, span: number, seed: number): TriMesh {
  const sea = geo.seaLevel, half = span / 2, cell = span / (RES - 1);
  const chains = riverChains(geo, cx, cy, span); // the connected watercourses in this frame
  const H = new Float32Array(RES * RES);
  const pos = new Float32Array(RES * RES * 3), col = new Float32Array(RES * RES * 3), nrm = new Float32Array(RES * RES * 3);
  const mat = new Float32Array(RES * RES * 4); // (sand, mud, snowBias, gravel) per vertex
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const wx = cx - half + i * cell, wy = cy - half + j * cell, k = j * RES + i;
    const { elev: h, ch } = channeledElev(geo, chains, wx, wy, seed); // smooth-bedded, carved trough
    H[k] = h;
    let r: number, g: number, b: number, mSand = 0, mMud = 0, mSnow = 0, mGravel = 0;
    if (h < sea) { // seabed, darkening with depth (shows through the translucent water)
      const d = Math.max(0, Math.min(1, (sea - h) / 0.12));
      r = 0.36 - d * 0.2; g = 0.34 - d * 0.16; b = 0.28 - d * 0.1;
    } else {
      const temp = temperatureAt(geo, wx, wy), moist = moistureAt(geo, wx, wy);
      const bio = biomeOf({ temperature: temp, moisture: moist, elevation: h });
      r = bio.color[0] / 255; g = bio.color[1] / 255; b = bio.color[2] / 255;
      if (h > 0.72 && temp < 0.42) { const s = Math.min(1, (h - 0.72) / 0.16) * Math.min(1, (0.42 - temp) / 0.4); r += (0.92 - r) * s; g += (0.94 - g) * s; b += (0.96 - b) * s; }
      // damp, darker earth on the banks (the water itself is the ribbon mesh laid in the trough)
      if (ch > 0) { const t = ch * ch * 0.5; r *= 1 - t * 0.4; g *= 1 - t * 0.32; b *= 1 - t * 0.16; }
      // BIOME material class (design/28 #4): the ground the sim's climate actually laid down
      if (bio.id === 'desert') mSand = 1;
      else if (bio.id === 'wetland') mMud = 1;
      else if (bio.id === 'tundra') mSnow = 1;
      if (temp > 0.4) mSand = Math.max(mSand, Math.max(0, 1 - (h - sea) / 0.02)); // a warm beach at the waterline
      if (ch > 0) mGravel = ch * ch * 0.8; // a river lays a gravel shingle on its banks
    }
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
    mat[k * 4] = mSand; mat[k * 4 + 1] = mMud; mat[k * 4 + 2] = mSnow; mat[k * 4 + 3] = mGravel;
    pos[k * 3] = i * cell - half; pos[k * 3 + 1] = (h - sea) * VSCALE; pos[k * 3 + 2] = j * cell - half;
  }
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const k = j * RES + i;
    const hL = H[j * RES + Math.max(0, i - 1)], hR = H[j * RES + Math.min(RES - 1, i + 1)];
    const hD = H[Math.max(0, j - 1) * RES + i], hU = H[Math.min(RES - 1, j + 1) * RES + i];
    const nx = -(hR - hL) * VSCALE, nz = -(hU - hD) * VSCALE, ny = 2 * cell, l = Math.hypot(nx, ny, nz) || 1;
    nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
  }
  const idx = new Uint32Array((RES - 1) * (RES - 1) * 6);
  let p = 0;
  for (let j = 0; j < RES - 1; j++) for (let i = 0; i < RES - 1; i++) {
    const a = j * RES + i, c = a + RES;
    idx[p++] = a; idx[p++] = c; idx[p++] = a + 1; idx[p++] = a + 1; idx[p++] = c; idx[p++] = c + 1;
  }
  return { pos, col, nrm, idx, mat };
}

// --- structure primitives (flat-shaded, normals from winding) ---
function pushBox(A: Accum, x: number, by: number, z: number, sx: number, sy: number, sz: number, rot: number, r: number, g: number, b: number, m = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hz = sz / 2;
  const P: number[][] = [];
  for (const dy of [0, sy]) for (const dz of [-hz, hz]) for (const dx of [-hx, hx]) P.push([x + dx * c - dz * s, by + dy, z + dx * s + dz * c]);
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  for (const f of faces) {
    const a = P[f[0]], b2 = P[f[1]], cc = P[f[2]], d = P[f[3]];
    const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const [tt, bb] = faceBasis([nx, ny, nz]);
    const base = A.n;
    for (const q of [a, b2, cc, d]) { A.pos.push(q[0], q[1], q[2]); A.nrm.push(nx, ny, nz); A.col.push(r, g, b); pushUV(A, q, tt, bb, m); A.n++; }
    A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
function pushCone(A: Accum, x: number, by: number, z: number, rad: number, ht: number, r: number, g: number, b: number) {
  const SEG = 6, apex = A.n;
  // foliage stays PLAIN (mat 0): vertex colour only. The uv is still pushed — every attribute
  // array must stay index-aligned with `pos`, whether or not the shader reads it.
  A.pos.push(x, by + ht, z); A.nrm.push(0, 1, 0); A.col.push(r, g, b); A.uv.push(0, 0); A.mat.push(0); A.n++;
  const ring = A.n;
  for (let i = 0; i < SEG; i++) { const a = (i / SEG) * Math.PI * 2; const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad; A.pos.push(px, by, pz); A.nrm.push(Math.cos(a), 0.5, Math.sin(a)); A.col.push(r, g, b); A.uv.push(0, 0); A.mat.push(0); A.n++; }
  // outer faces FRONT-facing so a double-sided material lights them from outside (not flipped inward → black)
  for (let i = 0; i < SEG; i++) A.idx.push(apex, ring + ((i + 1) % SEG), ring + i);
}
/** a rounded canopy — a hexagonal bipyramid (top+bottom apex over a waist ring). Reads as a
 *  broadleaf/bush puff; normals point outward so a double-sided material lights it right. */
function pushBlob(A: Accum, x: number, by: number, z: number, rad: number, ht: number, r: number, g: number, b: number) {
  const SEG = 6, top = A.n;
  A.pos.push(x, by + ht, z); A.nrm.push(0, 1, 0); A.col.push(r, g, b); A.uv.push(0, 0); A.mat.push(0); A.n++;
  const bot = A.n; A.pos.push(x, by, z); A.nrm.push(0, -1, 0); A.col.push(r, g, b); A.uv.push(0, 0); A.mat.push(0); A.n++;
  const ring = A.n, midY = by + ht * 0.55;
  for (let i = 0; i < SEG; i++) { const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); A.pos.push(x + c * rad, midY, z + s * rad); A.nrm.push(c, 0.2, s); A.col.push(r, g, b); A.uv.push(0, 0); A.mat.push(0); A.n++; }
  for (let i = 0; i < SEG; i++) A.idx.push(top, ring + ((i + 1) % SEG), ring + i); // upper faces (front-facing out)
  for (let i = 0; i < SEG; i++) A.idx.push(bot, ring + i, ring + ((i + 1) % SEG)); // lower faces
}
/** parse a `rgb(r, g, b)` plan tone (0..255, darkened for the flat 2D map) into a lit 3D
 *  foliage colour — scaled back up so canopy reads bright under the sun, not muddy. */
function parseTone(s: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!s) return fallback;
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
  if (!m) return fallback;
  return [Math.min(1, (+m[1] / 255) * 1.6), Math.min(1, (+m[2] / 255) * 1.6), Math.min(1, (+m[3] / 255) * 1.6)];
}
function faceNormal(a: number[], b: number[], c: number[]): [number, number, number] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
function tri(A: Accum, p0: number[], p1: number[], p2: number[], r: number, g: number, b: number, m = 0) {
  const n = faceNormal(p0, p1, p2), [tt, bb] = faceBasis(n), base = A.n;
  for (const p of [p0, p1, p2]) { A.pos.push(p[0], p[1], p[2]); A.nrm.push(n[0], n[1], n[2]); A.col.push(r, g, b); pushUV(A, p, tt, bb, m); A.n++; }
  A.idx.push(base, base + 1, base + 2);
}
function quad(A: Accum, p0: number[], p1: number[], p2: number[], p3: number[], r: number, g: number, b: number, m = 0) {
  const n = faceNormal(p0, p1, p2), [tt, bb] = faceBasis(n), base = A.n;
  for (const p of [p0, p1, p2, p3]) { A.pos.push(p[0], p[1], p[2]); A.nrm.push(n[0], n[1], n[2]); A.col.push(r, g, b); pushUV(A, p, tt, bb, m); A.n++; }
  A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function pushRoof(A: Accum, x: number, by: number, z: number, w: number, d: number, roofH: number, rot: number, r: number, g: number, b: number, m = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  const tr = (lx: number, lz: number, ly: number) => [x + lx * c - lz * s, by + ly, z + lx * s + lz * c];
  if (w >= d) {
    const A0 = tr(-hw, -hd, 0), B0 = tr(hw, -hd, 0), C0 = tr(hw, hd, 0), D0 = tr(-hw, hd, 0), R0 = tr(-hw, 0, roofH), R1 = tr(hw, 0, roofH);
    quad(A, A0, B0, R1, R0, r, g, b, m); quad(A, D0, R0, R1, C0, r, g, b, m); tri(A, A0, R0, D0, r, g, b, m); tri(A, B0, C0, R1, r, g, b, m);
  } else {
    const A0 = tr(-hw, -hd, 0), B0 = tr(hw, -hd, 0), C0 = tr(hw, hd, 0), D0 = tr(-hw, hd, 0), R0 = tr(0, -hd, roofH), R1 = tr(0, hd, roofH);
    quad(A, A0, R0, R1, D0, r, g, b, m); quad(A, B0, C0, R1, R0, r, g, b, m); tri(A, A0, B0, R0, r, g, b, m); tri(A, D0, R1, C0, r, g, b, m);
  }
}
/** a 4-sided pyramid roof (apex over the centre) — a conical people's silhouette on a square base. */
function pushPyramid(A: Accum, x: number, by: number, z: number, w: number, d: number, ht: number, rot: number, r: number, g: number, b: number, m = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  const tr = (lx: number, lz: number, ly: number): number[] => [x + lx * c - lz * s, by + ly, z + lx * s + lz * c];
  const A0 = tr(-hw, -hd, 0), B0 = tr(hw, -hd, 0), C0 = tr(hw, hd, 0), D0 = tr(-hw, hd, 0), AP = tr(0, 0, ht);
  tri(A, A0, B0, AP, r, g, b, m); tri(A, B0, C0, AP, r, g, b, m); tri(A, C0, D0, AP, r, g, b, m); tri(A, D0, A0, AP, r, g, b, m);
}
/** a small rect on a box's FRONT (+z local) face, sat just proud of the wall — a door or window.
 *  Left PLAIN: a lit window is its own flat colour, and must not wear the wall's boards. */
function pushFront(A: Accum, cx: number, by: number, cz: number, d: number, rot: number, lx0: number, lx1: number, y0: number, y1: number, r: number, g: number, b: number) {
  const c = Math.cos(rot), s = Math.sin(rot), hd = d / 2 + 0.006;
  const tr = (lx: number, ly: number): number[] => [cx + lx * c - hd * s, by + ly, cz + lx * s + hd * c];
  quad(A, tr(lx0, y0), tr(lx1, y0), tr(lx1, y1), tr(lx0, y1), r, g, b);
}
/** a DWELLING in its culture's style (design/28 §3): coloured walls + roof, a gable/flat/conical
 *  roofline, an optional chimney, and a door + windows so it reads as a home (warm-lit if lived in).
 *  Wealth (`grand`) raises a taller, richer roof. */
function pushHouse(A: Accum, lx: number, by: number, lz: number, w: number, d: number, rot: number, style: ArchStyle, grand: boolean, inhabited: boolean) {
  const wallH = 0.16 * (grand ? 1.15 : 1);
  // the style names its own materials (design/28 §3) — its boards, its stones, its straw
  const wm = SURF[style.wallMat], rm = SURF[style.roofMat];
  pushBox(A, lx, by, lz, w, wallH, d, rot, style.wall[0], style.wall[1], style.wall[2], wm);
  const k = grand ? 0.9 : 1, rr = style.roof[0] * k, rg = style.roof[1] * k, rb = style.roof[2] * k, top = by + wallH;
  if (style.roofShape === 'flat') pushBox(A, lx, top, lz, w * 1.03, 0.03, d * 1.03, rot, rr, rg, rb, rm); // a thin clay slab, slight eave
  else if (style.roofShape === 'conical') pushPyramid(A, lx, top, lz, w * 1.05, d * 1.05, 0.2 * (grand ? 1.2 : 1), rot, rr, rg, rb, rm);
  else pushRoof(A, lx, top, lz, w, d, 0.13 * (grand ? 1.2 : 1), rot, rr, rg, rb, rm);
  if (style.chimney) {
    const c = Math.cos(rot), s = Math.sin(rot), ox = w * 0.3, oz = d * 0.12;
    pushBox(A, lx + ox * c - oz * s, top, lz + ox * s + oz * c, 0.024, 0.16, 0.024, rot, 0.3, 0.27, 0.24, SURF.masonry); // a stack is stone whatever the walls are
  }
  const win: [number, number, number] = inhabited ? [0.95, 0.78, 0.42] : [0.2, 0.22, 0.26]; // lit if a known family lives here
  pushFront(A, lx, by, lz, d, rot, -w * 0.09, w * 0.09, 0, wallH * 0.6, 0.14, 0.11, 0.09); // door
  pushFront(A, lx, by, lz, d, rot, -w * 0.4, -w * 0.22, wallH * 0.4, wallH * 0.78, win[0], win[1], win[2]); // window L
  pushFront(A, lx, by, lz, d, rot, w * 0.22, w * 0.4, wallH * 0.4, wallH * 0.78, win[0], win[1], win[2]); // window R
}
// A civic building answers to its FUNCTION, not to the local culture's dwellings: a lord's hall
// and a shrine are raised in stone under slate wherever they stand, a workshop in boards under
// straw. (Only houses wear the people's own style — that's what makes a town read as theirs.)
type RoofSpec = { wallH: number; roofH: number; wall: [number, number, number]; roof: [number, number, number]; wm: SurfaceMat; rm: SurfaceMat };
type BoxSpec = { h: number; col: [number, number, number]; m: SurfaceMat };
const ROOFED: Record<string, RoofSpec> = {
  house: { wallH: 0.16, roofH: 0.13, wall: [0.60, 0.50, 0.40], roof: [0.36, 0.22, 0.18], wm: 'plank', rm: 'thatch' },
  seat: { wallH: 0.34, roofH: 0.26, wall: [0.62, 0.54, 0.36], roof: [0.30, 0.24, 0.30], wm: 'masonry', rm: 'slate' },
  shrine: { wallH: 0.24, roofH: 0.34, wall: [0.56, 0.52, 0.60], roof: [0.34, 0.28, 0.42], wm: 'masonry', rm: 'slate' },
  tavern: { wallH: 0.20, roofH: 0.15, wall: [0.60, 0.48, 0.36], roof: [0.34, 0.22, 0.18], wm: 'plank', rm: 'thatch' },
  workshop: { wallH: 0.16, roofH: 0.12, wall: [0.55, 0.47, 0.40], roof: [0.32, 0.24, 0.20], wm: 'plank', rm: 'thatch' },
  warehouse: { wallH: 0.20, roofH: 0.12, wall: [0.56, 0.48, 0.42], roof: [0.33, 0.25, 0.22], wm: 'plank', rm: 'thatch' },
  boathouse: { wallH: 0.15, roofH: 0.11, wall: [0.55, 0.48, 0.42], roof: [0.32, 0.26, 0.22], wm: 'plank', rm: 'thatch' },
  minehead: { wallH: 0.20, roofH: 0.14, wall: [0.50, 0.46, 0.42], roof: [0.30, 0.27, 0.25], wm: 'plank', rm: 'plank' },
  mill: { wallH: 0.30, roofH: 0.22, wall: [0.60, 0.50, 0.40], roof: [0.34, 0.24, 0.20], wm: 'masonry', rm: 'slate' },
  granary: { wallH: 0.30, roofH: 0.20, wall: [0.60, 0.52, 0.36], roof: [0.35, 0.26, 0.18], wm: 'plank', rm: 'thatch' }, // a tall storehouse
  stall: { wallH: 0.08, roofH: 0.06, wall: [0.52, 0.42, 0.28], roof: [0.60, 0.36, 0.22], wm: 'plank', rm: 'plain' }, // a low awninged counter (the awning is cloth)
  watchtower: { wallH: 0.55, roofH: 0.16, wall: [0.36, 0.34, 0.29], roof: [0.24, 0.22, 0.20], wm: 'masonry', rm: 'slate' }, // a tall keep (war, design/28)
};
const BOXED: Record<string, BoxSpec> = {
  monument: { h: 0.9, col: [0.62, 0.58, 0.46], m: 'masonry' },
  tomb: { h: 0.24, col: [0.46, 0.46, 0.48], m: 'masonry' },
  stone: { h: 0.34, col: [0.52, 0.52, 0.54], m: 'masonry' },
  shell: { h: 0.14, col: [0.22, 0.20, 0.18], m: 'masonry' }, // a burned-out stone shell
  well: { h: 0.12, col: [0.44, 0.42, 0.38], m: 'masonry' }, // a low stone ring
  grave: { h: 0.08, col: [0.50, 0.49, 0.46], m: 'masonry' }, // a headstone (design/28)
  scaffold: { h: 0.18, col: [0.54, 0.44, 0.28], m: 'plank' }, // a rising frame (design/28)
};
const FS = 1.15; // footprint scale — a touch above real so buildings read, but not chunky/merging

/** Extrude the town PLAN onto the terrain: roofed buildings, monuments, walls, trees, and
 *  streets/fields DRAPED on the surface — each seated on the real height at its footprint. */
export function buildStructures(plan: LocalPlan, geo: Geography, cx: number, cy: number, span: number, seed: number): Accum {
  const A = newAccum(), sea = geo.seaLevel, half = span / 2;
  const chains = riverChains(geo, cx, cy, span); // carve the SAME channel the terrain does, so riverside buildings sit on the true surface
  const rawY = (wx: number, wy: number) => (channeledElev(geo, chains, wx, wy, seed).elev - sea) * VSCALE;
  const surfY = (wx: number, wy: number) => Math.max(0, rawY(wx, wy));
  const inFrame = (wx: number, wy: number) => Math.abs(wx - cx) <= half && Math.abs(wy - cy) <= half;
  for (const it of plan.items) {
    if (it.kind === 'building') {
      if (!inFrame(it.x, it.y)) continue;
      const w = Math.max(0.1, it.w * FS), d = Math.max(0.1, it.h * FS), by = surfY(it.x, it.y), lx = it.x - cx, lz = it.y - cy;
      const rf = ROOFED[it.role];
      if (it.derelict) {
        // a DERELICT house (design/28): roofless, weathered walls — a hollow shell, no roof.
        // Still its people's walling: an abandoned house is one THEY built, only left to rot.
        const dm = it.arch && ARCH_BY_ID[it.arch] ? SURF[ARCH_BY_ID[it.arch].wallMat] : SURF.plank;
        pushBox(A, lx, by, lz, w, (rf?.wallH ?? 0.14) * 0.75, d, it.rot, 0.34, 0.33, 0.27, dm);
      } else if (it.role === 'house' && it.arch && ARCH_BY_ID[it.arch]) {
        // a DWELLING in its culture's architecture (design/28 §3)
        pushHouse(A, lx, by, lz, w, d, it.rot, ARCH_BY_ID[it.arch], it.shape === 'compound' || it.tone === 'grand', !!it.inhabited);
      } else if (rf) {
        pushBox(A, lx, by, lz, w, rf.wallH, d, it.rot, rf.wall[0], rf.wall[1], rf.wall[2], SURF[rf.wm]);
        pushRoof(A, lx, by + rf.wallH, lz, w, d, rf.roofH, it.rot, rf.roof[0], rf.roof[1], rf.roof[2], SURF[rf.rm]);
      } else {
        const bx = BOXED[it.role] ?? { h: 0.3, col: [0.4, 0.35, 0.3] as [number, number, number], m: 'masonry' as SurfaceMat };
        pushBox(A, lx, by, lz, w, bx.h, d, it.rot, bx.col[0], bx.col[1], bx.col[2], SURF[bx.m]);
      }
    } else if (it.kind === 'wall' || it.kind === 'barricade' || it.kind === 'bridge') {
      // a town wall is coursed stone; a bridge and a hasty barricade are timber
      const wm = it.kind === 'wall' ? SURF.masonry : SURF.plank;
      const wcol: [number, number, number] = it.kind === 'bridge' ? [0.30, 0.24, 0.17] : [0.42, 0.38, 0.33];
      const wh = it.kind === 'bridge' ? 0.1 : 0.42;
      for (let i = 0; i + 1 < it.pts.length; i++) {
        const p0 = it.pts[i], p1 = it.pts[i + 1], mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        if (!inFrame(mx, my)) continue;
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y), ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        pushBox(A, mx - cx, surfY(mx, my), my - cy, len, wh, Math.max(0.05, it.width * 1.6), ang, wcol[0], wcol[1], wcol[2], wm);
      }
    } else if (it.kind === 'tree') {
      if (!inFrame(it.x, it.y)) continue;
      const tx = it.x - cx, tz = it.y - cy, ty = surfY(it.x, it.y), r = Math.max(0.04, it.r);
      const [cr, cg, cb] = parseTone(it.tone, [0.20, 0.42, 0.18]);
      const TK = 0.30, TG = 0.22, TB = 0.15; // bark
      const form = it.form ?? 'broadleaf';
      if (form === 'conifer') {
        // a fir: a short trunk under two stacked cones
        pushBox(A, tx, ty, tz, r * 0.5, r * 1.4, r * 0.5, 0, TK, TG, TB);
        pushCone(A, tx, ty + r * 1.1, tz, r * 2.0, 0.30 + r * 3, cr, cg, cb);
        pushCone(A, tx, ty + r * 2.6, tz, r * 1.3, 0.22 + r * 2, cr, cg, cb);
      } else if (form === 'palm') {
        // a tall bare trunk under a wide flat crown
        pushBox(A, tx, ty, tz, r * 0.42, r * 5, r * 0.42, 0, TK, TG, TB);
        pushBlob(A, tx, ty + r * 4.6, tz, r * 2.4, r * 1.4, cr, cg, cb);
      } else if (form === 'reed') {
        // a tuft of thin spikes at the waterline
        for (let k = 0; k < 3; k++) {
          const ox = (k - 1) * r * 0.5;
          pushCone(A, tx + ox, ty, tz + ox * 0.4, r * 0.35, r * 4, cr, cg, cb);
        }
      } else if (form === 'scrub') {
        // a low round bush, no clear trunk
        pushBlob(A, tx, ty, tz, r * 1.5, r * 2.2, cr, cg, cb);
      } else {
        // broadleaf / orchard — a trunk under a rounded canopy
        pushBox(A, tx, ty, tz, r * 0.5, r * 1.3, r * 0.5, 0, TK, TG, TB);
        pushBlob(A, tx, ty + r * 1.1, tz, r * 2.2, r * 3, cr, cg, cb);
      }
    } else if (it.kind === 'person') {
      // a small standing figure — a cloaked body under a head (design/27 §3, 3D)
      if (!inFrame(it.x, it.y)) continue;
      const by = surfY(it.x, it.y), lx = it.x - cx, lz = it.y - cy;
      const child = it.tone === 'child';
      // a person stands ~1/3 the height of a cottage — small (was nearly house-height)
      const bodyH = child ? 0.055 : 0.085, bw = child ? 0.024 : 0.03, headS = child ? 0.022 : 0.028;
      const body: [number, number, number] = it.tone === 'notable' ? [0.54, 0.44, 0.24] : it.tone === 'mourner' ? [0.22, 0.20, 0.24] : [0.42, 0.36, 0.28];
      pushBox(A, lx, by, lz, bw, bodyH, bw, it.facing, body[0], body[1], body[2]);
      pushBox(A, lx, by + bodyH, lz, headS, headS, headS, it.facing, 0.72, 0.58, 0.46);
    }
  }
  return A;
}

/** The RIVER SURFACE — a continuous water ribbon laid along each connected course, sitting in
 *  the carved channel floor (so it reads as one flowing watercourse, not disjoint pools). Flat
 *  across its width; its floor clamps to sea level near the mouth so it meets the sea plane. */
export function buildRiverMesh(geo: Geography, cx: number, cy: number, span: number, seed: number): Accum {
  const A = newAccum(), sea = geo.seaLevel, half = span / 2;
  A.sea = []; // per-vertex 0 (freshwater) … 1 (sea) so the ribbon fades into the sea shader at the mouth
  const chains = riverChains(geo, cx, cy, span);
  const inFrame = (x: number, y: number) => Math.abs(x - cx) <= half + 0.6 && Math.abs(y - cy) <= half + 0.6;
  const push = (q: number[], s: number) => { A.pos.push(q[0], q[1], q[2]); A.nrm.push(0, 1, 0); A.col.push(0.2, 0.4, 0.49); A.sea!.push(s); A.uv.push(0, 0); A.mat.push(0); A.n++; };
  for (const chain of chains) {
    const pts = chain.pts;
    if (pts.length < 2) continue;
    const R = chain.width * 1.5 + 0.16; // the trough half-width (matches channelAt)
    const hw = R * 0.85; // the water fills most of the trough; the banks frame it and occlude the excess
    let prevL: number[] | null = null, prevRp: number[] | null = null, prevIn = false, prevSea = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx; // perpendicular to the flow
      // sit the water surface part-way UP the smooth trough (not at the buried floor), so it
      // clears the bed and reads as water; clamp to the sea plane at the mouth.
      const bed = channeledElev(geo, chains, p.x, p.y, seed).elev;
      const waterElev = bed + CHANNEL_DEPTH * 0.7;
      const fy = Math.max(0, (waterElev - sea) * VSCALE) + 0.03;
      // near sea level the water blends fully to the sea's own shader; well inland it's bright freshwater
      const curSea = 1 - Math.max(0, Math.min(1, (waterElev - sea) / 0.045));
      const L = [p.x + nx * hw - cx, fy, p.y + ny * hw - cy];
      const Rp = [p.x - nx * hw - cx, fy, p.y - ny * hw - cy];
      const here = inFrame(p.x, p.y);
      if (prevL && prevRp && (here || prevIn)) {
        const base = A.n;
        push(prevL, prevSea); push(prevRp, prevSea); push(Rp, curSea); push(L, curSea);
        A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      prevL = L; prevRp = Rp; prevIn = here; prevSea = curSea;
    }
  }
  return A;
}

export interface RoadAccum { pos: number[]; nrm: number[]; col: number[]; uv: number[]; idx: number[]; n: number }
/** The ROAD network as its own TEXTURED mesh: dirt-track ribbons that hug the terrain (densified
 *  so they never float over bumps), UV-mapped so a packed-earth texture tiles along their length.
 *  Renders the worn "packed" band (paler shoulders) and the road track (darker) on top. */
export function buildRoadMesh(plan: LocalPlan, geo: Geography, cx: number, cy: number, span: number, seed: number): RoadAccum {
  const A: RoadAccum = { pos: [], nrm: [], col: [], uv: [], idx: [], n: 0 };
  const sea = geo.seaLevel, half = span / 2;
  const chains = riverChains(geo, cx, cy, span);
  const rawY = (wx: number, wy: number) => (channeledElev(geo, chains, wx, wy, seed).elev - sea) * VSCALE;
  const inFrame = (x: number, y: number) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
  const TEX = 0.22; // world units per dirt tile — small so the gravel/rut detail reads on a narrow road
  const mottle = (x: number, y: number) => { const h = Math.sin(x * 57.3 + y * 39.1) * 43758.5453; return 0.86 + 0.26 * (h - Math.floor(h)); };
  const vert = (q: number[], u: number, v: number, tint: [number, number, number], m: number) => { A.pos.push(q[0], q[1], q[2]); A.nrm.push(0, 1, 0); A.col.push(tint[0] * m, tint[1] * m, tint[2] * m); A.uv.push(u, v); A.n++; };
  const strip = (pts: { x: number; y: number }[], width: number, tint: [number, number, number], yoff: number) => {
    const dense: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p0 = pts[i], p1 = pts[i + 1], segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y), steps = Math.max(1, Math.ceil(segLen / 0.1));
      for (let s = 0; s < steps; s++) dense.push({ x: p0.x + (p1.x - p0.x) * s / steps, y: p0.y + (p1.y - p0.y) * s / steps });
    }
    if (pts.length) dense.push(pts[pts.length - 1]);
    if (dense.length < 2) return;
    const hw = width / 2, uR = width / TEX;
    const segDir = (i: number) => { const a = dense[i], b = dense[i + 1]; let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    // MITER the cross-section at each vertex so the strip keeps a constant width around bends
    // (no narrowing/jagged notches); clamped to a 2× limit so a hairpin bevels instead of spiking.
    const miter = (i: number) => {
      const d0 = segDir(Math.max(0, i - 1)), d1 = segDir(Math.min(dense.length - 2, i));
      const n0x = -d0[1], n0y = d0[0], n1x = -d1[1], n1y = d1[0];
      let mx = n0x + n1x, my = n0y + n1y; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      return { mx, my, len: hw / Math.max(0.5, mx * n0x + my * n0y) };
    };
    let prevL: number[] | undefined, prevR: number[] | undefined, prevV = 0, prevM = 1, cum = 0;
    for (let i = 0; i < dense.length; i++) {
      const p = dense[i];
      if (i > 0) cum += Math.hypot(p.x - dense[i - 1].x, p.y - dense[i - 1].y);
      if (!inFrame(p.x, p.y)) { prevL = prevR = undefined; continue; }
      const { mx, my, len } = miter(i);
      const lx = p.x + mx * len, ly = p.y + my * len, rx = p.x - mx * len, ry = p.y - my * len;
      const L = [lx - cx, rawY(lx, ly) + yoff, ly - cy], R = [rx - cx, rawY(rx, ry) + yoff, ry - cy];
      const v = cum / TEX, m = mottle(p.x, p.y);
      if (prevL && prevR) {
        const base = A.n;
        vert(prevL, 0, prevV, tint, prevM); vert(prevR, uR, prevV, tint, prevM); vert(R, uR, v, tint, m); vert(L, 0, v, tint, m);
        A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      prevL = L; prevR = R; prevV = v; prevM = m;
    }
    // ROUNDED END CAPS — a half-disc so a road TAPERS to a rounded end and streets meeting at a
    // shared point blend into a smooth junction instead of colliding as sharp rectangles.
    const cap = (idx: number, dir: number, v: number) => {
      const p = dense[idx];
      if (!inFrame(p.x, p.y)) return;
      const t = segDir(idx === 0 ? 0 : dense.length - 2), aL = Math.atan2(t[0], -t[1]); // angle to the left edge
      const SEG = 7, m = mottle(p.x, p.y), yv = rawY(p.x, p.y) + yoff, base = A.n;
      A.pos.push(p.x - cx, yv, p.y - cy); A.nrm.push(0, 1, 0); A.col.push(tint[0] * m, tint[1] * m, tint[2] * m); A.uv.push(0.5, v); A.n++;
      for (let s = 0; s <= SEG; s++) {
        const ang = aL - dir * Math.PI * (s / SEG), px = p.x + Math.cos(ang) * hw, py = p.y + Math.sin(ang) * hw;
        vert([px - cx, rawY(px, py) + yoff, py - cy], 0.5 + Math.cos(ang - aL) * 0.5, v, tint, m);
      }
      for (let s = 0; s < SEG; s++) A.idx.push(base, base + 1 + s, base + 2 + s);
    };
    cap(0, -1, 0); cap(dense.length - 1, 1, cum / TEX);
  };
  for (const it of plan.items) {
    if (it.kind === 'packed') strip(it.pts, Math.max(0.1, it.width), [1.06, 1.02, 0.95], 0.03); // worn shoulders, paler
    else if (it.kind === 'street') strip(it.pts, Math.max(0.07, it.width * 1.9), [0.92, 0.86, 0.78], 0.05); // the track, a touch darker
  }
  return A;
}

/** The FIELDS as their own TEXTURED mesh: each plot a terrain-conforming grid (not a flat
 *  floating quad), UV-mapped to a ploughed crop-row texture aligned to the plot's orientation. */
export function buildFieldMesh(plan: LocalPlan, geo: Geography, cx: number, cy: number, span: number, seed: number): RoadAccum {
  const A: RoadAccum = { pos: [], nrm: [], col: [], uv: [], idx: [], n: 0 };
  const sea = geo.seaLevel, half = span / 2;
  const chains = riverChains(geo, cx, cy, span);
  const rawY = (wx: number, wy: number) => (channeledElev(geo, chains, wx, wy, seed).elev - sea) * VSCALE;
  const inFrame = (x: number, y: number) => Math.abs(x - cx) <= half && Math.abs(y - cy) <= half;
  const TEX = 0.6; // world units per field-texture tile
  for (const it of plan.items) {
    if (it.kind !== 'field' && it.kind !== 'terrace') continue;
    if (!inFrame(it.x, it.y)) continue;
    const co = Math.cos(it.rot), si = Math.sin(it.rot), hw = it.w / 2, hh = it.h / 2;
    const NX = Math.max(2, Math.ceil(it.w / 0.12)), NY = Math.max(2, Math.ceil(it.h / 0.12)); // conform to bumps
    // crop tint (design/28 §5) — green vineyards, a paddy's blue-green sheen, golden grain
    const crop = it.kind === 'field' ? it.crop : undefined;
    const tint: [number, number, number] =
      crop === 'vine' ? [0.74, 0.9, 0.6] :
      crop === 'paddy' ? [0.72, 0.92, 0.88] :
      it.kind === 'terrace' ? [0.86, 0.94, 0.74] : [1, 1, 1];
    const start = A.n;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const lx = -hw + it.w * (i / NX), lz = -hh + it.h * (j / NY);
      const wx = it.x + lx * co - lz * si, wy = it.y + lx * si + lz * co;
      A.pos.push(wx - cx, rawY(wx, wy) + 0.02, wy - cy);
      A.nrm.push(0, 1, 0);
      A.col.push(tint[0], tint[1], tint[2]);
      A.uv.push(lx / TEX, lz / TEX);
      A.n++;
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = start + j * (NX + 1) + i, b = a + 1, c = a + (NX + 1), d = c + 1;
      A.idx.push(a, c, d, a, d, b);
    }
  }
  return A;
}
