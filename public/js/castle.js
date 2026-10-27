// Infinity Castle — the world. One endless structure on a grid of 12.6 m cells, built six cell rows at a time
// below the fall, with open space carved through it along the line of the fall: a canyon, a well, an atrium or
// a void, as the chapter of that depth asks (chapters.js). Blocks turn only in quarter and
// half turns, so it stays one connected thing; the biwa turns them over in their cells. Every piece is an
// instance; each frame only the ones in view are packed into their InstancedMesh (far ones into the lighter twin).
import * as THREE from 'three';
import { CELL } from './kit.js';
import { INTRO_Y, chapterAt, wanderAt } from './chapters.js';

const TAU = Math.PI * 2;
export const SEG = CELL * 6;    // metres of castle per segment: six cell rows
export { INTRO_Y };
const LOD_DIST = 55;
const FAR_CULL = 290;            // past this the fog has it all
const CLEAR = 3.4;              // nothing comes nearer the line of the fall than this
const CANYON = 26;              // in a canyon, cells whose centre is this near the line of the fall stay open
const VOID = 63;                // in the void, this near the axis
const TOP = INTRO_Y + 20;       // no cells above this: the void over the castle
const CAP = { K1: 1400, 'K1~': 1400, K3: 2000, 'K3~': 2000, KD: 500, 'KD~': 500, LS4: 24, 'LS4~': 24, BR3: 40, BR4: 40,
  WL: 24, 'WL~': 24, WH: 8, trap: 4, mansion: 1 };
// a face block turns so its open side (+z) looks along one of these
const DIRS = [[1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, 1, 0], [0, -1, Math.PI]];
const QUARTERS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

