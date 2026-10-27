// Infinity Castle — Mugen-jō. The biwa sounds in the Ubuyashiki house, the floor opens, and you fall into
// Muzan's fortress: an endless shaft of rooms, stairs and lanterns that Nakime refolds at every note.
import * as THREE from 'three';
import { LIB } from './js/kit.js';
import { U, castleMaterial, makeEnv, voidSky, farLamps, dust } from './js/shade.js';
import { Castle, Debris, pathAt, INTRO_Y } from './js/castle.js';
import { Post } from './js/post.js';
import { Score } from './js/sound.js';

// ---------------------------------------------------------------- constants
const params = new URLSearchParams(location.search);
const MAX_PR = Math.min(window.devicePixelRatio || 1, params.has('hq') ? 2 : 1.5);
let pixelRatio = Math.min(MAX_PR, +(params.get('dpr') || 1));
const EYE = 1.55;              // eye height in the Ubuyashiki room
const LAMPS = 6;               // real lights that follow the fall, borrowed from the nearest lanterns
const FALL_SPEED = 17;         // metres per second, by default
const STILL = params.has('still');
let timeScale = +(params.get('timescale') || 1);   // debugging: watch a refold in slow motion

// ---------------------------------------------------------------- helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 1300);
camera.rotation.order = 'YXZ';
const post = new Post(renderer);

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 84 : 70;
  camera.updateProjectionMatrix();
  post.setSize(Math.max(4, Math.floor(innerWidth * pixelRatio)), Math.max(4, Math.floor(innerHeight * pixelRatio)));
  if (motes) far.material.uniforms.uPR.value = pixelRatio;
}

// ---------------------------------------------------------------- the kit: built and lit in workers
const enterBtn = document.getElementById('enter');
const cost = (s) => (s.name[0] === 'T' ? 9 : s.name[0] === 'F' ? 5 : s.name.startsWith('d_') ? 0 : 2) / (s.name.endsWith('~') ? 2 : 1);

