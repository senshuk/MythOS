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

export const GEO_SIZE = 208; // grid resolution across the (now much larger) world extent

/** Default fraction of terrain below which a cell holds water. It is a PARAMETER, not
 *  a law: a dry/desert world passes a low value (few or no seas — just basins), a water
 *  world a high one. Nothing in the engine assumes a world has oceans. */
export const SEA_LEVEL = 0.4;

/** The world-coordinate span the geography grid covers. It is deliberately LARGER than
 *  the [0,100] settlement plane, so the map can render terrain past the settled area
 *  instead of smearing the grid's edge cells to fill its margin. The grid edge carries
 *  no meaning — land may run right off it; it is not a coastline. */
export const GEO_MIN = -15;
export const GEO_SPAN = 200;

/** Terrain relief classes, derived from local elevation contrast (RimWorld's
 *  hilliness, as data): 0 flat · 1 rolling · 2 hills · 3 mountainous. */
export const HILL_FLAT = 0;
export const HILL_ROLLING = 1;
export const HILL_HILLS = 2;
export const HILL_MOUNTAIN = 3;
export type Hilliness = 0 | 1 | 2 | 3;

/**
 * A notable geographic FEATURE the generator identified — a sea, a lake, a mountain
 * range, a great river. Pure geometry + identity; the PACK names it (a culture's
 * tongue), the UI labels it. `center` is in world coordinates; `cells` is its extent.
 */
export interface GeoFeature {
  kind: 'sea' | 'lake' | 'range' | 'river';
  /** stable per-world index (deterministic naming seed). */
  index: number;
  center: { x: number; y: number };
  cells: number;
}

