// Infinity Castle — the kit.
// Every piece is built in its own frame (metres, y up, the side that faces the void towards +z) and lit
// once: ambient occlusion and the light of its own lamps are baked into the vertices. No three.js in
// here, so the same code runs in the bake workers.

// ---------------------------------------------------------------- materials (ids read by the shader)
export const M = {
  WOOD: 0, PLANK: 1, LACQUER: 2, SHOJI: 3, TATAMI: 4, TILE: 5, PLASTER: 6, FUSUMA: 7,
  LANTERN: 8, BRASS: 9, BLACK: 10, ROPE: 11, RANMA: 12, EAVE: 13,
};

// ---------------------------------------------------------------- dimensions
export const FH = 4.2;        // storey, floor to floor
const SLAB = 0.34;            // floor thickness
const BAY = 2.0;              // pillar spacing
const VER = 2.3;              // veranda depth, railing to shoji
const ROOM = 4.0;             // room depth behind the shoji
const DOOR = 2.3;             // shoji and fusuma height
const WARM = [1.0, 0.52, 0.22];
const AMBER = [1.0, 0.64, 0.34];
const RED = [1.0, 0.34, 0.15];
const MOON = [0.42, 0.56, 1.0];

// ---------------------------------------------------------------- math
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
// column-major 4x4, like three.js
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const ID = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const TR = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

// ---------------------------------------------------------------- builder
const _p = [0, 0, 0], _n = [0, 0, 0];

export class Builder {
  constructor(seed = 1) {
    this.P = []; this.N = []; this.UV = []; this.MA = []; this.DR = []; this.G = []; this.K = []; this.I = [];
    this.occ = [];            // occluders: axis-aligned boxes in the piece frame
    this.lights = [];         // lamps: position, colour, power, range
    this.m = ID();
    this.stack = [];
    this.rnd = mulberry32(seed >>> 0);
    this.door = null;         // [dx, dy, dz, channel]: how far the vertices being emitted slide when open
    this.group = 0;           // tags occluders, so a surface never occludes itself
    this.lod = false;         // the far twin: coarse grids, plain lamps
    this.hex = false;         // lanterns are hexagonal frames (the castle of the film), not round chochin
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rnd(); }
  chance(p) { return this.rnd() < p; }
  pick(a) { return a[Math.floor(this.rnd() * a.length) % a.length]; }

  push() { this.stack.push(this.m.slice()); return this; }
  pop() { this.m = this.stack.pop(); return this; }
  at(x, y, z) { this.m = mul(this.m, TR(x, y, z)); return this; }
  rx(a) { this.m = mul(this.m, RX(a)); return this; }
  ry(a) { this.m = mul(this.m, RY(a)); return this; }
  rz(a) { this.m = mul(this.m, RZ(a)); return this; }
  xp(x, y, z, o = _p) {
    const m = this.m;
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return o;
  }
  xd(x, y, z, o = _n) {
    const m = this.m;
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
    return o;
  }

