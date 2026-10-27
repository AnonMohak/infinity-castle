// Infinity Castle — the Corps, falling with you: Tanjiro, Giyu, Shinobu and Zenitsu. Jointed figures in the
// black uniform; each haori carries its owner's pattern and streams up in the wind of the fall.
import * as THREE from 'three';
import { U, fogPatch } from './shade.js';

const TAU = Math.PI * 2;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
let ENV = null;              // the castle's reflection map, set by Corps

// ---------------------------------------------------------------- materials
// how a character is lit, whatever the castle does: warm light from the lamps far below, and a rim
const LIT = /* glsl */`
{
  vec3 kd = normalize((viewMatrix * vec4(0.25, -1.0, 0.3, 0.0)).xyz);
  float key = max(dot(normal, kd) * 0.6 + 0.4, 0.0);
  float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.56, 0.26) * key * 0.75 + vec3(1.0, 0.68, 0.42) * rim * 0.22;
}`;
function lit(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + LIT);
}

function plain(color, rough = 0.6, metal = 0, env = 1.4) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMap: ENV, envMapIntensity: env });
  m.onBeforeCompile = (sh) => { fogPatch(sh); lit(sh); };
  m.customProgramCacheKey = () => 'mugen-corps-plain';
  return m;
}

// the haori: kind picks the pattern; the cloth is blown along uWind (the wind in the cloth's own frame)
function haoriMaterial(kind, env) {
  const uni = { uWind: { value: new THREE.Vector3(0, 1, 0) }, uKind: { value: kind }, uSeed: { value: Math.random() * 10 } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.4 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni, { uTime: U.uTime });
    fogPatch(sh);
    lit(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aPat;
        uniform vec3 uWind;
        uniform float uTime, uSeed;
        varying vec2 vPat;
        varying float vFree;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // 0 where the cloth hangs from the body, 1 at the free hem
        float free = 1.0 - uv.y;
        float f = free * free;
        float ph = uTime * 10.0 + uSeed;
        transformed += uWind * f * 0.42;
        transformed += normal * f * (sin(ph + free * 7.0 + uv.x * 19.0) * 0.06 + sin(ph * 1.7 + uv.x * 37.0) * 0.025);
        transformed += cross(normal, uWind) * f * sin(ph * 0.7 + uv.x * 9.0) * 0.05;
        vPat = aPat;
        vFree = free;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uKind;
        varying vec2 vPat;
        varying float vFree;
        float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vPat;
          vec3 c;
          if (uKind < 0.5) {
            // Tanjiro: ichimatsu, green and black checks
            vec2 g = floor(p / 0.085);
            c = mod(g.x + g.y, 2.0) < 0.5 ? vec3(0.025, 0.2, 0.13) : vec3(0.012, 0.012, 0.014);
          } else if (uKind < 1.5) {
            // Giyu: half plain maroon, half kikkō in mustard, green and rust
            if (p.x < 0.0) c = vec3(0.24, 0.035, 0.04);
            else {
              vec2 q = p / 0.07;
              q.x += 0.5 * mod(floor(q.y), 2.0);
              vec2 cell = floor(q);
              float k = hh(cell);
              c = k < 0.33 ? vec3(0.55, 0.42, 0.08) : k < 0.66 ? vec3(0.12, 0.25, 0.1) : vec3(0.45, 0.16, 0.06);
              vec2 fq = fract(q) - 0.5;
              c *= 1.0 - 0.75 * smoothstep(0.4, 0.47, max(abs(fq.x), abs(fq.y)));
            }
          } else if (uKind < 2.5) {
            // Shinobu: a butterfly's wing, white into teal into violet, dark veins and a spotted border
            float t = clamp(vFree, 0.0, 1.0);
            c = mix(vec3(0.85, 0.86, 0.9), vec3(0.08, 0.5, 0.48), smoothstep(0.15, 0.6, t));
            c = mix(c, vec3(0.32, 0.12, 0.5), smoothstep(0.6, 0.95, t));
            float vein = 1.0 - smoothstep(0.0, 0.012, abs(fract((p.x + 0.4 * t * t) / 0.11) - 0.5) - 0.48);
            c *= 1.0 - 0.6 * vein * smoothstep(0.2, 0.5, t);
            if (t > 0.9) { c = vec3(0.04, 0.03, 0.06); if (length(fract(p / 0.06) - 0.5) < 0.22) c = vec3(0.85); }
          } else {
            // Zenitsu: orange-yellow with white scales (uroko)
            vec2 q = p / vec2(0.1, 0.09);
            vec2 f = fract(q);
            float tri = step(f.y, 1.0 - abs(f.x * 2.0 - 1.0));
            c = mix(vec3(0.95, 0.55, 0.06), vec3(0.95, 0.92, 0.85), tri);
            c = mix(c, c * vec3(1.0, 0.7, 0.4), smoothstep(0.5, 1.0, vFree));
          }
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'mugen-corps-haori';
  return { m, uni };
}

// ---------------------------------------------------------------- geometry
function capsule(r, len) { return new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, -len / 2, 0); }

