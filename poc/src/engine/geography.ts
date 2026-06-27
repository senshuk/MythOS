/**
 * The world's PHYSICAL geography — generated deterministically from the seed, as the
 * SUBSTRATE the simulation is built on (not decoration). It holds only universal,
 * physical fields (elevation, moisture, water, fertility) over a grid spanning the
 * [0,100] world plane; a Universe Pack interprets these into biomes/resources/yields.
 *
 * Settlement placement, local resources, economy and development all derive from this:
 * civilizations are founded where the land is generous (fresh water, arable soil,
 * coasts, defensible high ground) — geography is the prime mover.
 *
 * Pure function of the seed, so it is never serialized: it is regenerated identically
 * on load, and the UI regenerates the same grid to render the real world.
 */

export const WATER_NONE = 0;
export const WATER_SEA = 1;
export const WATER_LAKE = 2;
export const WATER_RIVER = 3;
export type WaterKind = 0 | 1 | 2 | 3;

export const GEO_SIZE = 128; // grid resolution over the 100×100 world plane
export const SEA_LEVEL = 0.4;

export interface Geography {
  size: number;
  seaLevel: number;
  elevation: Float32Array; // 0..1
  moisture: Float32Array; // 0..1
  fertility: Float32Array; // 0..1 (arable potential; 0 in water/mountain)
  water: Uint8Array; // WaterKind per cell
  /** distance (in cells) to the nearest fresh water (river/lake); large if none near. */
  freshDist: Uint16Array;
  /** distance (in cells) to the nearest sea cell. */
  seaDist: Uint16Array;
}

// --- tiny seeded value noise (the single source of the world's shape) -------
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

const FREQ = 0.05; // world-units → noise scale (smaller = larger landmasses)

/** Generate the world's geography. Deterministic from `seed`. */
export function generateGeography(seed: number, size = GEO_SIZE): Geography {
  const N = size;
  const NN = N * N;
  const elevation = new Float32Array(NN);
  const moisture = new Float32Array(NN);
  const water = new Uint8Array(NN);
  const fertility = new Float32Array(NN);

  // 1) elevation (base fbm + ridged detail for mountain ranges) + moisture
  for (let j = 0; j < N; j++) {
    const wy = (j / N) * 100;
    for (let i = 0; i < N; i++) {
      const wx = (i / N) * 100;
      let e = fbm(wx * FREQ, wy * FREQ, seed, 5);
      e = e * 0.82 + (0.5 - Math.abs(fbm(wx * FREQ * 2.4, wy * FREQ * 2.4, seed + 99, 3) - 0.5)) * 0.36;
      const k = j * N + i;
      elevation[k] = e > 1 ? 1 : e;
      moisture[k] = fbm(wx * FREQ * 0.85 + 40, wy * FREQ * 0.85 + 40, seed + 7, 3);
    }
  }

  // 2) seas: flood-fill below-sea-level cells reachable from the map border. Below-
  //    sea-level cells NOT reachable become inland lakes.
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) {
      if (elevation[k] < SEA_LEVEL && water[k] === WATER_NONE) {
        water[k] = WATER_SEA;
        queue.push(k);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const x = k % N;
    const y = (k / N) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (water[nk] === WATER_NONE && elevation[nk] < SEA_LEVEL) {
        water[nk] = WATER_SEA;
        queue.push(nk);
      }
    }
  }
  for (let k = 0; k < NN; k++) {
    if (elevation[k] < SEA_LEVEL && water[k] === WATER_NONE) water[k] = WATER_LAKE;
  }

  // 3) rivers: from scattered high cells, follow steepest descent to water; mark river.
  const NEI8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
  const tries = Math.floor(NN / 900);
  for (let s = 0; s < tries; s++) {
    let x = Math.floor(hash2(s, 5, seed + 300) * N);
    let y = Math.floor(hash2(s, 6, seed + 300) * N);
    if (elevation[y * N + x] < 0.66) continue; // sources start high
    const path: number[] = [y * N + x];
    for (let step = 0; step < N * 2; step++) {
      let bx = x;
      let by = y;
      let be = elevation[y * N + x];
      for (const [dx, dy] of NEI8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const e = elevation[ny * N + nx];
        if (e < be) {
          be = e;
          bx = nx;
          by = ny;
        }
      }
      if (bx === x && by === y) break; // stuck in a basin
      x = bx;
      y = by;
      const k = y * N + x;
      path.push(k);
      if (water[k] === WATER_SEA || water[k] === WATER_LAKE) break; // reached open water
    }
    if (path.length < N / 12) continue; // too short to be a river
    for (const k of path) if (water[k] === WATER_NONE) water[k] = WATER_RIVER;
  }

  // 4) distance fields: BFS out from fresh water and from sea (used for fertility + siting)
  const freshDist = bfsDistance(water, N, (w) => w === WATER_RIVER || w === WATER_LAKE);
  const seaDist = bfsDistance(water, N, (w) => w === WATER_SEA);

  // 5) fertility: arable potential. Best in moist lowlands near fresh water; none in
  //    water or on bare mountains.
  for (let k = 0; k < NN; k++) {
    if (water[k] !== WATER_NONE) {
      fertility[k] = 0;
      continue;
    }
    const e = elevation[k];
    const elevFit = e < 0.45 ? 0.5 : e < 0.62 ? 1 : e < 0.74 ? 0.6 : e < 0.86 ? 0.25 : 0.05; // lowlands best
    const waterBoost = freshDist[k] <= 2 ? 0.35 : freshDist[k] <= 5 ? 0.18 : 0;
    fertility[k] = Math.min(1, moisture[k] * 0.7 * elevFit + waterBoost);
  }

  return { size: N, seaLevel: SEA_LEVEL, elevation, moisture, fertility, water, freshDist, seaDist };
}