async function bakeKit(onProgress) {
  const specs = [...LIB].sort((a, b) => cost(b) - cost(a));
  const out = {};
  let done = 0;
  const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
  try {
    const workers = Array.from({ length: n }, () => new Worker(new URL('./js/bake.worker.js', import.meta.url), { type: 'module' }));
    await new Promise((resolve, reject) => {
      let next = 0;
      const feed = (w) => { if (next < specs.length) w.postMessage({ id: next, spec: specs[next++] }); };
      for (const w of workers) {
        w.onmessage = (e) => {
          out[e.data.r.name] = e.data.r;
          onProgress(++done, specs.length);
          if (done === specs.length) resolve(); else feed(w);
        };
        w.onerror = (err) => reject(err);
        feed(w);
      }
    });
    workers.forEach((w) => w.terminate());
  } catch (err) {
    // no module workers (or a file:// page): bake here, one piece per frame
    console.warn('bake workers unavailable, baking on the main thread', err);
    const { buildPiece } = await import('./js/kit.js');
    for (const s of specs) {
      if (out[s.name]) continue;
      out[s.name] = buildPiece(s);
      onProgress(++done, specs.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}

function toGeometry(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.N, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(r.UV, 4));
  g.setAttribute('aMat', new THREE.BufferAttribute(r.MA, 4));
  g.setAttribute('aLight', new THREE.BufferAttribute(r.LI, 3));
  g.setAttribute('aDoor', new THREE.BufferAttribute(r.DR, 4));
  g.setIndex(new THREE.BufferAttribute(r.I, 1));
  return g;
}

// ---------------------------------------------------------------- scene
let castle, debris, sky, far, motes;
const lamps = [];
const lampList = [];

async function build() {
  const t0 = performance.now();
  const baked = await bakeKit((d, n) => { enterBtn.textContent = `Building rooms ${d} / ${n}`; });
  const pieces = {};
  for (const [name, r] of Object.entries(baked)) pieces[name] = { geo: toGeometry(r), bounds: r.bounds, lights: r.lights };
  const env = makeEnv(renderer);
  castle = new Castle(scene, castleMaterial(env), pieces);
  debris = new Debris(castle);
  sky = voidSky();
  scene.add(sky);
  far = farLamps(9000, 900);
  scene.add(far);
  motes = dust(1500);
  scene.add(motes);
  for (let i = 0; i < LAMPS; i++) {
    const l = new THREE.PointLight(0xffa060, 0, 10, 2);
    scene.add(l);
    lamps.push(l);
  }
  console.info(`castle built in ${(performance.now() - t0).toFixed(0)} ms`);
}

// ---------------------------------------------------------------- the fall
const SHOTS = [
  { pitch: -1.12, rate: 0.1, roll: 0.0, dur: 12 },               // down and ahead: the shaft opening below
  { pitch: -0.36, rate: 0.07, roll: 0.06, dur: 10 },             // across, at the walls rushing up
  { pitch: -1.5, rate: 0.42, roll: 0.0, dur: 9 },                // straight down and turning
  { pitch: 0.82, rate: -0.05, roll: -0.05, dur: 8 },             // back up at what is already gone
  { pitch: -0.85, rate: 0.03, roll: 0.0, dur: 8, tumble: true }, // head over heels, once
];
const ORDER = [0, 1, 2, 0, 3, 1, 4, 2, 1, 0, 3];
const fall = {
  phase: 'room', y: INTRO_Y + EYE, v: 0, vt: FALL_SPEED, slow: 1,
  yaw: +(params.get('yaw') || 0), pitch: +(params.get('pitch') || 0.02), roll: 0, yawRate: 0,
  shotIdx: -1, shot: 0, shotEnd: 0, tumbleAt: -1, shake: 0, manual: params.has('free'),
  strikeAt: Infinity, dropAt: Infinity,
};
const look = { mx: 0, my: 0, yaw: 0, pitch: 0, dragX: 0, dragY: 0 };
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _fwd = new THREE.Vector3();

function nextShot(t) {
  fall.shotIdx = (fall.shotIdx + 1) % ORDER.length;
  fall.shot = ORDER[fall.shotIdx];
  const s = SHOTS[fall.shot];
  fall.shotEnd = t + s.dur * (0.85 + Math.random() * 0.3);
  if (s.tumble) fall.tumbleAt = t + 1.5;
}

function startFalling(t) {
  fall.phase = 'fall';
  fall.shotIdx = -1;
  nextShot(t);
  debris.start(fallPos);
  nextStrike = t + 5;
}

function updateCamera(t, dt) {
  if (fall.phase === 'room') {
    fall.pitch = damp(fall.pitch, 0.02 + Math.sin(t * 0.4) * 0.012, 2, dt);
    if (t >= fall.strikeAt) {
      fall.strikeAt = Infinity;
      castle.intro.doorT[0] = 1;
      strike(t, true);
      fall.dropAt = t + 0.4;
    }
    if (t >= fall.dropAt) { fall.phase = 'drop'; fall.v = 0; }
  } else if (fall.phase === 'drop') {
    // the floor goes and gravity has you; the eyes go down with it
    fall.v = Math.min(fall.v + 9.8 * dt, 26);
    fall.y -= fall.v * dt;
    fall.pitch = damp(fall.pitch, -1.32, 1.5, dt);
    fall.roll = damp(fall.roll, 0.1, 0.8, dt);
    if (fall.y < INTRO_Y - 16) startFalling(t);
  } else {
    fall.v = damp(fall.v, STILL ? 0 : fall.vt * fall.slow, fall.slow < 0.98 ? 5 : 0.8, dt);
    fall.y -= fall.v * dt;
    if (!fall.manual && !STILL) {
      if (t > fall.shotEnd) nextShot(t);
      const s = SHOTS[fall.shot];
      fall.yawRate = damp(fall.yawRate, s.rate, 0.5, dt);
      fall.pitch = damp(fall.pitch, s.pitch, 0.55, dt);
      fall.roll = damp(fall.roll, s.roll + 0.04 * Math.sin(t * 0.31), 0.5, dt);
    } else if (!STILL) {
      fall.yawRate = damp(fall.yawRate, 0, 2, dt);
      fall.pitch = damp(fall.pitch, -0.9, 1, dt);
      fall.roll = damp(fall.roll, 0, 1, dt);
    }
    fall.yaw += fall.yawRate * dt;
  }

  pathAt(fall.y, _p);
  const sway = fall.phase === 'room' ? 0.05 : 0.4;
  camera.position.set(_p.x + Math.sin(t * 0.23) * sway, fall.y, _p.z + Math.cos(t * 0.19) * sway);

  const free = fall.manual;
  look.yaw = damp(look.yaw, -look.mx * (free ? Math.PI : 0.9) - look.dragX, 2.4, dt);
  look.pitch = damp(look.pitch, -look.my * (free ? 1.3 : 0.6) - look.dragY, 2.4, dt);
  const tumble = fall.tumbleAt > 0 ? Math.PI * 2 * smooth(fall.tumbleAt, fall.tumbleAt + 3.6, t) : 0;
  const sh = fall.shake;
  camera.rotation.set(
    fall.pitch + look.pitch - tumble + sh * 0.03 * Math.sin(t * 61),
    fall.yaw + look.yaw + sh * 0.03 * Math.sin(t * 53 + 1),
    fall.roll + sh * 0.04 * Math.sin(t * 47 + 2));
  fall.shake = damp(fall.shake, 0, 3.5, dt);
  fallPos.copy(camera.position);
  if (debugPose) { camera.position.copy(debugPose.p); camera.rotation.set(debugPose.pitch, debugPose.yaw, 0); }
}
let debugPose = null;
const fallPos = new THREE.Vector3();   // where the fall has the camera (a debug pose can move the real one)

// ---------------------------------------------------------------- the biwa
let score = null;
let strikes = 0, nextStrike = Infinity, struckAt = -10, flash = 0, gutter = 0;
const biwaEl = document.getElementById('biwa');
const notesEl = document.getElementById('notes');

// the biwa only sounds when a door opens under you: the floor of the Ubuyashiki room, a trap's roof hatch
function pluck(strength) {
  strikes++;
  score?.biwa(strength);
  biwaEl.classList.add('struck');
  requestAnimationFrame(() => requestAnimationFrame(() => biwaEl.classList.remove('struck')));
  notesEl.textContent = `${strikes} ${strikes === 1 ? 'note' : 'notes'}`;
}

function strike(t, intro = false) {
  struckAt = t;
  flash = 1;
  gutter = 1;
  fall.shake = intro ? 0.7 : 1;
  const res = intro ? { moved: 0, doors: 0 } : castle.strike(camera.position, t);
  if (intro) pluck(1.1);
  if (score) {
    const slides = Math.min(6, Math.ceil(res.doors / 4));
    for (let i = 0; i < slides; i++) score.slide(0.08 + Math.random() * 0.4, Math.random() * 1.6 - 0.8);
    if (res.moved) score.thud(0.12, Math.min(0.45, 0.15 + res.moved * 0.03));
    if (intro) { score.slide(0.05, -0.3); score.slide(0.08, 0.3); }
  }
}

// ---------------------------------------------------------------- input
let live = false;
let dragging = null;
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    look.mx = (e.clientX / innerWidth) * 2 - 1;
    look.my = (e.clientY / innerHeight) * 2 - 1;
  } else if (dragging) {
    look.dragX += (e.clientX - dragging.x) / innerWidth * 2.4;
    look.dragY = clamp(look.dragY + (e.clientY - dragging.y) / innerHeight * 1.8, -1.2, 1.2);
    dragging.moved += Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y);
    dragging.x = e.clientX; dragging.y = e.clientY;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') dragging = { x: e.clientX, y: e.clientY, moved: 0 };
  else if (live && fall.phase === 'fall') strike(t);
});
addEventListener('pointerup', () => {
  if (dragging && dragging.moved < 8 && live && fall.phase === 'fall') strike(t);
  dragging = null;
});
addEventListener('wheel', (e) => { fall.vt = clamp(fall.vt - e.deltaY * 0.02, 3, 48); }, { passive: true });
addEventListener('keydown', (e) => {
  if (!live) return;
  if (e.key === 'ArrowUp') { fall.vt = clamp(fall.vt - 3, 3, 48); e.preventDefault(); }
  else if (e.key === 'ArrowDown') { fall.vt = clamp(fall.vt + 3, 3, 48); e.preventDefault(); }
  else if (e.key === ' ') { if (fall.phase === 'fall') strike(t); e.preventDefault(); }
  else if (e.key === 'c' || e.key === 'C') toggleCamera();
  else if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') document.body.classList.toggle('nohud');
});