export interface Geography {
  size: number;
  seaLevel: number;
  elevation: Float32Array; // 0..1
  moisture: Float32Array; // 0..1 (wind-advected: wet windward coasts, dry rain shadows)
  temperature: Float32Array; // 0..1 (cold→hot): latitude − elevation lapse + the world's climate
  fertility: Float32Array; // 0..1 (arable potential; 0 in water/mountain)
  water: Uint8Array; // WaterKind per cell
  /** accumulated drainage (rainfall routed downhill) per cell — a river's SIZE.
   *  0 off-river; grows downstream, so mouths read wider than springs. */
  flux: Float32Array;
  /** relief class per cell (flat/rolling/hills/mountainous) from local contrast. */
  hilliness: Uint8Array;
  /** the prevailing wind, as one of 8 compass steps (dx,dy in cell space) — the
   *  cause behind the moisture map (legibility: "why is this side desert?"). */
  wind: { dx: number; dy: number };
  /** notable named-by-the-pack features: seas, lakes, ranges, great rivers. */
  features: GeoFeature[];
  /** per-cell membership: the index of the feature this cell belongs to, or -1. Lets a
   *  settlement learn which landmark it sits beside (`nearestFeatureAt`). */
  featureOf: Int16Array;
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

// the 8 compass steps, used for wind, flow and relief (declared once, deterministic order)
const NEI8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/** How much accumulated drainage makes a cell a river (tuned to GEO_SIZE catchments). */
export const RIVER_FLUX = 60;
/** Drainage above this reads as a GREAT river (a nameable feature, drawn wider). */
export const GREAT_RIVER_FLUX = 300;

/**
 * Generate the world's geography. Deterministic from `seed`. `seaLevel` controls how
 * wet the world is (dry/desert → low, water world → high); `freq` sets the noise scale
 * (smaller = larger, smoother landmasses; larger = broken-up, island-y terrain).
 *
 * The climate is CAUSAL, not painted (the RimWorld worldgen lesson): a prevailing wind
 * carries humidity off the seas inland; rising ground wrings it out as rain, leaving a
 * rain shadow beyond the ranges. Rivers then FOLLOW the rain — every cell's rainfall
 * drains downhill (depressions filled), and where enough catchment gathers, a river
 * runs to the sea, growing as tributaries join. So deserts sit behind mountains, big
 * rivers rise in wet highlands, and "why is this here?" always has a physical answer.
 */
export function generateGeography(seed: number, size = GEO_SIZE, seaLevel = SEA_LEVEL, freq = FREQ, baseTemp = 0, wetness = 0): Geography {
  const N = size;
  const NN = N * N;
  const elevation = new Float32Array(NN);
  const moisture = new Float32Array(NN);
  const temperature = new Float32Array(NN);
  const water = new Uint8Array(NN);
  const fertility = new Float32Array(NN);
  const wOf = (i: number) => GEO_MIN + (i / (N - 1)) * GEO_SPAN;

  // 1) elevation (base fbm + ridged detail for mountain ranges) and TEMPERATURE —
  //    colder toward one pole (latitude) and with altitude (mountains keep snow),
  //    shifted by the world's overall climate (baseTemp: an ice world vs a hot one).
  for (let j = 0; j < N; j++) {
    const wy = wOf(j);
    const lat = (wy - GEO_MIN) / GEO_SPAN; // 0 (one pole) … 1 (the other)
    for (let i = 0; i < N; i++) {
      const wx = wOf(i);
      let e = fbm(wx * freq, wy * freq, seed, 5);
      e = e * 0.82 + (0.5 - Math.abs(fbm(wx * freq * 2.4, wy * freq * 2.4, seed + 99, 3) - 0.5)) * 0.36;
      const k = j * N + i;
      const elev = e < 0 ? 0 : e > 1 ? 1 : e;
      elevation[k] = elev;
      // temperature: the world's CLIMATE (baseTemp) dominates; the in-map latitude band is
      // gentle (a region, not a whole hemisphere) so a world reads as one climate — frozen,
      // temperate, or scorching — instead of every world having the same cold→hot stripe.
      const tNoise = fbm(wx * freq * 1.3 + 90, wy * freq * 1.3 + 90, seed + 23, 2);
      const t = baseTemp + 0.42 + lat * 0.34 - elev * 0.42 + (tNoise - 0.5) * 0.2;
      temperature[k] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }

  // 2) water bodies. Every below-sea-level cell holds water; classify each connected
  //    body by SIZE — a large body is a SEA/ocean, a small one an inland LAKE. The map
  //    border is NOT assumed to be ocean: a world may be a continent with only lakes,
  //    an archipelago, mostly sea, or — at a low sea level — nearly dry.
  const SEA_MIN_CELLS = NN * 0.03; // a water body larger than ~3% of the world is a sea
  const seen = new Uint8Array(NN);
  const stack: number[] = [];
  const bodies: { kind: 1 | 2; cells: number[] }[] = [];
  for (let start = 0; start < NN; start++) {
    if (seen[start] || elevation[start] >= seaLevel) continue;
    const body: number[] = [];
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop() as number;
      body.push(k);
      const x = k % N;
      const y = (k / N) | 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nk = ny * N + nx;
        if (!seen[nk] && elevation[nk] < seaLevel) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    const kind = body.length >= SEA_MIN_CELLS ? WATER_SEA : WATER_LAKE;
    for (const k of body) water[k] = kind;
    bodies.push({ kind, cells: body });
  }

  // 3) MOISTURE by wind advection (rain shadow). A seeded prevailing wind marches
  //    across the map; air picks up humidity over water and loses it as rain — hard
  //    when the ground rises (orographic lift). Windward coasts are lush; the far
  //    side of a range is desert. A little noise breaks up the bands; `wetness`
  //    shifts the whole world (arid pack vs rainforest pack).
  const wind = NEI8[Math.floor(hash2(11, 13, seed + 777) * 8) % 8];
  const humidity = new Float32Array(NN);
  advectMoisture(elevation, water, humidity, moisture, N, wind[0], wind[1], seaLevel);
  for (let k = 0; k < NN; k++) {
    const noise = fbm((k % N) * 0.11 + 40, ((k / N) | 0) * 0.11 + 40, seed + 7, 2) - 0.5;
    const m = moisture[k] + noise * 0.18 + wetness;
    moisture[k] = m < 0 ? 0 : m > 1 ? 1 : m;
  }

  // 4) RIVERS from drainage. Fill depressions so every land cell has a way down,
  //    give each cell its rainfall (moisture), and route it downhill; where enough
  //    catchment gathers, a river runs — growing wider as tributaries join.
  const filled = fillDepressions(elevation, water, N, seaLevel);
  const flux = accumulateFlow(filled, water, moisture, N);
  for (let k = 0; k < NN; k++) {
    if (water[k] === WATER_NONE && flux[k] >= RIVER_FLUX) water[k] = WATER_RIVER;
  }

  // 5) HILLINESS: relief class from local elevation contrast (flat valley floors,
  //    rolling country, hills, true mountains) — read by travel, siting and the map.
  const hilliness = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    const x = k % N;
    const y = (k / N) | 0;
    let relief = 0;
    for (const [dx, dy] of NEI8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const d = Math.abs(elevation[ny * N + nx] - elevation[k]);
      if (d > relief) relief = d;
    }
    const e = elevation[k];
    hilliness[k] = e > 0.82 || relief > 0.075 ? HILL_MOUNTAIN : relief > 0.045 ? HILL_HILLS : relief > 0.022 ? HILL_ROLLING : HILL_FLAT;
  }

  // 6) distance fields: BFS out from fresh water and from sea (used for fertility + siting)
  const freshDist = bfsDistance(water, N, (w) => w === WATER_RIVER || w === WATER_LAKE);
  const seaDist = bfsDistance(water, N, (w) => w === WATER_SEA);

  // 7) fertility: arable potential. Best in moist lowlands near fresh water; none in
  //    water or on bare mountains. (Moisture is now causal, so fertile belts follow
  //    windward coasts and river valleys instead of scattering at random.)
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

  // 8) FEATURES: the seas, lakes, ranges and great rivers worth a name on the map.
  const { features, featureOf } = findFeatures(bodies, elevation, water, flux, hilliness, N);

  return { size: N, seaLevel, elevation, moisture, temperature, fertility, water, flux, hilliness, wind: { dx: wind[0], dy: wind[1] }, features, featureOf, freshDist, seaDist };
}

/**
 * March the prevailing wind across the grid, carrying humidity: air saturates over
 * water, drops a base drizzle over land, and is wrung out hard when the ground rises
 * (orographic rain) — what's left continues downwind, so a range casts a dry shadow.
 * Rows/columns are processed so every cell's UPWIND neighbour is already done.
 */
function advectMoisture(
  elevation: Float32Array,
  water: Uint8Array,
  humidity: Float32Array,
  moisture: Float32Array,
  N: number,
  wdx: number,
  wdy: number,
  seaLevel: number,
): void {
  // iterate so the upwind neighbour (x-wdx, y-wdy) is computed before (x,y)
  const xs = wdx >= 0 ? { from: 0, to: N, step: 1 } : { from: N - 1, to: -1, step: -1 };
  const ys = wdy >= 0 ? { from: 0, to: N, step: 1 } : { from: N - 1, to: -1, step: -1 };
  for (let y = ys.from; y !== ys.to; y += ys.step) {
    for (let x = xs.from; x !== xs.to; x += xs.step) {
      const k = y * N + x;
      if (water[k] !== WATER_NONE) {
        humidity[k] = 1; // air saturates over open water
        moisture[k] = 0.75;
        continue;
      }
      const ux = x - wdx;
      const uy = y - wdy;
      const inb = ux >= 0 && uy >= 0 && ux < N && uy < N;
      let h = inb ? humidity[uy * N + ux] : 0.35; // off-map air arrives half-dry
      const upElev = inb ? Math.max(elevation[uy * N + ux], seaLevel) : seaLevel;
      const rise = Math.max(0, Math.max(elevation[k], seaLevel) - upElev);
      const rain = h * (0.045 + rise * 5.2); // base drizzle + hard orographic squeeze
      h = Math.max(0, h - rain) * 0.998; // slow drying even over flat land
      humidity[k] = h;
      // a cell's moisture is the rain that falls on it, plus a share of the ambient
      // humidity (so lowlands just past a coast are green, not bone dry)
      const m = rain * 6 + h * 0.42;
      moisture[k] = m < 0 ? 0 : m > 1 ? 1 : m;
    }
  }
}

/**
 * Planchon–Darboux depression filling: raise every land cell to the level of its
 * lowest escape route (+ε), so steepest-descent flow always reaches water or the map
 * edge instead of pooling in noise pits. Water cells and border cells are the outlets.
 */
function fillDepressions(elevation: Float32Array, water: Uint8Array, N: number, seaLevel: number): Float32Array {
  const NN = N * N;
  const EPS = 1e-4;
  const filled = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    const x = k % N;
    const y = (k / N) | 0;
    const isOutlet = water[k] !== WATER_NONE || x === 0 || y === 0 || x === N - 1 || y === N - 1;
    filled[k] = isOutlet ? elevation[k] : Math.max(elevation[k], seaLevel) + 2; // start "flooded"
  }
  // iterative relaxation (converges fast at this grid size; order is deterministic)
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 4 * N) {
    changed = false;
    // forward then backward sweeps to halve the iteration count
    for (const dir of [1, -1] as const) {
      const start = dir === 1 ? 0 : NN - 1;
      const end = dir === 1 ? NN : -1;
      for (let k = start; k !== end; k += dir) {
        if (water[k] !== WATER_NONE) continue;
        const x = k % N;
        const y = (k / N) | 0;
        const base = Math.max(elevation[k], seaLevel);
        if (filled[k] <= base + EPS) continue; // already settled
        for (const [dx, dy] of NEI8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const cand = Math.max(base, filled[ny * N + nx] + EPS);
          if (cand < filled[k]) {
            filled[k] = cand;
            changed = true;
          }
        }
      }
    }
  }
  return filled;
}

