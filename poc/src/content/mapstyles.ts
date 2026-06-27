/**
 * Map "world skins" — PACK DATA that tells the (universe-agnostic) map renderer how a
 * world looks. The engine supplies only settlement positions + relations; how that
 * reads as a place is entirely here, so the same simulated world can be painted as a
 * temperate realm, a red desert planet, an ice world, an ocean of islands, a volcanic
 * hellscape — or, for a space setting, a starfield of systems.
 *
 * Two layers of flexibility:
 *   - SurfaceTheme: a data-driven biome palette for any PLANET SURFACE (most settings).
 *   - MapStyle.kind: a pluggable RENDERER for worlds that aren't surfaces ('starfield').
 * A Universe Pack picks (or ships) its own style; the selector in the UI lets you swap
 * to see how agnostic it is.
 */

export type RGB = [number, number, number];

/** Elevation→colour bands for a planet surface. Water is optional (a dry world has
 *  none; a volcanic one paints its "water" as lava). Moisture splits land bands. */
export interface SurfaceTheme {
  water: { deep: RGB; shallow: RGB; level: number } | null;
  /** land bands by ascending elevation cutoff; `wet` is used where moisture is high. */
  land: { upTo: number; dry: RGB; wet?: RGB }[];
  peak: RGB; // above the highest land band (snow, dust, ash…)
  vignette: RGB; // edge-fade tint (the world's "sky")
  freq: number; // terrain noise frequency (smaller = larger landmasses)
  hillshade: number; // relief strength
}

/** A starfield (space) backdrop — systems on the void. */
export interface StarfieldStyle {
  voidColor: RGB;
  nebula: RGB[]; // a few nebula tints
  star: RGB;
}

export type MapStyle =
  | { kind: 'surface'; theme: SurfaceTheme }
  | { kind: 'starfield'; field: StarfieldStyle };

export interface MapStyleOption {
  id: string;
  name: string;
  style: MapStyle;
}

export const MAP_STYLES: MapStyleOption[] = [
  {
    id: 'temperate',
    name: 'Temperate realm',
    style: {
      kind: 'surface',
      theme: {
        water: { deep: [11, 20, 33], shallow: [30, 52, 72], level: 0.4 },
        land: [
          { upTo: 0.425, dry: [78, 72, 52] }, // coast / sand
          { upTo: 0.6, dry: [60, 66, 47], wet: [38, 56, 41] }, // grassland / forest
          { upTo: 0.74, dry: [70, 64, 46], wet: [33, 48, 37] }, // dry hills / deep forest
          { upTo: 0.88, dry: [72, 67, 59] }, // mountain
        ],
        peak: [184, 188, 198], // snow
        vignette: [7, 8, 12],
        freq: 0.05,
        hillshade: 5,
      },
    },
  },
  {
    id: 'desert',
    name: 'Red desert world',
    style: {
      kind: 'surface',
      theme: {
        water: { deep: [30, 22, 26], shallow: [70, 52, 48], level: 0.4 }, // sluggish, silt-laden
        land: [
          { upTo: 0.42, dry: [62, 30, 22] }, // dark basalt lowlands
          { upTo: 0.62, dry: [156, 74, 46], wet: [126, 58, 40] }, // rust dunes
          { upTo: 0.8, dry: [120, 60, 42] }, // red rock highlands
          { upTo: 0.92, dry: [96, 48, 36] }, // mountains
        ],
        peak: [206, 184, 172], // dust / ice caps
        vignette: [22, 8, 6],
        freq: 0.055,
        hillshade: 6,
      },
    },
  },
  {
    id: 'frozen',
    name: 'Frozen world',
    style: {
      kind: 'surface',
      theme: {
        water: { deep: [18, 38, 58], shallow: [70, 120, 150], level: 0.38 }, // frozen seas
        land: [
          { upTo: 0.45, dry: [150, 165, 185] }, // ice shelf
          { upTo: 0.7, dry: [184, 198, 212], wet: [162, 182, 202] }, // snowfields
          { upTo: 0.88, dry: [120, 135, 160] }, // rock under snow
        ],
        peak: [236, 241, 249],
        vignette: [14, 18, 26],
        freq: 0.05,
        hillshade: 4,
      },
    },
  },
  {
    id: 'ocean',
    name: 'Ocean of isles',
    style: {
      kind: 'surface',
      theme: {
        water: { deep: [8, 28, 50], shallow: [26, 92, 122], level: 0.62 }, // high sea level
        land: [
          { upTo: 0.68, dry: [82, 76, 56] }, // beaches
          { upTo: 0.82, dry: [40, 60, 42], wet: [34, 54, 40] }, // island green
        ],
        peak: [120, 120, 110],
        vignette: [6, 14, 22],
        freq: 0.06,
        hillshade: 4,
      },
    },
  },
  {
    id: 'ashlands',
    name: 'Volcanic ashlands',
    style: {
      kind: 'surface',
      theme: {
        water: { deep: [44, 12, 6], shallow: [170, 70, 22], level: 0.34 }, // lava seas
        land: [
          { upTo: 0.46, dry: [28, 24, 22] }, // black ash plains
          { upTo: 0.7, dry: [46, 40, 36], wet: [64, 32, 24] }, // basalt / cinder
          { upTo: 0.88, dry: [64, 56, 50] }, // volcanic rock
        ],
        peak: [96, 86, 80],
        vignette: [16, 6, 4],
        freq: 0.06,
        hillshade: 7,
      },
    },
  },
  {
    id: 'starfield',
    name: 'Starfield (space)',
    style: {
      kind: 'starfield',
      field: {
        voidColor: [6, 7, 13],
        nebula: [
          [40, 30, 70],
          [20, 50, 70],
          [70, 30, 50],
        ],
        star: [220, 224, 235],
      },
    },
  },
];

export const DEFAULT_MAP_STYLE = 'temperate';
