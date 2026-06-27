/**
 * The SUBSTRATE — the physical medium a world is made of, and the engine's ONLY view of
 * it. The engine founds settlements, feeds them, and connects them by asking a Substrate;
 * it never assumes the world is a 2D land surface. `Geography` (an elevation/water/rivers
 * heightmap) is ONE implementation (`SurfaceSubstrate`); a future pack could supply an
 * ocean world, an archipelago, a single megacity, or a galaxy of star systems behind the
 * same interface without touching the engine.
 *
 * Deterministic from the seed and NEVER serialized — regenerated identically on load and
 * by the UI to render. A world's SHAPE (archetype, how wet, how broken-up, how many
 * settlements) is itself chosen from the seed, so different seeds make visibly different
 * worlds — sprawling pangaeas, scattered archipelagos, continents around an inland sea.
 */
import { Rng, mixSeed } from './rng';
import { type Vec2 } from './model';
import {
  type Geography,
  generateGeography,
  GEO_SIZE,
  siteSuitability,
  terrainCapacity,
  siteEpithet,
  fertilityAt,
  elevationAt,
  moistureAt,
  temperatureAt,
  seaDist,
  freshWaterDist,
  isLand,
} from './geography';

/** A candidate place to found a settlement, with its physical qualities. The engine reads
 *  `suitability` (where to found) and `capacity` (how big it grows); a pack reads
 *  `attributes` (a generic quality vector) to decide what the place PRODUCES. */
export interface Site {
  pos: Vec2;
  suitability: number; // founding desirability (candidates() returns only viable ones)
  capacity: number; // carrying-capacity multiplier
  attributes: Record<string, number>; // 0..1 physical qualities the pack maps to yields
  epithet: string; // "a coastal settlement" — for legends
}

export interface Substrate {
  kind: string; // 'surface' | … — the UI picks a renderer by this
  /** how many settlements this world should be founded with (its richness, from the shape). */
  settlements: number;
  /** a deterministic pool of viable, scored candidate founding sites. */
  candidates(rng: Rng): Site[];
  /** any habitable spot, for worlds where good sites are scarce (selection fallback). */
  fallbackSite(rng: Rng): Site | undefined;
  /** spatial distance between two positions (region graph, migration weighting). */
  distance(a: Vec2, b: Vec2): number;
}

// ---------------------------------------------------------------- surface ----

/** A 2D-surface world: the elevation/water/rivers/fertility heightmap. */
export class SurfaceSubstrate implements Substrate {
  readonly kind = 'surface';
  constructor(
    readonly geography: Geography,
    readonly settlements: number,
    private readonly tries: number,
  ) {}

  private siteAt(x: number, y: number, suitability: number): Site {
    const g = this.geography;
    return {
      pos: { x, y },
      suitability,
      capacity: terrainCapacity(g, x, y),
      attributes: {
        fertility: fertilityAt(g, x, y),
        elevation: elevationAt(g, x, y),
        moisture: moistureAt(g, x, y),
        temperature: temperatureAt(g, x, y), // → biome (with moisture/elevation)
        coast: Math.max(0, 1 - seaDist(g, x, y) / 8), // 1 = on the coast, 0 = deep inland
        freshWater: Math.max(0, 1 - freshWaterDist(g, x, y) / 8),
      },
      epithet: siteEpithet(g, x, y),
    };
  }

  candidates(rng: Rng): Site[] {
    const out: Site[] = [];
    for (let t = 0; t < this.tries; t++) {
      const x = 3 + rng.next() * 94;
      const y = 3 + rng.next() * 94;
      const suit = siteSuitability(this.geography, x, y);
      if (suit > 0.4) out.push(this.siteAt(x, y, suit));
    }
    return out;
  }

  fallbackSite(rng: Rng): Site | undefined {
    for (let g = 0; g < 50; g++) {
      const x = 3 + rng.next() * 94;
      const y = 3 + rng.next() * 94;
      if (isLand(this.geography, x, y)) return this.siteAt(x, y, 0);
    }
    return undefined;
  }

  distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

// -------------------------------------------------------------- starfield ----

/**
 * A SPACE world: a scattering of star systems instead of a land surface. The A4 capstone
 * — it satisfies the SAME Substrate interface with no terrain at all, proving the engine
 * founds, feeds, connects and renders a galaxy exactly as it does a continent. Each system
 * reports its space qualities (habitability, mineral wealth, trade-lane access) THROUGH
 * the generic attribute vector the pack economy reads, so a habitable system feeds its
 * people, a mineral-rich one mines, and a well-connected one trades — no engine change.
 * (A real sci-fi pack would supply space species/cultures/resources; the fixture's are
 * reused here, so the proof is architectural, not thematic.)
 */
export class StarfieldSubstrate implements Substrate {
  readonly kind = 'starfield';
  constructor(
    readonly settlements: number,
    private readonly pool: number,
  ) {}

