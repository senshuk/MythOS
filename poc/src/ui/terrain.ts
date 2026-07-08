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
import { type Geography, WATER_SEA, WATER_LAKE, WATER_RIVER, GEO_MIN, GEO_SPAN } from '../engine/geography';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  const sea = geo.seaLevel;
  const water = theme.water ?? { deep: [18, 26, 40] as RGB, shallow: [40, 60, 80] as RGB, level: sea };
  const river: RGB = [Math.min(255, water.shallow[0] * 1.15 + 16), Math.min(255, water.shallow[1] * 1.15 + 16), Math.min(255, water.shallow[2] * 1.15 + 20)];

  // world coord → grid coord over the geography's full extent (the grid spans more than
  // the [0,100] settled plane, so the map's margin samples real terrain, never a smear).
  const gOf = (w: number) => Math.max(0, Math.min(N - 1, ((w - GEO_MIN) / GEO_SPAN) * (N - 1)));

  const img = ctx.createImageData(W, H);
  const data = img.data;
  for (let py = 0; py < H; py++) {
    const gy = gOf(vb.y + (py / H) * vb.h);
    for (let px = 0; px < W; px++) {
      const gx = gOf(vb.x + (px / W) * vb.w);
      const ci = Math.round(gy) * N + Math.round(gx);
      const w = WTR[ci];
      let r: number;
      let g: number;
      let b: number;
      if (w === WATER_SEA) {
        const e = bilinear(E, N, gx, gy);
        [r, g, b] = lerp3(water.deep, water.shallow, Math.max(0, Math.min(1, e / sea)));
      } else if (w === WATER_LAKE) {
        [r, g, b] = lerp3(water.deep, water.shallow, 0.65);
      } else if (w === WATER_RIVER) {
        [r, g, b] = river;
      } else {
        const e = bilinear(E, N, gx, gy);
        // colour by BIOME (the pack's climate taxonomy), not an elevation band
        const col = biomeOf({ temperature: T[ci], moisture: M[ci], elevation: E[ci] }).color;
        r = col[0];
        g = col[1];
        b = col[2];
        // NW hillshade for relief
        const ex = bilinear(E, N, Math.min(N - 1, gx + 0.8), gy) - e;
        const ey = bilinear(E, N, gx, Math.min(N - 1, gy + 0.8)) - e;
        let s = 1 + (-ex - ey) * theme.hillshade * 8;
        s = s < 0.72 ? 0.72 : s > 1.28 ? 1.28 : s;
        r *= s;
        g *= s;
        b *= s;
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
