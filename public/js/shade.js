// Infinity Castle — surfaces. One MeshStandardMaterial for the whole castle: the kit's material ids pick a
// procedural surface (timber, boards, lacquer, shoji, tatami, tiles, plaster, gold fusuma, lanterns), the
// baked lamp light and occlusion come in per vertex, and the fog is the colour of the void itself.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uGlow: { value: 1 },        // every lamp in the castle; the biwa makes it gutter
  uFog: { value: 0.0085 },    // extinction per metre
  uDyn: { value: 0.3 },       // diffuse share of the moving lights (the baked light already has most of it)
  uAmbient: { value: new THREE.Color(0.013, 0.012, 0.016) },
};

// ---------------------------------------------------------------- shared GLSL
export const GLSL_VOID = /* glsl */`
vec3 voidColor(vec3 d) {
  vec3 below = vec3(0.026, 0.0115, 0.0055);  // the haze of a thousand lamps further down
  vec3 level = vec3(0.0082, 0.0062, 0.0068);  // cold dark across the shaft, warm only where the lamps are
  vec3 above = vec3(0.0032, 0.0040, 0.0080);
  vec3 c = mix(level, below, smoothstep(0.05, -0.85, d.y));
  return mix(c, above, smoothstep(0.1, 0.95, d.y));
}
float fogT(float dist) { return exp(-pow(dist * uFog, 1.25)); }
`;

const GLSL_NOISE = /* glsl */`
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.13; a *= 0.5; }
  return s;
}
// a line of half-width hw (in units of x) at every integer x, filtered over a pixel footprint w
float lineAA(float x, float hw, float w) {
  w = max(w, 1e-4);
  float d = abs(fract(x + 0.5) - 0.5);
  float l = 1.0 - smoothstep(hw - w, hw + w, d);
  return mix(l, min(1.0, 2.0 * hw), smoothstep(0.25, 0.6, w));
}
float edgeAA(float d, float wd, float w) { w = max(w, 1e-4); return 1.0 - smoothstep(wd - w, wd + w, d); }
`;

// ---------------------------------------------------------------- the castle material
const VERT_PARS = /* glsl */`
attribute vec4 aUv;     // xy: metres across the face, zw: the size of the face
attribute vec4 aMat;    // x: material, y: piece seed, z: material parameter, w: baked occlusion
attribute vec3 aLight;  // baked light of the piece's own lamps
attribute vec4 aDoor;   // xyz: how far this vertex slides when its doors are open, w: which doors
#ifdef USE_INSTANCING
attribute vec4 iData;   // x: seed, y: lamp level, z / w: doors open
#endif
varying vec4 vUv4;
varying vec4 vMat;
varying vec3 vLight;
varying vec3 vWPos;
varying float vGlow;
varying float vSeed;
`;
const VERT_BEGIN = /* glsl */`
vec4 inst = vec4(0.0, 1.0, 0.0, 0.0);
#ifdef USE_INSTANCING
inst = iData;
#endif
transformed += aDoor.xyz * mix(inst.z, inst.w, aDoor.w);
vUv4 = aUv; vMat = aMat; vLight = aLight; vGlow = inst.y; vSeed = inst.x;
`;
const VERT_END = /* glsl */`
vec4 wp4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wp4 = instanceMatrix * wp4;
#endif
vWPos = (modelMatrix * wp4).xyz;
`;

