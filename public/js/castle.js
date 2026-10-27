// Infinity Castle — the world. An endless shaft of rooms, built a segment at a time below the fall, folded
// and refolded at every note of the biwa. Every piece is an instance; each frame only the ones in view
// are packed into their InstancedMesh (far ones into the lighter twin of their piece).
import * as THREE from 'three';
import { FH } from './kit.js';

const TAU = Math.PI * 2;
export const SEG = 72;          // metres of castle per segment
export const INTRO_Y = 30;      // the floor of the Ubuyashiki room
const LOD_DIST = 55;
const FAR_CULL = 290;            // past this the fog has it all
const CLEAR = 3.4;              // nothing comes nearer the line of the fall than this

const WALL = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];
const MID = ['B1', 'B2', 'S1', 'S2', 'S3', 'S3', 'L1', 'L2', 'L1', 'P1', 'P2', 'P3', 'C1', 'T2', 'R1', 'H1', 'H1'];
const LONG = new Set(['B1', 'B2', 'S1', 'S2', 'S3', 'L1', 'L2', 'C1']);
const FAR = ['F1', 'F2', 'F4', 'F5', 'F7', 'T1', 'T1', 'T2', 'P1', 'P3', 'R1', 'C1', 'F6', 'H1'];
const CAP = { trap: 4, mansion: 1, R1: 48, T1: 48, T2: 48 };

// the line the fall follows: a slow wander, so the shaft never lines up into a tube
export function pathAt(y, out = new THREE.Vector3()) {
  return out.set(
    5.5 * Math.sin(y * 0.011 + 1.3) + 2.5 * Math.sin(y * 0.027 + 0.4),
    y,
    5.5 * Math.sin(y * 0.009 + 4.1) + 2.5 * Math.sin(y * 0.031 + 2.2));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const easeOutBack = (u) => { const c1 = 1.15, c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; };

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _o = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _pm = new THREE.Matrix4();
const _s = new THREE.Sphere(), _frustum = new THREE.Frustum();
const ONE = new THREE.Vector3(1, 1, 1), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const qe = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
const qa = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);

class Inst {
  // c is the centre of the piece's bounds in the world; q its turn
  constructor(type, kind, q, c, seed, glow) {
    this.type = type; this.kind = kind; this.q = q; this.c = c;
    this.data = new THREE.Vector4(seed, glow, 0, 0);
    this.doorT = [0, 0];
    this.anim = null;
    this.m = new THREE.Matrix4();
    this.compose();
  }
  compose() {
    _v.copy(this.type.center).applyQuaternion(this.q);
    _o.copy(this.c).sub(_v);
    this.m.compose(_o, this.q, ONE);
  }
  originY() { return this.m.elements[13]; }
}

// half extents of a rotated box, in world axes
function extents(half, q, out = new THREE.Vector3()) {
  _m.makeRotationFromQuaternion(q);
  const e = _m.elements;
  out.set(
    Math.abs(e[0]) * half.x + Math.abs(e[4]) * half.y + Math.abs(e[8]) * half.z,
    Math.abs(e[1]) * half.x + Math.abs(e[5]) * half.y + Math.abs(e[9]) * half.z,
    Math.abs(e[2]) * half.x + Math.abs(e[6]) * half.y + Math.abs(e[10]) * half.z);
  return out;
}