  // k: how the bake samples this vertex (-1 itself, -2 lamp light only, >= 0 shares the sample of vertex k)
  vert(x, y, z, nx, ny, nz, u, v, fw, fh, mat, seed, param, g, k = -1) {
    this.K.push(k === -3 ? this.P.length / 3 : k);
    const p = this.xp(x, y, z);
    this.P.push(p[0], p[1], p[2]);
    const n = this.xd(nx, ny, nz);
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l > 1e-12) this.N.push(n[0] / l, n[1] / l, n[2] / l); else this.N.push(0, 1, 0);
    this.UV.push(u, v, fw, fh);
    this.MA.push(mat, seed, param, 1);
    if (this.door) {
      const d = this.xd(this.door[0], this.door[1], this.door[2]);
      this.DR.push(d[0], d[1], d[2], this.door[3]);
    } else this.DR.push(0, 0, 0, 0);
    this.G.push(g);
  }

  // an axis-aligned box in the current frame; its faces are gridded so the bake has vertices to light
  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const seed = o.seed ?? this.rnd(), param = o.param ?? 0, cell = Math.max(o.cell ?? 0.9, this.lod ? 3.5 : 0);
    const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    const sz = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const grain = o.grain ?? (sz[0] >= sz[1] && sz[0] >= sz[2] ? 0 : sz[1] >= sz[2] ? 1 : 2);
    const g = o.group ?? ++this.group;
    const c = [0, 0, 0], n = [0, 0, 0];
    for (let ax = 0; ax < 3; ax++) {
      const a = (ax + 1) % 3, b = (ax + 2) % 3;
      let ua, va;
      // u follows the grain when it lies in the face; otherwise v stays vertical when it can
      if (grain === a || grain === b) { ua = grain; va = grain === a ? b : a; }
      else if (a === 1 || b === 1) { va = 1; ua = a === 1 ? b : a; }
      else { ua = a; va = b; }
      const cs = ua === a ? 1 : -1;
      for (let side = 0; side < 2; side++) {
        if (o.skip && o.skip.includes(ax * 2 + side)) continue;
        const s = side ? 1 : -1;
        const fu = sz[ua], fv = sz[va];
        const nu = fu > cell * 1.25 ? Math.min(48, Math.ceil(fu / cell)) : 1;
        const nv = fv > cell * 1.25 ? Math.min(48, Math.ceil(fv / cell)) : 1;
        const base = this.P.length / 3;
        n[0] = n[1] = n[2] = 0; n[ax] = s;
        c[ax] = side ? hi[ax] : lo[ax];
        const small = nu === 1 && nv === 1 && fu * fv < 0.25;
        for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
          c[ua] = lo[ua] + fu * i / nu;
          c[va] = lo[va] + fv * j / nv;
          this.vert(c[0], c[1], c[2], n[0], n[1], n[2], fu * i / nu, fv * j / nv, fu, fv, mat, seed, param, g, small ? (i + j ? base : -3) : -1);
        }
        const flip = cs * s < 0;
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          const k = base + j * (nu + 1) + i, k1 = k + 1, k2 = k + nu + 1, k3 = k2 + 1;
          if (flip) this.I.push(k, k2, k1, k1, k2, k3);
          else this.I.push(k, k1, k3, k, k3, k2);
        }
      }
    }
    if (o.occ !== false) this.occBox(lo, hi, g, o.big);
    return this;
  }

  // the occluder of a box: its bounds in the piece frame (exact while the frame turns in quarter turns)
  occBox(lo, hi, g, big) {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < 8; i++) {
      const p = this.xp(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    }
    const big2 = big ?? ((mx[0] - mn[0] > 1.0) + (mx[1] - mn[1] > 1.0) + (mx[2] - mn[2] > 1.0) >= 2);
    this.occ.push({ lo: mn, hi: mx, g, big: big2 });
  }

  // a parametric patch: pos(s, t) and uv(s, t) over [0, 1]²; normals from finite differences
  surface(nu, nv, pos, uv, mat, o = {}) {
    const seed = o.seed ?? this.rnd(), param = o.param ?? 0, g = o.group ?? ++this.group, flip = !!o.flip;
    const base = this.P.length / 3, e = 1e-3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const s = i / nu, t = j / nv;
      const p = pos(s, t);
      const a = pos(Math.min(1, s + e), t), b = pos(Math.max(0, s - e), t);
      const c = pos(s, Math.min(1, t + e)), d = pos(s, Math.max(0, t - e));
      const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
      const vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const q = uv(s, t);
      this.vert(p[0], p[1], p[2], nx, ny, nz, q[0], q[1], o.fw ?? 1, o.fh ?? 1, mat, seed, param, g, o.shared ? -2 : -1);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = base + j * (nu + 1) + i, k1 = k + 1, k2 = k + nu + 1, k3 = k2 + 1;
      if (flip) this.I.push(k, k3, k1, k, k2, k3);
      else this.I.push(k, k1, k3, k, k3, k2);
    }
  }

  // a surface of revolution about the local y axis; prof is [[r, y], ...] from bottom to top
  lathe(prof, segs, mat, o = {}) {
    const n = prof.length - 1;
    const acc = [0];
    for (let i = 1; i <= n; i++) acc.push(acc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
    const rmax = Math.max(...prof.map((p) => p[0]));
    const circ = 2 * Math.PI * rmax;
    const at = (t) => {
      const k = Math.min(n - 1, Math.floor(t * n)), f = t * n - k;
      return [prof[k][0] + (prof[k + 1][0] - prof[k][0]) * f, prof[k][1] + (prof[k + 1][1] - prof[k][1]) * f, acc[k] + (acc[k + 1] - acc[k]) * f];
    };
    this.surface(segs, n, (s, t) => {
      const [r, y] = at(t), a = -s * Math.PI * 2;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    }, (s, t) => [s * circ, at(t)[2]], mat, { shared: rmax < 0.5, ...o, fw: circ, fh: acc[n] });
  }

  // a box from a to c, w wide and h tall, at any angle (no occluder)
  beam(a, c, w, h, mat, o = {}) {
    const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
    const L = Math.hypot(dx, dy, dz), hz = Math.hypot(dx, dz);
    this.push().at((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2).ry(Math.atan2(dx, dz)).rx(-Math.atan2(dy, hz));
    this.box(-w / 2, -h / 2, -L / 2, w / 2, h / 2, L / 2, mat, { occ: false, grain: 2, cell: 9, ...o });
    this.pop();
  }

  light(x, y, z, col, power, range = 7) {
    const p = this.xp(x, y, z);
    this.lights.push({ p: [p[0], p[1], p[2]], c: col, power, range });
  }

  // chochin: a ribbed paper barrel between two black rims, hung on a cord; the lamp sits at its centre
  lantern(x, y, z, o = {}) {
    if (this.hex && !o.round) return this.hexLantern(x, y, z, o);
    const h = o.h ?? 0.66, r = o.r ?? 0.27, seg = 12, tint = o.tint ?? 0;
    if (this.lod || o.lod) {
      this.box(x - r * 0.8, y - h / 2, z - r * 0.8, x + r * 0.8, y + h / 2, z + r * 0.8, M.LANTERN, { param: tint, occ: false });
      this.light(x, y, z, tint > 0.5 ? RED : WARM, (o.power ?? 1.8) * (o.glow ?? 1), o.range ?? 7.5);
      return;
    }
    this.push().at(x, y, z);
    const prof = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([r * (0.6 + 0.4 * Math.sin(Math.PI * t)), -h / 2 + h * t]); }
    this.lathe(prof, seg, M.LANTERN, { param: tint });
    const rr = r * 0.64;
    this.lathe([[0.001, -h / 2 - 0.05], [rr, -h / 2 - 0.05], [rr, -h / 2 + 0.03], [0.001, -h / 2 + 0.03]], seg, M.BLACK);
    this.lathe([[0.001, h / 2 - 0.03], [rr, h / 2 - 0.03], [rr, h / 2 + 0.05], [0.001, h / 2 + 0.05]], seg, M.BLACK);
    if (o.cord) this.box(-0.012, h / 2 + 0.05, -0.012, 0.012, h / 2 + 0.05 + o.cord, 0.012, M.ROPE, { occ: false, cell: 9 });
    this.pop();
    this.light(x, y, z, tint > 0.5 ? RED : WARM, (o.power ?? 1.8) * (o.glow ?? 1), o.range ?? 7.5);
  }

  // a hexagonal frame lantern: six paper panels in black frames, a cap and a foot
  hexLantern(x, y, z, o = {}) {
    const h = (o.h ?? 0.66) * 1.05, r = Math.max(0.22, o.r ?? 0.27) * 0.95, tint = o.tint ?? 0;
    if (this.lod || o.lod) {
      this.box(x - r * 0.8, y - h / 2, z - r * 0.8, x + r * 0.8, y + h / 2, z + r * 0.8, M.LANTERN, { param: 2, occ: false });
      this.light(x, y, z, tint > 0.5 ? RED : WARM, (o.power ?? 1.8) * (o.glow ?? 1), o.range ?? 7.5);
      return;
    }
    this.push().at(x, y, z);
    const ap = r * 0.866;
    for (let k = 0; k < 6; k++) {
      this.push().ry(k * Math.PI / 3);
      this.box(-r / 2, -h / 2, ap - 0.012, r / 2, h / 2, ap + 0.012, M.LANTERN, { param: 2, grain: 0, cell: 9, occ: false });
      this.box(r / 2 - 0.018, -h / 2, ap - 0.03, r / 2 + 0.018, h / 2, ap + 0.03, M.BLACK, { cell: 9, occ: false });
      this.pop();
    }
    this.lathe([[0.001, h / 2], [r * 1.12, h / 2], [r * 0.95, h / 2 + 0.07], [0.001, h / 2 + 0.11]], 6, M.BLACK);
    this.lathe([[0.001, -h / 2 - 0.06], [r * 0.9, -h / 2 - 0.06], [r * 1.05, -h / 2], [0.001, -h / 2]], 6, M.BLACK);
    if (o.cord) this.box(-0.012, h / 2 + 0.1, -0.012, 0.012, h / 2 + 0.1 + o.cord, 0.012, M.ROPE, { occ: false, cell: 9 });
    this.pop();
    this.light(x, y, z, tint > 0.5 ? RED : WARM, (o.power ?? 1.8) * (o.glow ?? 1), o.range ?? 7.5);
  }

  // lamp points: small hot dots in a row along x, the thousands of lights strung over the castle
  points(x0, x1, y, z, step = 1.0) {
    const s = this.lod ? 0.14 : 0.055, n = Math.max(1, Math.round((x1 - x0) / step));
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      this.box(x - s, y - s, z - s, x + s, y + s, z + s, M.LANTERN, { param: 3, occ: false, cell: 9 });
    }
  }

  // ---------------------------------------------------------------- the bake
  bake(o = {}) {
    const nV = this.P.length / 3, P = this.P, N = this.N, G = this.G, K = this.K, MA = this.MA;
    const LI = new Float32Array(nV * 3);
    const nb = this.occ.length;
    const B = new Float32Array(nb * 6), BG = new Int32Array(nb), BB = new Uint8Array(nb);
    this.occ.forEach((b, i) => {
      B[i * 6] = b.lo[0]; B[i * 6 + 1] = b.lo[1]; B[i * 6 + 2] = b.lo[2];
      B[i * 6 + 3] = b.hi[0]; B[i * 6 + 4] = b.hi[1]; B[i * 6 + 5] = b.hi[2];
      BG[i] = b.g; BB[i] = b.big ? 1 : 0;
    });
    const inside = (i, x, y, z) => x > B[i * 6] && x < B[i * 6 + 3] && y > B[i * 6 + 1] && y < B[i * 6 + 4] && z > B[i * 6 + 2] && z < B[i * 6 + 5];
    // slab test with the inverse direction precomputed: entry distance, or -1
    const hit = (ox, oy, oz, ix, iy, iz, tmax, i) => {
      const o6 = i * 6;
      let a = (B[o6] - ox) * ix, b = (B[o6 + 3] - ox) * ix;
      let t0 = a < b ? a : b, t1 = a < b ? b : a;
      a = (B[o6 + 1] - oy) * iy; b = (B[o6 + 4] - oy) * iy;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      a = (B[o6 + 2] - oz) * iz; b = (B[o6 + 5] - oz) * iz;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 < 0) t0 = 0;
      return t0 <= t1 && t0 < tmax ? t0 : -1;
    };
    const inv = (d) => (Math.abs(d) < 1e-9 ? (d < 0 ? -1e9 : 1e9) : 1 / d);

    // a 1 m grid over the occluders, packed as offsets + indices
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i * 3 + k]); mx[k] = Math.max(mx[k], P[i * 3 + k]); }
    const g0 = mn.map((v) => Math.floor(v) - 2);
    const dims = [0, 1, 2].map((k) => Math.ceil(mx[k]) + 3 - g0[k]);
    const ncell = dims[0] * dims[1] * dims[2];
    const range = (b, k) => [Math.max(0, Math.floor(B[b * 6 + k] - g0[k])), Math.min(dims[k] - 1, Math.floor(B[b * 6 + 3 + k] - g0[k]))];
    const start = new Int32Array(ncell + 1);
    for (let pass = 0; pass < 2; pass++) {
      const fill = pass ? start.slice() : null;
      var idx = pass ? new Int32Array(start[ncell]) : null;
      for (let b = 0; b < nb; b++) {
        const [i0, i1] = range(b, 0), [j0, j1] = range(b, 1), [k0, k1] = range(b, 2);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
          const c = (i * dims[1] + j) * dims[2] + k;
          if (pass) idx[fill[c]++] = b; else start[c + 1]++;
        }
      }
      if (!pass) for (let c = 0; c < ncell; c++) start[c + 1] += start[c];
    }

    // fixed cosine-weighted hemisphere, so neighbouring vertices agree
    const RAYS = o.rays ?? 10, D = o.aoDist ?? 1.35;
    const DIR = [];
    for (let i = 0; i < RAYS; i++) {
      const u = (i + 0.5) / RAYS, phi = i * 2.399963, r = Math.sqrt(u);
      DIR.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
    }
    // the lamps: only big occluders cast their shadows (thin rails are below the vertex density anyway)
    const L = this.lights.map((l) => {
      const occ = [];
      for (let b = 0; b < nb; b++) {
        if (!BB[b] || inside(b, l.p[0], l.p[1], l.p[2])) continue;
        let d2 = 0;
        for (let k = 0; k < 3; k++) {
          const v = l.p[k], lo = B[b * 6 + k], hi = B[b * 6 + 3 + k];
          if (v < lo) d2 += (lo - v) ** 2; else if (v > hi) d2 += (v - hi) ** 2;
        }
        if (d2 < l.range * l.range) occ.push(b);
      }
      return { x: l.p[0], y: l.p[1], z: l.p[2], c: l.c, power: l.power, occ: Int32Array.from(occ), r2: l.range * l.range };
    });

    const stamp = new Int32Array(nb);
    let st = 0;
    const cand = new Int32Array(Math.max(1, nb));
    for (let v = 0; v < nV; v++) {
      const key = K[v];
      if (key >= 0 && key !== v) {
        MA[v * 4 + 3] = MA[key * 4 + 3];
        LI[v * 3] = LI[key * 3]; LI[v * 3 + 1] = LI[key * 3 + 1]; LI[v * 3 + 2] = LI[key * 3 + 2];
        continue;
      }
      let px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      if (key === v) { px = (px + P[v * 3 + 9]) / 2; py = (py + P[v * 3 + 10]) / 2; pz = (pz + P[v * 3 + 11]) / 2; }
      const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      const g = G[v], lampOnly = key === -2;
      const ox = px + nx * 0.02, oy = py + ny * 0.02, oz = pz + nz * 0.02;

      if (!lampOnly) {
        // tangent frame
        let tx, ty, tz;
        if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 0; ty = -nz; tz = ny; }
        const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        // occluders near the vertex
        st++;
        let nc = 0;
        const i0 = Math.max(0, Math.floor(px - D - g0[0])), i1 = Math.min(dims[0] - 1, Math.floor(px + D - g0[0]));
        const j0 = Math.max(0, Math.floor(py - D - g0[1])), j1 = Math.min(dims[1] - 1, Math.floor(py + D - g0[1]));
        const k0 = Math.max(0, Math.floor(pz - D - g0[2])), k1 = Math.min(dims[2] - 1, Math.floor(pz + D - g0[2]));
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const row = (i * dims[1] + j) * dims[2];
          for (let c = start[row + k0], e = start[row + k1 + 1]; c < e; c++) {
            const b = idx[c];
            if (stamp[b] === st) continue;
            stamp[b] = st;
            if (BG[b] !== g && !inside(b, px, py, pz)) cand[nc++] = b;
          }
        }
        let occl = 0;
        if (nc) {
          for (let r = 0; r < RAYS; r++) {
            const d = DIR[r];
            const ix = inv(tx * d[0] + bx * d[1] + nx * d[2]), iy = inv(ty * d[0] + by * d[1] + ny * d[2]), iz = inv(tz * d[0] + bz * d[1] + nz * d[2]);
            let best = D;
            for (let q = 0; q < nc; q++) {
              const t = hit(ox, oy, oz, ix, iy, iz, best, cand[q]);
              if (t >= 0) best = t;
            }
            if (best < D) occl += 1 - best / D;
          }
        }
        MA[v * 4 + 3] = Math.max(0.1, 1 - 1.2 * occl / RAYS);
      }

      // the piece's own lamps
      let lr = 0, lg = 0, lb = 0;
      for (let li = 0; li < L.length; li++) {
        const l = L[li];
        const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > l.r2) continue;
        const d = Math.sqrt(d2) + 1e-6;
        const w = lampOnly ? 0.6 : ((dx * nx + dy * ny + dz * nz) / d + 0.2) / 1.2;
        if (w <= 0) continue;
        let vis = 1;
        if (!lampOnly) {
          const ix = inv(dx / d), iy = inv(dy / d), iz = inv(dz / d), occ = l.occ, tm = d - 0.12;
          for (let q = 0; q < occ.length; q++) {
            const b = occ[q];
            if (BG[b] !== g && hit(ox, oy, oz, ix, iy, iz, tm, b) > 0.001) { vis = 0.1; break; }
          }
        }
        const win = Math.max(0, 1 - (d2 / l.r2) ** 2);
        const a = l.power / (1 + d2) * win * win * w * vis;
        lr += l.c[0] * a; lg += l.c[1] * a; lb += l.c[2] * a;
      }
      LI[v * 3] = lr; LI[v * 3 + 1] = lg; LI[v * 3 + 2] = lb;
    }
    this.LI = LI;
  }

  out(name) {
    const nV = this.P.length / 3;
    const P = new Float32Array(this.P);
    const bounds = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k], P[i * 3 + k]);
      bounds[3 + k] = Math.max(bounds[3 + k], P[i * 3 + k]);
    }
    const lights = new Float32Array(this.lights.length * 8);
    this.lights.forEach((l, i) => lights.set([l.p[0], l.p[1], l.p[2], l.c[0], l.c[1], l.c[2], l.power, l.range], i * 8));
    return {
      name, P, bounds, lights,
      N: new Float32Array(this.N), UV: new Float32Array(this.UV), MA: new Float32Array(this.MA),
      LI: this.LI || new Float32Array(nV * 3), DR: new Float32Array(this.DR),
      I: nV > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I),
    };
  }
}

