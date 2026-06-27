/**
 * The PACK's BIOME taxonomy — DATA. The engine produces the physical fields (elevation,
 * moisture, temperature, water); how those combine into biomes, and what each biome is
 * NAMED, COLOURED, and PRODUCES, is universe content. A sci-fi pack would swap these for
 * ash-wastes and crystal-flats; this fantasy pack ships a Whittaker-style Earth set.
 *
 * `biomeOf` reads a Site's generic attribute vector, so the same classification serves the
 * economy (yields), the legends (names), and the map (colours).
 */
import type { RGB } from './mapstyles';

export interface Biome {
  id: string;
  name: string;
  color: RGB; // land colour on the map
  /** base per-capita yields for a settlement in this biome (the economy reads these). */
  yields: { food: number; materials: number; goods: number };
  /** a short label for what a people here mostly does. */
  craft: string;
}

export const BIOMES: Record<string, Biome> = {
  tundra: { id: 'tundra', name: 'tundra', color: [198, 208, 214], yields: { food: 0.62, materials: 0.35, goods: 0.15 }, craft: 'hunting' },
  taiga: { id: 'taiga', name: 'boreal forest', color: [58, 92, 78], yields: { food: 1.0, materials: 0.95, goods: 0.2 }, craft: 'forestry' },
  alpine: { id: 'alpine', name: 'alpine', color: [152, 152, 160], yields: { food: 0.32, materials: 0.95, goods: 0.1 }, craft: 'mining' },
  steppe: { id: 'steppe', name: 'steppe', color: [156, 154, 98], yields: { food: 1.0, materials: 0.2, goods: 0.25 }, craft: 'herding' },
  grassland: { id: 'grassland', name: 'grassland', color: [122, 158, 80], yields: { food: 1.35, materials: 0.12, goods: 0.25 }, craft: 'farming' },
  temperate_forest: { id: 'temperate_forest', name: 'woodland', color: [70, 118, 64], yields: { food: 0.98, materials: 0.9, goods: 0.3 }, craft: 'forestry' },
  desert: { id: 'desert', name: 'desert', color: [205, 184, 124], yields: { food: 0.5, materials: 0.55, goods: 0.2 }, craft: 'mining' },
  savanna: { id: 'savanna', name: 'savanna', color: [176, 166, 96], yields: { food: 1.08, materials: 0.2, goods: 0.3 }, craft: 'ranching' },
  jungle: { id: 'jungle', name: 'jungle', color: [46, 104, 54], yields: { food: 1.2, materials: 0.6, goods: 0.5 }, craft: 'plantation' },
  wetland: { id: 'wetland', name: 'wetland', color: [84, 116, 92], yields: { food: 1.08, materials: 0.3, goods: 0.35 }, craft: 'reed & fish' },
};

/**
 * Classify a place into a biome from its physical qualities — temperature × moisture,
 * with altitude and very wet lowlands overriding. The engine never calls this; the pack's
 * economy, legends and map renderer do.
 */
export function biomeOf(a: Record<string, number>): Biome {
  const temp = a.temperature ?? 0.5;
  const moist = a.moisture ?? 0.5;
  const elev = a.elevation ?? 0.5;
  if (elev > 0.82) return BIOMES.alpine; // bare cold peaks, whatever the latitude
  if (moist > 0.72 && elev < 0.46 && temp > 0.3) return BIOMES.wetland; // marsh / swamp lowlands
  if (temp < 0.28) return moist < 0.42 ? BIOMES.tundra : BIOMES.taiga; // cold
  if (temp < 0.58) return moist < 0.3 ? BIOMES.steppe : moist < 0.6 ? BIOMES.grassland : BIOMES.temperate_forest; // temperate
  return moist < 0.3 ? BIOMES.desert : moist < 0.58 ? BIOMES.savanna : BIOMES.jungle; // hot
}