const FRAG_PARS = /* glsl */`
uniform float uTime, uGlow, uFog, uDyn;
uniform vec3 uAmbient;
varying vec4 vUv4;
varying vec4 vMat;
varying vec3 vLight;
varying vec3 vWPos;
varying float vGlow;
varying float vSeed;
float sRough = 0.6, sMetal = 0.0, sH = 0.0;
vec3 sEmit = vec3(0.0);
${GLSL_NOISE}
${GLSL_VOID}
vec3 bumpNormal(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

const FRAG_SURFACE = /* glsl */`
{
  float id = floor(vMat.x + 0.5);
  float seed = fract(vMat.y + vSeed * 0.618);
  float prm = vMat.z;
  vec2 uv = vUv4.xy;
  vec2 fs = max(vUv4.zw, vec2(1e-3));
  vec2 fw = fwidth(uv);
  float px = max(fw.x, fw.y);
  float glow = vGlow * uGlow;
  float flick = 0.9 + 0.1 * sin(uTime * (5.0 + 3.0 * seed) + seed * 40.0) * sin(uTime * 2.3 + seed * 17.0);
  vec3 woodDark = vec3(0.10, 0.055, 0.032);
  vec3 alb = vec3(0.5);
  // two noise fields shared by every surface: streaky along u, and even
  float nA = fbm(vec2(uv.x * 0.55, uv.y * 6.0) + seed * 41.0);
  float nB = fbm(uv * 2.2 + seed * 9.0);

  if (id == 0.0) {                         // timber: dark, oiled, the grain along u
    float n = nA;
    float st = vn(vec2(uv.x * 0.2 + seed * 3.0, uv.y * 30.0));
    alb = vec3(0.13, 0.07, 0.038) * (0.7 + 0.55 * n) * (0.85 + 0.3 * h11(seed * 13.1));
    alb *= 1.0 - 0.3 * smoothstep(0.5, 0.85, st) * (1.0 - smoothstep(0.02, 0.06, fw.y * 30.0));
    // growth rings, wavering along the grain
    float rings = 0.5 + 0.5 * sin(uv.y * 48.0 + fbm(vec2(uv.x * 0.7, uv.y * 2.5) + seed * 5.0) * 10.0);
    alb *= 0.8 + 0.34 * mix(rings, 0.5, smoothstep(0.004, 0.02, fw.y));
    sRough = 0.5 + 0.25 * n;
    sH = st * 0.0025;
  } else if (id == 1.0) {                  // boards: polished, along u, staggered butt joints
    float w = 0.24;
    float row = floor(uv.y / w);
    float off = h11(row * 3.7 + seed * 17.0) * 3.0;
    float sg = floor((uv.x + off) / 2.7);
    float hh = h12(vec2(row, sg) + seed * 5.0);
    float n = nA;
    alb = vec3(0.30, 0.16, 0.08) * (0.6 + 0.5 * hh) * (0.78 + 0.38 * n);
    float gap = max(lineAA(uv.y / w, 0.025, fw.y / w), lineAA((uv.x + off) / 2.7, 0.003, fw.x / 2.7));
    float fig = 0.5 + 0.5 * sin(fract(uv.y / w) * 30.0 + vn(vec2(uv.x * 0.9, row * 7.0)) * 8.0);
    alb *= 0.82 + 0.3 * mix(fig, 0.5, smoothstep(0.003, 0.015, fw.y));
    alb *= 1.0 - 0.7 * gap;
    sRough = 0.2 + 0.18 * n + 0.35 * gap;
    sH = -gap * 0.003 + n * 0.0012;
  } else if (id == 2.0) {                  // vermilion lacquer, rubbed through to black at the edges
    float n = nB;
    float e = min(min(uv.x, fs.x - uv.x), min(uv.y, fs.y - uv.y));
    float wear = smoothstep(0.62, 0.82, n) * 0.55 + (1.0 - smoothstep(0.0, 0.04, e)) * 0.35;
    alb = mix(vec3(0.46, 0.068, 0.03) * (0.85 + 0.25 * n), vec3(0.035, 0.018, 0.012), wear);
    sRough = 0.26 + 0.18 * n;
  } else if (id == 3.0 || id == 12.0) {    // shoji, and the ranma over it: paper lit from the room behind
    float e = min(min(uv.x, fs.x - uv.x), min(uv.y, fs.y - uv.y));
    float wood;
    if (id == 3.0) {
      float frame = edgeAA(e, 0.045, px);
      float koshi = edgeAA(uv.y, 0.26, fw.y);
      float iw = fs.x - 0.09, ih = fs.y - 0.3;
      float nc = max(2.0, floor(iw / 0.27 + 0.5)), nr = max(3.0, floor(ih / 0.31 + 0.5));
      float cw = iw / nc, ch = ih / nr;
      float lat = max(lineAA((uv.x - 0.045) / cw, 0.008 / cw, fw.x / cw), lineAA((uv.y - 0.26) / ch, 0.008 / ch, fw.y / ch));
      wood = max(frame, max(koshi, lat));
    } else {
      float frame = edgeAA(e, 0.035, px);
      vec2 r = uv / 0.14;
      float lw = (fw.x + fw.y) / 0.14;
      wood = max(frame, max(lineAA(r.x + r.y, 0.07, lw), lineAA(r.x - r.y, 0.07, lw)));
    }
    float g = abs(prm) * glow;
    vec3 gc = prm < 0.0 ? vec3(0.26, 0.38, 0.85) : vec3(1.0, 0.46, 0.15);
    float hot = 0.45 + 0.65 * exp(-pow((uv.y - 0.95) / 1.2, 2.0));
    float paper = 0.88 + 0.24 * nB;
    sEmit = gc * g * 1.05 * hot * flick * paper * (1.0 - wood);
    alb = mix(vec3(0.84, 0.78, 0.64), woodDark, wood);
    sRough = mix(0.9, 0.5, wood);
    sH = wood * 0.003;
  } else if (id == 4.0) {                  // tatami: rush along the mat, a cloth border on the long sides
    bool longU = fs.x > fs.y;
    float across = longU ? uv.y : uv.x, acrossL = longU ? fs.y : fs.x, along = longU ? uv.x : uv.y;
    float fa = longU ? fw.x : fw.y, fc = longU ? fw.y : fw.x;
    float heri = edgeAA(min(across, acrossL - across), 0.04, fc);
    float amp = 1.0 - smoothstep(0.004, 0.012, fa);
    float rush = 0.5 + 0.5 * sin(along * 6.2832 / 0.016);
    float n = nB;
    vec3 straw = vec3(0.42, 0.38, 0.19) * (0.82 + 0.25 * n) * (0.9 + 0.16 * h11(seed * 7.0));
    straw *= 1.0 - 0.12 * rush * amp;
    float brocade = step(0.5, fract(along * 9.0)) * (1.0 - smoothstep(0.02, 0.06, fa * 9.0));
    vec3 cloth = mix(vec3(0.035, 0.04, 0.03), vec3(0.09, 0.075, 0.04), brocade * 0.6);
    alb = mix(straw, cloth, heri);
    sRough = mix(0.72, 0.85, heri);
    sH = rush * amp * 0.0008 * (1.0 - heri);
  } else if (id == 5.0) {                  // roof tiles: round tiles in columns down the slope, a course every 30 cm
    float cu = uv.x / 0.32;
    float fade = 1.0 - smoothstep(0.12, 0.45, fw.x / 0.32);
    float ridge = pow(abs(sin(3.14159 * cu)), 0.7);
    float course = fract(uv.y / 0.3);
    float n = nB;
    alb = vec3(0.05, 0.055, 0.064) * (0.75 + 0.45 * n) * mix(1.0, 0.45 + 0.55 * ridge, fade) * mix(1.0, 0.8 + 0.2 * course, fade);
    sRough = 0.38 + 0.25 * n + 0.2 * (1.0 - ridge) * fade;
    sH = (ridge * 0.035 + course * 0.012) * fade;
  } else if (id == 13.0) {                 // eave: gilded round tile ends over a black fascia
    float cu = fract(uv.x / 0.32) - 0.5;
    float r = length(vec2(cu * 0.32, uv.y - fs.y * 0.6));
    float disc = edgeAA(r, 0.11, px);
    float rim = disc * (1.0 - edgeAA(r, 0.085, px));
    alb = mix(vec3(0.02, 0.018, 0.017), vec3(0.8, 0.58, 0.26), disc * (0.6 + 0.4 * rim));
    sMetal = disc; sRough = mix(0.3, 0.35, disc);
    sH = disc * 0.01 + rim * 0.006;
  } else if (id == 6.0) {                  // plaster, sooty by the beams
    float n = nB, m = vn(uv * 9.0);
    float e = min(uv.y, fs.y - uv.y);
    alb = vec3(0.68, 0.62, 0.5) * (0.84 + 0.18 * n) * (0.95 + 0.08 * m);
    alb *= 0.75 + 0.25 * smoothstep(0.0, 0.25, e);
    sRough = 0.92; sH = m * 0.0015;
  } else if (id == 7.0) {                  // fusuma: gold leaf, a painting, a black frame and a round pull
    float e = min(min(uv.x, fs.x - uv.x), min(uv.y, fs.y - uv.y));
    float frame = edgeAA(e, 0.035, px);
    float lh = h12(floor(uv / 0.105) + seed * 3.0);
    float seam = max(lineAA(uv.x / 0.105, 0.02, fw.x / 0.105), lineAA(uv.y / 0.105, 0.02, fw.y / 0.105));
    vec3 gold = vec3(0.76, 0.54, 0.21) * (0.93 + 0.1 * lh) * (1.0 - 0.1 * seam);
    float ny = uv.y / fs.y;
    float pn = fbm(uv * vec2(0.9, 1.6) + seed * 4.0);
    float paint = 0.0;
    vec3 pc = vec3(0.0);
    if (prm < 0.5) {                       // gold clouds drifting over a dark ground
      float band = sin(uv.y * 2.4 + pn * 3.5);
      paint = 1.0 - smoothstep(0.25, 0.35, band);
      pc = vec3(0.06, 0.05, 0.035);
    } else if (prm < 1.5) {                // seigaiha: indigo waves along the foot
      vec2 w = uv / 0.11;
      float kmin = ceil(2.0 * (w.y - 1.0));
      float ring = 0.0, found = 0.0;
      for (int j = 0; j < 5; j++) {
        float k = kmin + float(j);
        float ox = mod(k, 2.0);
        float cx = 2.0 * floor((w.x - ox) / 2.0 + 0.5) + ox;
        float r = length(w - vec2(cx, 0.5 * k));
        if (found < 0.5 && r < 1.0) { found = 1.0; ring = lineAA(r * 4.0, 0.14, 4.0 * px / 0.11); }
      }
      paint = found * (1.0 - smoothstep(0.4, 0.46, ny + 0.03 * sin(uv.x * 8.0)));
      pc = mix(vec3(0.03, 0.06, 0.16), vec3(0.62, 0.64, 0.66), ring);
    } else if (prm < 2.5) {                // ink pines
      paint = smoothstep(0.58, 0.62, pn) * smoothstep(0.15, 0.55, ny);
      pc = vec3(0.03, 0.055, 0.035);
    } else {                               // wisteria: racemes hanging from leaves along the top
      float col = floor(uv.x / 0.15);
      float hx = h11(col * 7.3 + seed * 13.0);
      float cx = (col + 0.5 + (hx - 0.5) * 0.5) * 0.15;
      float len = 0.3 + 0.6 * h11(col * 3.1 + seed * 5.0);
      float top = fs.y - 0.12 - 0.15 * h11(col * 1.7 + seed);
      float t = clamp((top - uv.y) / len, 0.0, 1.0);
      float inside = step(uv.y, top) * step(top - len, uv.y);
      float w = 0.05 * (1.0 - t * 0.85) + 0.006;
      float dx = abs(uv.x - cx - 0.012 * sin(uv.y * 9.0 + hx * 6.0));
      float body = (1.0 - smoothstep(w - px, w + px, dx)) * inside;
      float fl = vn(uv * vec2(80.0, 60.0));
      paint = body * smoothstep(0.25, 0.5, fl);
      pc = mix(vec3(0.36, 0.24, 0.6), vec3(0.78, 0.66, 0.9), t * 0.75) * (0.75 + 0.4 * fl);
      float leaf = smoothstep(0.56, 0.6, pn) * smoothstep(fs.y - 0.55, fs.y - 0.12, uv.y);
      paint = max(paint, leaf);
      pc = mix(pc, vec3(0.07, 0.14, 0.05), leaf);
    }
    alb = mix(gold, pc, paint);
    sMetal = 0.9 * (1.0 - paint);
    sRough = mix(0.36, 0.7, paint);
    float hk = edgeAA(length(vec2(uv.x - min(0.16, fs.x * 0.2), uv.y - fs.y * 0.43)), 0.04, px);
    alb = mix(alb, vec3(0.02), frame);
    alb = mix(alb, vec3(0.05, 0.035, 0.02), hk);
    sMetal *= (1.0 - frame) * (1.0 - 0.5 * hk);
    sRough = mix(sRough, 0.25, frame);
    sH = frame * 0.004 - hk * 0.003 + lh * 0.0005;
  } else if (id == 8.0) {                  // lanterns
    if (prm < 1.99) {                      // chochin: ribbed paper, brightest at the belly
      float t = uv.y / fs.y;
      float rib = lineAA(uv.y / 0.042, 0.17, fw.y / 0.042);
      float belly = sin(3.14159 * clamp(t, 0.0, 1.0));
      vec3 paper = mix(vec3(0.95, 0.84, 0.6), vec3(0.8, 0.12, 0.05), prm);
      vec3 lc = mix(vec3(1.0, 0.42, 0.13), vec3(1.0, 0.13, 0.04), prm);
      sEmit = lc * glow * (0.25 + 1.3 * belly * belly) * (1.0 - 0.8 * rib) * flick;
      alb = paper * (1.0 - 0.7 * rib);
    } else {                               // andon: paper in a square frame
      float e = min(min(uv.x, fs.x - uv.x), min(uv.y, fs.y - uv.y));
      float wood = max(edgeAA(e, 0.025, px), lineAA(uv.y / fs.y * 2.0, 0.02, fw.y / fs.y * 2.0));
      sEmit = vec3(1.0, 0.5, 0.2) * glow * 1.5 * flick * (1.0 - wood);
      alb = mix(vec3(0.9, 0.82, 0.66), vec3(0.03, 0.02, 0.015), wood);
    }
    sRough = 0.8;
  } else if (id == 9.0) {                  // brass
    float n = nB;
    alb = vec3(0.86, 0.6, 0.28) * (0.8 + 0.3 * n);
    sMetal = 1.0; sRough = 0.28 + 0.2 * n;
  } else if (id == 10.0) {                 // black lacquer
    float n = nA;
    alb = vec3(0.022, 0.018, 0.016) * (0.8 + 0.5 * n);
    sRough = 0.18 + 0.15 * n;
  } else {                                 // rope
    alb = vec3(0.2, 0.15, 0.1);
    sRough = 0.95;
  }
  // age over everything solid: broad stains, soot running down, a fine grain; lit paper and lamps stay clean
  if (id != 3.0 && id != 12.0 && id != 8.0) {
    vec3 wp = vWPos;
    float big = fbm(vec2(wp.x + wp.z, wp.y * 0.6) * 0.09 + seed * 3.0);
    float run = vn(vec2((wp.x + wp.z * 0.7) * 1.6, wp.y * 0.1 + seed));
    float fine = mix(vn(uv * vec2(16.0, 3.5) + seed * 11.0), 0.5, smoothstep(0.01, 0.05, px));
    float age = (0.7 + 0.45 * big) * (1.0 - 0.3 * smoothstep(0.55, 0.9, run)) * (0.88 + 0.22 * fine);
    alb *= age;
    sRough = clamp(sRough + 0.18 * (1.0 - age), 0.0, 1.0);
    sH += (fine - 0.5) * 0.0015;
  }
  diffuseColor.rgb = alb;
  sEmit += alb * vLight * glow * mix(0.5, 1.0, vMat.w);
}
`;

const FRAG_AO = /* glsl */`
float ambientOcclusion = vMat.w;
reflectedLight.indirectDiffuse *= ambientOcclusion;
reflectedLight.indirectSpecular *= mix(1.0, ambientOcclusion, 0.8);
reflectedLight.indirectDiffuse += material.diffuseColor * uAmbient * ambientOcclusion;
`;

const FRAG_FOG = /* glsl */`
{
  vec3 dv = vWPos - cameraPosition;
  float dist = length(dv);
  gl_FragColor.rgb = mix(voidColor(dv / max(dist, 1e-3)), gl_FragColor.rgb, fogT(dist));
}
`;

export function castleMaterial(envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, envMap, envMapIntensity: 1.0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BEGIN}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERT_END}`);
    const lights = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
      'reflectedLight.directDiffuse += uDyn * irradiance * BRDF_Lambert( material.diffuseColor );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, vec2(dFdx(sH), dFdy(sH)), faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = sEmit;')
      .replace('#include <lights_physical_pars_fragment>', lights)
      .replace('#include <aomap_fragment>', FRAG_AO)
      .replace('#include <fog_fragment>', FRAG_FOG);
  };
  mat.customProgramCacheKey = () => 'mugen-castle-1';
  return mat;
}

