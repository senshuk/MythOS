/**
 * THE TERRAIN PAINT, ON THE GPU (design/32 §4).
 *
 * `computeTerrainImage` in `terrain.ts` is a per-pixel loop over dozens of noise octaves —
 * exactly the workload a fragment shader eats. This module is that same painter as a shader:
 * zoom/pan becomes a draw call instead of a ~2s worker round-trip, so the view can repaint
 * continuously instead of settling.
 *
 * THE CONTRACT WITH THE CPU PAINTER: this is a PORT, not a reimagining. `terrain.ts` stays the
 * reference — it still runs as the fallback when WebGL2 is unavailable, and `diffAgainstCpu()`
 * exists so the two can be compared pixel-for-pixel in a real browser. Every constant here is
 * lifted from the reference; the noise is ported through `uint` arithmetic so it is BIT-EXACT
 * rather than merely similar (JS `Math.imul`/`>>>` are mod-2^32 ops, which GLSL `uint` reproduces
 * exactly). Sampling is manual `texelFetch` bilinear rather than hardware LINEAR filtering — both
 * because 32F linear filtering needs an extension, and because it matches the reference's exact
 * clamp semantics (`x1 = min(N-1, x0+1)`).
 *
 * Determinism: same uniforms ⇒ same pixels on a given device. Across GPUs the last bit of a
 * float may differ; that is presentation only and never touches the simulation hash.
 *
 * MEASURED against the CPU reference (700×500, seed 123456, Chrome/WebGL2), same frame both ways:
 *
 *   frame                 cpu      gpu       mean|diff|   max   channels>8
 *   close view (w=11)    902ms   4.87ms         0.033      141    0.0047%
 *   mid        (w=40)    674ms   1.37ms         0.032      208    0.0010%
 *   world map  (w=190)   471ms   0.99ms         0.027        1    0.0000%
 *
 * Read that world-map row first: with the dither/grain gates off it agrees to within 1/255, which
 * is what says the bilinear, biome, water and hillshade ports are right. The large `max` at close
 * zoom is ~23 pixels in 350k, nearly all sitting on a colour edge — a threshold pixel (coastline,
 * dither test) flipping sides on a last-bit difference. Boundary flips, not a systematic error.
 */
import { geoTablesFor, type GeoFields, type GroundPatch, type ViewBox } from './terrain';
import type { SurfaceTheme } from '../content/mapstyles';
import { GEO_MIN, GEO_SPAN } from '../engine/geography';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;

uniform sampler2D uFields;  // (elevation, moisture, temperature, fertility)
uniform sampler2D uClass;   // (water class, hilliness, channel stamp, -)
uniform sampler2D uLand;    // land colour LUT (biome tint + snow), 0..255
uniform sampler2D uGround;  // per-pixel ground mask: R=strength, G=patch index/255
uniform sampler2D uPatch;   // patch params: row0 (tone.rgb, blend), row1 (speckle,-,-,-)

uniform int   uN;           // geography grid size
uniform vec4  uVb;          // viewbox x, y, w, h
uniform vec2  uRes;         // W, H
uniform float uSea;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uShore;
uniform vec3  uRiver;
uniform float uHillshade;
uniform bool  uHasGround;

const vec3 SAND = vec3(216.0, 205.0, 168.0);
const float WATER_SEA = 1.0, WATER_LAKE = 2.0, WATER_RIVER = 3.0;

