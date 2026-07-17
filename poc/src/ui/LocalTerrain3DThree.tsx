/**
 * THE CLOSE VIEW IN 3D (design/24 §8) — three.js.
 *
 * The settlement's neighbourhood as a lit, orbitable 3-D scene: the world's real elevation
 * continued with coherent sub-grid detail (shared geometry in `terrain3dGeo.ts`), the town
 * plan extruded onto it, and the sea as animated reflective water. The heavy graphics come
 * from three's built-ins — PCFSoft shadow maps, SSAO + SMAA post, an atmospheric Sky, ACES
 * tone mapping, exponential fog, OrbitControls — so this stays small. Pure presentation.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { type Geography, temperatureAt } from '../engine/geography';
import type { LocalPlan } from '../content/localmap';
import { buildTerrain, buildStructures, buildRiverMesh, buildRoadMesh, buildFieldMesh, type Accum } from './terrain3dGeo';
import { Icon } from './icons';

/** the geometry builders author colours in sRGB; three works in LINEAR, so convert before
 *  upload (otherwise the biome colours render pale/muted after tone mapping + sRGB output). */
function toLinear(c: Float32Array | number[]): Float32Array {
  const out = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) { const v = c[i] as number; out[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return out;
}
function toGeometry(d: { pos: Float32Array | number[]; nrm: Float32Array | number[]; col: Float32Array | number[]; idx: Uint32Array | number[] }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(toLinear(d.col), 3));
  g.setIndex(new THREE.Uint32BufferAttribute(d.idx, 1));
  return g;
}