// the castle's fog, for any other MeshStandardMaterial (call from onBeforeCompile)
export function fogPatch(sh) {
  sh.uniforms.uFog = U.uFog;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFogPos;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFogPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uFog;
varying vec3 vFogPos;
${GLSL_VOID}`)
    .replace('#include <fog_fragment>', `{
      vec3 dv = vFogPos - cameraPosition;
      float dist = length(dv);
      gl_FragColor.rgb = mix(voidColor(dv / max(dist, 1e-3)), gl_FragColor.rgb, fogT(dist));
    }`);
}

// ---------------------------------------------------------------- the void, and the warm room it reflects
export function voidSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: U.uFog },
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uFog;
      varying vec3 vDir;
      ${GLSL_VOID}
      void main() { gl_FragColor = vec4(voidColor(normalize(vDir)), 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

export function makeEnv(renderer) {
  // what the gold and the lacquer reflect: the warm dark of the castle, freckled with distant lamps
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: U.uFog },
    side: THREE.BackSide,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uFog;
      varying vec3 vDir;
      ${GLSL_VOID}
      float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = voidColor(d) * 3.0;
        vec3 g = d * 26.0;
        vec3 f = fract(g) - 0.5;
        float h = h13(floor(g));
        float spot = smoothstep(0.42, 0.0, length(f)) * step(0.78, h) * (1.0 - smoothstep(-0.1, 0.6, d.y));
        c += vec3(1.0, 0.52, 0.22) * spot * 7.0 * h;
        c += vec3(1.0, 0.5, 0.2) * 0.12 * exp(-pow((d.y + 0.15) * 3.0, 2.0));
        c += vec3(1.0, 0.42, 0.16) * 0.06 * smoothstep(0.0, -0.8, d.y);   // the warm glow of the depths
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 96, 48), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.015);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- lamps on buildings too far to draw
export function farLamps(count, period) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
  let i = 0;
  const rnd = Math.random;
  while (i < count) {
    // a row of lamps along an eave, sometimes two storeys of them
    const ang = rnd() * Math.PI * 2, rad = 90 + Math.pow(rnd(), 0.7) * 430, y = rnd() * period;
    const n = 3 + Math.floor(rnd() * 12), rows = rnd() < 0.35 ? 2 : 1, red = rnd() < 0.25;
    const tx = -Math.sin(ang), tz = Math.cos(ang);
    for (let rr = 0; rr < rows; rr++) for (let k = 0; k < n && i < count; k++, i++) {
      const s = (k - n / 2) * 2.1;
      pos[i * 3] = Math.cos(ang) * rad + tx * s;
      pos[i * 3 + 1] = y - rr * 4.2;
      pos[i * 3 + 2] = Math.sin(ang) * rad + tz * s;
      const w = 0.7 + 0.6 * rnd();
      col[i * 3] = w; col[i * 3 + 1] = w * (red ? 0.3 : 0.55); col[i * 3 + 2] = w * (red ? 0.12 : 0.24);
      size[i] = 0.6 + rnd() * 0.6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCamY: { value: 0 }, uPeriod: { value: period }, uPR: { value: 1 }, uTime: U.uTime, uFog: U.uFog, uGlow: U.uGlow },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uCamY, uPeriod, uPR, uTime, uFog, uGlow;
      attribute vec3 aCol;
      attribute float aSize;
      varying vec3 vCol;
      float fogT(float dist) { return exp(-pow(dist * uFog, 1.25)); }
      void main() {
        vec3 p = position;
        float lo = uCamY - uPeriod * 0.7;
        p.y = lo + mod(p.y - lo, uPeriod);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = length(mv.xyz);
        float px = aSize * uPR * 700.0 / dist;
        gl_PointSize = max(px, 1.5);
        float energy = min(1.0, px * px / 2.25);
        float tw = 0.85 + 0.15 * sin(uTime * (2.0 + aSize * 3.0) + p.x);
        vCol = aCol * energy * tw * uGlow * (0.15 + 0.85 * fogT(dist * 0.45)) * 1.6;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.8, 1.0, r));
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -5;
  return pts;
}

// ---------------------------------------------------------------- dust and embers streaking past
export function dust(count) {
  const BOX = new THREE.Vector3(36, 60, 36);
  const pos = new Float32Array(count * 6), end = new Float32Array(count * 2), seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * BOX.x, y = (Math.random() - 0.5) * BOX.y, z = (Math.random() - 0.5) * BOX.z, s = Math.random();
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0; end[i * 2 + 1] = 1;
    seed[i * 2] = s; seed[i * 2 + 1] = s;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uStreak: { value: 0.5 }, uTime: U.uTime },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform vec3 uCam, uBox;
      uniform float uStreak, uTime;
      attribute float aEnd, aSeed;
      varying float vA;
      varying float vEmber;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.6;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 edge = abs(p) / (uBox * 0.5);
        float fade = 1.0 - smoothstep(0.7, 1.0, max(edge.x, max(edge.y, edge.z)));
        p += uCam;
        p.y += aEnd * uStreak * (0.6 + 0.8 * aSeed);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = length(mv.xyz);
        vEmber = step(0.93, aSeed);
        vA = fade * smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(14.0, 26.0, d)) * mix(1.0, 0.35, aEnd);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      varying float vEmber;
      void main() {
        vec3 c = mix(vec3(0.5, 0.36, 0.24) * 0.22, vec3(1.0, 0.42, 0.12) * 1.6, vEmber);
        gl_FragColor = vec4(c * vA, 1.0);
      }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  return lines;
}
