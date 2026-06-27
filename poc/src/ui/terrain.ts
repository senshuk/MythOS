/**
 * Procedural terrain for the region map — PRESENTATION ONLY, deterministic from the
 * world seed, so the same world always looks the same (it never touches the sim).
 * Self-contained value-noise (no dependencies). Renders a relief-shaded biome
 * heightmap to a canvas drawn BEHIND the clickable settlement overlay; settlements
 * gently lift the land around them, so the towns sit on habitable ground.
 */

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

// --- tiny seeded value noise -------------------------------------------------
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

// biome base colour from elevation e (0..1) and moisture m (0..1)
function biome(e: number, m: number): [number, number, number] {
  if (e < 0.30) return [11, 20, 33]; // deep water
  if (e < 0.37) return [19, 36, 54]; // water
  if (e < 0.40) return [30, 52, 72]; // shallows
  if (e < 0.425) return [78, 72, 52]; // coast / sand
  if (e < 0.60) return m > 0.52 ? [38, 56, 41] : [60, 66, 47]; // forest / grassland
  if (e < 0.74) return m > 0.5 ? [33, 48, 37] : [70, 64, 46]; // deep forest / dry hills
  if (e < 0.88) return [72, 67, 59]; // mountain rock
  return [184, 188, 198]; // snow
}

/** Paint terrain into the canvas. `vb` must match the overlay SVG's viewBox so the
 *  settlements land on the right ground. */
export function paintTerrain(canvas: HTMLCanvasElement, seed: number, nodes: TerrainNode[], vb: ViewBox): void {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const FREQ = 0.05; // world units → noise scale (smaller = larger landmasses)

  // elevation at a world point: a base fbm, ridged detail for ranges, and a gentle
  // lift around each settlement so towns aren't stranded in the sea.
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

  // precompute elevation so hillshade reads neighbours instead of recomputing
  const elev = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const wy = vb.y + (py / H) * vb.h;
    for (let px = 0; px < W; px++) {
      const wx = vb.x + (px / W) * vb.w;
      elev[py * W + px] = elevAt(wx, wy);
    }
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
      let [r, g, b] = biome(e, m);
      // hillshade on land: NW-lit relief
      if (e >= 0.40) {
        const ex = elev[idx + (px < W - 1 ? 1 : 0)] - e;
        const ey = elev[idx + (py < H - 1 ? W : 0)] - e;
        let s = 1 + (-ex - ey) * 5;
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

  // a soft vignette for the lamplit-atlas feel
  const grd = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.32, W / 2, H / 2, H * 0.74);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(7,8,12,0.5)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}