export class Castle {
  constructor(scene, material, pieces) {
    this.types = {};
    for (const [name, p] of Object.entries(pieces)) {
      const cap = CAP[name] ?? (name.startsWith('d_') ? 8 : 96);
      const iData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      iData.setUsage(THREE.DynamicDrawUsage);
      p.geo.setAttribute('iData', iData);
      const mesh = new THREE.InstancedMesh(p.geo, material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      const b = p.bounds;
      this.types[name] = {
        name, mesh, iData, cap, n: 0, lights: p.lights,
        center: new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2),
        half: new THREE.Vector3((b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2),
      };
    }
    for (const t of Object.values(this.types)) {
      t.radius = t.half.length();
      t.lod = this.types[t.name + '~'] ?? null;
    }
    this.segments = new Map();
    this.all = new Set();
    this.moving = new Set();
    this.traps = [];
    this.intro = null;
    this.cand = [];
  }

  add(seg, name, kind, q, c, seed, glow) {
    const it = new Inst(this.types[name], kind, q, c, seed, glow);
    if (seg) seg.list.push(it);
    this.all.add(it);
    return it;
  }
  remove(it) {
    this.all.delete(it);
    this.moving.delete(it);
  }
  // centre of a piece whose own origin should sit at o
  centreFor(name, q, o) { return this.types[name].center.clone().applyQuaternion(q).add(o); }

  // is the line of the fall clear of this piece (its bounds grown by margin)?
  clear(type, q, c, margin = CLEAR) {
    const ext = extents(type.half, q, _w);
    _q.copy(q).invert();
    for (let y = c.y - ext.y - margin; y <= c.y + ext.y + margin; y += 0.8) {
      pathAt(y, _p).sub(c).applyQuaternion(_q);
      if (Math.abs(_p.x) < type.half.x + margin && Math.abs(_p.y) < type.half.y + margin && Math.abs(_p.z) < type.half.z + margin) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- segments
  update(camY) {
    const cur = Math.floor(-camY / SEG);
    for (let k = cur - 2; k <= cur + 4; k++) if (!this.segments.has(k)) this.segments.set(k, this.build(k));
    for (const [k, s] of this.segments) {
      if (k >= cur - 2 && k <= cur + 4) continue;
      for (const it of s.list) this.remove(it);
      this.traps = this.traps.filter((t) => this.all.has(t));
      this.segments.delete(k);
    }
  }

  build(k) {
    const rnd = mulberry32((Math.imul(k, 0x9E3779B1) ^ 0x5bd1e995) >>> 0);
    const r = (a = 0, b = 1) => a + (b - a) * rnd();
    const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
    const seg = { k, list: [] };
    const top = -k * SEG, bot = top - SEG;
    const axis = new THREE.Vector3();
    const ext = new THREE.Vector3();

    // ---- the wall: façades facing the fall, stacked, now and then upside down or on their side
    const R = r(14, 21);
    const S = Math.max(5, Math.round(TAU * R / 15.5));
    const chord = 2 * R * Math.sin(Math.PI / S) + 3;
    const phase = r(0, TAU);
    for (let j = 0; j < S; j++) {
      if (rnd() < 0.12) continue;                 // a gap: the far castle shows through
      const th = phase + (j + r(-0.1, 0.1)) / S * TAU;
      const dir = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
      let y = top - r(0, 6);
      for (let guard = 0; guard < 14 && y > bot; guard++) {
        const roll = rnd() < 0.62 ? 0 : rnd() < 0.55 ? Math.PI : (rnd() < 0.5 ? 1 : -1) * Math.PI / 2;
        const q = qe(0, th + Math.PI, roll);
        let name = null;
        for (let a = 0; a < 6 && !name; a++) {
          const n = pick(WALL);
          if (2 * extents(this.types[n].half, q, ext).x <= chord) name = n;
        }
        if (!name) { y -= 4; continue; }
        const t = this.types[name];
        extents(t.half, q, ext);
        const yc = y - ext.y;
        pathAt(yc, axis);
        const c = axis.clone().addScaledVector(dir, R + r(-1, 3) + t.half.z);
        c.y = yc;
        this.add(seg, name, 'ring', q, c, rnd(), rnd() < 0.15 ? r(0.15, 0.45) : r(0.75, 1.15));
        y = yc - ext.y - (rnd() < 0.2 ? r(6, 16) : r(0.3, 3));
      }
    }

    // ---- across the void: bridges, stairs, lantern lines, rooms hanging at any angle
    const mids = [];
    const nMid = 4 + Math.floor(r(0, 4));
    for (let a = 0; a < nMid * 6 && mids.length < nMid; a++) {
      const name = pick(MID), t = this.types[name];
      const y = r(bot + 6, top - 6);
      if (k < 0 && Math.abs(y - INTRO_Y) < 26) continue;
      pathAt(y, axis);
      let q, c;
      if (LONG.has(name)) {
        const vertical = rnd() < 0.22;
        q = qe(0, r(0, TAU), vertical ? (rnd() < 0.5 ? 1 : -1) * Math.PI / 2 : 0);
        const side = Z.clone().applyQuaternion(q);
        side.y = 0;
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();
        c = axis.clone().addScaledVector(side, (rnd() < 0.5 ? -1 : 1) * r(4.6, 11));
        c.y = y;
      } else {
        const turn = pick([qe(0, 0, 0), qe(0, 0, 0), qe(Math.PI, 0, 0), qe(0, 0, Math.PI / 2), qe(0, 0, -Math.PI / 2), qe(Math.PI / 2, 0, 0)]);
        q = qe(0, r(0, TAU), 0).multiply(turn);
        const ang = r(0, TAU), dist = r(7, Math.max(8, R - 3));
        c = axis.clone().add(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist));
      }
      if (!this.clear(t, q, c)) continue;
      if (mids.some((m) => m.c.distanceTo(c) < (m.type.radius + t.radius) * 0.6)) continue;
      mids.push(this.add(seg, name, 'mid', q, c, rnd(), rnd() < 0.15 ? r(0.2, 0.5) : r(0.8, 1.15)));
    }

    // ---- far off: more of the same, any way up, in the haze
    const fars = [];
    for (let a = 0; a < 60 && fars.length < 22; a++) {
      const name = pick(FAR), t = this.types[name];
      const ang = r(0, TAU), dist = r(38, 125), y = r(bot, top);
      pathAt(y, axis);
      const roll = rnd() < 0.6 ? 0 : rnd() < 0.5 ? Math.PI : (rnd() < 0.5 ? 1 : -1) * Math.PI / 2;
      const q = qe(rnd() < 0.15 ? Math.PI / 2 : 0, r(0, TAU), roll);
      const c = axis.clone().add(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist));
      c.y = y;
      if (fars.some((m) => m.c.distanceTo(c) < (m.type.radius + t.radius) * 0.7)) continue;
      fars.push(this.add(seg, name, 'far', q, c, rnd(), r(0.7, 1.2)));
    }

    // ---- every other segment, a room right across the fall: it opens as you reach it
    if (k > 0 && k % 2 === 1) {
      const y = top - SEG * 0.5;
      const q = qe(0, r(0, TAU), 0);
      const c = this.centreFor('trap', q, pathAt(y, new THREE.Vector3()));
      for (const m of mids) if (Math.abs(m.c.y - y) < 16 + extents(m.type.half, m.q, ext).y) { this.remove(m); seg.list.splice(seg.list.indexOf(m), 1); }
      const it = this.add(seg, 'trap', 'trap', q, c, rnd(), 1.1);
      it.floorY = y;
      this.traps.push(it);
    }
    // ---- and at the top of it all, the room it begins in
    if (k === -1 && !this.intro) {
      const q = new THREE.Quaternion();
      const o = pathAt(INTRO_Y, new THREE.Vector3());
      this.intro = this.add(null, 'mansion', 'intro', q, this.centreFor('mansion', q, o), 0.3, 1);
    }
    return seg;
  }

  // ---------------------------------------------------------------- the biwa
  strike(cam, now) {
    const cands = [];
    for (const it of this.all) {
      if ((it.kind !== 'ring' && it.kind !== 'mid') || it.anim) continue;
      const d = it.c.distanceTo(cam);
      if (d < 90 && d > it.type.radius * 0.4 + 5) cands.push(it);
    }
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    let moved = 0;
    for (const it of cands) {
      if (moved >= 11) break;
      if (Math.random() > 0.5) continue;
      const mv = this.move(it);
      if (!mv) continue;
      it.anim = { q0: it.q.clone(), c0: it.c.clone(), q1: mv.q, c1: mv.c, t0: now + Math.random() * 0.25, dur: 0.42 + Math.random() * 0.3 };
      this.moving.add(it);
      moved++;
    }
    // the shoji of the rooms around fly open or shut
    let doors = 0;
    for (const it of this.all) {
      if (it.kind !== 'ring' && it.kind !== 'mid' && it.kind !== 'far') continue;
      if (it.c.distanceTo(cam) > 110 || Math.random() > 0.55) continue;
      it.doorT[0] = it.doorT[0] > 0.5 ? 0 : 1;
      it.doorDelay = now + Math.random() * 0.4;
      doors++;
    }
    return { moved, doors };
  }

  move(it) {
    for (let tries = 0; tries < 5; tries++) {
      const q = it.q.clone(), c = it.c.clone(), u = Math.random(), sg = Math.random() < 0.5 ? -1 : 1;
      if (it.kind === 'ring') {
        if (u < 0.5) c.y += sg * FH * (1 + Math.floor(Math.random() * 3));
        else if (u < 0.78) q.premultiply(qa(Z.clone().applyQuaternion(it.q), Math.PI));       // turned over
        else c.addScaledVector(X.clone().applyQuaternion(it.q), sg * (4 + Math.random() * 6));  // along the wall
      } else {
        if (u < 0.38) q.premultiply(qa(Y, sg * Math.PI / 2));
        else if (u < 0.7) c.addScaledVector(X.clone().applyQuaternion(it.q), sg * (4 + Math.random() * 7));
        else if (u < 0.85) c.y += sg * (5 + Math.random() * 8);
        else q.premultiply(qa(Math.random() < 0.5 ? X : Z, Math.PI));
      }
      const ey = extents(it.type.half, q, _w).y;
      const nearTrap = this.traps.some((tr) => Math.abs(c.y - tr.floorY - 2.5) < ey + 6 && Math.hypot(c.x - tr.c.x, c.z - tr.c.z) < it.type.radius + 9.5);
      if (!nearTrap && this.clear(it.type, q, c)) return { q, c };
    }
    return null;
  }

  // ---------------------------------------------------------------- per frame
  tick(now, dt, camY) {
    for (const it of this.moving) {
      const a = it.anim;
      const u = (now - a.t0) / a.dur;
      if (u < 0) continue;
      if (u >= 1) {
        it.q.copy(a.q1); it.c.copy(a.c1); it.anim = null;
        this.moving.delete(it);
      } else {
        const e = easeOutBack(u);
        it.q.slerpQuaternions(a.q0, a.q1, e);
        it.c.lerpVectors(a.c0, a.c1, e);
      }
      it.compose();
    }
    // traps: the roof hatch opens as you come down on it, the floor hatch once you are inside
    let slow = 1;
    for (const it of this.traps) {
      const fy = it.floorY, ty = fy + 5.0;
      if (camY < ty + 26) it.doorT[0] = 1;
      if (camY < ty - 0.6) it.doorT[1] = 1;
      const inside = 1 - Math.min(1, Math.max(0, Math.abs(camY - (fy + 2.6)) - 2.6) / 4);
      slow = Math.min(slow, 1 - 0.68 * inside);
    }
    // doors slide
    const kd = 1 - Math.exp(-dt * 9);
    for (const it of this.all) {
      if (it.doorDelay && now < it.doorDelay) continue;
      const d = it.data;
      if (Math.abs(d.z - it.doorT[0]) > 1e-3) d.z += (it.doorT[0] - d.z) * kd;
      if (Math.abs(d.w - it.doorT[1]) > 1e-3) d.w += (it.doorT[1] - d.w) * kd;
    }
    return slow;
  }

  pack(camera) {
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const n in this.types) { this.types[n].n = 0; this.types[n].near = 1e9; }
    const cp = camera.position;
    // front to back, so the depth test throws away most of the hidden rooms before they are shaded
    const vis = this.vis || (this.vis = []);
    vis.length = 0;
    for (const it of this.all) {
      _s.center.copy(it.c);
      _s.radius = it.type.radius;
      if (!_frustum.intersectsSphere(_s)) continue;
      it.dist = it.c.distanceTo(cp) - it.type.radius;
      if (it.dist < FAR_CULL) vis.push(it);
    }
    vis.sort((a, b) => a.dist - b.dist);
    for (const it of vis) {
      const t = it.dist > LOD_DIST && it.type.lod ? it.type.lod : it.type;
      if (t.n === 0) t.near = it.dist;
      if (t.n >= t.cap) continue;
      it.m.toArray(t.mesh.instanceMatrix.array, t.n * 16);
      it.data.toArray(t.iData.array, t.n * 4);
      t.n++;
    }
    let drawn = 0;
    const order = Object.values(this.types).sort((a, b) => a.near - b.near);
    order.forEach((t, i) => { t.mesh.renderOrder = i; });
    for (const n in this.types) {
      const t = this.types[n];
      t.mesh.count = t.n;
      drawn += t.n;
      if (t.n) { t.mesh.instanceMatrix.needsUpdate = true; t.iData.needsUpdate = true; }
    }
    return drawn;
  }