function haoriGeo() {
  // an open coat hanging from the shoulders, wrapped round the back; uv.y = 1 at the shoulders
  const nu = 30, nv = 14, th0 = 0.45, th1 = TAU - 0.45;
  const pos = [], nrm = [], uv = [], pat = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const y = 0.5 - v * 0.9, r = 0.2 + 0.16 * Math.pow(v, 0.85);
    for (let i = 0; i <= nu; i++) {
      const th = th0 + (th1 - th0) * i / nu;
      pos.push(Math.sin(th) * r, y, Math.cos(th) * r * 0.78);
      const n = new THREE.Vector3(Math.sin(th), 0.15, Math.cos(th) / 0.78).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push(i / nu, 1 - v);
      pat.push((th - Math.PI) * 0.27, -y);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPat', new THREE.Float32BufferAttribute(pat, 2));
  g.setIndex(idx);
  return g;
}

function sleeveGeo() {
  // a wide sleeve: an open, flattened tube down the arm (uv.y = 1 at the shoulder)
  const g = new THREE.CylinderGeometry(0.11, 0.13, 0.46, 12, 4, true);
  g.scale(1, 1, 0.62);
  g.translate(0, -0.25, -0.02);
  const uv = g.attributes.uv, pat = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { pat[i * 2] = uv.getX(i) * 0.75; pat[i * 2 + 1] = (1 - uv.getY(i)) * 0.46; }
  g.setAttribute('aPat', new THREE.BufferAttribute(pat, 2));
  return g;
}

function spikes(parent, mat, n, len, seed, spread = 1) {
  // hair: cones from the crown and the back of the head, pointing out and back
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, b = 0.15 + rnd() * 1.25 * spread;
    const dir = new THREE.Vector3(Math.sin(a) * Math.sin(b), Math.cos(b), -Math.abs(Math.cos(a)) * Math.sin(b) - 0.25).normalize();
    const h = len * (0.7 + rnd() * 0.6);
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.035 + rnd() * 0.02, h, 6).translate(0, h / 2, 0), mat);
    c.position.copy(dir).multiplyScalar(0.075);
    c.quaternion.setFromUnitVectors(UP, dir);
    parent.add(c);
  }
}

// ---------------------------------------------------------------- one member of the Corps
const POSES = {
  // root: body orientation; joints: [x, y, z] per joint
  arch: { root: [Math.PI / 2, 0, 0], spine: [-0.25, 0, 0], neck: [-0.55, 0, 0], shL: [-0.3, 0, -1.25], elL: [0, 0, -1.3], shR: [-0.3, 0, 1.25], elR: [0, 0, 1.3], hipL: [0.1, 0, -0.25], knL: [1.25, 0, 0], hipR: [0.1, 0, 0.25], knR: [1.1, 0, 0] },
  dive: { root: [Math.PI - 0.35, 0, 0], spine: [0.1, 0, 0], neck: [0.3, 0, 0], shL: [0.4, 0, -0.35], elL: [-0.2, 0, 0], shR: [0.4, 0, 0.35], elR: [-0.2, 0, 0], hipL: [-0.1, 0, -0.08], knL: [0.5, 0, 0], hipR: [0.15, 0, 0.08], knR: [0.3, 0, 0] },
  sword: { root: [0.95, 0, 0.1], spine: [0.35, 0, 0], neck: [0.35, 0, 0], shL: [-2.3, 0, 0.35], elL: [-0.5, 0, 0], shR: [-2.4, 0, -0.25], elR: [-0.35, 0, 0], hipL: [-0.9, 0, -0.15], knL: [1.5, 0, 0], hipR: [0.2, 0, 0.12], knR: [0.6, 0, 0] },
  tuck: { root: [-0.45, 0, 0], spine: [0.35, 0, 0], neck: [0.5, 0, 0], shL: [-0.9, 0, -0.9], elL: [-0.9, 0, 0], shR: [-0.9, 0, 0.9], elR: [-0.9, 0, 0], hipL: [-1.35, 0, -0.12], knL: [1.7, 0, 0], hipR: [-1.2, 0, 0.12], knR: [1.6, 0, 0] },
};