// ---------------------------------------------------------------- small parts
function giboshi(b, x, y, z, s = 1) {
  // the brass onion cap on a railing post
  b.push().at(x, y, z);
  b.lathe([[0.075 * s, 0], [0.08 * s, 0.04 * s], [0.1 * s, 0.09 * s], [0.088 * s, 0.15 * s], [0.05 * s, 0.2 * s], [0.014 * s, 0.25 * s], [0.001, 0.3 * s]], 10, M.BRASS);
  b.pop();
}

function railing(b, x0, x1, y, z, o = {}) {
  // kōran along x: posts, a top rail (kasagi), a middle rail and a foot rail
  const mat = o.mat ?? M.LACQUER, H = o.h ?? 0.92;
  const n = Math.max(1, Math.round((x1 - x0) / (o.step ?? 1.0)));
  const last = o.skipEnd ? n - 1 : n;
  for (let i = 0; i <= last; i++) {
    const x = x0 + (x1 - x0) * i / n, main = o.caps && i % o.caps === 0;
    if (o.lod && !main) continue;
    const r = main ? 0.075 : 0.05;
    b.box(x - r, y, z - r, x + r, y + H + (main ? 0.1 : 0), z + r, mat, { cell: 9, grain: 1 });
    if (main && !o.lod) giboshi(b, x, y + H + 0.1, z);
  }
  b.box(x0 - 0.1, y + H - 0.02, z - 0.075, x1 + 0.1, y + H + 0.07, z + 0.075, mat, { grain: 0, cell: 2 });
  if (!o.lod) b.box(x0, y + H * 0.48, z - 0.035, x1, y + H * 0.48 + 0.06, z + 0.035, mat, { grain: 0, cell: 2 });
  b.box(x0, y + 0.05, z - 0.06, x1, y + 0.13, z + 0.06, mat, { grain: 0, cell: 2 });
  if (o.points) b.points(x0 + 0.5, x1 - 0.5, y + H + 0.14, z, o.lod ? 2.0 : 1.0);
}

function andon(b, x, y, z, glow, lod) {
  // a paper floor lamp on the mats
  b.box(x - 0.2, y + 0.12, z - 0.2, x + 0.2, y + 0.74, z + 0.2, M.LANTERN, { param: 2, occ: false, cell: 9 });
  if (!lod) {
    b.box(x - 0.22, y, z - 0.22, x + 0.22, y + 0.04, z + 0.22, M.BLACK, { occ: false, cell: 9 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.box(x + sx * 0.21 - 0.02, y + 0.04, z + sz * 0.21 - 0.02, x + sx * 0.21 + 0.02, y + 0.8, z + sz * 0.21 + 0.02, M.BLACK, { occ: false, cell: 9 });
    }
  }
  b.light(x, y + 0.45, z, AMBER, 1.5 * glow, 6.5);
}

function tatamiFloor(b, x0, x1, z0, z1, y, door) {
  // mats 0.95 × 1.9, long side front to back, a turned row where the depth runs out
  const nx = Math.floor((x1 - x0) / 0.95), nz = Math.floor((z1 - z0) / 1.9);
  const ox = (x0 + x1) / 2 - nx * 0.95 / 2, oz = (z0 + z1) / 2 - nz * 1.9 / 2;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const xa = ox + i * 0.95, za = oz + k * 1.9;
    if (door && door(xa + 0.475, za + 0.95)) continue;
    b.box(xa + 0.004, y, za + 0.004, xa + 0.946, y + 0.055, za + 1.896, M.TATAMI, { occ: false, cell: 9 });
  }
}

// ---------------------------------------------------------------- roof
function roof(b, w, d, h, ridge, o = {}) {
  // a hipped roof with a concave sweep and lifted corners over the eave rectangle w × d (y = 0 at the eave)
  const W = w / 2, D = d / 2, R = Math.max(0, Math.min(ridge / 2, W - D * 0.35)), up = o.up ?? 0.7, T = 0.34;
  const g = ++b.group;
  const prof = (t) => h * t * (0.3 + 0.7 * t);
  const sides = [
    [[-W, D], [W, D], [-R, 0.02], [R, 0.02]],
    [[W, -D], [-W, -D], [R, -0.02], [-R, -0.02]],
    [[W, D], [W, -D], [R, 0.02], [R, -0.02]],
    [[-W, -D], [-W, D], [-R, -0.02], [-R, 0.02]],
  ];
  const cell = o.lod ? 2.4 : 0.9;
  for (const [e0, e1, r0, r1] of sides) {
    const len = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
    const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
    const run = Math.hypot((e0[0] + e1[0] - r0[0] - r1[0]) / 2, (e0[1] + e1[1] - r0[1] - r1[1]) / 2);
    const slope = Math.hypot(run, h) * 1.05;
    const P = (s, t, dy = 0) => {
      const c = Math.pow(Math.abs(2 * s - 1), 3);
      const ex = e0[0] + (e1[0] - e0[0]) * s, ez = e0[1] + (e1[1] - e0[1]) * s;
      const rx = r0[0] + (r1[0] - r0[0]) * s, rz = r0[1] + (r1[1] - r0[1]) * s;
      const out = 1 + 0.05 * c * (1 - t);
      return [(ex + (rx - ex) * t) * out, prof(t) + up * c * (1 - t) * (1 - t) + dy, (ez + (rz - ez) * t) * out];
    };
    const uv = (s, t) => [(s - 0.5) * (len + (rl - len) * t), t * slope];
    const nu = Math.max(4, Math.ceil(len / cell));
    b.surface(nu, o.lod ? 4 : 9, (s, t) => P(s, t), uv, M.TILE, { group: g, fw: len, fh: slope });
    b.surface(nu, o.lod ? 2 : 5, (s, t) => P(s, t, -T), uv, M.WOOD, { group: g, flip: true, fw: len, fh: slope });
    // the eave: a row of round tile ends over a black fascia
    b.surface(nu, 1, (s, t) => P(s, 0, -T * t), (s, t) => [(s - 0.5) * len, (1 - t) * T], M.EAVE, { group: g, flip: true, fw: len, fh: T });
    // rafters under the eave
    if (!o.lod) {
      const over = o.over ?? 1.8, tw = Math.min(0.6, over / Math.max(run, 0.1));
      const n = Math.floor(len / 0.38);
      for (let i = 1; i < n; i++) {
        const s = i / n;
        if (Math.abs(2 * s - 1) > 0.8) continue;
        const a = P(s, 0, -T - 0.08), c = P(s, tw, -T - 0.08);
        b.beam(a, c, 0.075, 0.12, M.WOOD);
      }
    }
  }
  // ridge, its end tiles and brass finials
  b.box(-R - 0.3, h - 0.14, -0.3, R + 0.3, h + 0.34, 0.3, M.TILE, { grain: 0, group: g, cell: 1.5 });
  b.box(-R - 0.34, h + 0.34, -0.2, R + 0.34, h + 0.46, 0.2, M.BLACK, { grain: 0, group: g, cell: 1.5 });
  for (const sx of [-1, 1]) {
    b.box(sx * (R + 0.3) - 0.26, h - 0.2, -0.36, sx * (R + 0.3) + 0.26, h + 0.72, 0.36, M.TILE, { group: g, cell: 9 });
    if (!o.lod) giboshi(b, sx * (R + 0.3), h + 0.72, 0, 1.8);
  }
  // one occluder under the slopes shades the floor beneath the eaves
  b.occBox([-W * 0.86, -T, -D * 0.86], [W * 0.86, prof(0.3), D * 0.86], g, true);
}

// ---------------------------------------------------------------- façade: storeys of veranda and room
function storey(b, s) {
  const { W, bays, y, back, glow, lod } = s;
  const top = y + FH - SLAB, e = s.edge ?? 0.4;
  // floor: polished boards from the railing to the back wall, a black edge beam in front
  b.box(-W / 2 - e, y - SLAB, back - 0.2, W / 2 + e, y, 0.6, M.PLANK, { grain: 0 });
  b.box(-W / 2 - e - 0.1 * (e >= 0.4), y - SLAB - 0.16, 0.52, W / 2 + e + 0.1 * (e >= 0.4), y - 0.04, 0.7, M.BLACK, { grain: 0 });
  if (!lod) tatamiFloor(b, -W / 2 + 0.12, W / 2 - 0.12, back + 0.08, -VER - 0.1, y);
  // pillars on the veranda edge and on the shoji line; brackets under the head beam
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + i * BAY;
    b.box(x - 0.16, y, -0.16, x + 0.16, top - 0.44, 0.16, s.pil, { grain: 1 });
    b.box(x - 0.14, y + 0.05, -VER - 0.14, x + 0.14, top, -VER + 0.14, M.WOOD, { grain: 1 });
    if (!lod) {
      b.box(x - 0.2, top - 0.72, -0.2, x + 0.2, top - 0.56, 0.2, M.WOOD, { cell: 9 });
      b.box(x - 0.5, top - 0.56, -0.13, x + 0.5, top - 0.44, 0.13, M.WOOD, { cell: 9 });
    }
  }
  b.box(-W / 2 - Math.min(0.3, e), top - 0.44, -0.18, W / 2 + Math.min(0.3, e), top, 0.18, M.WOOD, { grain: 0 });
  // veranda ceiling joists
  if (!lod) for (let x = -W / 2 + 0.33; x < W / 2; x += 0.66) b.box(x - 0.05, top - 0.13, -VER + 0.14, x + 0.05, top, 0.55, M.WOOD, { grain: 2, cell: 9, occ: false });
  railing(b, -W / 2, W / 2, y, 0.38, { caps: 2, mat: s.rail, lod, points: s.points });
  // a row of lamp points along the eave of the veranda as well
  if (s.points) b.points(-W / 2 + 0.3, W / 2 - 0.3, top - 0.5, 0.2, lod ? 2.0 : 1.0);

  // the shoji line: sill, panels on two tracks, lintel, transom, beam, plaster
  b.box(-W / 2, y, -VER - 0.07, W / 2, y + 0.05, -VER + 0.07, M.WOOD, { grain: 0 });
  for (let i = 0; i < bays; i++) {
    const xa = -W / 2 + i * BAY + 0.14, xb = xa + BAY - 0.28, pw = (xb - xa) / 2;
    const g = glow * (b.chance(0.12) ? 0.05 : b.r(0.65, 1.2));
    const dir = i % 2 ? -1 : 1;
    // the front panel slides across the back one when the doors of the instance open
    b.door = [dir * pw, 0, 0, 0];
    b.box(dir > 0 ? xa : xa + pw, y + 0.05, -VER + 0.005, dir > 0 ? xa + pw : xb, y + DOOR, -VER + 0.045, M.SHOJI, { param: g, grain: 0, cell: 9, occ: false });
    b.door = null;
    b.box(dir > 0 ? xa + pw : xa, y + 0.05, -VER - 0.045, dir > 0 ? xb : xa + pw, y + DOOR, -VER - 0.005, M.SHOJI, { param: g, grain: 0, cell: 9, occ: false });
    b.box(xa, y + DOOR + 0.1, -VER - 0.03, xb, y + DOOR + 0.68, -VER + 0.03, M.RANMA, { param: g * 0.8, grain: 0, cell: 9, occ: false });
    if (g > 0.1) b.light((xa + xb) / 2, y + 1.3, -VER + 0.6, AMBER, 0.9 * g, 6);
  }
  b.box(-W / 2, y + DOOR, -VER - 0.08, W / 2, y + DOOR + 0.1, -VER + 0.08, M.WOOD, { grain: 0 });
  b.box(-W / 2, y + DOOR + 0.68, -VER - 0.09, W / 2, y + DOOR + 0.84, -VER + 0.09, M.WOOD, { grain: 0 });
  b.box(-W / 2, y + DOOR + 0.84, -VER - 0.07, W / 2, top, -VER + 0.07, M.PLASTER, { grain: 0 });

  // the room: gold fusuma along the back, plaster at the ends, a board ceiling, andon on the mats
  b.box(-W / 2, y, back - 0.16, W / 2, top, back, M.PLASTER, { grain: 0 });
  for (let i = 0; i < bays; i++) {
    const xa = -W / 2 + i * BAY + 0.1, xb = xa + BAY - 0.2, pw = (xb - xa) / 2;
    b.box(xa, y + 0.05, back, xa + pw - 0.005, y + DOOR, back + 0.04, M.FUSUMA, { param: s.fusuma, grain: 0, cell: 9, occ: false });
    b.box(xa + pw + 0.005, y + 0.05, back, xb, y + DOOR, back + 0.04, M.FUSUMA, { param: s.fusuma, grain: 0, cell: 9, occ: false });
  }
  b.box(-W / 2, y + DOOR, back, W / 2, y + DOOR + 0.1, back + 0.07, M.WOOD, { grain: 0 });
  for (const sx of [-1, 1]) {
    b.box(sx * W / 2 - 0.08, y, back, sx * W / 2 + 0.08, top, -VER - 0.14, M.PLASTER, { grain: 2 });
    b.box(sx * W / 2 - 0.1, y + DOOR, back, sx * W / 2 + 0.1, y + DOOR + 0.1, -VER - 0.14, M.WOOD, { grain: 2 });
  }
  b.box(-W / 2 + 0.08, top - 0.05, back, W / 2 - 0.08, top, -VER - 0.07, M.WOOD, { grain: 2, occ: false });
  for (let i = 0; i + 1 < bays; i += 2) andon(b, -W / 2 + (i + 1) * BAY + b.r(-0.4, 0.4), y + 0.055, -VER - ROOM * 0.5 + b.r(-0.6, 0.6), glow, lod);
  // chochin along the veranda
  for (let i = 0; i < bays; i++) {
    if (i % 2 === 0 || b.chance(0.3)) b.lantern(-W / 2 + (i + 0.5) * BAY, top - 1.02, 0.02, { cord: 0.6, tint: s.red && b.chance(0.55) ? 1 : 0, glow, lod });
  }
}