  // the lamps nearest a point, for the few real lights that follow the camera
  lamps(at, k, out) {
    const cand = this.cand;
    let n = 0;
    for (const it of this.all) {
      const L = it.type.lights;
      if (!L.length || it.c.distanceTo(at) - it.type.radius > 26) continue;
      const e = it.m.elements, glow = it.data.y;
      for (let i = 0; i < L.length; i += 8) {
        const x = e[0] * L[i] + e[4] * L[i + 1] + e[8] * L[i + 2] + e[12];
        const y = e[1] * L[i] + e[5] * L[i + 1] + e[9] * L[i + 2] + e[13];
        const z = e[2] * L[i] + e[6] * L[i + 1] + e[10] * L[i + 2] + e[14];
        const d = Math.hypot(x - at.x, y - at.y, z - at.z);
        if (d > 26) continue;
        const c = cand[n] || (cand[n] = {});
        c.d = d; c.x = x; c.y = y; c.z = z; c.r = L[i + 3]; c.g = L[i + 4]; c.b = L[i + 5]; c.p = L[i + 6] * glow; c.range = L[i + 7];
        n++;
      }
    }
    const list = cand.slice(0, n).sort((a, b) => a.d - b.d);
    const edge = list.length > k ? list[k].d : 26;
    out.length = 0;
    for (let i = 0; i < Math.min(k, list.length); i++) {
      const c = list[i];
      out.push({ ...c, w: Math.min(1, Math.max(0, (edge - c.d) / (edge * 0.4 + 1e-3))) });
    }
    return out;
  }
}

