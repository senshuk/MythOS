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

// ----------------------------------------------------- world shape & factory --

/** How a world is shaped — chosen from the seed so worlds differ. For a surface world
 *  this is mostly sea level (how wet) and noise frequency (how broken-up the land is). */
export interface WorldShape {
  archetype: string;
  seaLevel: number;
  freq: number;
  settlements: number;
  tries: number; // candidate samples (more for island-y worlds, where viable land is rarer)
}

// Sea levels are spread across the steep middle of the elevation distribution, so the
// archetypes look genuinely different yet all keep enough coast/fresh water to be viable
// (a near-waterless world starves — no fishing, little fertile ground).
const ARCHETYPES: Omit<WorldShape, 'settlements'>[] = [
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
  return { ...a, settlements };
}

/** Build a world's substrate from its seed (the surface heightmap is shaped per archetype). */
export function createSubstrate(seed: number): Substrate {
  const shape = worldShapeFor(seed);
  const geo = generateGeography(seed, GEO_SIZE, shape.seaLevel, shape.freq);
  return new SurfaceSubstrate(geo, shape.settlements, shape.tries);
}