function facade(b, o) {
  const W = o.bays * BAY, back = -(VER + ROOM);
  const rail = o.red ? M.LACQUER : M.BLACK, pil = o.red ? M.LACQUER : M.WOOD;
  for (let k = 0; k < o.stories; k++) {
    storey(b, { W, bays: o.bays, y: k * FH, back, pil, rail, red: o.red, lod: o.lod, glow: (o.glow ?? 1) * b.r(0.75, 1.1), fusuma: b.pick([0, 0, 1, 2]) });
  }
  const H = o.stories * FH;
  b.box(-W / 2 - 0.4, H - SLAB, back - 0.2, W / 2 + 0.4, H, 0.6, M.PLANK, { grain: 0 });
  if (o.roof) {
    b.push().at(0, H, back / 2 + 0.2);
    roof(b, W + 3.8, -back + 4.4, 2.4 + W * 0.08, W * 0.5, { lod: o.lod, up: 0.8 });
    b.pop();
  } else {
    railing(b, -W / 2, W / 2, H, 0.38, { caps: 2, mat: rail, lod: o.lod });
    if (!o.lod) for (let i = 1; i < o.bays; i += 3) b.lantern(-W / 2 + i * BAY, H + 1.5, 0.38, { cord: 0, glow: o.glow ?? 1, h: 0.5, r: 0.2 });
  }
}

// ---------------------------------------------------------------- free-standing rooms
function wall(b, len, kind, y, top, glow, o = {}) {
  // one side of a room along x (centred on the origin), outside towards +z; the last post belongs to the next side
  const n = Math.max(1, Math.round(len / BAY)), bw = len / n;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * bw;
    b.box(x - 0.15, y, -0.15, x + 0.15, top, 0.15, o.pil ?? M.WOOD, { grain: 1 });
  }
  if (kind === 'none') return;
  b.box(-len / 2, top - 0.4, -0.17, len / 2, top, 0.17, M.WOOD, { grain: 0 });
  if (kind === 'open') { railing(b, -len / 2, len / 2, y, 0.3, { caps: 2, mat: o.rail ?? M.LACQUER, lod: o.lod }); return; }
  b.box(-len / 2, y, -0.07, len / 2, y + 0.05, 0.07, M.WOOD, { grain: 0 });
  b.box(-len / 2, y + DOOR, -0.08, len / 2, y + DOOR + 0.1, 0.08, M.WOOD, { grain: 0 });
  if (kind === 'plaster') {
    b.box(-len / 2, y + 0.05, -0.07, len / 2, y + DOOR, 0.07, M.PLASTER, { grain: 0 });
    b.box(-len / 2, y + 1.0, -0.09, len / 2, y + 1.12, 0.09, M.WOOD, { grain: 0 });
  } else {
    for (let i = 0; i < n; i++) {
      const xa = -len / 2 + i * bw + 0.15, xb = xa + bw - 0.3, pw = (xb - xa) / 2;
      const fus = kind === 'fusuma', mat = fus ? M.FUSUMA : M.SHOJI;
      const g = fus ? (o.style ?? 0) : glow * (b.chance(0.1) ? 0.05 : b.r(0.7, 1.2));
      const dir = i % 2 ? -1 : 1;
      b.door = [dir * pw, 0, 0, 0];
      b.box(dir > 0 ? xa : xa + pw, y + 0.05, 0.005, dir > 0 ? xa + pw : xb, y + DOOR, 0.045, mat, { param: g, grain: 0, cell: 9, occ: false });
      b.door = null;
      b.box(dir > 0 ? xa + pw : xa, y + 0.05, -0.045, dir > 0 ? xb : xa + pw, y + DOOR, -0.005, mat, { param: g, grain: 0, cell: 9, occ: false });
      if (!fus) {
        b.box(xa, y + DOOR + 0.1, -0.03, xb, y + DOOR + 0.62, 0.03, M.RANMA, { param: g * 0.8, grain: 0, cell: 9, occ: false });
        if (g > 0.1) b.light((xa + xb) / 2, y + 1.3, 0.6, AMBER, 0.85 * g, 6);
      }
    }
  }
  const t0 = kind === 'shoji' ? y + DOOR + 0.62 : y + DOOR + 0.1;
  if (top - 0.4 > t0) b.box(-len / 2, t0, -0.07, len / 2, top - 0.4, 0.07, M.PLASTER, { grain: 0 });
}

function pavilion(b, o) {
  const { w, d } = o, top = FH - SLAB, glow = o.glow ?? 1;
  b.box(-w / 2 - 0.35, -SLAB, -d / 2 - 0.35, w / 2 + 0.35, 0, d / 2 + 0.35, M.PLANK, { grain: 0 });
  if (!o.lod && o.tatami !== false) tatamiFloor(b, -w / 2 + 0.15, w / 2 - 0.15, -d / 2 + 0.15, d / 2 - 0.15, 0);
  b.box(-w / 2 - 0.35, top, -d / 2 - 0.35, w / 2 + 0.35, top + SLAB, d / 2 + 0.35, M.PLANK, { grain: 0 });
  if (!o.lod) {
    // coffered ceiling
    for (let x = -w / 2 + 0.6; x < w / 2 - 0.3; x += 0.6) b.box(x - 0.04, top - 0.1, -d / 2, x + 0.04, top, d / 2, M.BLACK, { grain: 2, cell: 9, occ: false });
    for (let z = -d / 2 + 0.6; z < d / 2 - 0.3; z += 0.6) b.box(-w / 2, top - 0.1, z - 0.04, w / 2, top, z + 0.04, M.BLACK, { grain: 0, cell: 9, occ: false });
  }
  for (let k = 0; k < 4; k++) {
    const len = k % 2 ? d : w, off = k % 2 ? w / 2 : d / 2;
    b.push().ry(k * Math.PI / 2).at(0, 0, off);
    wall(b, len, o.sides[k], 0, top, glow, { lod: o.lod, style: o.style, pil: o.pil, rail: o.rail });
    b.pop();
  }
  // lamps: a line of chochin down the long axis
  const along = w >= d, L = Math.max(w, d), n = Math.max(1, Math.round(L / 4));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (i + 0.5) * L / n;
    b.lantern(along ? t : 0, top - 1.0, along ? 0 : t, { cord: 0.55, glow, lod: o.lod, tint: o.red && i % 2 ? 1 : 0 });
  }
  if (o.roof) {
    b.push().at(0, top + SLAB, 0);
    roof(b, w + 3.4, d + 3.4, 2.0 + Math.min(w, d) * 0.14, Math.abs(w - d) * 0.6 + 0.4, { lod: o.lod });
    b.pop();
  } else if (o.terrace) {
    for (let k = 0; k < 4; k++) {
      const len = k % 2 ? d : w, off = k % 2 ? w / 2 : d / 2;
      b.push().ry(k * Math.PI / 2);
      railing(b, -len / 2, len / 2, top + SLAB, off, { caps: 2, mat: o.rail ?? M.LACQUER, lod: o.lod, skipEnd: true });
      b.pop();
    }
  }
}

// ---------------------------------------------------------------- stairs, bridges, lines
function stair(b, o) {
  const n = o.steps, rise = 0.25, run = 0.3, w = o.w ?? 2.4, L = n * run, H = n * rise;
  const rail = o.rail ?? M.LACQUER;
  for (let i = 0; i < n; i++) {
    b.box(-w / 2, (i + 1) * rise - 0.05, i * run - 0.03, w / 2, (i + 1) * rise, (i + 1) * run + 0.01, M.PLANK, { grain: 0, cell: 9 });
    b.box(-w / 2 + 0.02, i * rise, i * run - 0.03, w / 2 - 0.02, (i + 1) * rise - 0.05, i * run, M.WOOD, { grain: 0, cell: 9, occ: false });
  }
  // stringers and the board underside, along the slope
  for (const sx of [-1, 1]) b.beam([sx * (w / 2 + 0.08), -0.2, -0.15], [sx * (w / 2 + 0.08), H - 0.05, L + 0.05], 0.16, 0.5, M.WOOD);
  b.beam([0, -0.36, -0.1], [0, H - 0.2, L], w, 0.05, M.PLANK, { grain: 2 });
  // posts every third step and the handrail
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 0.1);
    for (let i = 0; i <= n; i += 3) {
      const yy = Math.min(n, i) * rise;
      b.box(x - 0.055, yy, Math.max(0, i * run - 0.15) - 0.05, x + 0.055, yy + 1.02, Math.max(0, i * run - 0.15) + 0.05, rail, { cell: 9, occ: false });
    }
    b.beam([x, 1.0, -0.2], [x, H + 1.0, L - 0.2], 0.1, 0.09, rail);
  }
  // landings
  b.box(-w / 2 - 0.2, -SLAB, -1.8, w / 2 + 0.2, 0, -0.03, M.PLANK, { grain: 0 });
  b.box(-w / 2 - 0.2, H - SLAB, L, w / 2 + 0.2, H, L + 1.8, M.PLANK, { grain: 0 });
  b.push().at(0, H, L + 1.8).ry(Math.PI); railing(b, -w / 2 - 0.1, w / 2 + 0.1, 0, 0.1, { caps: 2, mat: rail }); b.pop();
  b.lantern(0, H * 0.5 - 1.6, L * 0.5, { cord: 0.4, glow: o.glow ?? 1 });
  b.lantern(w / 2 + 0.1, H + 1.55, L + 1.6, { glow: o.glow ?? 1, h: 0.5, r: 0.2 });
}