// ---------------------------------------------------------------- things falling with you
export class Debris {
  constructor(castle) {
    this.castle = castle;
    this.items = [];
    const names = ['d_shoji', 'd_shoji', 'd_fusuma', 'd_tatami', 'd_tatami', 'd_plank', 'd_plank', 'd_lantern', 'd_lantern', 'd_fusuma'];
    for (let i = 0; i < 14; i++) {
      const it = castle.add(null, names[i % names.length], 'debris', new THREE.Quaternion(), new THREE.Vector3(0, -1e5, 0), Math.random(), 1);
      castle.all.delete(it);
      it.rel = new THREE.Vector3(); it.vel = new THREE.Vector3(); it.spin = new THREE.Vector3();
      this.items.push(it);
    }
    this.on = false;
  }
  start(cam) {
    this.on = true;
    for (const it of this.items) { this.spawn(it, true); this.castle.all.add(it); }
    this.update(0, cam);
  }
  spawn(it, first) {
    const ang = Math.random() * TAU, rad = 3.2 + Math.random() * 7;
    const fromBelow = Math.random() < 0.72;
    it.rel.set(Math.cos(ang) * rad, first ? -10 - Math.random() * 45 : fromBelow ? -38 - Math.random() * 18 : 22 + Math.random() * 8, Math.sin(ang) * rad);
    // relative to the camera: most fall a little slower (they drift up past you), some faster
    it.vel.set((Math.random() - 0.5) * 0.8, fromBelow || first ? 2.5 + Math.random() * 6 : -3 - Math.random() * 4, (Math.random() - 0.5) * 0.8);
    it.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 2.2);
    it.q.setFromEuler(new THREE.Euler(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU));
  }
  update(dt, cam, slow = 1) {
    if (!this.on) return;
    for (const it of this.items) {
      it.rel.addScaledVector(it.vel, dt * slow);
      const a = it.spin.length() * dt * slow;
      if (a > 0) it.q.premultiply(_q.setFromAxisAngle(_v.copy(it.spin).normalize(), a));
      if (Math.abs(it.rel.y) > 58 || Math.hypot(it.rel.x, it.rel.z) > 16) this.spawn(it, false);
      it.c.copy(cam).add(it.rel);
      for (const tr of this.castle.traps) {
        if (Math.abs(it.c.y - tr.floorY - 2.5) > 4.5) continue;
        pathAt(it.c.y, _v);
        if (Math.hypot(it.c.x - _v.x, it.c.z - _v.z) > 2.3) { this.spawn(it, false); it.c.copy(cam).add(it.rel); }
      }
      it.compose();
    }
  }
}