const muteBtn = document.getElementById('mute');
muteBtn.addEventListener('click', () => {
  if (!score) return;
  score.setMuted(!score.muted);
  muteBtn.textContent = score.muted ? 'Sound off' : 'Sound on';
  muteBtn.setAttribute('aria-pressed', String(score.muted));
  muteBtn.blur();
});
const camBtn = document.getElementById('camBtn');
function toggleCamera() {
  fall.manual = !fall.manual;
  camBtn.textContent = fall.manual ? 'Camera: free' : 'Camera: cinematic';
  camBtn.setAttribute('aria-pressed', String(fall.manual));
}
camBtn.addEventListener('click', () => { toggleCamera(); camBtn.blur(); });
document.getElementById('hide').addEventListener('click', (e) => {
  document.body.classList.add('nohud');
  e.currentTarget.blur();
});
addEventListener('pointerdown', (e) => {
  if (document.body.classList.contains('nohud') && !e.target.closest('#veil')) document.body.classList.remove('nohud');
});

// ---------------------------------------------------------------- HUD
const depthEl = document.getElementById('depth');
const rateEl = document.getElementById('rate');
let hudTimer = 0;
function updateHud(dt) {
  hudTimer += dt;
  if (hudTimer < 0.1) return;
  hudTimer = 0;
  const fallen = Math.max(0, INTRO_Y + EYE - fall.y);
  depthEl.innerHTML = `${Math.floor(fallen).toLocaleString('en-US')} <small>m</small>`;
  rateEl.textContent = `${fall.v.toFixed(0)} m/s${fall.slow < 0.9 ? ' · through a room' : ''}`;
}