/** Multi-source BFS distance (in cells) to the nearest cell matching `is`. */
function bfsDistance(water: Uint8Array, N: number, is: (w: number) => boolean): Uint16Array {
  const dist = new Uint16Array(N * N).fill(0xffff);
  const q: number[] = [];
  for (let k = 0; k < N * N; k++) {
    if (is(water[k])) {
      dist[k] = 0;
      q.push(k);
    }
  }
  for (let i = 0; i < q.length; i++) {
    const k = q[i];
    const x = k % N;
    const y = (k / N) | 0;
    const nd = dist[k] + 1;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (nd < dist[nk]) {
        dist[nk] = nd;
        q.push(nk);
      }
    }
  }
  return dist;
}

// --- sampling (world coords 0..100) -----------------------------------------
function clampIdx(v: number, N: number): number {
  const i = Math.round((v / 100) * (N - 1));
  return i < 0 ? 0 : i > N - 1 ? N - 1 : i;
}
function cellOf(geo: Geography, x: number, y: number): number {
  return clampIdx(y, geo.size) * geo.size + clampIdx(x, geo.size);
}
export function elevationAt(geo: Geography, x: number, y: number): number {
  return geo.elevation[cellOf(geo, x, y)];
}
export function waterAt(geo: Geography, x: number, y: number): WaterKind {
  return geo.water[cellOf(geo, x, y)] as WaterKind;
}
export function fertilityAt(geo: Geography, x: number, y: number): number {
  return geo.fertility[cellOf(geo, x, y)];
}
export function moistureAt(geo: Geography, x: number, y: number): number {
  return geo.moisture[cellOf(geo, x, y)];
}

/**
 * How much population/development the land here can sustain, as a multiplier on the
 * base carrying capacity. Fertile, well-watered, coastal ground supports large cities
 * (think floodplains and ports); harsh, dry, isolated ground supports only villages.
 */
export function terrainCapacity(geo: Geography, x: number, y: number): number {
  const fert = fertilityAt(geo, x, y);
  let c = 0.55 + fert * 0.95;
  if (freshWaterDist(geo, x, y) <= 1) c += 0.25; // on a river
  if (seaDist(geo, x, y) <= 3) c += 0.2; // a port
  return c; // ≈ 0.55 (barren) … 1.9 (a fertile river-coast)
}
export function isLand(geo: Geography, x: number, y: number): boolean {
  const w = geo.water[cellOf(geo, x, y)];
  return w === WATER_NONE || w === WATER_RIVER;
}
/** cells-distance to the nearest fresh water at this point. */
export function freshWaterDist(geo: Geography, x: number, y: number): number {
  return geo.freshDist[cellOf(geo, x, y)];
}
/** cells-distance to the nearest sea (coast) at this point. */
export function seaDist(geo: Geography, x: number, y: number): number {
  return geo.seaDist[cellOf(geo, x, y)];
}

/**
 * How good a site this is to FOUND a settlement — the heart of "geography drives the
 * civilization". Returns -1 if unviable (in water, or no fresh water within reach).
 * Otherwise rewards fresh water (paramount), fertile soil, coastal access, and
 * defensible high ground; penalises bare peaks. (Pack-agnostic — purely physical.)
 */
export function siteSuitability(geo: Geography, x: number, y: number): number {
  if (!isLand(geo, x, y)) return -1;
  const fresh = freshWaterDist(geo, x, y);
  if (fresh > 8) return -1; // a people cannot live without fresh water
  const sea = seaDist(geo, x, y);
  const e = elevationAt(geo, x, y);
  const fert = fertilityAt(geo, x, y);
  let s = 0;
  s += Math.max(0, 1 - fresh / 8) * 3.0; // fresh water is everything
  s += fert * 2.6; // arable land for food
  s += Math.max(0, 1 - sea / 14) * 1.6; // a coastline for fish & trade
  s += e > 0.5 && e < 0.72 ? 0.8 : 0; // defensible high ground
  s -= e > 0.85 ? 1.6 : 0; // not on a bare mountaintop
  return s;
}

/** A short reason a site is good, for legends/UI ("a river town", "a coastal city"). */
export function siteEpithet(geo: Geography, x: number, y: number): string {
  const sea = seaDist(geo, x, y);
  const fresh = freshWaterDist(geo, x, y);
  const onRiver = waterAt(geo, x, y) === WATER_RIVER || fresh <= 1;
  if (sea <= 2) return 'a coastal settlement';
  if (onRiver) return 'a river settlement';
  if (fertilityAt(geo, x, y) > 0.55) return 'a settlement of rich farmland';
  if (elevationAt(geo, x, y) > 0.7) return 'a hill settlement';
  return 'an inland settlement';
}