function bridge(b, o) {
  const L = o.len, w = 3.0, rail = o.rail ?? M.LACQUER;
  if (o.points) b.hex = true;
  b.box(-L / 2, -0.22, -w / 2, L / 2, 0, w / 2, M.PLANK, { grain: 0 });
  for (const sz of [-1, 1]) b.box(-L / 2 - 0.1, -0.62, sz * w / 2 - 0.12, L / 2 + 0.1, -0.04, sz * w / 2 + 0.08, M.BLACK, { grain: 0 });
  for (let x = -L / 2 + 1; x < L / 2; x += 2) b.box(x - 0.12, -0.56, -w / 2, x + 0.12, -0.22, w / 2, M.WOOD, { grain: 2, cell: 9 });
  for (const sz of [-1, 1]) railing(b, -L / 2, L / 2, 0, sz * (w / 2 - 0.12), { caps: 3, mat: rail, step: 1.0, points: o.points, lod: o.lod });
  for (let x = -L / 2 + 3; x < L / 2 - 1; x += 6) b.lantern(x, -1.3, 0, { cord: 0.45, glow: o.glow ?? 1, tint: o.red && (x / 6) % 2 ? 1 : 0 });
}

function lanternLine(b, o) {
  // a rope sagging across the void with lanterns on it
  if (o.hex) b.hex = true;
  const L = o.len, sag = o.sag, n = Math.max(8, Math.round(L / 1.2));
  const yAt = (x) => -sag * (1 - (2 * x / L) ** 2);
  for (let i = 0; i < n; i++) {
    const xa = -L / 2 + L * i / n, xb = -L / 2 + L * (i + 1) / n;
    b.beam([xa, yAt(xa), 0], [xb, yAt(xb), 0], 0.035, 0.035, M.ROPE);
  }
  let k = 0;
  for (let x = -L / 2 + 2; x < L / 2 - 1.5; x += o.gap) b.lantern(x, yAt(x) - 0.75, 0, { cord: 0.38, tint: k++ % 3 === 1 ? 1 : 0 });
}

function frame(b, o) {
  // bare structure: four great posts with tie beams through them, a lantern on every other tie
  const H = o.h, s = o.s / 2, mat = o.red ? M.LACQUER : M.WOOD;
  const corners = [[-s, -s], [s, -s], [-s, s], [s, s]];
  for (const [x, z] of corners) b.box(x - 0.36, 0, z - 0.36, x + 0.36, H, z + 0.36, mat, { grain: 1, cell: 1.2 });
  let k = 0;
  for (let y = 4; y < H - 1; y += 6.5, k++) {
    for (const z of [-s, s]) b.box(-s - 1.1, y, z - 0.18, s + 1.1, y + 0.5, z + 0.18, M.WOOD, { grain: 0 });
    for (const x of [-s, s]) b.box(x - 0.18, y + 0.56, -s - 1.1, x + 0.18, y + 1.06, s + 1.1, M.WOOD, { grain: 2 });
    for (const [x, z] of corners) b.box(x - 0.42, y - 0.08, z - 0.42, x + 0.42, y + 0.04, z + 0.42, M.BRASS, { cell: 9, occ: false });
    if (k % 2 === 0) b.lantern(0, y - 1.05, k % 4 ? s : -s, { cord: 0.6 });
    if (k % 2 === 1) b.lantern(k % 4 === 1 ? s : -s, y - 0.5, 0, { cord: 0.6, tint: 1 });
  }
  // a platform partway up
  const py = Math.floor(H * 0.45);
  b.box(-s - 0.6, py - SLAB, -s - 0.6, s + 0.6, py, s + 0.6, M.PLANK, { grain: 0 });
  for (let q = 0; q < 4; q++) { b.push().ry(q * Math.PI / 2); railing(b, -s - 0.5, s + 0.5, py, s + 0.45, { caps: 2, skipEnd: true }); b.pop(); }
  andon(b, s * 0.4, py, -s * 0.3, 1, false);
}

function tower(b, o) {
  // a pagoda of shoji rooms, each level with its own balcony and roof
  let s = o.size, y = 0;
  const rail = o.rail ?? M.LACQUER;
  for (let k = 0; k < o.levels; k++) {
    const last = k === o.levels - 1, H = 3.5, top = y + H;
    b.box(-s / 2 - 1.1, y - SLAB, -s / 2 - 1.1, s / 2 + 1.1, y, s / 2 + 1.1, M.PLANK, { grain: 0 });
    if (!o.lod) tatamiFloor(b, -s / 2 + 0.15, s / 2 - 0.15, -s / 2 + 0.15, s / 2 - 0.15, y);
    for (let q = 0; q < 4; q++) {
      b.push().ry(q * Math.PI / 2);
      railing(b, -s / 2 - 0.95, s / 2 + 0.95, y, s / 2 + 0.95, { caps: 2, mat: rail, lod: o.lod, skipEnd: true });
      b.at(0, 0, s / 2);
      wall(b, s, q === 1 && k % 2 ? 'fusuma' : 'shoji', y, top, o.glow ?? 1, { lod: o.lod, style: k % 3 });
      b.pop();
    }
    b.box(-s / 2 - 0.15, top, -s / 2 - 0.15, s / 2 + 0.15, top + 0.3, s / 2 + 0.15, M.WOOD);
    b.lantern(0, top - 0.95, 0, { cord: 0.5, lod: o.lod });
    const rw = s + 3.8, rh = last ? 3.4 : 1.6;
    b.push().at(0, top + 0.3, 0);
    roof(b, rw, rw, rh, last ? 0 : 0.6, { lod: o.lod, up: 0.65 });
    b.pop();
    // lanterns hang from the lifted eave corners
    const c = rw / 2 * 1.02 - 0.25;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.lantern(sx * c, top + 0.3 + 0.6 - 0.34 - 0.75, sz * c, { cord: 0.4, lod: o.lod, tint: k % 2 });
    if (last) {
      b.push().at(0, top + 0.3 + rh + 0.4, 0);
      b.lathe([[0.16, 0], [0.16, 0.5], [0.3, 0.55], [0.3, 0.65], [0.1, 0.7], [0.1, 1.4], [0.24, 1.45], [0.24, 1.55], [0.08, 1.6], [0.08, 2.3], [0.2, 2.45], [0.001, 2.9]], 10, M.BRASS);
      b.pop();
    }
    y = top + 1.45;
    s = Math.max(4, s - 1.2);
  }
}

function hall(b, o) {
  // an open floor hanging in the void: polished boards, a grid of pillars carrying beams, a railing all round
  const S = o.s / 2, H = 4.4, step = o.s / 4, pil = o.red ? M.LACQUER : M.WOOD;
  b.box(-S, -SLAB, -S, S, 0, S, M.PLANK, { grain: 0 });
  for (const sz of [-1, 1]) {
    b.box(-S - 0.12, -SLAB - 0.22, sz * S - 0.12, S + 0.12, -0.02, sz * S + 0.12, M.BLACK, { grain: 0 });
    b.box(sz * S - 0.12, -SLAB - 0.22, -S - 0.12, sz * S + 0.12, -0.02, S + 0.12, M.BLACK, { grain: 2 });
  }
  for (let x = -S + step / 2; x < S; x += step) {
    b.box(x - 0.15, -SLAB - 0.5, -S, x + 0.15, -SLAB, S, M.WOOD, { grain: 2 });          // joists under the floor
    b.box(x - 0.2, H - 0.45, -S + 0.3, x + 0.2, H, S - 0.3, M.WOOD, { grain: 2 });        // beams over the pillars
  }
  for (let x = -S + step / 2; x < S; x += step) for (let z = -S + step / 2; z < S; z += step) {
    b.box(x - 0.2, 0, z - 0.2, x + 0.2, H - 0.45, z + 0.2, pil, { grain: 1 });
    if (!o.lod) {
      b.box(x - 0.26, 0, z - 0.26, x + 0.26, 0.12, z + 0.26, M.BLACK, { cell: 9 });
      b.box(x - 0.3, H - 0.62, z - 0.3, x + 0.3, H - 0.45, z + 0.3, M.WOOD, { cell: 9 });
    }
  }
  for (let q = 0; q < 4; q++) { b.push().ry(q * Math.PI / 2); railing(b, -S, S, 0, S - 0.15, { caps: 2, skipEnd: true, lod: o.lod }); b.pop(); }
  let k = 0;
  for (let x = -S + step; x < S - 0.5; x += step) for (let z = -S + step; z < S - 0.5; z += step) {
    if ((k++) % 2 === 0) b.lantern(x, H - 1.6, z, { cord: 0.7, tint: k % 4 === 1 ? 1 : 0, lod: o.lod });
    else andon(b, x, 0, z, 1, o.lod);
  }
}

