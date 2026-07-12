/**
 * Generates seamless, tiling terrain material textures (albedo + normal) into
 * public/textures/. Run: `node scripts/gen-terrain-textures.mjs`. These are procedural
 * stand-ins for CC0 grass/rock/snow sets — the terrain material splats them by slope/altitude.
 */
import { PNG } from 'pngjs';
import fs from 'node:fs';

const SIZE = 512;
const OUT = new URL('../public/textures/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

function hash(a, b, seed) {
  let n = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2246822519)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
// value noise wrapping at period P (so the octave tiles seamlessly across the texture)
function pnoise(x, y, P, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const w = (a, b) => hash(((a % P) + P) % P, ((b % P) + P) % P, seed);
  const v00 = w(ix, iy), v10 = w(ix + 1, iy), v01 = w(ix, iy + 1), v11 = w(ix + 1, iy + 1);
  const sx = smooth(fx), sy = smooth(fy);
  return (v00 + (v10 - v00) * sx) * (1 - sy) + (v01 + (v11 - v01) * sx) * sy;
}
function fbm(x, y, baseCells, seed, oct = 5) {
  let val = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const G = baseCells * (1 << o); // grid cells at this octave — tiles because it wraps at SIZE
    val += amp * pnoise((x / SIZE) * G, (y / SIZE) * G, G, seed + o * 17);
    norm += amp; amp *= 0.5;
  }
  return val / norm; // 0..1
}
function writePNG(name, rgb) {
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let i = 0; i < SIZE * SIZE; i++) { png.data[i * 4] = rgb[i * 3]; png.data[i * 4 + 1] = rgb[i * 3 + 1]; png.data[i * 4 + 2] = rgb[i * 3 + 2]; png.data[i * 4 + 3] = 255; }
  fs.writeFileSync(new URL(name, OUT), PNG.sync.write(png));
  console.log('wrote', name);
}
const clamp8 = (v) => Math.max(0, Math.min(255, v | 0));

/** albedo(n, fine, x, y) → [r,g,b] 0..255 ; hAmp = normal strength ; hFn(n,fine,x,y) → height (for furrow relief) */
function gen(name, baseCells, seed, albedo, hAmp, hFn) {
  const alb = new Uint8Array(SIZE * SIZE * 3), H = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const n = fbm(x, y, baseCells, seed), fine = fbm(x, y, baseCells * 3, seed + 99, 4);
    const [r, g, b] = albedo(n, fine, x, y);
    const i = y * SIZE + x;
    alb[i * 3] = clamp8(r); alb[i * 3 + 1] = clamp8(g); alb[i * 3 + 2] = clamp8(b);
    H[i] = hFn ? hFn(n, fine, x, y) : n * 0.65 + fine * 0.35;
  }
  writePNG(`${name}_albedo.png`, alb);
  const nrm = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const xl = H[y * SIZE + ((x - 1 + SIZE) % SIZE)], xr = H[y * SIZE + ((x + 1) % SIZE)];
    const yd = H[((y - 1 + SIZE) % SIZE) * SIZE + x], yu = H[((y + 1 + SIZE) % SIZE) * SIZE + x];
    let nx = (xl - xr) * hAmp, ny = (yd - yu) * hAmp, nz = 1; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = y * SIZE + x;
    nrm[i * 3] = (nx * 0.5 + 0.5) * 255; nrm[i * 3 + 1] = (ny * 0.5 + 0.5) * 255; nrm[i * 3 + 2] = (nz * 0.5 + 0.5) * 255;
  }
  writePNG(`${name}_normal.png`, nrm);
}

// grass — greens with earthy patches
gen('grass', 6, 11, (n, f) => { const g = 96 + n * 78 + f * 20; return [42 + n * 34 + f * 16, g, 38 + n * 22]; }, 26);
// rock — greys with darker cracks
gen('rock', 7, 23, (n, f) => { const v = 92 + n * 74; const crack = f < 0.33 ? 0.58 : 1; return [v * crack, v * crack * 0.98, v * crack * 0.93]; }, 40);
// snow — bright, faint blue, gentle relief
gen('snow', 4, 37, (n, f) => { const v = 222 + n * 26 + f * 6; return [v * 0.95, v * 0.98, v]; }, 14);
// sand — warm dune tan, fine even grain with faint ripples (desert & beach)
gen('sand', 8, 61, (n, f) => { const v = 198 + n * 38 + f * 14; return [v, v * 0.9, v * 0.68]; }, 12);
// mud — dark wet earth, mottled with a damp sheen (marsh & riverbank)
gen('mud', 9, 67, (n, f) => { const v = 72 + n * 46; const wet = f > 0.6 ? 1.14 : f < 0.3 ? 0.82 : 1; return [v * 0.86 * wet, v * 0.68 * wet, v * 0.5 * wet]; }, 24);
// gravel — loose grey stones of mixed size, pale flecks and dark gaps (scree & river shingle)
gen('gravel', 10, 83, (n, f) => { const v = 118 + n * 66; const fleck = f > 0.63 ? 1.3 : f < 0.32 ? 0.66 : 1; return [v * fleck, v * fleck * 0.98, v * fleck * 0.9]; }, 36);
// ice — pale blue-white sheet, faint cracks and a cold tint (frozen water)
gen('ice', 5, 91, (n, f) => { const v = 206 + n * 30 + f * 8; const crack = f < 0.24 ? 0.72 : 1; return [v * 0.9 * crack, v * 0.95 * crack, v * crack]; }, 16);
// dirt/path — packed tan earth with STRONG pale gravel flecks + dark ruts (for roads). Finer
// grain (baseCells 11) and high contrast so it reads as rough dirt, not a smooth pale sheet.
gen('dirt', 11, 53, (n, f) => {
  const v = 132 + n * 64;
  const t = f > 0.68 ? 1.28 : f < 0.30 ? 0.62 : 1; // bright gravel flecks and dark ruts (wide range)
  return [v * 1.0 * t, v * 0.82 * t, v * 0.6 * t];
}, 32);
// field — ploughed crop rows: green-gold ridges over dark furrows (furrows run along x)
const FURROWS = 15;
gen('field', 6, 71,
  (n, f, x, y) => {
    const row = Math.sin((y / SIZE) * Math.PI * 2 * FURROWS) * 0.5 + 0.5; // 0 furrow … 1 ridge
    const shade = 0.66 + 0.46 * row;
    const green = 92 + n * 58 + f * 24;
    return [(70 + n * 30) * shade, green * shade, (46 + n * 18) * shade];
  },
  18,
  (n, f, x, y) => {
    const ridge = Math.sin((y / SIZE) * Math.PI * 2 * FURROWS) * 0.5 + 0.5; // raised ridges, sunken furrows
    return ridge * 0.72 + (n * 0.65 + f * 0.35) * 0.28;
  });

console.log('done');
