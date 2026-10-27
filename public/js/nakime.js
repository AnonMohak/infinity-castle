// Infinity Castle — Nakime. The only figure in the piece, and the only hand-drawn thing in it: a painted card
// kneeling on her platform at the bottom of the void. Her bangs part (the hair is pushed aside in the card's
// shader), and behind them a second card with her face opens its single eye. Then she strikes, and the floor goes.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

const HEIGHT = 1.45;    // the card, kneeling, in metres
// where her face is on the card (u0, v0, u1, v1, v up), and where the eye sits in it
const FACE = new THREE.Vector4(0.405, 0.735, 0.557, 0.815);
const EYE = { x: 0.5, y: 0.44, rx: 0.36, ry: 0.21 };     // in the face card's own uv

// her face behind the bangs: grey skin, and the eye, shut or open, with 肆 in the iris
function faceCanvas(open) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const skin = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.7);
  skin.addColorStop(0, '#948d93'); skin.addColorStop(1, '#565056');
  g.fillStyle = skin; g.fillRect(0, 0, S, S);
  const ex = EYE.x * S, ey = (1 - EYE.y) * S, rx = EYE.rx * S, ry = EYE.ry * S;
  // dark veins round the eye
  g.strokeStyle = 'rgba(52, 36, 50, 0.75)'; g.lineWidth = 2;
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2 + 0.2, r0 = 1.05, r1 = 1.6 + (k % 3) * 0.25;
    g.beginPath();
    g.moveTo(ex + Math.cos(a) * rx * r0, ey + Math.sin(a) * ry * r0 * 1.6);
    g.quadraticCurveTo(ex + Math.cos(a + 0.2) * rx * (r0 + r1) / 2, ey + Math.sin(a + 0.2) * ry * 2.2, ex + Math.cos(a) * rx * r1, ey + Math.sin(a) * ry * r1 * 1.7);
    g.stroke();
  }
  if (!open) {
    g.strokeStyle = '#1a1214'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(ex - rx, ey); g.quadraticCurveTo(ex, ey + ry * 0.8, ex + rx, ey); g.stroke();
    return c;
  }
  g.save();
  g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#efe4e6'; g.fillRect(0, 0, S, S);
  const iris = g.createRadialGradient(ex, ey, 2, ex, ey, ry * 1.05);
  iris.addColorStop(0, '#f2a9c4'); iris.addColorStop(0.7, '#d4688f'); iris.addColorStop(1, '#7a2a48');
  g.fillStyle = iris; g.beginPath(); g.arc(ex, ey, ry * 1.05, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b0f1a';
  g.font = `bold ${Math.round(ry * 1.15)}px "Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('肆', ex, ey + 1);
  g.restore();
  g.strokeStyle = '#140c0e'; g.lineWidth = 6;
  g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, Math.PI, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI); g.stroke();
  return c;
}

export class Nakime {
  constructor(scene, map) {
    map.colorSpace = THREE.SRGBColorSpace;
    const aspect = map.image.width / map.image.height, W = HEIGHT * aspect;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.part = 0; this.open = 0; this.strikeAt = -10;

    // the painted figure; inside the face box the bangs are pushed to the sides as uPart rises
    this.figure = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: map }, uPart: { value: 0 }, uFace: { value: FACE }, uLight: { value: 1 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform float uPart, uLight; uniform vec4 uFace;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          if (uPart > 0.0 && uv.x > uFace.x && uv.x < uFace.z && uv.y > uFace.y && uv.y < uFace.w) {
            float cx = 0.5 * (uFace.x + uFace.z), hw = 0.5 * (uFace.z - uFace.x);
            float vy = (uv.y - uFace.y) / (uFace.w - uFace.y);
            // the bangs part in a V: a narrow line at the hairline, open wide by the chin
            float g = uPart * hw * (0.2 + 0.7 * (1.0 - vy)) * smoothstep(0.0, 0.08, vy) * (1.0 - smoothstep(0.92, 1.0, vy));
            g *= 0.88 + 0.12 * sin(uv.x * 900.0 + vy * 7.0);       // the parting is ragged, strand by strand
            float d = uv.x - cx;
            if (abs(d) < g) discard;
            uv.x = cx + sign(d) * (abs(d) - g) * hw / max(hw - g, 1e-3);
          }
          vec4 c = texture2D(tMap, uv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb * vec3(1.06, 0.9, 0.78) * uLight, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const fig = new THREE.Mesh(new THREE.PlaneGeometry(W, HEIGHT).translate(0, HEIGHT / 2, 0), this.figure);
    this.group.add(fig);

    // her face, a hair's breadth behind the figure: the eye opens from a slit
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    this.face = new THREE.ShaderMaterial({
      uniforms: { tShut: { value: tex(faceCanvas(false)) }, tOpen: { value: tex(faceCanvas(true)) }, uOpen: { value: 0 }, uLight: { value: 1 }, uEye: { value: new THREE.Vector2(EYE.y, EYE.ry) } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tShut, tOpen; uniform float uOpen, uLight; uniform vec2 uEye;
        varying vec2 vUv;
        void main() {
          float lid = step(abs(vUv.y - uEye.x), uOpen * uEye.y * 1.05);
          vec3 c = mix(texture2D(tShut, vUv).rgb, texture2D(tOpen, vUv).rgb, lid);
          // an oval face; round it, the shadow of her hair
          vec2 q = (vUv - vec2(0.5, 0.25)) / vec2(0.47, 0.8);
          float face = 1.0 - smoothstep(0.82, 1.0, length(q));
          c = mix(vec3(0.03, 0.025, 0.028), c, face);
          gl_FragColor = vec4(c * vec3(1.04, 0.92, 0.84) * uLight, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const fw = (FACE.z - FACE.x) * W, fh = (FACE.w - FACE.y) * HEIGHT;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), this.face);
    face.position.set(((FACE.x + FACE.z) / 2 - 0.5) * W, (FACE.y + FACE.w) / 2 * HEIGHT, -0.015);
    this.group.add(face);
  }

  // kneel at a point on the platform, facing +z
  place(p) { this.group.position.copy(p); this.base = p.clone(); this.group.visible = true; }
  hide() { this.group.visible = false; }

  update(t, glow) {
    if (!this.group.visible) return;
    this.figure.uniforms.uPart.value = this.part;
    this.face.uniforms.uOpen.value = this.open;
    this.figure.uniforms.uLight.value = this.face.uniforms.uLight.value = 0.75 + 0.25 * glow;
    // the strike: the whole figure jolts and settles
    const k = t - this.strikeAt, j = k > 0 && k < 1 ? Math.exp(-k * 6) : 0;
    this.group.position.x = this.base.x + Math.sin(k * 55) * 0.02 * j;
    this.group.position.y = this.base.y - 0.015 * j;
  }
}

// the 18 seconds in front of her: slow to a stop at her eye height, hang, the bangs part and the eye opens,
// she strikes, the floor opens and the fall goes on
export class Moment {
  constructor(nakime) { this.n = nakime; this.on = false; }

  begin(t, fall, platform) {
    this.on = true; this.t0 = t; this.p = platform;
    this.y0 = fall.y; this.last = fall.y;
    this.pulse = this.struck = this.opened = false;
    // turn towards her (she is at -z) the short way round
    this.yaw = Math.round(fall.yaw / (Math.PI * 2)) * Math.PI * 2;
    this.n.place(platform.cardAt);
    this.n.part = 0; this.n.open = 0;
  }

  // false once the floor has opened under you
  step(t, dt, fall, ev) {
    const s = t - this.t0, P = this.p;
    const u = smooth(0, 5, s), y = this.y0 + (P.stopY - this.y0) * (1 - (1 - u) ** 2);
    fall.y = s < 5 ? y : P.stopY + 0.03 * Math.sin((s - 5) * 1.1);
    fall.v = Math.max(0, (this.last - fall.y) / Math.max(dt, 1e-3));
    this.last = fall.y;
    fall.pitch = damp(fall.pitch, -0.03, 1.4, dt);
    fall.roll = damp(fall.roll, 0, 1.4, dt);
    fall.yawRate = 0;
    fall.yaw = damp(fall.yaw, this.yaw, 1.1, dt);
    fall.dz = 1.0 - smooth(5, 9, s);                 // she comes a metre closer as the camera hangs
    fall.zoom = smooth(4.5, 9.5, s) * (1 - smooth(13.8, 14.7, s));   // and the lens closes in on her
    this.n.part = smooth(9, 10.8, s);
    this.n.open = smooth(10.5, 11.6, s);
    if (s >= 9 && !this.pulse) { this.pulse = true; ev.pulse(); }
    if (s >= 12.4 && !this.struck) { this.struck = true; this.n.strikeAt = t; ev.strike(); }
    if (s >= 14 && !this.opened) { this.opened = true; P.doorT[0] = 1; ev.open(); }
    if (s >= 14.7) { this.on = false; fall.dz = 0; fall.zoom = 0; return false; }
    return true;
  }
}