// ---- the reference's integer hash, ported bit-exactly -----------------------
// JS: h = (seed ^ imul(ix,374761393) ^ imul(iy,668265263)) | 0
//     h = imul(h ^ (h >>> 13), 1274126177)
//     return ((h ^ (h >>> 16)) >>> 0) / 4294967295
// Every step is mod 2^32, so uint arithmetic reproduces the exact bit pattern.
float hash2(int ix, int iy, int seed) {
  uint h = uint(seed) ^ (uint(ix) * 374761393u) ^ (uint(iy) * 668265263u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
float smoothT(float t) { return t * t * (3.0 - 2.0 * t); }
float vnoise(float x, float y, int seed) {
  float fx0 = floor(x), fy0 = floor(y);
  int ix = int(fx0), iy = int(fy0);
  float fx = x - fx0, fy = y - fy0;
  float v00 = hash2(ix, iy, seed), v10 = hash2(ix + 1, iy, seed);
  float v01 = hash2(ix, iy + 1, seed), v11 = hash2(ix + 1, iy + 1, seed);
  float sx = smoothT(fx), sy = smoothT(fy);
  return (v00 + (v10 - v00) * sx) * (1.0 - sy) + (v01 + (v11 - v01) * sx) * sy;
}

// ---- manual bilinear (matches the reference's clamp exactly) ----------------
ivec2 clampC(int x, int y) { return ivec2(clamp(x, 0, uN - 1), clamp(y, 0, uN - 1)); }
vec4 fetchF(int x, int y) { return texelFetch(uFields, clampC(x, y), 0); }
vec4 fetchC(int x, int y) { return texelFetch(uClass, clampC(x, y), 0); }

float bilinF(int ch, float gx, float gy) {
  int x0 = int(floor(gx)), y0 = int(floor(gy));
  int x1 = min(uN - 1, x0 + 1), y1 = min(uN - 1, y0 + 1);
  float fx = gx - float(x0), fy = gy - float(y0);
  float v00 = fetchF(x0, y0)[ch], v10 = fetchF(x1, y0)[ch];
  float v01 = fetchF(x0, y1)[ch], v11 = fetchF(x1, y1)[ch];
  return (v00 * (1.0 - fx) + v10 * fx) * (1.0 - fy) + (v01 * (1.0 - fx) + v11 * fx) * fy;
}
float bilinChan(float gx, float gy) {
  int x0 = int(floor(gx)), y0 = int(floor(gy));
  int x1 = min(uN - 1, x0 + 1), y1 = min(uN - 1, y0 + 1);
  float fx = gx - float(x0), fy = gy - float(y0);
  float v00 = fetchC(x0, y0).z, v10 = fetchC(x1, y0).z;
  float v01 = fetchC(x0, y1).z, v11 = fetchC(x1, y1).z;
  return (v00 * (1.0 - fx) + v10 * fx) * (1.0 - fy) + (v01 * (1.0 - fx) + v11 * fx) * fy;
}
vec3 bilinLand(float gx, float gy) {
  int x0 = int(floor(gx)), y0 = int(floor(gy));
  int x1 = min(uN - 1, x0 + 1), y1 = min(uN - 1, y0 + 1);
  float fx = gx - float(x0), fy = gy - float(y0);
  vec3 v00 = texelFetch(uLand, clampC(x0, y0), 0).rgb, v10 = texelFetch(uLand, clampC(x1, y0), 0).rgb;
  vec3 v01 = texelFetch(uLand, clampC(x0, y1), 0).rgb, v11 = texelFetch(uLand, clampC(x1, y1), 0).rgb;
  return (v00 * (1.0 - fx) + v10 * fx) * (1.0 - fy) + (v01 * (1.0 - fx) + v11 * fx) * fy;
}

float gOf(float w) { return clamp(((w - float(${GEO_MIN})) / float(${GEO_SPAN})) * float(uN - 1), 0.0, float(uN - 1)); }
float clumpAt(int cx, int cy, int seed) { return vnoise(float(cx) * 0.33, float(cy) * 0.33, seed); }

void main() {
  float px = gl_FragCoord.x - 0.5;
  // the CPU walks rows top-down; gl_FragCoord.y is bottom-up — flip so row 0 is row 0
  float py = uRes.y - (gl_FragCoord.y + 0.5);

  float zoomK = clamp(30.0 / uVb.z, 1.0, 3.0);
  float shadeDelta = 0.8 / zoomK;
  float reliefFade = min(1.0, uVb.z / 16.0);
  float texBase = clamp(34.0 / uVb.z, 3.0, 40.0);
  float riverTintK = clamp((uVb.z - 18.0) / 30.0, 0.0, 1.0);
  float CHANNEL_DEPTH = 0.02 * clamp(1.0 - (uVb.z - 6.0) / 18.0, 0.0, 1.0);
  bool matGate = uVb.z < 30.0;
  float dfq = clamp((uRes.x / uVb.z) * 0.4, 14.0, 96.0);

  float gx = gOf(uVb.x + (px / uRes.x) * uVb.z);
  float gy = gOf(uVb.y + (py / uRes.y) * uVb.w);
  int x0 = int(floor(gx)), y0 = int(floor(gy));
  int x1 = min(uN - 1, x0 + 1), y1 = min(uN - 1, y0 + 1);
  float fx = gx - float(x0), fy = gy - float(y0);
  float w00 = (1.0 - fx) * (1.0 - fy), w10 = fx * (1.0 - fy);
  float w01 = (1.0 - fx) * fy, w11 = fx * fy;
  ivec2 nc = clampC(int(floor(gy + 0.5)), int(floor(gx + 0.5))); // (row, col) — see below
  int ncx = clamp(int(floor(gx + 0.5)), 0, uN - 1), ncy = clamp(int(floor(gy + 0.5)), 0, uN - 1);

  float wtr00 = fetchC(x0, y0).x, wtr10 = fetchC(x1, y0).x;
  float wtr01 = fetchC(x0, y1).x, wtr11 = fetchC(x1, y1).x;
  float wtrN = fetchC(ncx, ncy).x;
  float hillN = fetchC(ncx, ncy).y;
  float tempN = fetchF(ncx, ncy).z;

  float ePlain = bilinF(0, gx, gy);
  float nearShore = 1.0 - abs(ePlain - uSea) / 0.06;
  float eP = ePlain;
  if (nearShore > 0.0) {
    float cd = 0.0, camp = 0.5, cf = 1.6;
    for (int o = 0; o < 4; o++) {
      cd += camp * (vnoise(gx * cf + float(o) * 31.7, gy * cf + float(o) * 13.3, 917) - 0.5);
      camp *= 0.5; cf *= 2.15;
    }
    eP = ePlain + cd * 0.06 * nearShore;
  }

  float lakeFrac = (wtr00 == WATER_LAKE ? w00 : 0.0) + (wtr10 == WATER_LAKE ? w10 : 0.0)
                 + (wtr01 == WATER_LAKE ? w01 : 0.0) + (wtr11 == WATER_LAKE ? w11 : 0.0);
  bool lakeHere = lakeFrac >= 0.5;

  vec3 col;
  if (eP < uSea || lakeHere) {
    bool anySea = wtr00 == WATER_SEA || wtr10 == WATER_SEA || wtr01 == WATER_SEA || wtr11 == WATER_SEA;
    bool anyLake = wtr00 == WATER_LAKE || wtr10 == WATER_LAKE || wtr01 == WATER_LAKE || wtr11 == WATER_LAKE;
    if (lakeHere || (anyLake && !anySea)) {
      float shoreLift = lakeHere ? (1.0 - min(1.0, lakeFrac)) * 0.45 : 0.0;
      col = mix(uDeep, uShallow, 0.66 + shoreLift);
    } else {
      float below = uSea - eP;
      float coast = max(0.0, 1.0 - below / 0.05);
      float depth = clamp(eP / uSea, 0.0, 1.0);
      col = mix(uDeep, uShallow, max(depth, coast * 0.85));
      if (coast > 0.0) col = mix(col, uShore, coast * coast * 0.5);
    }
  } else {
    col = bilinLand(gx, gy);
    int cw = int(floor((uVb.x + ((px + 0.5) / uRes.x) * uVb.z) * dfq));
    int chh = int(floor((uVb.y + ((py + 0.5) / uRes.y) * uVb.w) * dfq));

    if (eP < uSea + 0.018 && tempN > 0.34) {
      float beach = max(0.0, 1.0 - (eP - uSea) / 0.018);
      float bk = matGate
        ? (beach * 1.4 + (clumpAt(cw, chh, 1697) - 0.5) * 0.9 > 0.75 ? 0.85 : beach * 0.12)
        : beach * 0.7;
      col = mix(col, SAND, bk);
    }

    float e = ePlain;
    float gxp = min(float(uN - 1), gx + shadeDelta), gyp = min(float(uN - 1), gy + shadeDelta);
    float gxm = max(0.0, gx - shadeDelta), gym = max(0.0, gy - shadeDelta);
    float grain = clamp((zoomK - 1.0) / 1.7, 0.0, 1.0);
    float synthAmp = (0.010 + hillN * 0.012) * grain;

    float sh0 = 0.0, shXP = 0.0, shYP = 0.0, shXM = 0.0, shYM = 0.0;
    {
      float a = 0.5, fr = 1.15, nrm = 0.0;
      float v0 = 0.0, vxp = 0.0, vyp = 0.0, vxm = 0.0, vym = 0.0;
      for (int o = 0; o < 5; o++) {
        float ox = float(o) * 13.1, oy = float(o) * 7.7;
        v0  += a * (vnoise(gx  * fr + ox, gy  * fr + oy, 3110) - 0.5);
        vxp += a * (vnoise(gxp * fr + ox, gy  * fr + oy, 3110) - 0.5);
        vyp += a * (vnoise(gx  * fr + ox, gyp * fr + oy, 3110) - 0.5);
        vxm += a * (vnoise(gxm * fr + ox, gy  * fr + oy, 3110) - 0.5);
        vym += a * (vnoise(gx  * fr + ox, gym * fr + oy, 3110) - 0.5);
        nrm += a; a *= 0.5; fr *= 2.15;
      }
      sh0 = (v0 / nrm) * synthAmp; shXP = (vxp / nrm) * synthAmp; shYP = (vyp / nrm) * synthAmp;
      shXM = (vxm / nrm) * synthAmp; shYM = (vym / nrm) * synthAmp;
    }

    float chG = bilinChan(gx, gy) * CHANNEL_DEPTH;
    float ex = (bilinF(0, gxp, gy) - e) * reliefFade + (shXP - sh0) - (bilinChan(gxp, gy) * CHANNEL_DEPTH - chG);
    float ey = (bilinF(0, gx, gyp) - e) * reliefFade + (shYP - sh0) - (bilinChan(gx, gyp) * CHANNEL_DEPTH - chG);
    float s = 1.0 + (-ex - ey) * uHillshade * (8.0 + hillN * 4.0);
    s = clamp(s, 0.5, 1.5);
    float eC = e + sh0;
    float concavity = ((bilinF(0, gxp, gy) + shXP) + (bilinF(0, gxm, gy) + shXM)
                     + (bilinF(0, gx, gyp) + shYP) + (bilinF(0, gx, gym) + shYM)) / 4.0 - eC;
    s *= 1.0 - clamp(concavity * 6.0, -0.14, 0.18);
    col *= s;

    if (CHANNEL_DEPTH > 0.0) {
      float chRaw = bilinChan(gx, gy);
      if (chRaw > 0.0) col *= vec3(1.0 - chRaw * 0.30, 1.0 - chRaw * 0.22, 1.0 - chRaw * 0.10);
    }

    if (hillN >= 2.0 && synthAmp > 0.0) {
      float crest = max(0.0, sh0 / synthAmp);
      float bare = crest * grain * (hillN >= 3.0 ? 1.0 : 0.55);
      if (bare > 0.0) {
        col = mix(col, vec3(150.0, 150.0, 152.0), bare * 0.5);
        if (matGate && bare > 0.1 && bare * 2.0 + (clumpAt(cw, chh, 733) - 0.5) * 0.8 > 0.9) {
          col = mix(col, vec3(148.0, 146.0, 150.0), vec3(0.7, 0.7, 0.66));
        }
        if (tempN < 0.42) {
          float snow = bare * min(1.0, (0.42 - tempN) / 0.3);
          col = mix(col, vec3(236.0, 240.0, 245.0), snow * 0.7);
        }
      }
    }

    if (grain > 0.0) {
      float d = 0.0, amp = 0.5, fr = texBase, norm = 0.0;
      for (int o = 0; o < 4; o++) {
        d += amp * (vnoise(gx * fr + float(o) * 17.3, gy * fr + float(o) * 9.1, 5150) - 0.5);
        norm += amp; amp *= 0.5; fr *= 2.0;
      }
      d /= norm;
      col *= 1.0 + d * (0.16 + hillN * 0.08) * grain;
      float cm = (vnoise(gx * texBase * 1.7 + 7.7, gy * texBase * 1.7 + 2.3, 2718) - 0.5) * grain * 0.4;
      float lush = fetchF(ncx, ncy).y * 0.5 + fetchF(ncx, ncy).w * 0.5;
      col.g += cm * (7.0 + lush * 12.0);
      col.r += cm * 3.0;
      col.b -= cm * 3.0;
    }

    float nearRiver = wtrN == WATER_RIVER ? 0.68
      : (wtr00 == WATER_RIVER || wtr10 == WATER_RIVER || wtr01 == WATER_RIVER || wtr11 == WATER_RIVER) ? 0.34 : 0.0;
    if (nearRiver > 0.0 && riverTintK > 0.0) col = mix(col, uRiver, nearRiver * riverTintK);

    if (uHasGround) {
      vec2 gm = texelFetch(uGround, ivec2(int(px), int(py)), 0).xy;
      float m = gm.x;
      if (m > 0.0 && m + (clumpAt(cw, chh, 4242) - 0.5) * 0.55 > 0.5) {
        int pi = int(floor(gm.y * 255.0 + 0.5));
        vec4 p0 = texelFetch(uPatch, ivec2(pi, 0), 0);
        float speckle = texelFetch(uPatch, ivec2(pi, 1), 0).x;
        float sp = speckle > 0.0 ? 1.0 + (hash2(cw, chh, 9091) - 0.5) * speckle : 1.0;
        col = mix(col, p0.rgb * sp * s, p0.a);
      }
    }
  }
  outColor = vec4(clamp(col, 0.0, 255.0) / 255.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`terrain shader: ${log}`);
  }
  return sh;
}

export interface TerrainGpu {
  /** paint the frame; returns the GPU draw time in ms (excludes the one-off geo upload) */
  paint(geo: GeoFields, vb: ViewBox, theme: SurfaceTheme, W: number, H: number, key: number, ground?: GroundPatch[]): number;
  /** the rendered surface, for `drawImage` onto the visible 2D canvas. The shader flips its row
   *  order to match the CPU reference, so this blits across with no further orientation fuss. */
  readonly surface: CanvasImageSource;
  readPixels(W: number, H: number): Uint8Array;
  dispose(): void;
}

/** Build the GPU painter on an offscreen canvas, or return null when WebGL2 (or float colour
 *  buffers) are unavailable — the caller then keeps the CPU/worker path. */
export function createTerrainGpu(): TerrainGpu | null {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  if (!canvas) return null;
  const gl = (canvas as HTMLCanvasElement).getContext('webgl2', { antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  // 32F textures are sampled (not rendered to), so only the float TEXTURE support matters —
  // core in WebGL2. Bail loudly rather than paint something subtly wrong.
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
  } catch (e) {
    console.warn('[terrainGpu] unavailable, falling back to the CPU painter:', (e as Error).message);
    return null;
  }

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const mkTex = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const texFields = mkTex(), texClass = mkTex(), texLand = mkTex(), texGround = mkTex(), texPatch = mkTex();
  let uploadedKey: number | null = null;

  const u = (n: string) => gl.getUniformLocation(prog, n);

  return {
    surface: canvas as CanvasImageSource,
    paint(geo, vb, theme, W, H, key, ground) {
      const N = geo.size;
      (canvas as HTMLCanvasElement).width = W;
      (canvas as HTMLCanvasElement).height = H;
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog);

      // ---- one-off per-world upload (the tables are view-independent) ----
      if (uploadedKey !== key) {
        const { landR, landG, landB, chan } = geoTablesFor(geo, key);
        const f = new Float32Array(N * N * 4);
        for (let i = 0; i < N * N; i++) { f[i * 4] = geo.elevation[i]; f[i * 4 + 1] = geo.moisture[i]; f[i * 4 + 2] = geo.temperature[i]; f[i * 4 + 3] = geo.fertility[i]; }
        gl.bindTexture(gl.TEXTURE_2D, texFields);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, f);
        const c = new Float32Array(N * N * 4);
        for (let i = 0; i < N * N; i++) { c[i * 4] = geo.water[i]; c[i * 4 + 1] = geo.hilliness[i]; c[i * 4 + 2] = chan[i]; }
        gl.bindTexture(gl.TEXTURE_2D, texClass);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, c);
        const l = new Float32Array(N * N * 4);
        for (let i = 0; i < N * N; i++) { l[i * 4] = landR[i]; l[i * 4 + 1] = landG[i]; l[i * 4 + 2] = landB[i]; }
        gl.bindTexture(gl.TEXTURE_2D, texLand);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, l);
        uploadedKey = key;
      }

      // ---- the ground mask: rasterized on the CPU exactly as the reference does, because it
      //      is bounded by the patches' own bounding boxes (cheap) rather than by W*H*patches
      //      (which is what evaluating every patch per-fragment would cost).
      const patches = (ground ?? []).slice(0, 255);
      const hasGround = patches.length > 0;
      if (hasGround) {
        const mask = new Uint8Array(W * H * 4);
        const pxPerW = W / vb.w, pyPerH = H / vb.h;
        const strength = new Float32Array(W * H);
        patches.forEach((p, pi) => {
          const put = (px: number, py: number, s: number) => {
            const k = py * W + px;
            if (s >= strength[k]) { strength[k] = s; mask[k * 4] = Math.round(s * 255); mask[k * 4 + 1] = pi; }
          };
          if (p.r !== undefined) {
            const x0 = Math.max(0, Math.floor((p.x - p.r - vb.x) * pxPerW)), x1 = Math.min(W - 1, Math.ceil((p.x + p.r - vb.x) * pxPerW));
            const y0 = Math.max(0, Math.floor((p.y - p.r - vb.y) * pyPerH)), y1 = Math.min(H - 1, Math.ceil((p.y + p.r - vb.y) * pyPerH));
            for (let py = y0; py <= y1; py++) {
              const wy = vb.y + ((py + 0.5) / H) * vb.h;
              for (let px = x0; px <= x1; px++) {
                const wx = vb.x + ((px + 0.5) / W) * vb.w;
                const d = Math.hypot(wx - p.x, wy - p.y) / p.r;
                if (d >= 1) continue;
                put(px, py, Math.min(1, (1 - d) / 0.5));
              }
            }
          } else if (p.w !== undefined && p.h !== undefined) {
            const rr = Math.hypot(p.w, p.h) / 2;
            const x0 = Math.max(0, Math.floor((p.x - rr - vb.x) * pxPerW)), x1 = Math.min(W - 1, Math.ceil((p.x + rr - vb.x) * pxPerW));
            const y0 = Math.max(0, Math.floor((p.y - rr - vb.y) * pyPerH)), y1 = Math.min(H - 1, Math.ceil((p.y + rr - vb.y) * pyPerH));
            const co = Math.cos(-(p.rot ?? 0)), si = Math.sin(-(p.rot ?? 0));
            const hw = p.w / 2, hh = p.h / 2;
            for (let py = y0; py <= y1; py++) {
              const wy = vb.y + ((py + 0.5) / H) * vb.h;
              for (let px = x0; px <= x1; px++) {
                const wx = vb.x + ((px + 0.5) / W) * vb.w;
                const dx = wx - p.x, dy = wy - p.y;
                const lx = Math.abs(dx * co - dy * si), ly = Math.abs(dx * si + dy * co);
                if (lx >= hw || ly >= hh) continue;
                put(px, py, Math.min(1, Math.min(hw - lx, hh - ly) / (Math.min(hw, hh) * 0.2)));
              }
            }
          }
        });
        gl.bindTexture(gl.TEXTURE_2D, texGround);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask);
        const pp = new Float32Array(256 * 2 * 4);
        patches.forEach((p, i) => {
          pp[i * 4] = p.tone[0]; pp[i * 4 + 1] = p.tone[1]; pp[i * 4 + 2] = p.tone[2]; pp[i * 4 + 3] = p.blend;
          pp[(256 + i) * 4] = p.speckle ?? 0;
        });
        gl.bindTexture(gl.TEXTURE_2D, texPatch);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 2, 0, gl.RGBA, gl.FLOAT, pp);
      }

      const water = theme.water ?? { deep: [18, 26, 40] as [number, number, number], shallow: [40, 60, 80] as [number, number, number], level: geo.seaLevel };
      gl.uniform1i(u('uN'), N);
      gl.uniform4f(u('uVb'), vb.x, vb.y, vb.w, vb.h);
      gl.uniform2f(u('uRes'), W, H);
      gl.uniform1f(u('uSea'), geo.seaLevel);
      gl.uniform3f(u('uDeep'), water.deep[0], water.deep[1], water.deep[2]);
      gl.uniform3f(u('uShallow'), water.shallow[0], water.shallow[1], water.shallow[2]);
      gl.uniform3f(u('uShore'), Math.min(255, water.shallow[0] + 24), Math.min(255, water.shallow[1] + 44), Math.min(255, water.shallow[2] + 40));
      gl.uniform3f(u('uRiver'), Math.min(255, water.shallow[0] * 1.15 + 16), Math.min(255, water.shallow[1] * 1.15 + 16), Math.min(255, water.shallow[2] * 1.15 + 20));
      gl.uniform1f(u('uHillshade'), theme.hillshade);
      gl.uniform1i(u('uHasGround'), hasGround ? 1 : 0);
      for (const [i, [t, n]] of ([[texFields, 'uFields'], [texClass, 'uClass'], [texLand, 'uLand'], [texGround, 'uGround'], [texPatch, 'uPatch']] as [WebGLTexture, string][]).entries()) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(u(n), i);
      }

      const t0 = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.finish(); // so the timing below is the real GPU cost, not just submission
      return performance.now() - t0;
    },
    readPixels(W, H) {
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    },
    dispose() {
      for (const t of [texFields, texClass, texLand, texGround, texPatch]) gl.deleteTexture(t);
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
    },
  };
}