  private system(rng: Rng): Site {
    const x = 4 + rng.next() * 92;
    const y = 4 + rng.next() * 92;
    const habitability = rng.next(); // can it support a population?
    const minerals = rng.next(); // asteroid / ore wealth
    const lanes = rng.next(); // trade-lane access (a system's "coastline")
    return {
      pos: { x, y },
      // map space qualities onto the generic quality vector: habitability → can feed
      // people (fertility/freshWater); mineral wealth → can mine (elevation); lane access
      // → can trade & is reachable (coast).
      attributes: {
        fertility: 0.28 + habitability * 0.68,
        freshWater: habitability,
        moisture: 0.3 + habitability * 0.4,
        temperature: 0.35 + habitability * 0.4, // a garden world is temperate; a barren one cold
        elevation: 0.45 + minerals * 0.5,
        coast: lanes,
      },
      suitability: habitability * 2.4 + lanes * 1.4 + minerals * 0.8,
      capacity: 0.6 + habitability * 1.1 + lanes * 0.3,
      epithet:
        lanes > 0.66 ? 'a core system' : minerals > 0.6 ? 'a mining colony' : habitability > 0.6 ? 'a garden world' : 'a frontier outpost',
    };
  }

  candidates(rng: Rng): Site[] {
    const out: Site[] = [];
    for (let i = 0; i < this.pool; i++) out.push(this.system(rng));
    return out;
  }

  fallbackSite(rng: Rng): Site | undefined {
    return this.system(rng);
  }

  /** Sub-light distance between systems. (A jump-lane graph could replace this — the
   *  engine only ever asks the substrate, so it would not notice.) */
  distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}

// ----------------------------------------------------- world shape & factory --

/** How a world is shaped — chosen from the seed so worlds differ. For a surface world
 *  this is mostly sea level (how wet) and noise frequency; a starfield ignores those. */
export interface WorldShape {
  kind: 'surface' | 'starfield';
  archetype: string;
  seaLevel: number;
  freq: number;
  baseTemp: number; // the world's overall climate (an ice world vs a hot one)
  settlements: number;
  tries: number; // candidate samples (more for island-y worlds, where viable land is rarer)
}

// Sea levels are spread across the steep middle of the elevation distribution, so the
// archetypes look genuinely different yet all keep enough coast/fresh water to be viable
// (a near-waterless world starves — no fishing, little fertile ground).
const ARCHETYPES: Omit<WorldShape, 'settlements' | 'kind' | 'baseTemp'>[] = [
  { archetype: 'pangaea', seaLevel: 0.4, freq: 0.045, tries: 700 }, // one vast landmass, rivers & lakes
  { archetype: 'continents', seaLevel: 0.46, freq: 0.05, tries: 850 }, // land & sea in balance
  { archetype: 'inland-sea', seaLevel: 0.5, freq: 0.052, tries: 1000 }, // continents around a great sea
  { archetype: 'archipelago', seaLevel: 0.57, freq: 0.078, tries: 1400 }, // scattered islands, all coastal
];

/** Pick a world's shape from its seed — a separate RNG stream so it doesn't perturb the
 *  rest of worldgen. This is what makes two seeds feel like different WORLDS. */
export function worldShapeFor(seed: number): WorldShape {
  const r = new Rng(mixSeed(seed, 0x5ade));
  const a = ARCHETYPES[r.int(ARCHETYPES.length)];
  const settlements = 11 + r.int(7); // 11..17 — richer, varied-size regions
  // ~1 in 5 worlds is a GALAXY instead. The draw is taken AFTER the surface draws, so
  // surface worlds are byte-identical to before; this only diverts some seeds to space.
  if (r.int(5) === 0) {
    // pool sized so the land-scaling cap (cands/24) still seats the full set of systems
    return { kind: 'starfield', archetype: 'starfield', seaLevel: 0, freq: 0, baseTemp: 0, settlements, tries: settlements * 26 };
  }
  // a surface world's overall climate — drawn LAST so the starfield set & surface
  // placement are unchanged; an icy world skews tundra, a hot one desert.
  const baseTemp = (r.next() - 0.5) * 0.34; // ≈ −0.17 (cold) … +0.17 (hot)
  return { kind: 'surface', ...a, baseTemp, settlements };
}

/** Build a world's substrate from its seed (a surface heightmap, or a scattering of stars). */
export function createSubstrate(seed: number): Substrate {
  const shape = worldShapeFor(seed);
  if (shape.kind === 'starfield') return new StarfieldSubstrate(shape.settlements, shape.tries);
  const geo = generateGeography(seed, GEO_SIZE, shape.seaLevel, shape.freq, shape.baseTemp);
  return new SurfaceSubstrate(geo, shape.settlements, shape.tries);
}