// ---------------------------------------------------------------- adaptive resolution
let frameAvg = 1 / 60, perfClock = 0, goodFor = 0;
function adapt(dt) {
  frameAvg += (dt - frameAvg) * 0.05;
  perfClock += dt;
  if (perfClock < 1.5) return;
  perfClock = 0;
  if (frameAvg > 1 / 42 && pixelRatio > 0.5) {
    pixelRatio = Math.max(0.5, pixelRatio * 0.85);
    goodFor = 0;
    resize();
  } else if (frameAvg < 1 / 57) {
    goodFor += 1;
    if (goodFor >= 3 && pixelRatio < MAX_PR) {
      pixelRatio = Math.min(MAX_PR, pixelRatio * 1.1);
      goodFor = 0;
      resize();
    }
  } else goodFor = 0;
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let t = 0, fadeIn = 0;
let drawn = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1) * timeScale;
  t += dt;
  U.uTime.value = t;

  updateCamera(t, dt);
  castle.update(fall.y);
  fall.slow = castle.tick(t, dt, fall.y);
  for (const tr of castle.traps) {
    if (tr.doorT[0] && !tr.heard0) {
      tr.heard0 = true; score?.slide(0, 0); score?.knock(0.22, 0.2);
      if (live && fall.phase === 'fall') pluck(0.95);
    }
    if (tr.doorT[1] && !tr.heard1) { tr.heard1 = true; score?.slide(0, 0.2); score?.knock(0.2, 0.2, -0.2); }
  }
  debris.update(dt, fallPos, fall.slow);
  if (live && fall.phase === 'fall' && !STILL && t > nextStrike) {
    strike(t);
    nextStrike = t + 7 + Math.random() * 5;
  }
  camera.updateMatrixWorld();
  drawn = castle.pack(camera);

  // the real lights: the lanterns nearest where the camera is about to be
  _v.copy(camera.position).y -= fall.v * 0.3;
  castle.lamps(_v, LAMPS, lampList);
  for (let i = 0; i < LAMPS; i++) {
    const l = lamps[i], c = lampList[i];
    if (!c) { l.intensity = 0; continue; }
    l.position.set(c.x, c.y, c.z);
    l.color.setRGB(c.r, c.g, c.b);
    l.intensity = c.p * 1.4 * c.w * U.uGlow.value;
    l.distance = c.range * 1.3;
  }

  // the biwa: a flash, a shock ring, lamps guttering and coming back
  flash = damp(flash, 0, 7, dt);
  gutter = damp(gutter, 0, 2.2, dt);
  U.uGlow.value = 1 - 0.45 * gutter * smooth(0.0, 0.08, t - struckAt);
  const cu = post.composite.uniforms;
  cu.uFlash.value = flash;
  const sk = (t - struckAt) / 0.9;
  cu.uShock.value = sk > 0 && sk < 1 ? sk : 0;
  cu.uTime.value = t;

  // the smear of the fall, centred on the point we fall towards (or away from)
  camera.getWorldDirection(_fwd);
  const down = _fwd.y <= 0;
  _v.copy(camera.position).y += down ? -1000 : 1000;
  _v.project(camera);
  let cx = _v.x * 0.5 + 0.5, cy = _v.y * 0.5 + 0.5;
  const off = Math.hypot(cx - 0.5, cy - 0.5);
  const norm = Math.max(1, off / 0.9);
  cx = 0.5 + (cx - 0.5) / norm; cy = 0.5 + (cy - 0.5) / norm;
  cu.uCenter.value.set(cx, cy);
  cu.uBlur.value = clamp(fall.v * 0.0017, 0, 0.09) * (0.35 + 0.65 * Math.abs(_fwd.y)) / norm;

  sky.position.copy(camera.position);
  far.material.uniforms.uCamY.value = camera.position.y;
  motes.material.uniforms.uCam.value.copy(camera.position);
  motes.material.uniforms.uStreak.value = 0.15 + fall.v * 0.045;
  if (score) score.setFall(fall.phase === 'room' ? 0 : fall.v, dt);

  updateHud(dt);
  fadeIn = live ? Math.min(1, fadeIn + dt / 2.0) : Math.min(0.4, fadeIn + dt / 3);
  cu.uFade.value = fadeIn * fadeIn;
  post.render(scene, camera);
  if (!params.has('fixed')) adapt(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
function enter(withSound) {
  if (live) return;
  if (withSound) { try { score = new Score(); score.start(); } catch (err) { score = null; } }
  live = true;
  document.getElementById('veil').classList.add('gone');
  document.body.classList.add('live');
  enterBtn.blur();
  if (params.has('y')) {
    // start already deep in the castle (for looking around)
    fall.y = +params.get('y');
    castle.intro.doorT[0] = 1;
    startFalling(t);
  } else if (!params.has('hold')) fall.strikeAt = t + 1.6;
}

await build();
resize();
addEventListener('resize', resize);
castle.update(fall.y);
camera.updateMatrixWorld();
castle.pack(camera);
enterBtn.textContent = 'Lighting the lamps';
const tc = performance.now();
await post.warm(scene, camera).catch((err) => console.warn('shader warm-up failed', err));
console.info(`shaders compiled in ${(performance.now() - tc).toFixed(0)} ms`);
enterBtn.disabled = false;
enterBtn.textContent = 'Fall';
enterBtn.addEventListener('click', () => enter(true));
requestAnimationFrame(frame);
// ?auto skips the veil (no sound): handy for screenshots and kiosks
if (params.has('auto')) enter(false);

// debug hooks for tuning from the console
window.__ic = { castle, camera, fall, U, post, scene, renderer, strike: () => strike(t), lamps, slowmo: (s) => { timeScale = s; }, pose: (x, y, z, pitch = 0, yaw = 0) => { debugPose = { p: new THREE.Vector3(x, y, z), pitch, yaw }; }, get drawn() { return drawn; }, get t() { return t; } };