// the line the fall follows: a slow wander through the canyons, so they never line up into a tube; straight down
// the axis of the grid (the middle of cell 0, 0) through the well, the atria and the void
export function pathAt(y, out = new THREE.Vector3()) {
  const w = wanderAt(INTRO_Y - y);
  return out.set(
    w * (5.5 * Math.sin(y * 0.011 + 1.3) + 2.5 * Math.sin(y * 0.027 + 0.4)),
    y,
    w * (5.5 * Math.sin(y * 0.009 + 4.1) + 2.5 * Math.sin(y * 0.031 + 2.2)));
}
const isCanyon = (y) => chapterAt(INTRO_Y - y).ch.open === 'canyon';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// how far past the canyon edge a cell reaches, in metres (-7 to +7), the same every time for the same cell
function jag(i, l, j) {
  let h = Math.imul(i, 73856093) ^ Math.imul(l, 19349663) ^ Math.imul(j, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296 - 0.5) * 14;
}
const easeOutBack =(u) => { const c1 = 1.15, c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; };

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
    this.gates = [];          // hatches across the fall: each opens as the camera comes within reach above it
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
    for (let k = cur - 1; k <= cur + 3; k++) if (!this.segments.has(k)) this.segments.set(k, this.build(k));
    for (const [k, s] of this.segments) {
      if (k >= cur - 1 && k <= cur + 3) continue;
      for (const it of s.list) this.remove(it);
      this.traps = this.traps.filter((t) => this.all.has(t));
      this.gates = this.gates.filter((t) => this.all.has(t));
      this.segments.delete(k);
    }
  }

  gate(it, y, reach = 30) {
    it.gateY = y; it.reach = reach;
    this.gates.push(it);
    return it;
  }

  // which cells of row j are open, and how far from the axis the open space reaches
  openRow(j) {
    const yc = -(j + 0.5) * CELL;
    if (yc > TOP) return { shape: 'sky', open: () => true, reach: 0, p: new THREE.Vector3(0, yc, 0) };
    const p = pathAt(yc, new THREE.Vector3());
    const shape = chapterAt(INTRO_Y - yc).ch.open;
    switch (shape) {
      case 'well': return { shape, open: (i, l) => i === 0 && l === 0, reach: CELL, p };
      case 'atrium': return { shape, open: (i, l) => Math.abs(i) <= 1 && Math.abs(l) <= 1, reach: 2 * CELL, p };
      case 'void': return { shape, open: (i, l) => Math.hypot(i * CELL, l * CELL) <= VOID + jag(i, l, j) * 0.6, reach: VOID + 5, p };
      default: return { shape, open: (i, l) => Math.hypot(i * CELL - p.x, l * CELL - p.z) <= CANYON + jag(i, l, j), reach: CANYON + 7, p };
    }
  }

  build(k) {
    const rnd = mulberry32((Math.imul(k, 0x9E3779B1) ^ 0x5bd1e995) >>> 0);
    const r = (a = 0, b = 1) => a + (b - a) * rnd();
    const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
    const seg = { k, list: [] };
    const top = -k * SEG;
    const p = new THREE.Vector3(), o = new THREE.Vector3();
    const glow = () => (rnd() < 0.12 ? r(0.15, 0.4) : r(0.75, 1.15));

    // ---- the cells: open near the line of the fall, a face block where a cell looks into the open,
    // a closed block one step further back, nothing deeper (it is never seen)
    for (let row = 0; row < 6; row++) {
      const j = k * 6 + row, yc = -(j + 0.5) * CELL;
      if (yc > TOP) continue;
      // the edge of a canyon is ragged: each cell has its own reach, so blocks jut out and fall back
      const here = this.openRow(j), open = here.open, openAbove = this.openRow(j - 1).open;
      p.copy(here.p);
      const span = Math.ceil(here.reach / CELL) + 2;
      if (here.shape === 'well') {
        const q0 = new THREE.Quaternion();
        if (j % 2 === 0 && this.openRow(j + 1).shape === 'well') {
          o.set(0, -(j + 2) * CELL, 0);
          this.add(seg, 'WL', 'set', q0, this.centreFor('WL', q0, o), rnd(), glow());
        }
        if (j % 6 === 0 && this.openRow(j - 1).shape === 'well') {
          o.set(0, -j * CELL, 0);
          this.gate(this.add(seg, 'WH', 'set', q0, this.centreFor('WH', q0, o), rnd(), 1), -j * CELL);
        }
      }
      const ci = Math.round(p.x / CELL), cl = Math.round(p.z / CELL);
      for (let i = ci - span; i <= ci + span; i++) for (let l = cl - span; l <= cl + span; l++) {
        if (open(i, l)) continue;
        let yaw = null, bd = 1e9;
        for (const [di, dl, a] of DIRS) {
          if (!open(i + di, l + dl)) continue;
          const d = Math.hypot((i + di) * CELL - p.x, (l + dl) * CELL - p.z);
          if (d < bd) { bd = d; yaw = a; }
        }
        o.set(i * CELL, yc, l * CELL);
        let it;
        if (yaw !== null && rnd() < 0.2) {
          // a closed block in the face of the canyon: timber walls and lattice windows between the verandas
          const q = qe(0, yaw, 0);
          it = this.add(seg, 'K3', 'back', q, this.centreFor('K3', q, o), rnd(), glow());
        } else if (yaw !== null) {
          // mostly upright; now and then upside down or on its side, always still facing the open
          const u = rnd();
          const roll = u < 0.84 ? 0 : u < 0.93 ? Math.PI : (u < 0.965 ? 1 : -1) * Math.PI / 2;
          const q = qe(0, yaw, roll);
          it = this.add(seg, 'K1', 'cell', q, this.centreFor('K1', q, o), rnd(), glow());
        } else {
          let near = false;
          for (let di = -2; di <= 2 && !near; di++) for (let dl = -2; dl <= 2 && !near; dl++) {
            if (Math.abs(di) + Math.abs(dl) <= 2 && open(i + di, l + dl)) near = true;
          }
          if (!near) continue;
          const q = qe(0, pick(QUARTERS), 0);
          it = this.add(seg, 'K3', 'back', q, this.centreFor('K3', q, o), rnd(), glow());
        }
        it.o = o.clone();
        // a cell with open space above it shows its roof: a railing with lamps all round
        if (openAbove(i, l)) {
          const q = qe(0, pick(QUARTERS), 0);
          o.y = yc + CELL / 2;
          this.add(seg, 'KD', 'deck', q, this.centreFor('KD', q, o), rnd(), glow());
        }
      }
    }

    // ---- across the canyon: bridges at the floor levels of the blocks, and long stairs
    const mids = [];
    const place = (name, q, c) => {
      const t = this.types[name];
      if (!this.clear(t, q, c)) return null;
      if (mids.some((m) => m.c.distanceTo(c) < (m.type.radius + t.radius) * 0.4)) return null;
      const it = this.add(seg, name, 'mid', q, c, rnd(), r(0.8, 1.15));
      mids.push(it);
      return it;
    };
    for (let a = 0, n = 0; a < 14 && n < 3; a++) {
      const row = Math.floor(r(0, 6)), yb = -(k * 6 + row + 1) * CELL + 4.2 * Math.floor(r(0, 3));
      if (yb > TOP - 8 || Math.abs(yb - INTRO_Y) < 26 || !isCanyon(yb - 8) || !isCanyon(yb + 8)) continue;
      pathAt(yb, p);
      const alongX = rnd() < 0.5, off = (rnd() < 0.5 ? -1 : 1) * r(5.5, 14);
      const q = qe(0, alongX ? 0 : Math.PI / 2, 0);
      o.set(p.x + (alongX ? 0 : off), yb, p.z + (alongX ? off : 0));
      for (const name of ['BR4', 'BR3']) if (place(name, q, this.centreFor(name, q, o))) { n++; break; }
    }
    if (rnd() < 0.85) {
      for (let a = 0; a < 8; a++) {
        const row = Math.floor(r(0, 3)), yb = -(k * 6 + row + 3) * CELL;
        if (yb + 42 > TOP - 8 || Math.abs(yb - INTRO_Y) < 60 || !isCanyon(yb - 8) || !isCanyon(yb + 50)) continue;
        pathAt(yb + 21, p);
        const q = qe(0, pick(QUARTERS), 0);
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q), side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const off = (rnd() < 0.5 ? -1 : 1) * r(6, 13), L = this.types.LS4.half.z;
        // the middle step of the flight sits beside the line of the fall
        o.copy(p).addScaledVector(side, off).addScaledVector(dir, -L);
        o.y = yb;
        if (place('LS4', q, this.centreFor('LS4', q, o))) break;
      }
    }

    // ---- every other segment, a room right across the fall: it opens as you reach it
    if (k > 0 && k % 2 === 1 && isCanyon(top - SEG * 0.5 - 20) && isCanyon(top - SEG * 0.5 + 30)) {
      const y = top - SEG * 0.5;
      const q = qe(0, pick(QUARTERS), 0);
      const c = this.centreFor('trap', q, pathAt(y, new THREE.Vector3()));
      for (const m of [...mids]) {
        if (Math.abs(m.c.y - y) < 16 + extents(m.type.half, m.q, _w).y) { this.remove(m); seg.list.splice(seg.list.indexOf(m), 1); }
      }
      const it = this.add(seg, 'trap', 'trap', q, c, rnd(), 1.1);
      it.floorY = y;
      this.traps.push(it);
      this.gate(it, y + 5.0, 26);
    }
    // ---- and at the top of it all, the room it begins in
    if (k === -1 && !this.intro) {
      const q = new THREE.Quaternion();
      const o2 = pathAt(INTRO_Y, new THREE.Vector3());
      this.intro = this.add(null, 'mansion', 'intro', q, this.centreFor('mansion', q, o2), 0.3, 1);
    }
    return seg;
  }

  // ---------------------------------------------------------------- the biwa
  strike(cam, now) {
    const cands = [];
    for (const it of this.all) {
      if (it.kind !== 'cell' || it.anim) continue;
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
      if (it.kind !== 'cell' && it.kind !== 'back') continue;
      if (it.c.distanceTo(cam) > 110 || Math.random() > 0.55) continue;
      it.doorT[0] = it.doorT[0] > 0.5 ? 0 : 1;
      it.doorDelay = now + Math.random() * 0.4;
      doors++;
    }
    return { moved, doors };
  }

  move(it) {
    // a face block turns about the line it looks along: over (a half turn) or onto its side (a quarter turn),
    // so it stays in its cell and keeps its open side to the canyon
    const axis = Z.clone().applyQuaternion(it.q);
    const a = Math.random() < 0.6 ? Math.PI : (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    const q = qa(axis, a).multiply(it.q);
    return { q, c: this.centreFor(it.type.name, q, it.o) };
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
    for (const it of this.gates) if (camY < it.gateY + it.reach) it.doorT[0] = 1;
    for (const it of this.traps) {
      const fy = it.floorY, ty = fy + 5.0;
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
  stop() {
    if (!this.on) return;
    this.on = false;
    for (const it of this.items) this.castle.all.delete(it);
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