/**
 * Route each land cell's rainfall down the filled surface (steepest descent, ties by
 * neighbour order — deterministic) and accumulate: a cell's flux is everything that
 * drains through it. Processing in descending elevation order makes it single-pass.
 */
function accumulateFlow(filled: Float32Array, water: Uint8Array, moisture: Float32Array, N: number): Float32Array {
  const NN = N * N;
  const flux = new Float32Array(NN);
  const order: number[] = [];
  for (let k = 0; k < NN; k++) {
    if (water[k] === WATER_NONE) {
      order.push(k);
      flux[k] = 0.12 + moisture[k]; // each cell contributes its rainfall
    }
  }
  order.sort((a, b) => filled[b] - filled[a] || a - b); // high ground first (stable ties)
  for (const k of order) {
    const x = k % N;
    const y = (k / N) | 0;
    let best = -1;
    let bestE = filled[k];
    for (const [dx, dy] of NEI8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      const e = water[nk] !== WATER_NONE ? -1 : filled[nk]; // water always accepts
      if (e < bestE) {
        bestE = e;
        best = nk;
      }
    }
    if (best >= 0 && water[best] === WATER_NONE) flux[best] += flux[k];
    // draining into water (or off the map edge) ends the routing — the sea takes it
  }
  return flux;
}