const MEMBERS = [
  { name: 'Tanjiro', kind: 0, hair: 0x2a0606, tips: null, blade: 0x0a0a0c, pose: 'sword', rel: [1.0, -6.5, 0.5], style: 'spiky' },
  { name: 'Giyu', kind: 1, hair: 0x050608, tips: null, blade: 0x1d3f8a, pose: 'arch', rel: [-1.1, -10.5, -0.4], style: 'tail' },
  { name: 'Shinobu', kind: 2, hair: 0x07060a, tips: 0x4a1f6e, blade: 0x5aa48c, pose: 'dive', rel: [0.4, -15, -1.2], style: 'bob' },
  { name: 'Zenitsu', kind: 3, hair: 0xd9a51a, tips: 0xc4581a, blade: 0xb08a2a, pose: 'tuck', rel: [-0.5, 6.5, 1.1], style: 'spiky' },
];

function member(spec, env) {
  const mat = {
    uniform: plain(0x0c0c10, 0.55, 0.0, 1.2),
    skin: plain(0xd9a68a, 0.6, 0, 1.5),
    white: plain(0xc8c6be, 0.7, 0, 1.3),
    hair: plain(spec.hair, 0.5, 0, 1.2),
    blade: plain(spec.blade, 0.22, 0.9, 1.6),
    dark: plain(0x111014, 0.5, 0, 1.2),
  };
  const ha = haoriMaterial(spec.kind, env);
  const root = new THREE.Group();
  const J = {};
  const add = (parent, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  const joint = (parent, name, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); J[name] = g; return g; };

  // torso, hips, belt
  joint(root, 'spine', 0, 0.05, 0);
  const torso = new THREE.LatheGeometry([[0.001, -0.02], [0.135, 0.0], [0.15, 0.12], [0.16, 0.28], [0.185, 0.42], [0.17, 0.5], [0.1, 0.56], [0.055, 0.6], [0.001, 0.61]].map((p) => new THREE.Vector2(p[0], p[1])), 16);
  torso.scale(1, 1, 0.72);
  add(J.spine, torso, mat.uniform);
  add(J.spine, new THREE.CylinderGeometry(0.143, 0.143, 0.055, 16).scale(1, 1, 0.74), mat.white, 0, 0.03, 0);
  add(root, new THREE.SphereGeometry(0.165, 16, 10).scale(1, 0.72, 0.75), mat.uniform, 0, -0.02, 0);
  // head
  joint(J.spine, 'neck', 0, 0.59, 0);
  add(J.neck, new THREE.CylinderGeometry(0.045, 0.05, 0.09, 10), mat.skin, 0, 0.03, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.15, 0.01);
  J.neck.add(head);
  add(head, new THREE.SphereGeometry(0.105, 18, 14).scale(0.92, 1.08, 1.0), mat.skin);
  // hair
  const cap = new THREE.SphereGeometry(0.116, 18, 12, 0, TAU, 0, 1.75).scale(0.96, 1.08, 1.05).rotateX(-0.35);
  add(head, cap, mat.hair, 0, 0.012, -0.01);
  if (spec.style === 'spiky') spikes(head, spec.tips ? plain(spec.tips, 0.5) : mat.hair, 16, 0.15, spec.kind * 97 + 13);
  if (spec.style === 'tail') {
    spikes(head, mat.hair, 10, 0.1, 71, 0.8);
    const tail = add(head, new THREE.ConeGeometry(0.05, 0.36, 7).translate(0, -0.18, 0), mat.hair, 0, -0.04, -0.1);
    tail.rotation.x = -0.5;
  }
  if (spec.style === 'bob') {
    add(head, new THREE.SphereGeometry(0.06, 10, 8), mat.hair, 0, 0.02, -0.12);
    // the butterfly ornament
    const wing = new THREE.CircleGeometry(0.05, 8).scale(1, 0.7, 1);
    const b1 = add(head, wing, plain(spec.tips, 0.5), 0.07, 0.07, -0.07); b1.rotation.set(0, 0.9, 0.5);
    const b2 = add(head, wing, plain(spec.tips, 0.5), 0.1, 0.03, -0.05); b2.rotation.set(0, 0.9, -0.4);
    b1.material.side = b2.material.side = THREE.DoubleSide;
  }
  // arms, with the haori's wide sleeves
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    const sh = joint(J.spine, 'sh' + L, s * 0.2, 0.47, 0);
    add(sh, capsule(0.052, 0.24), mat.uniform);
    add(sh, sleeveGeo(), ha.m);
    const el = joint(sh, 'el' + L, 0, -0.3, 0);
    add(el, capsule(0.046, 0.21), mat.uniform);
    const hand = new THREE.Group();
    hand.position.set(0, -0.29, 0);
    el.add(hand);
    J['hand' + L] = hand;
    add(hand, new THREE.SphereGeometry(0.048, 10, 8).scale(0.8, 1.15, 0.6), mat.skin);
  }
  // legs: black hakama, white wraps on the shins, sandals
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    const hip = joint(root, 'hip' + L, s * 0.09, -0.05, 0);
    add(hip, capsule(0.078, 0.36), mat.uniform);
    const kn = joint(hip, 'kn' + L, 0, -0.44, 0);
    add(kn, capsule(0.062, 0.14), mat.uniform);
    add(kn, capsule(0.052, 0.16), mat.white, 0, -0.19, 0);
    add(kn, new THREE.BoxGeometry(0.085, 0.04, 0.24), mat.dark, 0, -0.42, 0.05);
  }
  // the haori itself
  add(J.spine, haoriGeo(), ha.m);
  // a nichirin blade in the right hand
  const sword = new THREE.Group();
  sword.position.set(0, -0.03, 0.02);
  sword.rotation.set(-Math.PI / 2 + 0.2, 0, 0);
  J.handR.add(sword);
  add(sword, new THREE.CylinderGeometry(0.017, 0.017, 0.24, 8), mat.dark, 0, -0.04, 0);
  add(sword, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), mat.dark, 0, 0.085, 0);
  add(sword, new THREE.BoxGeometry(0.03, 0.72, 0.007).translate(0, 0.45, 0), mat.blade);

  root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return { root, J, ha, spec, phase: Math.random() * 10, spin: (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.2), rel: new THREE.Vector3(...spec.rel) };
}