// ---------------------------------------------------------------- set pieces
function trap(b) {
  // a room the fall passes straight through: a hatch in its roof (door channel 0) and one in its floor (channel 1)
  const S = 6.5, top = 5.0, hw = 2.85, glow = 1.15;
  b.hex = true;
  // floor around the hole, with mats
  b.box(-S, -SLAB, -S, -hw, 0, S, M.PLANK, { grain: 0 });
  b.box(hw, -SLAB, -S, S, 0, S, M.PLANK, { grain: 0 });
  b.box(-hw, -SLAB, -S, hw, 0, -hw, M.PLANK, { grain: 0 });
  b.box(-hw, -SLAB, hw, hw, 0, S, M.PLANK, { grain: 0 });
  tatamiFloor(b, -S + 0.1, S - 0.1, -S + 0.1, S - 0.1, 0, (x, z) => Math.abs(x) < hw && Math.abs(z) < hw);
  // floor hatch: two halves of mats slide apart into the floor
  for (const sx of [-1, 1]) {
    b.door = [sx * (hw + 0.05), 0, 0, 1];
    b.box(sx > 0 ? 0.01 : -hw, -SLAB + 0.02, -hw, sx > 0 ? hw : -0.01, 0, hw, M.PLANK, { grain: 2, occ: false });
    tatamiFloor(b, sx > 0 ? 0.01 : -hw, sx > 0 ? hw : -0.01, -hw, hw, 0);
    b.door = null;
  }
  // roof: boards outside, a coffered ceiling within, its own two-leaf hatch
  const ry = top;
  b.box(-S, ry, -S, -hw, ry + SLAB, S, M.PLANK, { grain: 0 });
  b.box(hw, ry, -S, S, ry + SLAB, S, M.PLANK, { grain: 0 });
  b.box(-hw, ry, -S, hw, ry + SLAB, -hw, M.PLANK, { grain: 0 });
  b.box(-hw, ry, hw, hw, ry + SLAB, S, M.PLANK, { grain: 0 });
  for (const sz of [-1, 1]) {
    b.door = [0, 0, sz * (hw + 0.05), 0];
    b.box(-hw, ry + 0.02, sz > 0 ? 0.01 : -hw, hw, ry + SLAB - 0.02, sz > 0 ? hw : -0.01, M.PLANK, { grain: 0, occ: false });
    b.box(-hw + 0.1, ry + SLAB - 0.02, (sz > 0 ? hw : -0.01) - 0.3, hw - 0.1, ry + SLAB + 0.05, (sz > 0 ? hw : -0.01) - 0.18, M.BRASS, { occ: false, cell: 9 });
    b.door = null;
  }
  for (let x = -S + 0.65; x < S - 0.3; x += 0.65) {
    if (Math.abs(x) < hw + 0.1) continue;
    b.box(x - 0.04, ry - 0.1, -S, x + 0.04, ry, S, M.BLACK, { grain: 2, cell: 9, occ: false });
  }
  for (let z = -S + 0.65; z < S - 0.3; z += 0.65) {
    if (Math.abs(z) < hw + 0.1) continue;
    b.box(-S, ry - 0.1, z - 0.04, S, ry, z + 0.04, M.BLACK, { grain: 0, cell: 9, occ: false });
  }
  // a black frame round each opening
  for (const yy of [0, ry]) {
    for (const s2 of [-1, 1]) {
      b.box(-hw - 0.12, yy - 0.06, s2 * hw - 0.12, hw + 0.12, yy + 0.04, s2 * hw + 0.12, M.BLACK, { grain: 0, occ: false });
      b.box(s2 * hw - 0.12, yy - 0.06, -hw - 0.12, s2 * hw + 0.12, yy + 0.04, hw + 0.12, M.BLACK, { grain: 2, occ: false });
    }
  }
  for (let k = 0; k < 4; k++) {
    b.push().ry(k * Math.PI / 2).at(0, 0, S);
    wall(b, 2 * S, k === 2 ? 'fusuma' : 'shoji', 0, ry, glow, { style: 0, pil: M.LACQUER });
    b.pop();
  }
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.lantern(x, ry - 1.25, z, { cord: 0.75, glow, tint: (x > 0) === (z > 0) ? 1 : 0 });
  andon(b, -S + 0.8, 0.055, S - 0.9, 1, false);
  andon(b, S - 0.8, 0.055, -S + 0.9, 1, false);
  // railing and lamps on the roof, so it reads from above
  for (let q = 0; q < 4; q++) { b.push().ry(q * Math.PI / 2); railing(b, -S, S, ry + SLAB, S - 0.15, { caps: 2, skipEnd: true }); b.pop(); }
  for (const [x, z] of [[-S + 0.3, -S + 0.3], [S - 0.3, S - 0.3]]) b.lantern(x, ry + SLAB + 1.5, z, { h: 0.5, r: 0.2 });
}

function mansion(b) {
  // the Ubuyashiki house: a quiet room lit by the moon through the shoji, until the floor opens
  const S = 5.0, top = 3.3, hw = 1.9;
  b.box(-S, -SLAB, -S, -hw, 0, S, M.PLANK, { grain: 0 });
  b.box(hw, -SLAB, -S, S, 0, S, M.PLANK, { grain: 0 });
  b.box(-hw, -SLAB, -S, hw, 0, -hw, M.PLANK, { grain: 0 });
  b.box(-hw, -SLAB, hw, hw, 0, S, M.PLANK, { grain: 0 });
  tatamiFloor(b, -S + 0.1, S - 0.1, -S + 0.1, S - 0.1, 0, (x, z) => Math.abs(x) < hw && Math.abs(z) < hw);
  for (const sx of [-1, 1]) {
    b.door = [sx * (hw + 0.1), 0, 0, 0];
    b.box(sx > 0 ? 0.01 : -hw, -SLAB + 0.02, -hw, sx > 0 ? hw : -0.01, 0, hw, M.PLANK, { grain: 2, occ: false });
    tatamiFloor(b, sx > 0 ? 0.01 : -hw, sx > 0 ? hw : -0.01, -hw, hw, 0);
    b.door = null;
  }
  b.box(-S - 0.2, top, -S - 0.2, S + 0.2, top + SLAB, S + 0.2, M.PLANK, { grain: 0 });
  for (let x = -S + 0.6; x < S - 0.3; x += 0.6) b.box(x - 0.035, top - 0.09, -S, x + 0.035, top, S, M.BLACK, { grain: 2, cell: 9, occ: false });
  for (let z = -S + 0.6; z < S - 0.3; z += 0.6) b.box(-S, top - 0.09, z - 0.035, S, top, z + 0.035, M.BLACK, { grain: 0, cell: 9, occ: false });
  for (let k = 0; k < 4; k++) {
    b.push().ry(k * Math.PI / 2).at(0, 0, S);
    if (k === 2) wall(b, 2 * S, 'fusuma', 0, top, 1, { style: 3 });
    else {
      // moonlit shoji: negative glow is moonlight
      wall(b, 2 * S, 'shoji', 0, top, -0.5, {});
    }
    b.pop();
  }
  b.lights.length = 0;
  for (let k = 0; k < 4; k++) {
    if (k === 2) continue;
    b.push().ry(k * Math.PI / 2);
    b.light(0, 1.4, S - 1.2, MOON, 0.9, 8);
    b.pop();
  }
  andon(b, -S + 0.9, 0.055, -S + 0.9, 0.45, false);
}

function debris(b, o) {
  if (o.kind === 'shoji') b.box(-0.43, -1.15, -0.02, 0.43, 1.15, 0.02, M.SHOJI, { param: 0.3, grain: 0, cell: 9 });
  if (o.kind === 'fusuma') b.box(-0.43, -1.15, -0.02, 0.43, 1.15, 0.02, M.FUSUMA, { param: b.pick([0, 1, 2]), grain: 0, cell: 9 });
  if (o.kind === 'tatami') b.box(-0.475, -0.03, -0.95, 0.475, 0.03, 0.95, M.TATAMI, { cell: 9 });
  if (o.kind === 'plank') b.box(-1.7, -0.035, -0.12, 1.7, 0.035, 0.12, M.PLANK, { grain: 0, cell: 9 });
  if (o.kind === 'lantern') { b.hex = true; b.lantern(0, 0, 0, { cord: 0.3, power: 1.0 }); }
}

// ---------------------------------------------------------------- the grid: one cell of the castle
export const CELL = 12.6;     // three storeys high, six bays and a joint wide

function frameFace(b, len, h, o = {}) {
  // a closed timber wall along x, outside towards +z: posts every bay, a band at every floor,
  // plaster panels and lit lattice windows between them, lamp points along some of the bands
  const bays = Math.max(1, Math.round(len / BAY)), bw = len / bays;
  const floors = Math.max(1, Math.round(h / FH)), fh = h / floors;
  for (let i = 0; i <= bays; i++) {
    const x = -len / 2 + i * bw;
    b.box(x - 0.13, 0, -0.02, x + 0.13, h, 0.1, M.WOOD, { grain: 1, occ: false, cell: 4 });
  }
  for (let k = 0; k <= floors; k++) {
    const y = k * fh;
    b.box(-len / 2, Math.max(0, y - 0.17), -0.02, len / 2, Math.min(h, y + 0.17), 0.14, M.WOOD, { grain: 0, occ: false, cell: 4 });
    if (o.points && k > 0 && k < floors && b.chance(0.6)) b.points(-len / 2 + 0.6, len / 2 - 0.6, y + 0.3, 0.2, o.lod ? 3.0 : 2.0);
  }
  for (let i = 0; i < bays; i++) for (let k = 0; k < floors; k++) {
    const xa = -len / 2 + i * bw + 0.13, xb = xa + bw - 0.26, y0 = k * fh + 0.17, y1 = (k + 1) * fh - 0.17;
    const u = b.rnd();
    if (u < 0.42) {
      const g = (b.chance(0.25) ? 0.04 : b.r(0.35, 1.0)) * (o.glow ?? 1);
      b.box(xa, y0 + 0.85, -0.02, xb, Math.min(y1 - 0.45, y0 + 2.35), 0.02, M.SHOJI, { param: g, grain: 0, cell: 9, occ: false });
    } else if (u < 0.7) {
      b.box(xa, y0, -0.03, xb, y1, 0.0, M.PLASTER, { grain: 0, cell: 9, occ: false });
    }
  }
}

function closedMass(b, x0, x1, y0, y1, z0, z1, o = {}) {
  // a block of the castle seen from outside: a dark core with framed faces and plank decks
  b.box(x0, y0, z0, x1, y1, z1, M.WOOD, { grain: 1, cell: 6 });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = y1 - y0;
  const faces = o.faces ?? ['f', 'b', 'l', 'r'];
  const place = { f: [cx, z1, 0, x1 - x0], b: [cx, z0, Math.PI, x1 - x0], r: [x1, cz, Math.PI / 2, z1 - z0], l: [x0, cz, -Math.PI / 2, z1 - z0] };
  for (const f of faces) {
    const [px, pz, a, len] = place[f];
    b.push().at(px, y0, pz).ry(a);
    frameFace(b, len, h, o);
    b.pop();
  }
  b.box(x0 - 0.05, y1 - 0.22, z0 - 0.05, x1 + 0.05, y1, z1 + 0.05, M.PLANK, { grain: 0, occ: false, cell: 4 });
  b.box(x0 - 0.05, y0, z0 - 0.05, x1 + 0.05, y0 + 0.22, z1 + 0.05, M.PLANK, { grain: 0, occ: false, cell: 4 });
}

function block(b, o) {
  // one cell: 'face' has three storeys of veranda and rooms towards +z (the open side) and a closed mass behind;
  // 'closed' is the mass all through, for the cells one step back from the open space
  b.hex = true;
  const H = CELL / 2, glow = o.glow ?? 1;
  if (o.kind === 'face') {
    const back = -(VER + ROOM), fz = 5.3;
    const red = b.chance(0.5);
    b.push().at(0, -H, fz);
    for (let k = 0; k < 3; k++) {
      storey(b, { W: 12, bays: 6, y: k * FH, back, pil: red ? M.LACQUER : M.WOOD, rail: red ? M.LACQUER : M.BLACK, red, lod: o.lod,
        glow: glow * b.r(0.4, 1.0), fusuma: b.pick([0, 0, 1, 2]), points: true, edge: 0.25 });
    }
    b.box(-6.25, 3 * FH - SLAB, back - 0.2, 6.25, 3 * FH - 0.03, 0.5, M.PLANK, { grain: 0 });
    b.pop();
    closedMass(b, -6, 6, -H, H, -6, fz + back - 0.2, { lod: o.lod, glow, faces: ['b', 'l', 'r'] });
  } else {
    closedMass(b, -6, 6, -H, H, -6, 6, { lod: o.lod, glow: glow * 0.8, points: true });
  }
}

