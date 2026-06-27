/**
 * Map BACKDROP renderers — PRESENTATION ONLY, deterministic from the world seed, so a
 * world always looks the same (they never touch the sim). The look is driven by a
 * pack-defined style (content/mapstyles.ts): `paintTerrain` paints any planet surface
 * from a data `SurfaceTheme`; `paintStarfield` paints a space setting. The clickable
 * settlement/relation overlay (the SVG) is shared on top — only the backdrop changes.
 */
import type { SurfaceTheme, StarfieldStyle, RGB } from '../content/mapstyles';

export interface TerrainNode {
  x: number;
  y: number;
  ruined: boolean;
}
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --- tiny seeded value noise (no dependencies) -------------------------------
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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Colour for a surface point, entirely from the pack's SurfaceTheme. */
function surfaceColor(theme: SurfaceTheme, e: number, m: number): RGB {
  if (theme.water && e < theme.water.level) {
    const t = e / theme.water.level; // 0 deepest … 1 at the shore
    return lerp3(theme.water.deep, theme.water.shallow, t);
  }
  const top = theme.land[theme.land.length - 1];
  if (e >= top.upTo) return theme.peak;
  for (const band of theme.land) {
    if (e < band.upTo) return band.wet && m > 0.52 ? band.wet : band.dry;
  }
  return theme.peak;
}

/** Paint a planet surface. `vb` must match the overlay SVG viewBox so towns align. */
export function paintTerrain(canvas: HTMLCanvasElement, seed: number, nodes: TerrainNode[], vb: ViewBox, theme: SurfaceTheme): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const FREQ = theme.freq;

  // base fbm + ridged detail for ranges + a gentle lift around settlements (towns on
  // habitable ground — also forms islands on an ocean world).
  const elevAt = (wx: number, wy: number): number => {
    let e = fbm(wx * FREQ, wy * FREQ, seed, 5);
    e = e * 0.82 + (0.5 - Math.abs(fbm(wx * FREQ * 2.4, wy * FREQ * 2.4, seed + 99, 3) - 0.5)) * 0.36;
    for (const n of nodes) {
      const dx = wx - n.x;
      const dy = wy - n.y;
      e += Math.exp(-(dx * dx + dy * dy) / 110) * (n.ruined ? 0.05 : 0.12);
    }
    return e > 1 ? 1 : e;
  };

  const elev = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const wy = vb.y + (py / H) * vb.h;
    for (let px = 0; px < W; px++) elev[py * W + px] = elevAt(vb.x + (px / W) * vb.w, wy);
  }

  const img = ctx.createImageData(W, H);
  const data = img.data;
  for (let py = 0; py < H; py++) {
    const wy = vb.y + (py / H) * vb.h;
    for (let px = 0; px < W; px++) {
      const idx = py * W + px;
      const e = elev[idx];
      const wx = vb.x + (px / W) * vb.w;
      const m = fbm(wx * FREQ * 0.85 + 40, wy * FREQ * 0.85 + 40, seed + 7, 3);
      let [r, g, b] = surfaceColor(theme, e, m);
      const waterLevel = theme.water ? theme.water.level : 0;
      if (e >= waterLevel) {
        const ex = elev[idx + (px < W - 1 ? 1 : 0)] - e;
        const ey = elev[idx + (py < H - 1 ? W : 0)] - e;
        let s = 1 + (-ex - ey) * theme.hillshade;
        s = s < 0.7 ? 0.7 : s > 1.28 ? 1.28 : s;
        r *= s;
        g *= s;
        b *= s;
      }
      const i = idx * 4;
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
}

/** Paint a space backdrop — nebulae + stars on the void. Settlements (drawn by the
 *  shared SVG overlay) read as star systems. */
export function paintStarfield(canvas: HTMLCanvasElement, seed: number, _nodes: TerrainNode[], _vb: ViewBox, field: StarfieldStyle): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // void + nebula clouds (low-frequency noise tinted by the pack's nebula colours)
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const NF = 0.012;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let [r, g, b] = field.voidColor;
      for (let k = 0; k < field.nebula.length; k++) {
        const n = fbm(px * NF + k * 30, py * NF + k * 30, seed + 200 + k * 50, 4);
        const a = Math.max(0, n - 0.55) * 1.4; // only the dense wisps show
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

  // scattered stars: deterministic hash positions, varied brightness
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