// ---------------------------------------------------------------- the group, around the camera
export class Corps {
  constructor(scene, env) {
    ENV = env;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.members = MEMBERS.map((s) => member(s, env));
    for (const m of this.members) this.group.add(m.root);
    this.on = false;
    this.started = 0;
  }
  start(t, cam) {
    this.on = true;
    this.started = t;
    this.group.visible = true;
    // they went through the floor just ahead of you
    for (const m of this.members) {
      m.from = new THREE.Vector3((Math.random() - 0.5) * 2.2, -1.5 - Math.random() * 2.5, (Math.random() - 0.5) * 2.2);
    }
    this.update(t, 0, cam);
  }
  update(t, dt, cam, speed = 17) {
    if (!this.on) return;
    const k = Math.min(1, (t - this.started) / 6);
    const ease = k * k * (3 - 2 * k);
    for (const m of this.members) {
      const P = POSES[m.spec.pose], ph = m.phase + t;
      // where it falls, relative to the camera: a slow drift around its place in the formation
      _v.copy(m.rel);
      _v.x += Math.sin(ph * 0.21) * 0.45; _v.z += Math.cos(ph * 0.17) * 0.45; _v.y += Math.sin(ph * 0.13) * 1.6;
      _v.lerpVectors(m.from, _v, ease);
      m.root.position.copy(cam).add(_v);
      // turning slowly as it falls, a little wobble
      _e.set(P.root[0] + Math.sin(ph * 0.7) * 0.12, P.root[1], P.root[2] + Math.sin(ph * 0.5) * 0.1);
      _q.setFromEuler(_e);
      _q2.setFromAxisAngle(UP, m.spin * (t - this.started) + m.phase);
      m.root.quaternion.copy(_q2).multiply(_q);
      // limbs: the pose, and the wind pulling at them
      for (const j of ['spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR']) {
        const a = P[j], w = j.startsWith('sh') || j.startsWith('hip') ? 0.16 : 0.1, f = j.length * 0.37;
        m.J[j].rotation.set(a[0] + Math.sin(ph * (1.1 + f * 0.3) + f) * w, a[1], a[2] + Math.sin(ph * (0.9 + f * 0.2) + f * 2.0) * w * 0.8);
      }
      // the wind of the fall is world-up; give it to the cloth in the torso's frame
      m.J.spine.updateWorldMatrix(true, false);
      m.J.spine.getWorldQuaternion(_q).invert();
      m.ha.uni.uWind.value.copy(UP).applyQuaternion(_q).multiplyScalar(Math.min(1.2, 0.35 + speed * 0.045));
    }
  }
}