function deck(b, o) {
  // the top of a cell with open space above it: a railing all round, lamp points, a lantern at each corner
  b.hex = true;
  const S = 6.0;
  for (let q = 0; q < 4; q++) {
    b.push().ry(q * Math.PI / 2);
    railing(b, -S, S, 0, S - 0.15, { caps: 2, skipEnd: true, lod: o.lod, points: true, mat: b.chance(0.5) ? M.LACQUER : M.BLACK });
    b.pop();
  }
  for (const [x, z] of [[-S + 0.3, -S + 0.3], [S - 0.3, S - 0.3], [S - 0.3, -S + 0.3], [-S + 0.3, S - 0.3]]) {
    if (!o.lod) b.box(x - 0.06, 0, z - 0.06, x + 0.06, 1.2, z + 0.06, M.BLACK, { cell: 9, occ: false });
    b.lantern(x, 1.55, z, { h: 0.5, r: 0.2, lod: o.lod });
  }
}

function longStair(b, o) {
  // a long straight flight across the open space, rising along +z; lamp points on both handrails, lanterns hung beneath
  b.hex = true;
  const n = o.steps, rise = 0.25, run = 0.3, w = o.w ?? 3.0, L = n * run, H = n * rise, rail = o.rail ?? M.LACQUER, lod = o.lod;
  if (!lod) {
    for (let i = 0; i < n; i++) {
      b.box(-w / 2, (i + 1) * rise - 0.05, i * run - 0.03, w / 2, (i + 1) * rise, (i + 1) * run + 0.01, M.PLANK, { grain: 0, cell: 9, occ: false });
      b.box(-w / 2 + 0.02, i * rise, i * run - 0.03, w / 2 - 0.02, (i + 1) * rise - 0.05, i * run, M.WOOD, { grain: 0, cell: 9, occ: false });
    }
  } else {
    b.beam([0, rise / 2, 0], [0, H + rise / 2, L], w, 0.12, M.PLANK, { grain: 2 });
  }
  for (const sx of [-1, 1]) b.beam([sx * (w / 2 + 0.09), -0.25, -0.15], [sx * (w / 2 + 0.09), H - 0.1, L + 0.05], 0.18, 0.6, M.BLACK);
  b.beam([0, -0.42, -0.1], [0, H - 0.27, L], w, 0.06, M.PLANK, { grain: 2 });
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 0.1);
    for (let i = 0; i <= n; i += lod ? 24 : 6) {
      b.box(x - 0.05, i * rise, i * run - 0.05, x + 0.05, i * rise + 1.02, i * run + 0.05, rail, { cell: 9, occ: false });
    }
    b.beam([x, 1.0, 0], [x, H + 1.0, L], 0.1, 0.09, rail);
    for (let i = 2; i < n; i += lod ? 10 : 5) {
      const s = lod ? 0.14 : 0.055, y = i * rise + 1.12, z = i * run;
      b.box(x - s, y - s, z - s, x + s, y + s, z + s, M.LANTERN, { param: 3, occ: false, cell: 9 });
    }
  }
  b.box(-w / 2 - 0.2, -SLAB, -2.4, w / 2 + 0.2, 0, -0.03, M.PLANK, { grain: 0 });
  b.box(-w / 2 - 0.2, H - SLAB, L, w / 2 + 0.2, H, L + 2.4, M.PLANK, { grain: 0 });
  for (let i = 20; i < n - 10; i += 42) b.lantern(0, i * rise - 1.9, i * run, { cord: 0.8, lod, glow: o.glow ?? 1 });
}

// ---------------------------------------------------------------- the square stairwell
const WELL_IN = 3.6, WELL_OUT = 6.25;   // the open core is 7.2 m across; the flights run in the band outside it

function wellTurn(b, o) {
  // one turn of the stairwell, two cells high: four flights of 24 steps round the open core, a landing with a
  // lantern at each corner; flight k climbs along one side, and the next starts where it ends
  b.hex = true;
  const IN = WELL_IN, OUT = WELL_OUT, W = OUT - IN, zc = (IN + OUT) / 2, n = 24, H = CELL / 2, rise = H / n, run = 2 * IN / n, lod = o.lod;
  for (let k = 0; k < 4; k++) {
    b.push().ry(k * Math.PI / 2).at(0, k * H, 0);
    if (!lod) {
      for (let i = 0; i < n; i++) {
        const x = -IN + i * run;
        b.box(x - 0.02, (i + 1) * rise - 0.05, IN, x + run + 0.01, (i + 1) * rise, OUT, M.PLANK, { grain: 2, cell: 9, occ: false });
        b.box(x - 0.02, i * rise, IN + 0.02, x, (i + 1) * rise - 0.05, OUT - 0.02, M.WOOD, { grain: 2, cell: 9, occ: false });
      }
    } else {
      b.beam([-IN, rise / 2, zc], [IN, H + rise / 2, zc], W, 0.12, M.PLANK, { grain: 2 });
    }
    // the inner stringer, the boards under the flight, the handrail over the core with its lamp points
    b.beam([-IN, -0.25, IN - 0.08], [IN, H - 0.25, IN - 0.08], 0.16, 0.55, M.BLACK);
    b.beam([-IN, -0.42, zc], [IN, H - 0.42, zc], W, 0.06, M.PLANK, { grain: 2 });
    b.beam([-IN, 1.0, IN + 0.05], [IN, H + 1.0, IN + 0.05], 0.09, 0.08, M.LACQUER);
    for (let i = 0; i <= n; i += lod ? 12 : 4) {
      const x = -IN + i * run;
      b.box(x - 0.045, i * rise, IN, x + 0.045, i * rise + 1.0, IN + 0.1, M.LACQUER, { cell: 9, occ: false });
    }
    for (let i = 2; i < n; i += lod ? 8 : 3) {
      const s = lod ? 0.14 : 0.055, x = -IN + i * run, y = i * rise + 1.12, z = IN + 0.05;
      b.box(x - s, y - s, z - s, x + s, y + s, z + s, M.LANTERN, { param: 3, occ: false, cell: 9 });
    }
    // the landing it climbs to, with a lantern on a post at its inner corner
    b.box(IN, H - 0.3, IN, OUT, H, OUT, M.PLANK, { grain: 0 });
    b.box(IN + 0.35, H, IN + 0.35, IN + 0.45, H + 1.2, IN + 0.45, M.BLACK, { cell: 9, occ: false });
    b.lantern(IN + 0.4, H + 1.55, IN + 0.4, { h: 0.5, r: 0.2, lod });
    b.pop();
  }
}

function wellHatch(b, o) {
  // D3: a lattice floor across the core of the stairwell; its two leaves slide apart under the flights
  b.hex = true;
  const IN = WELL_IN;
  for (const s of [-1, 1]) {
    b.box(-IN - 0.3, -0.3, s * IN - 0.15, IN + 0.3, 0.06, s * IN + 0.15, M.BLACK, { grain: 0 });
    b.box(s * IN - 0.15, -0.3, -IN - 0.3, s * IN + 0.15, 0.06, IN + 0.3, M.BLACK, { grain: 2 });
  }
  for (const sx of [-1, 1]) {
    b.door = [sx * (IN + 0.2), 0, 0, 0];
    const x0 = sx > 0 ? 0.01 : -IN + 0.1, x1 = sx > 0 ? IN - 0.1 : -0.01;
    b.box(x0, -0.03, -IN + 0.1, x1, 0.02, IN - 0.1, M.SHOJI, { param: 0.55, grain: 0, cell: 9, occ: false });
    if (!o.lod) {
      for (let x = x0 + 0.6; x < x1 - 0.1; x += 0.6) b.box(x - 0.03, 0.02, -IN + 0.1, x + 0.03, 0.09, IN - 0.1, M.WOOD, { grain: 2, cell: 9, occ: false });
      for (let z = -IN + 0.7; z < IN - 0.2; z += 0.6) b.box(x0, 0.02, z - 0.03, x1, 0.09, z + 0.03, M.WOOD, { grain: 0, cell: 9, occ: false });
    }
    b.box(sx > 0 ? 0.01 : -0.09, -0.06, -IN + 0.1, sx > 0 ? 0.09 : -0.01, 0.1, IN - 0.1, M.BLACK, { grain: 2, cell: 9, occ: false });
    b.door = null;
  }
  for (const s of [-1, 1]) {
    b.points(-IN, IN, 0.14, s * (IN + 0.3), o.lod ? 2.0 : 0.8);
    b.push().ry(Math.PI / 2);
    b.points(-IN, IN, 0.14, s * (IN + 0.3), o.lod ? 2.0 : 0.8);
    b.pop();
  }
}

// ---------------------------------------------------------------- the atrium
const ATRIUM = 1.5 * CELL + 0.2;          // half the width of an atrium floor: three cells, up to the balconies

function atriumFloor(b, o) {
  // D4: the floor under an atrium, three cells across: boards and mats above, coffers below, an 8 m hatch in the
  // middle whose two leaves slide away under the floor, a railing with lamp points round the hatch
  b.hex = true;
  const S = ATRIUM, h = 4.0, T = 0.6;
  b.box(-S, -T, -S, -h, 0, S, M.PLANK, { grain: 0, cell: 3 });
  b.box(h, -T, -S, S, 0, S, M.PLANK, { grain: 0, cell: 3 });
  b.box(-h, -T, -S, h, 0, -h, M.PLANK, { grain: 0, cell: 3 });
  b.box(-h, -T, h, h, 0, S, M.PLANK, { grain: 0, cell: 3 });
  if (!o.lod) tatamiFloor(b, -S + 1.2, S - 1.2, -S + 1.2, S - 1.2, 0, (x, z) => Math.abs(x) < h + 1.6 && Math.abs(z) < h + 1.6);
  for (let v = -S + 2.1; v < S - 0.5; v += 2.1) {
    if (Math.abs(v) < h + 0.2) continue;
    b.box(v - 0.08, -T - 0.25, -S, v + 0.08, -T, S, M.BLACK, { grain: 2, cell: 9, occ: false });
    b.box(-S, -T - 0.25, v - 0.08, S, -T, v + 0.08, M.BLACK, { grain: 0, cell: 9, occ: false });
  }
  for (const sx of [-1, 1]) {
    b.door = [sx * (h + 0.2), 0, 0, 0];
    b.box(sx > 0 ? 0.01 : -h, -T + 0.05, -h, sx > 0 ? h : -0.01, -0.02, h, M.PLANK, { grain: 2, occ: false });
    if (!o.lod) tatamiFloor(b, sx > 0 ? 0.01 : -h, sx > 0 ? h : -0.01, -h, h, -0.02);
    b.door = null;
  }
  for (let q = 0; q < 4; q++) {
    b.push().ry(q * Math.PI / 2);
    b.box(-h - 0.15, -T - 0.05, h - 0.1, h + 0.15, 0.05, h + 0.15, M.BLACK, { grain: 0, occ: false });
    railing(b, -h - 0.3, h + 0.3, 0, h + 0.45, { caps: 2, skipEnd: true, lod: o.lod, points: true });
    b.pop();
  }
}