/**
 * Identify the map's nameable features: each sea and sizeable lake (from the water
 * bodies), each mountain RANGE (a connected run of mountainous relief), and each
 * GREAT river (a connected run of very high drainage). Geometry + stable index only —
 * the pack names them in a culture's tongue, the UI draws the labels.
 *
 * Also returns `featureOf`: per-cell membership (the surviving feature's index, or -1),
 * so a settlement can be told which landmark it sits beside (`nearestFeatureAt`).
 */
function findFeatures(
  bodies: { kind: 1 | 2; cells: number[] }[],
  elevation: Float32Array,
  water: Uint8Array,
  flux: Float32Array,
  hilliness: Uint8Array,
  N: number,
): { features: GeoFeature[]; featureOf: Int16Array } {
  const NN = N * N;
  // collected raw (index assigned at the end, after culling to the notable few); each
  // carries its member cells so we can paint the per-cell membership map after culling.
  const raw: (Omit<GeoFeature, 'index'> & { memberCells: number[] })[] = [];
  const toWorld = (k: number) => ({ x: GEO_MIN + ((k % N) / (N - 1)) * GEO_SPAN, y: GEO_MIN + (((k / N) | 0) / (N - 1)) * GEO_SPAN });
  const centerOf = (cells: number[]) => {
    let sx = 0;
    let sy = 0;
    for (const k of cells) {
      const p = toWorld(k);
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / cells.length, y: sy / cells.length };
  };

  // seas + big lakes (bodies come in deterministic scan order)
  const LAKE_MIN = Math.max(6, NN * 0.0015);
  for (const b of bodies) {
    if (b.kind === WATER_SEA) raw.push({ kind: 'sea', center: centerOf(b.cells), cells: b.cells.length, memberCells: b.cells });
    else if (b.cells.length >= LAKE_MIN) raw.push({ kind: 'lake', center: centerOf(b.cells), cells: b.cells.length, memberCells: b.cells });
  }

  // mountain ranges: connected UPLAND MASSIFS — a run of high-elevation ground that
  // rears up into at least one true peak. (Detecting from scattered high-relief cells
  // was wrong: steep spots are isolated, so no ridge ever formed. A range is a massif,
  // anchored at its highest peak — where it is most itself.)
  const RANGE_ELEV = 0.68; // the foot of the uplands: connected ground above this is a massif
  const RANGE_MIN = Math.max(24, NN * 0.0016);
  const seen = new Uint8Array(NN);
  const stack: number[] = [];
  for (let start = 0; start < NN; start++) {
    if (seen[start] || water[start] !== WATER_NONE || elevation[start] < RANGE_ELEV) continue;
    const comp: number[] = [];
    let hasPeak = false;
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop() as number;
      comp.push(k);
      if (hilliness[k] === HILL_MOUNTAIN) hasPeak = true;
      const x = k % N;
      const y = (k / N) | 0;
      for (const [dx, dy] of NEI8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nk = ny * N + nx;
        if (!seen[nk] && water[nk] === WATER_NONE && elevation[nk] >= RANGE_ELEV) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    if (comp.length < RANGE_MIN || !hasPeak) continue; // a broad plateau with no peak is not a range
    // anchor the label on the range's highest peak (its most legible point)
    let peak = comp[0];
    for (const k of comp) if (elevation[k] > elevation[peak]) peak = k;
    raw.push({ kind: 'range', center: toWorld(peak), cells: comp.length, memberCells: comp });
  }

  // great rivers: connected river cells whose drainage crosses the GREAT threshold
  seen.fill(0);
  for (let start = 0; start < NN; start++) {
    if (seen[start] || water[start] !== WATER_RIVER || flux[start] < GREAT_RIVER_FLUX) continue;
    const comp: number[] = [];
    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop() as number;
      comp.push(k);
      const x = k % N;
      const y = (k / N) | 0;
      for (const [dx, dy] of NEI8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nk = ny * N + nx;
        if (!seen[nk] && water[nk] === WATER_RIVER) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    // label a great river at its mouth (highest flux — where it is most itself)
    let mouth = comp[0];
    for (const k of comp) if (flux[k] > flux[mouth]) mouth = k;
    raw.push({ kind: 'river', center: toWorld(mouth), cells: comp.length, memberCells: comp });
  }

  // cull to the NOTABLE few, so the map reads as an atlas rather than a clutter of
  // labels. Keep the largest of each kind (seas & great rivers are already rare); the
  // rest of the terrain is still there on the map, just unnamed. Deterministic: sort by
  // size, ties by position. Indices are (re)assigned dense in a stable kind order, so a
  // feature's naming seed (featureName reads .index) is stable for the world.
  const CAPS: Record<GeoFeature['kind'], number> = { sea: 3, lake: 5, range: 6, river: 5 };
  const KIND_ORDER: GeoFeature['kind'][] = ['sea', 'range', 'river', 'lake'];
  const features: GeoFeature[] = [];
  const featureOf = new Int16Array(NN).fill(-1);
  for (const kind of KIND_ORDER) {
    const ofKind = raw
      .filter((f) => f.kind === kind)
      .sort((a, b) => b.cells - a.cells || a.center.x - b.center.x || a.center.y - b.center.y)
      .slice(0, CAPS[kind]);
    for (const f of ofKind) {
      const index = features.length;
      for (const k of f.memberCells) featureOf[k] = index; // membership for nearest-feature lookup
      features.push({ kind: f.kind, index, center: f.center, cells: f.cells });
    }
  }
  return { features, featureOf };
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
  const i = Math.round(((v - GEO_MIN) / GEO_SPAN) * (N - 1));
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
export function temperatureAt(geo: Geography, x: number, y: number): number {
  return geo.temperature[cellOf(geo, x, y)];
}
export function hillinessAt(geo: Geography, x: number, y: number): Hilliness {
  return geo.hilliness[cellOf(geo, x, y)] as Hilliness;
}

/**
 * The named feature this point sits beside, within `maxCells` — a bounded expanding-ring
 * search out from the cell for the nearest cell that belongs to a feature (its shore, its
 * foothills, its banks). Returns the feature and the ring distance in cells, or undefined
 * if none is near. Used to give a settlement a sense of place ("on the shores of …").
 */
export function nearestFeatureAt(geo: Geography, x: number, y: number, maxCells = 6): { feature: GeoFeature; dist: number } | undefined {
  const N = geo.size;
  const cx = clampIdx(x, N);
  const cy = clampIdx(y, N);
  for (let r = 0; r <= maxCells; r++) {
    let best = -1;
    // scan the ring at radius r (all cells whose Chebyshev distance is exactly r), in a
    // fixed order so ties resolve deterministically to the lowest feature index
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const f = geo.featureOf[ny * N + nx];
        if (f >= 0 && (best < 0 || f < best)) best = f;
      }
    }
    if (best >= 0) return { feature: geo.features[best], dist: r };
  }
  return undefined;
}
/** accumulated drainage at this point (0 off-river; a river's size). */
export function fluxAt(geo: Geography, x: number, y: number): number {
  return geo.flux[cellOf(geo, x, y)];
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
  if (hillinessAt(geo, x, y) === HILL_MOUNTAIN) c -= 0.2; // scarce buildable ground
  return c; // ≈ 0.35 (barren mountains) … 1.9 (a fertile river-coast)
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