// CUSTOM WATER — a stylised blue sea I fully control (three's `Water` just mirrored the pale sky
// and read grey). Deep-blue base that dominates, a BLUISH grazing tint (never white), animated
// ripples and a bright sun glint. Colours are LINEAR (the composer's OutputPass tone-maps); fog
// is three's own chunks so it matches the scene.
const WATER_VERT = `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = `
#include <fog_pars_fragment>
varying vec3 vWorld;
uniform float uTime; uniform vec3 uEye; uniform vec3 uSun;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float wav(vec2 p){ return vnz(p) + 0.5*vnz(p*2.1 + 7.0); }
void main() {
  vec3 v = normalize(vWorld - uEye);
  vec2 p = vWorld.xz * 1.1 + vec2(uTime*0.05, uTime*0.037);
  float e = 0.06, h0 = wav(p);
  vec3 n = normalize(vec3(-(wav(p+vec2(e,0.0))-h0)*0.7, 1.0, -(wav(p+vec2(0.0,e))-h0)*0.7));
  float fres = pow(1.0 - clamp(dot(-v, n), 0.0, 1.0), 3.0);
  // a DARK NAVY-TEAL sea to match the 2D map's palette (theme water deep→shallow): deep and
  // desaturated looking down, only a touch lighter and greener at grazing angles.
  vec3 col = mix(vec3(0.014, 0.036, 0.058), vec3(0.045, 0.098, 0.140), clamp(fres, 0.0, 1.0));
  vec3 refl = reflect(v, n);
  col += vec3(1.0, 0.92, 0.72) * pow(max(0.0, dot(refl, normalize(uSun))), 300.0) * 0.5; // tight, restrained sun glint
  gl_FragColor = vec4(col, 0.97);
  #include <fog_fragment>
}`;
// RIVERS — a brighter, sunlit FRESHWATER look that FADES into the exact sea shader at the mouth.
// The blend factor is derived IN-SHADER from the ribbon's height above the sea (vWorld.y): at
// sea level it IS the sea shader (seamless mouth); well inland it's clear bright freshwater. No
// custom attribute needed — it shares WATER_VERT.
const RIVER_FRAG = `
#include <fog_pars_fragment>
varying vec3 vWorld;
uniform float uTime; uniform vec3 uEye; uniform vec3 uSun;
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float wav(vec2 p){ return vnz(p) + 0.5*vnz(p*2.1 + 7.0); }
void main() {
  float sea = 1.0 - clamp((vWorld.y - 0.1) / 1.6, 0.0, 1.0); // 1 at the sea, 0 well inland
  vec3 v = normalize(vWorld - uEye);
  vec2 p = vWorld.xz * mix(2.3, 1.1, sea) + vec2(uTime*0.08, uTime*0.06); // fine stream ripples → coarse sea near the mouth
  float e = 0.05, h0 = wav(p);
  vec3 n = normalize(vec3(-(wav(p+vec2(e,0.0))-h0)*0.8, 1.0, -(wav(p+vec2(0.0,e))-h0)*0.8));
  float fres = pow(1.0 - clamp(dot(-v, n), 0.0, 1.0), 3.0);
  vec3 fresh = mix(vec3(0.08, 0.22, 0.30), vec3(0.20, 0.40, 0.48), clamp(fres, 0.0, 1.0)); // muted freshwater teal
  vec3 seaC  = mix(vec3(0.014, 0.036, 0.058), vec3(0.045, 0.098, 0.140), clamp(fres, 0.0, 1.0)); // matches the sea shader
  vec3 col = mix(fresh, seaC, sea);
  col += vec3(1.0, 0.95, 0.80) * pow(max(0.0, dot(reflect(v, n), normalize(uSun))), mix(160.0, 300.0, sea)) * mix(0.7, 0.5, sea);
  gl_FragColor = vec4(col, mix(0.9, 0.96, sea));
  #include <fog_fragment>
}`;

export function LocalTerrain3DThree({ geo, plan, cx, cy, span, seed, onExit }: {
  geo: Geography; plan: LocalPlan | null; cx: number; cy: number; span: number; seed: number; onExit: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch (e) { setErr(`3D unavailable: ${(e as Error).message}`); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // cap high-DPI (retina/4K) render cost; native crispness below that
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // the sun and geometry are static, so render the shadow map ONCE (not every frame) — saves
    // a full 2048² depth pass per frame. `needsUpdate` is set true for the first render below.
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sunDir = new THREE.Vector3(0.62, 0.5, 0.36).normalize();

    // atmospheric sky + matching aerial fog
    const sky = new Sky();
    sky.scale.setScalar(span * 40);
    const su = sky.material.uniforms;
    su['turbidity'].value = 1.4; su['rayleigh'].value = 3.4; su['mieCoefficient'].value = 0.003; su['mieDirectionalG'].value = 0.9;
    su['sunPosition'].value.copy(sunDir);
    scene.add(sky);
    scene.fog = new THREE.FogExp2(0x87abcc, 0.55 / (span * 8));

    // sun (shadows) + soft sky/ground fill
    const sun = new THREE.DirectionalLight(0xfff2e0, 3.1);
    sun.position.copy(sunDir).multiplyScalar(span * 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -span * 0.9; sc.right = span * 0.9; sc.top = span * 0.9; sc.bottom = -span * 0.9; sc.near = 0.1; sc.far = span * 4;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x55503f, 1.0));

    // terrain — the shared geometry, PBR-textured. Grass/rock/snow material maps (supplied in
    // public/textures/) are SPLATTED by slope + altitude in the standard material's shader, so
    // cliffs bare rock and peaks catch snow; the vertex-colour biome stays the tint.
    const tMesh = buildTerrain(geo, cx, cy, span, seed);
    const tGeo = toGeometry(tMesh);
    tGeo.setAttribute('aMat', new THREE.Float32BufferAttribute(tMesh.mat, 4)); // per-vertex (sand, mud, snowBias, gravel)
    const tp = tGeo.attributes.position, tuv = new Float32Array(tp.count * 2);
    for (let i = 0; i < tp.count; i++) { tuv[i * 2] = tp.getX(i) * 1.4; tuv[i * 2 + 1] = tp.getZ(i) * 1.4; }
    tGeo.setAttribute('uv', new THREE.BufferAttribute(tuv, 2));
    const texLoader = new THREE.TextureLoader();
    const tex = (url: string, srgb: boolean) => { const t = texLoader.load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
    const grassA = tex('/textures/grass_albedo.png', true), rockA = tex('/textures/rock_albedo.png', true), snowA = tex('/textures/snow_albedo.png', true);
    const sandA = tex('/textures/sand_albedo.png', true), mudA = tex('/textures/mud_albedo.png', true), gravelA = tex('/textures/gravel_albedo.png', true);
    // …and a NORMAL map per splat material. Without these every surface wore grass's bumpiness,
    // so a cliff read as rock-COLOURED grass: right hue, wrong relief. The splat below blends the
    // six by the same weights as the albedo, so each ground type carries its own surface.
    const grassN = tex('/textures/grass_normal.png', false), rockN = tex('/textures/rock_normal.png', false), snowN = tex('/textures/snow_normal.png', false);
    const sandN = tex('/textures/sand_normal.png', false), mudN = tex('/textures/mud_normal.png', false), gravelN = tex('/textures/gravel_normal.png', false);
    // `normalMap` stays bound (it's what defines USE_NORMALMAP_TANGENTSPACE and builds the `tbn`
    // frame our replacement reuses); the chunk override samples the six uniforms instead of it.
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0, normalMap: grassN, normalScale: new THREE.Vector2(0.5, 0.5) });
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.tGrass = { value: grassA }; shader.uniforms.tRock = { value: rockA }; shader.uniforms.tSnow = { value: snowA };
      shader.uniforms.tSand = { value: sandA }; shader.uniforms.tMud = { value: mudA }; shader.uniforms.tGravel = { value: gravelA }; shader.uniforms.uTexScale = { value: 1.4 };
      shader.uniforms.nGrass = { value: grassN }; shader.uniforms.nRock = { value: rockN }; shader.uniforms.nSnow = { value: snowN };
      shader.uniforms.nSand = { value: sandN }; shader.uniforms.nMud = { value: mudN }; shader.uniforms.nGravel = { value: gravelN };
      shader.uniforms.uNrm = { value: 0.5 }; // matches the normalScale the tangent-space path used
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nvarying vec4 vMat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vMat = aMat;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        // the six splat weights + shared uv are GLOBALS: <color_fragment> computes them for the
        // albedo, and <normal_fragment_maps> (which runs later) reuses them for the normal blend,
        // so colour and relief always agree — one partition, sampled twice.
        .replace('#include <common>', `#include <common>
        varying vec4 vMat; varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tGrass; uniform sampler2D tRock; uniform sampler2D tSnow; uniform sampler2D tSand; uniform sampler2D tMud; uniform sampler2D tGravel;
        uniform sampler2D nGrass; uniform sampler2D nRock; uniform sampler2D nSnow; uniform sampler2D nSand; uniform sampler2D nMud; uniform sampler2D nGravel;
        uniform float uTexScale;
        uniform float uNrm; // global relief depth. Our own, not three's \`normalScale\`: that is
                            // declared in <normalmap_pars_fragment>, which comes AFTER <common>,
                            // so the helpers below could not legally reference it.
        float wGrass, wRock, wSnow, wSand, wMud, wGravel;
        vec3 wp;  // world position, scaled — the triplanar sample point
        vec3 bw;  // how much each of the three planes counts here

        // TRIPLANAR (design/28): the ground used to be projected straight down (uv = world.xz),
        // which is exact on the flat and degenerate on a cliff — a vertical face barely moves in
        // xz, so its texture smeared into vertical streaks. And rock is the slope-gated material,
        // so the worst projection landed on the only surface that shows it. Sampling all three
        // world planes and blending by the normal removes the stretch at its source.
        vec3 tpA(sampler2D t) {
          return texture2D(t, wp.zy).rgb * bw.x + texture2D(t, wp.xz).rgb * bw.y + texture2D(t, wp.xy).rgb * bw.z;
        }
        // The normal needs the same treatment, and can't reuse three's \`tbn\`: that frame is built
        // from the xz-projected uv, so on a cliff it is exactly as degenerate as the projection
        // was. Instead each plane's tangent normal is folded onto the geometric normal (the
        // standard "whiteout" blend) to give a WORLD normal directly, which we hand to the
        // lighting in view space. Fixes cliff relief, not just cliff colour.
        vec3 tpN(sampler2D t, float s) {
          vec3 nx = texture2D(t, wp.zy).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(t, wp.xz).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(t, wp.xy).xyz * 2.0 - 1.0;
          float k = s * uNrm;
          nx.xy *= k; ny.xy *= k; nz.xy *= k;
          vec3 g = vWNrm;
          nx = vec3(nx.xy + g.zy, abs(nx.z) * g.x);
          ny = vec3(ny.xy + g.xz, abs(ny.z) * g.y);
          nz = vec3(nz.xy + g.xy, abs(nz.z) * g.z);
          return nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z;
        }
        // MACRO VARIATION — one texture at one scale repeats visibly over open ground. A cheap
        // low-frequency wobble over the whole splat breaks the grid up at distance. Procedural on
        // purpose: it costs arithmetic, not another 18 texture fetches.
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vnz(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float macro(vec2 p) { return vnz(p) * 0.62 + vnz(p * 2.7 + 3.1) * 0.38; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
          wRock = smoothstep(0.32, 0.62, slope);
          // snow comes from ALTITUDE or from a cold biome (tundra), whichever is greater
          wSnow = max(smoothstep(3.2, 6.5, vWPos.y), vMat.z) * (1.0 - wRock);
          float avail = max(0.0, 1.0 - wRock - wSnow);
          float scree = smoothstep(0.30, 0.52, slope);                       // loose stone on the steep apron below the cliffs
          float gravel = clamp(max(vMat.w, scree), 0.0, 1.0);                 // + a river's shingle banks
          float sand = clamp(vMat.x, 0.0, 1.0), mud = clamp(vMat.y, 0.0, 1.0);
          // partition the non-rock/snow ground: sand, then mud, then gravel, then grass
          wSand = avail * sand;
          float r1 = avail - wSand;
          wMud = r1 * mud;
          float r2 = r1 - wMud;
          wGravel = r2 * gravel;
          wGrass = max(0.0, r2 - wGravel);
          // the triplanar sample point and its per-plane weights, shared with the normal pass.
          // The exponent sharpens the transition so flat ground is almost purely the xz plane
          // (i.e. exactly what it used to be) and only genuinely steep faces pay for the blend.
          wp = vWPos * uTexScale;
          bw = pow(abs(vWNrm), vec3(4.0));
          bw /= max(1e-4, bw.x + bw.y + bw.z);
          vec3 base = diffuseColor.rgb;
          // WEIGHT-GATED FETCHES: sampling all six materials triplanar cost up to 18 albedo
          // fetches per fragment even where five weights were zero. The weights are spatially
          // coherent (a grass plain is grass for whole tiles), so these branches skip nearly
          // all of it on ordinary ground; a renormalising wSum keeps the blend exact when a
          // sub-threshold sliver is dropped.
          vec3 accum = vec3(0.0);
          float wSum = 0.0;
          if (wGrass > 0.004) {
            vec3 grassCol = base * (tpA(tGrass) * 1.55);  // biome hue × grass detail (matched to the flatter 2D biome tint)
            grassCol = mix(vec3(dot(grassCol, vec3(0.299, 0.587, 0.114))), grassCol, 0.72); // mute the verdancy toward the 2D palette
            grassCol *= vec3(1.06, 1.0, 0.90);                         // a touch warmer/yellower, like the 2D biome green
            accum += grassCol * wGrass; wSum += wGrass;
          }
          if (wRock > 0.004)   { accum += mix(tpA(tRock) * 1.12, base, 0.18) * wRock; wSum += wRock; }       // earthy stone, biome-tinted
          if (wSnow > 0.004)   { accum += tpA(tSnow) * 1.05 * wSnow; wSum += wSnow; }                        // its own white snow
          if (wSand > 0.004)   { accum += tpA(tSand) * 1.08 * wSand; wSum += wSand; }                        // warm sand
          if (wMud > 0.004)    { accum += tpA(tMud) * 1.12 * wMud; wSum += wMud; }                           // its own wet mud
          if (wGravel > 0.004) { accum += mix(tpA(tGravel) * 1.08, base, 0.16) * wGravel; wSum += wGravel; } // loose stone
          diffuseColor.rgb = accum / max(wSum, 1e-3);
          diffuseColor.rgb *= mix(0.86, 1.14, macro(vWPos.xz * 0.07)); // break up the tile at range
        }`)
        // RELIEF per material, triplanar and in WORLD space. The weights partition to exactly 1,
        // so a straight weighted sum is a valid blend. Per-material strengths carry the character
        // the albedo can't: rock and gravel bite hard, snow is smooth drift, grass keeps its 1.0
        // so open ground reads as it always did. `viewMatrix` (not normalMatrix, which three does
        // not declare in the fragment stage) takes the world normal to view space — exact here,
        // since the terrain mesh carries no scale.
        .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          // the same weight gates as the albedo (18 more fetches saved); normalize()
          // absorbs the dropped slivers, so no renormalisation is needed here
          vec3 wn = vec3(0.0);
          if (wGrass > 0.004)  wn += tpN(nGrass,  1.0) * wGrass;
          if (wRock > 0.004)   wn += tpN(nRock,   2.4) * wRock;
          if (wSnow > 0.004)   wn += tpN(nSnow,   0.5) * wSnow;
          if (wSand > 0.004)   wn += tpN(nSand,   1.1) * wSand;
          if (wMud > 0.004)    wn += tpN(nMud,    1.4) * wMud;
          if (wGravel > 0.004) wn += tpN(nGravel, 2.0) * wGravel;
          wn = normalize(wn);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        #endif`);
    };
    const terrain = new THREE.Mesh(tGeo, terrainMat);
    terrain.castShadow = true; terrain.receiveShadow = true;
    scene.add(terrain);
    if (plan) {
      // STRUCTURES (design/28 §3) — the town's fabric. Every face carries a material id
      // (`aSurf`) chosen by what it IS — its people's boards, a hall's masonry, a roof's straw —
      // and the shader picks that texture and tints it by the face's own colour. One mesh, one
      // draw call: the same aMat/splat idiom the terrain uses, selecting instead of blending.
      const A: Accum = buildStructures(plan, geo, cx, cy, span, seed);
      const sGeo = toGeometry({ pos: A.pos, nrm: A.nrm, col: A.col, idx: A.idx });
      sGeo.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
      sGeo.setAttribute('aSurf', new THREE.Float32BufferAttribute(A.mat, 1));
      const archA = (n: string) => tex(`/textures/${n}_albedo.png`, true);
      const archN = (n: string) => tex(`/textures/${n}_normal.png`, false);
      const aPlank = archA('plank'), aMasonry = archA('masonry'), aAdobe = archA('adobe'), aThatch = archA('thatch'), aSlate = archA('slate'), aClay = archA('clay');
      const nPlank = archN('plank'), nMasonry = archN('masonry'), nAdobe = archN('adobe'), nThatch = archN('thatch'), nSlate = archN('slate'), nClay = archN('clay');
      const structMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
        normalMap: nPlank, normalScale: new THREE.Vector2(0.7, 0.7), // binds the tangent-space path; the override picks the real map
      });
      structMat.onBeforeCompile = (shader) => {
        for (const [k, v] of Object.entries({ sPlank: aPlank, sMasonry: aMasonry, sAdobe: aAdobe, sThatch: aThatch, sSlate: aSlate, sClay: aClay,
          mPlank: nPlank, mMasonry: nMasonry, mAdobe: nAdobe, mThatch: nThatch, mSlate: nSlate, mClay: nClay })) shader.uniforms[k] = { value: v };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aSurf;\nvarying float vSurf;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;');
        // `sel` is 1 only for the face's own material — a select, not a blend, so a wall is all
        // boards and never half straw. Branch-free on purpose: sampling every map keeps the
        // texture derivatives well-defined, which a divergent `if` around texture2D would not.
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
          varying float vSurf;
          uniform sampler2D sPlank; uniform sampler2D sMasonry; uniform sampler2D sAdobe; uniform sampler2D sThatch; uniform sampler2D sSlate; uniform sampler2D sClay;
          uniform sampler2D mPlank; uniform sampler2D mMasonry; uniform sampler2D mAdobe; uniform sampler2D mThatch; uniform sampler2D mSlate; uniform sampler2D mClay;
          float sel(float id) { return step(abs(vSurf - id), 0.5); }`)
          .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 uvA = vNormalMapUv; // the only uv varying three declares here — we bind normalMap, not map
            vec3 t = texture2D(sPlank, uvA).rgb * sel(1.0) + texture2D(sMasonry, uvA).rgb * sel(2.0)
                   + texture2D(sAdobe, uvA).rgb * sel(3.0) + texture2D(sThatch, uvA).rgb * sel(4.0)
                   + texture2D(sSlate, uvA).rgb * sel(5.0) + texture2D(sClay, uvA).rgb * sel(6.0);
            // mat 0 (foliage, folk, glazing) keeps its flat colour; the rest are tinted by theirs.
            // The 1.5 lifts the near-grey maps back to the colour the flat build already had.
            float textured = 1.0 - sel(0.0);
            diffuseColor.rgb *= mix(vec3(1.0), t * 1.5, textured);
          }`)
          .replace('#include <normal_fragment_maps>', `
          #ifdef USE_NORMALMAP_TANGENTSPACE
            if (vSurf > 0.5) {
              vec2 uvN = vNormalMapUv;
              vec3 mapN = texture2D(mPlank, uvN).xyz * sel(1.0) + texture2D(mMasonry, uvN).xyz * sel(2.0)
                        + texture2D(mAdobe, uvN).xyz * sel(3.0) + texture2D(mThatch, uvN).xyz * sel(4.0)
                        + texture2D(mSlate, uvN).xyz * sel(5.0) + texture2D(mClay, uvN).xyz * sel(6.0);
              mapN = mapN * 2.0 - 1.0;
              mapN.xy *= normalScale;
              normal = normalize(tbn * mapN);
            }
          #endif`);
      };
      const sMesh = new THREE.Mesh(sGeo, structMat);
      sMesh.castShadow = true; sMesh.receiveShadow = true;
      scene.add(sMesh);

      // ROADS — their own textured dirt-track mesh (packed-earth albedo + normal, UV-tiled)
      const road = buildRoadMesh(plan, geo, cx, cy, span, seed);
      if (road.n > 0) {
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(road.pos, 3));
        rg.setAttribute('normal', new THREE.Float32BufferAttribute(road.nrm, 3));
        rg.setAttribute('color', new THREE.Float32BufferAttribute(toLinear(road.col), 3));
        rg.setAttribute('uv', new THREE.Float32BufferAttribute(road.uv, 2));
        rg.setIndex(new THREE.Uint32BufferAttribute(road.idx, 1));
        const roadMat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide, // fully matte — dirt has no shine
          map: tex('/textures/dirt_albedo.png?v=3', true), normalMap: tex('/textures/dirt_normal.png?v=3', false), normalScale: new THREE.Vector2(0.45, 0.45),
          emissive: new THREE.Color(0.06, 0.05, 0.035), // a faint earth floor so it never crushes to black in shadow
        });
        const roadMesh = new THREE.Mesh(rg, roadMat);
        roadMesh.receiveShadow = true;
        scene.add(roadMesh);
      }

      // FIELDS — a textured, terrain-conforming crop-row mesh (ploughed furrows) instead of flat quads
      const field = buildFieldMesh(plan, geo, cx, cy, span, seed);
      if (field.n > 0) {
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(field.pos, 3));
        fg.setAttribute('normal', new THREE.Float32BufferAttribute(field.nrm, 3));
        fg.setAttribute('color', new THREE.Float32BufferAttribute(toLinear(field.col), 3));
        fg.setAttribute('uv', new THREE.Float32BufferAttribute(field.uv, 2));
        fg.setIndex(new THREE.Uint32BufferAttribute(field.idx, 1));
        const fieldMat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide,
          map: tex('/textures/field_albedo.png?v=2', true), normalMap: tex('/textures/field_normal.png?v=2', false), normalScale: new THREE.Vector2(0.8, 0.8),
        });
        const fieldMesh = new THREE.Mesh(fg, fieldMat);
        fieldMesh.receiveShadow = true;
        scene.add(fieldMesh);
      }
    }

    // WATER — a custom stylised-blue sea (deep blue base, rippled, sun glint), fog-matched.
    // A COLD site freezes it: the surface renders as ice instead (design/28 #4). The threshold
    // matches biomeOf's cold cutoff, so a frozen sea sits under a tundra/taiga shore.
    const frozen = temperatureAt(geo, cx, cy) < 0.3;
    const riverAcc: Accum = buildRiverMesh(geo, cx, cy, span, seed);
    let waterMat: THREE.ShaderMaterial | undefined, riverMat: THREE.ShaderMaterial | undefined; // animated only when unfrozen
    if (frozen) {
      const iceTex = tex('/textures/ice_albedo.png', true); iceTex.repeat.set(span * 0.5, span * 0.5);
      const iceNrm = tex('/textures/ice_normal.png', false); iceNrm.repeat.set(span * 0.5, span * 0.5);
      const iceMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.82, 0.88, 0.94), roughness: 0.45, metalness: 0.0, map: iceTex, normalMap: iceNrm, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide });
      const ice = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.7, span * 1.7), iceMat);
      ice.rotation.x = -Math.PI / 2; ice.position.y = 0.0; ice.receiveShadow = true;
      scene.add(ice);
      // the river freezes over too — a plain pale sheet up the channel (its mesh carries no UVs)
      if (riverAcc.n > 0) {
        const riverIce = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86, 0.91, 0.96), roughness: 0.4, metalness: 0.0, side: THREE.DoubleSide });
        scene.add(new THREE.Mesh(toGeometry({ pos: riverAcc.pos, nrm: riverAcc.nrm, col: riverAcc.col, idx: riverAcc.idx }), riverIce));
      }
    } else {
      waterMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEye: { value: new THREE.Vector3() }, uSun: { value: sunDir.clone() } }]),
        vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.7, span * 1.7), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.0;
      scene.add(water);

      // RIVERS — a continuous water ribbon laid up the carved channel, in a BRIGHTER freshwater
      // shader (shares the sea's ripple/fresnel so it grades into it, but plainly reads as water).
      riverMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uEye: { value: new THREE.Vector3() }, uSun: { value: sunDir.clone() } }]),
        vertexShader: WATER_VERT, fragmentShader: RIVER_FRAG, transparent: true, fog: false, depthWrite: false, side: THREE.DoubleSide,
      });
      if (riverAcc.n > 0) {
        scene.add(new THREE.Mesh(toGeometry({ pos: riverAcc.pos, nrm: riverAcc.nrm, col: riverAcc.col, idx: riverAcc.idx }), riverMat));
      }
    }

    // camera + orbit controls
    const camera = new THREE.PerspectiveCamera(52, wrap.clientWidth / wrap.clientHeight, 0.1, span * 12);
    const d0 = span * 1.15;
    camera.position.set(Math.cos(0.6) * Math.cos(0.7) * d0, Math.sin(0.6) * d0, Math.cos(0.6) * Math.sin(0.7) * d0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = span * 0.35; controls.maxDistance = span * 4;
    controls.maxPolarAngle = Math.PI * 0.49;

    // post: SSAO + SMAA + tone-mapped output
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ssao = new SSAOPass(scene, camera, wrap.clientWidth, wrap.clientHeight);
    ssao.kernelRadius = span * 0.05; ssao.minDistance = 0.001; ssao.maxDistance = span * 0.4;
    composer.addPass(ssao);
    composer.addPass(new SMAAPass(wrap.clientWidth, wrap.clientHeight));
    composer.addPass(new OutputPass());

    // Fixed render resolution — we deliberately do NOT resize render targets on orbit/zoom.
    // Changing the pixel ratio mid-gesture reallocates every post target (SSAO keeps several
    // float buffers), and on a high-DPI display that texture churn stalls the pipeline at each
    // gesture boundary — the "occasional orbit lockup". The scene is light (≈82k tris, few
    // draw calls), so full res every frame is smooth on a capable GPU; a ONE-TIME probe below
    // (never per-gesture) steps a struggling device down instead.
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      renderer.setSize(w, h); composer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      needsRender = Math.max(needsRender, 1);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
    ro?.observe(wrap);

    renderer.shadowMap.needsUpdate = true; // render the (static) shadow map once, on the first frame
    // RENDER ON DEMAND. Only the water ever changes without input, so a frozen scene is
    // rendered exactly when something happened (orbit, damping, resize) — near-zero GPU at
    // rest — and a liquid scene drops its ambient ripple to ~30fps once the hand has been
    // off the controls a few seconds, snapping back to full rate on the next gesture.
    // `controls`' change event also fires throughout damping, so the glide stays smooth.
    let raf = 0, running = true, frame = 0;
    let lastInteract = performance.now();
    let needsRender = 24; // first frames: shadow map, SSAO warm-up — and the probe's samples
    controls.addEventListener('change', () => { lastInteract = performance.now(); needsRender = Math.max(needsRender, 1); });
    // ADAPTIVE QUALITY, measured once: average the first rendered frames' cost and, if the
    // device clearly can't afford the full pipeline, drop to pixelRatio 1 and disable SSAO
    // (the priciest pass for a scene this small). A single adaptation — the render targets
    // reallocate once, at startup, never at a gesture boundary.
    let probeN = 0, probeMs = 0, probed = false;
    const renderOnce = () => {
      const t0 = performance.now();
      composer.render();
      if (!probed) {
        probeN++; probeMs += performance.now() - t0;
        if (probeN >= 20) {
          probed = true;
          if (probeMs / probeN > 24) {
            renderer.setPixelRatio(1);
            ssao.enabled = false;
            const w = wrap.clientWidth, h = wrap.clientHeight;
            renderer.setSize(w, h); composer.setSize(w, h);
          }
        }
      }
    };
    const loop = () => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      frame++;
      controls.update(); // damping — emits 'change' while the glide settles
      const idle = performance.now() - lastInteract > 3000;
      if (waterMat) { // liquid water animates; halve the ambient rate once idle
        if (idle && probed && frame % 2 === 1) return;
        waterMat.uniforms.uTime.value += idle && probed ? 1 / 30 : 1 / 60;
        waterMat.uniforms.uEye.value.copy(camera.position);
        if (riverMat) { riverMat.uniforms.uTime.value = waterMat.uniforms.uTime.value; riverMat.uniforms.uEye.value.copy(camera.position); }
        renderOnce();
        return;
      }
      // frozen: a static surface — render only when something changed
      if (needsRender <= 0) return;
      needsRender--;
      renderOnce();
    };
    raf = requestAnimationFrame(loop);

    // Don't burn GPU/battery animating water while the tab is hidden.
    const onVis = () => {
      if (document.hidden) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
      else if (!running) { running = true; raf = requestAnimationFrame(loop); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false; if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro?.disconnect(); controls.dispose(); composer.dispose(); riverMat?.dispose(); renderer.dispose();
      if (renderer.domElement.parentElement === wrap) wrap.removeChild(renderer.domElement);
    };
  }, [geo, plan, cx, cy, span, seed]);

  return (
    <div ref={wrapRef} className="local-3d">
      {err && <p className="local-none muted">{err}</p>}
      <div className="local-3d-hint muted">drag to orbit · scroll to zoom</div>
      <button className="local-back local-3d-back" onClick={onExit} title="back to the map"><Icon name="back" /> the map</button>
    </div>
  );
}