function atriumLanterns(b, o) {
  // large hexagonal lanterns hung on cords of every length in the open space of an atrium
  b.hex = true;
  const at = [-12.6, -4.2, 4.2, 12.6];
  for (const x of at) for (const z of at) {
    const cord = b.r(2, 9);
    b.lantern(x, -cord - 0.55, z, { h: 0.95, r: 0.36, cord, glow: 1.2, range: 9, lod: o.lod });
  }
}

// ---------------------------------------------------------------- the red ring ceiling and the void
function ringCeiling(b, o) {
  // the roof of the void, seen from below: rings of red lamps hung from it, each ring lower than the one outside
  // it (a shallow cone), a ring of beams round the middle, and D5, the hatch you fall through, at its centre
  b.hex = true;
  const lod = o.lod, s = lod ? 0.2 : 0.11;
  const drop = (r) => (60 - r) / 12 * 1.5;
  for (const r of [12, 24, 36, 48, 60]) {
    const y = -0.6 - drop(r), n = Math.round(2 * Math.PI * r / 1.15), seg = Math.max(24, Math.round(r * 1.2));
    for (let k = 0; k < seg; k++) {
      const a0 = 2 * Math.PI * k / seg, a1 = 2 * Math.PI * (k + 1) / seg;
      b.beam([Math.cos(a0) * r, y + 0.12, Math.sin(a0) * r], [Math.cos(a1) * r, y + 0.12, Math.sin(a1) * r], 0.08, 0.08, M.BLACK);
      if (k % 4 === 0) b.box(Math.cos(a0) * r - 0.012, y + 0.16, Math.sin(a0) * r - 0.012, Math.cos(a0) * r + 0.012, 0, Math.sin(a0) * r + 0.012, M.ROPE, { occ: false, cell: 9 });
    }
    for (let k = 0; k < n; k += lod ? 2 : 1) {
      const a = 2 * Math.PI * k / n, x = Math.cos(a) * r, z = Math.sin(a) * r;
      b.box(x - s, y - s, z - s, x + s, y + s, z + s, M.LANTERN, { param: 4, occ: false, cell: 9 });
    }
  }
  // the ring of beams that hangs in the middle, with red lamps round it
  const R = 6.5, yr = -0.6 - drop(R);
  for (let k = 0; k < 24; k++) {
    const a0 = 2 * Math.PI * k / 24, a1 = 2 * Math.PI * (k + 1) / 24;
    b.beam([Math.cos(a0) * R, yr, Math.sin(a0) * R], [Math.cos(a1) * R, yr, Math.sin(a1) * R], 0.3, 0.4, M.LACQUER);
    b.box(Math.cos(a0) * R - 0.02, yr, Math.sin(a0) * R - 0.02, Math.cos(a0) * R + 0.02, 0, Math.sin(a0) * R + 0.02, M.ROPE, { occ: false, cell: 9 });
    const x = Math.cos(a0 + 0.13) * R, z = Math.sin(a0 + 0.13) * R;
    b.box(x - s * 1.6, yr - 0.4 - s * 1.6, z - s * 1.6, x + s * 1.6, yr - 0.4 + s * 1.6, z + s * 1.6, M.LANTERN, { param: 4, occ: false, cell: 9 });
  }
  // D5: a frame filling the open cell above, with an 8 m hatch whose two leaves slide away into it
  const C2 = CELL / 2 - 0.1, h = 4.0;
  b.box(-C2, -0.5, -C2, -h, 0, C2, M.PLANK, { grain: 0 });
  b.box(h, -0.5, -C2, C2, 0, C2, M.PLANK, { grain: 0 });
  b.box(-h, -0.5, -C2, h, 0, -h, M.PLANK, { grain: 0 });
  b.box(-h, -0.5, h, h, 0, C2, M.PLANK, { grain: 0 });
  for (const sx of [-1, 1]) {
    b.door = [sx * (h + 0.2), 0, 0, 0];
    b.box(sx > 0 ? 0.01 : -h, -0.45, -h, sx > 0 ? h : -0.01, -0.05, h, M.LACQUER, { grain: 2, occ: false });
    b.door = null;
  }
  for (let q = 0; q < 4; q++) {
    b.push().ry(q * Math.PI / 2);
    b.points(-h, h, -0.62, h + 0.25, lod ? 2.0 : 0.7);
    b.pop();
  }
}

function redPillar(b, o) {
  // a red lacquer pillar many cells high, black bands round it, a string of lamps hung down one side
  b.hex = true;
  const H = o.h, w = 0.45;
  b.box(-w, 0, -w, w, H, w, M.LACQUER, { grain: 1, cell: 4 });
  for (let y = 4.2; y < H; y += 4.2) b.box(-w - 0.06, y - 0.15, -w - 0.06, w + 0.06, y + 0.15, w + 0.06, M.BLACK, { cell: 9, occ: false });
  b.box(w + 0.25, 0, -0.012, w + 0.27, H, 0.012, M.ROPE, { occ: false, cell: 9 });
  const s = o.lod ? 0.15 : 0.06;
  for (let y = 0.6; y < H; y += o.lod ? 2.0 : 1.0) b.box(w + 0.26 - s, y - s, -s, w + 0.26 + s, y + s, s, M.LANTERN, { param: 3, occ: false, cell: 9 });
  for (let y = 8; y < H - 2; y += 16) b.lantern(w + 0.9, y, 0, { h: 0.6, r: 0.24, lod: o.lod });
}

// ---------------------------------------------------------------- Nakime's platform
function nakimePlatform(b, o) {
  // a floor of polished boards hung in the void on four ropes; the apron hatch (D7) under the camera's stop at the
  // origin, a dais of mats where she kneels 4 m behind it, a beam with a row of seven lanterns behind her
  b.hex = true;
  const X = 5, Z0 = -7, Z1 = 5, h = 1.5, T = 0.4;
  b.box(-X, -T, Z0, X, 0, -h, M.PLANK, { grain: 0 });
  b.box(-X, -T, h, X, 0, Z1, M.PLANK, { grain: 0 });
  b.box(-X, -T, -h, -h, 0, h, M.PLANK, { grain: 0 });
  b.box(h, -T, -h, X, 0, h, M.PLANK, { grain: 0 });
  for (const sx of [-1, 1]) {
    b.door = [sx * (h + 0.15), 0, 0, 0];
    b.box(sx > 0 ? 0.01 : -h, -T + 0.05, -h, sx > 0 ? h : -0.01, -0.01, h, M.PLANK, { grain: 2, occ: false });
    b.door = null;
  }
  // black edge beams, joists under the floor, the four ropes it hangs from
  b.box(-X - 0.15, -T - 0.25, Z1 - 0.15, X + 0.15, 0.04, Z1 + 0.05, M.BLACK, { grain: 0 });
  b.box(-X - 0.15, -T - 0.25, Z0 - 0.05, X + 0.15, 0.04, Z0 + 0.15, M.BLACK, { grain: 0 });
  for (const sx of [-1, 1]) b.box(sx * X - 0.1, -T - 0.25, Z0, sx * X + 0.1, 0.04, Z1, M.BLACK, { grain: 2 });
  for (let x = -X + 1.25; x < X; x += 2.5) b.box(x - 0.12, -T - 0.45, Z0, x + 0.12, -T, Z1, M.WOOD, { grain: 2, cell: 9, occ: false });
  for (const [x, z] of [[-X, Z0], [X, Z0], [-X, Z1], [X, Z1]]) b.box(x - 0.03, 0, z - 0.03, x + 0.03, 60, z + 0.03, M.ROPE, { occ: false, cell: 9 });
  // the dais of mats she kneels on
  b.box(-1.2, 0, -5.2, 1.2, 0.12, -2.8, M.PLANK, { grain: 0 });
  if (!o.lod) tatamiFloor(b, -0.95, 0.95, -5.0, -3.1, 0.12);
  // the beam behind her and its lanterns
  for (const sx of [-1, 1]) b.box(sx * (X - 0.3) - 0.15, 0, Z0 + 0.25, sx * (X - 0.3) + 0.15, 3.4, Z0 + 0.55, M.LACQUER, { grain: 1 });
  b.box(-X, 3.1, Z0 + 0.25, X, 3.4, Z0 + 0.55, M.LACQUER, { grain: 0 });
  for (let k = 0; k < 7; k++) b.lantern(-4.2 + k * 1.4, 2.35, Z0 + 0.4, { cord: 0.35, h: 0.66, r: 0.27, glow: 1.2, lod: o.lod });
  // lamp points along the front and the sides
  b.points(-X, X, 0.12, Z1 - 0.1, o.lod ? 2.0 : 0.6);
  for (const sx of [-1, 1]) {
    b.push().at(sx * (X - 0.1), 0, (Z0 + Z1) / 2).ry(Math.PI / 2);
    b.points(-(Z1 - Z0) / 2, (Z1 - Z0) / 2, 0.12, 0, o.lod ? 2.0 : 0.6);
    b.pop();
  }
}

const PIECES = { facade, pavilion, stair, bridge, lanternLine, frame, tower, hall, trap, mansion, debris, block, deck, longStair, wellTurn, wellHatch, atriumFloor, atriumLanterns, ringCeiling, redPillar, nakimePlatform };

// ---------------------------------------------------------------- the library
export const LIB = [
  { name: 'K1', fn: 'block', o: { kind: 'face' } },
  { name: 'K3', fn: 'block', o: { kind: 'closed' } },
  { name: 'KD', fn: 'deck' },
  { name: 'LS4', fn: 'longStair', o: { steps: 168 } },
  { name: 'BR3', fn: 'bridge', o: { len: 3 * CELL, red: true, points: true } },
  { name: 'BR4', fn: 'bridge', o: { len: 4 * CELL, rail: 10, points: true } },
  { name: 'WL', fn: 'wellTurn' },
  { name: 'WH', fn: 'wellHatch' },
  { name: 'AF', fn: 'atriumFloor' },
  { name: 'AL', fn: 'atriumLanterns' },
  { name: 'RC', fn: 'ringCeiling' },
  { name: 'NP', fn: 'nakimePlatform' },
  { name: 'RP', fn: 'redPillar', o: { h: 4 * CELL } },
  { name: 'LL', fn: 'lanternLine', o: { len: 72, sag: 9, gap: 2.4, hex: true } },
  { name: 'trap', fn: 'trap' },
  { name: 'mansion', fn: 'mansion' },
  { name: 'd_shoji', fn: 'debris', o: { kind: 'shoji' } },
  { name: 'd_fusuma', fn: 'debris', o: { kind: 'fusuma' } },
  { name: 'd_tatami', fn: 'debris', o: { kind: 'tatami' } },
  { name: 'd_plank', fn: 'debris', o: { kind: 'plank' } },
  { name: 'd_lantern', fn: 'debris', o: { kind: 'lantern' } },
];
// far away, the same pieces with less in them
for (const n of ['K1', 'K3', 'KD', 'LS4', 'WL', 'AF']) {
  const s = LIB.find((e) => e.name === n);
  LIB.push({ name: n + '~', fn: s.fn, seedOf: n, o: { ...s.o, lod: true } });
}

export function buildPiece(spec) {
  const b = new Builder(hashStr(spec.seedOf ?? spec.name));
  b.lod = !!spec.o?.lod;
  PIECES[spec.fn](b, spec.o ?? {});
  b.bake(spec.bake);
  return b.out(spec.name);
}
