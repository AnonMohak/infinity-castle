// Infinity Castle — post-processing: bloom, the radial smear of the fall, the shock of a biwa note,
// chromatic fringes, and a grade that keeps the shadows deep and the lamps amber.
import * as THREE from 'three';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLOOM_LEVELS = 6;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const fsGeo = new THREE.BufferGeometry();
    fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsMesh = new THREE.Mesh(fsGeo);
    this.fsMesh.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.fsMesh);

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.rtDown = Array.from({ length: BLOOM_LEVELS }, () => new THREE.WebGLRenderTarget(4, 4, rtOpts));
    this.rtUp = Array.from({ length: BLOOM_LEVELS - 1 }, () => new THREE.WebGLRenderTarget(4, 4, rtOpts));

    this.prefilter = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
        varying vec2 vUv;
        vec3 tap(vec2 o) { return min(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(30.0)); }
        void main() {
          vec3 c = tap(vec2(0.0)) * 4.0 + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
          c /= 8.0;
          float l = max(c.r, max(c.g, c.b));
          float knee = uThreshold * 0.6;
          float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee + 1e-4);
          float w = max(soft, l - uThreshold) / max(l, 1e-4);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
    });
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          gl_FragColor = vec4(c / 8.0, 1.0);
        }`,
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec2 t = uTexel;
          vec3 c = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * t).rgb + texture2D(tSrc, vUv + vec2(2.0, 0.0) * t).rgb
                 + texture2D(tSrc, vUv + vec2(0.0, -2.0) * t).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0) * t).rgb;
          c += 2.0 * (texture2D(tSrc, vUv + vec2(-1.0, -1.0) * t).rgb + texture2D(tSrc, vUv + vec2(1.0, -1.0) * t).rgb
                    + texture2D(tSrc, vUv + vec2(-1.0, 1.0) * t).rgb + texture2D(tSrc, vUv + vec2(1.0, 1.0) * t).rgb);
          gl_FragColor = vec4(c / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);
        }`,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uBlur: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uExposure: { value: 0.78 }, uBloom: { value: 0.55 }, uFade: { value: 0 }, uFlash: { value: 0 }, uShock: { value: 0 },
        uShaft: { value: 0 }, uShaftPos: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tScene, tBloom;
        uniform float uTime, uBlur, uExposure, uBloom, uFade, uFlash, uShock, uShaft;
        uniform vec2 uRes, uCenter, uShaftPos;
        varying vec2 vUv;
        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 dc = vUv - 0.5;
          float asp = uRes.x / uRes.y;
          // the note of the biwa: a ring of bent air running out from the centre
          float rr = length(dc * vec2(asp, 1.0));
          float ring = uShock > 0.0 && uShock < 1.0 ? exp(-pow((rr - uShock * 1.3) * 7.0, 2.0)) * (1.0 - uShock) : 0.0;
          vec2 uv = vUv - dc * ring * 0.035;
          float r2 = dot(dc, dc);
          vec2 ca = dc * (0.0012 + 0.005 * r2 + 0.0045 * uFlash + 0.006 * ring);
          // the fall: smear everything away from the point we fall towards
          vec2 fc = uv - uCenter;
          vec3 col = vec3(0.0);
          if (uBlur > 0.002) {
            for (int i = 0; i < 8; i++) {
              float s = 1.0 - uBlur * (float(i) + hash(vUv * uRes + float(i))) / 8.0;
              vec2 p = uCenter + fc * s;
              col += vec3(texture2D(tScene, p - ca).r, texture2D(tScene, p).g, texture2D(tScene, p + ca).b);
            }
            col /= 8.0;
          } else {
            col = vec3(texture2D(tScene, uv - ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv + ca).b);
          }
          col += texture2D(tBloom, uv).rgb * uBloom;
          // light shafts: the glow smeared out of the bright core below, through the gaps of the lattice
          if (uShaft > 0.001) {
            vec2 st = (uShaftPos - uv) / 12.0;
            vec2 q = uv + st * hash(vUv * uRes);
            vec3 acc = vec3(0.0);
            float w = 1.0;
            for (int i = 0; i < 12; i++) { acc += texture2D(tBloom, q).rgb * w; q += st; w *= 0.91; }
            col += acc / 12.0 * uShaft * vec3(1.0, 0.82, 0.62);
          }
          col *= uExposure * (1.0 + 0.35 * uFlash);
          col *= vec3(1.14, 0.9, 0.76);          // the whole castle a warmer, redder light
          col = aces(col);
          // split tone: deep red shadows, red-amber light
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(col, col * vec3(1.12, 0.84, 0.82), (1.0 - smoothstep(0.0, 0.22, l)) * 0.55);
          col = mix(col, col * vec3(1.1, 0.94, 0.8), smoothstep(0.3, 0.9, l) * 0.45);
          col = mix(vec3(l), col, 1.06);
          float vig = smoothstep(1.2, 0.25, length(dc * vec2(asp, 1.0)));
          col *= mix(0.42, 1.0, vig);
          col = pow(max(col, 0.0), vec3(1.0 / 2.2));
          col += (hash(vUv * uRes + fract(uTime * 13.7) * 91.0) - 0.5) * 0.022;
          col *= uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  // compile every pass up front, so the first frames after the veil do not stutter
  // (programs depend on the target they draw into, so each is compiled against its own)
  async warm(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    await r.compileAsync(scene, camera);
    for (const m of [this.prefilter, this.down, this.up, this.composite]) {
      this.fsMesh.material = m;
      r.setRenderTarget(m === this.composite ? null : this.rtDown[0]);
      await r.compileAsync(this.fsScene, this.fsCam);
    }
    r.setRenderTarget(null);
  }

  pass(mat, target) {
    this.fsMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  setSize(w, h) {
    this.rtScene.setSize(w, h);
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.rtDown[i].setSize(Math.max(2, bw), Math.max(2, bh));
      if (i < BLOOM_LEVELS - 1) this.rtUp[i].setSize(Math.max(2, bw), Math.max(2, bh));
      bw >>= 1; bh >>= 1;
    }
    this.composite.uniforms.uRes.value.set(w, h);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    const pf = this.prefilter.uniforms;
    pf.tSrc.value = this.rtScene.texture;
    pf.uTexel.value.set(1 / this.rtScene.width, 1 / this.rtScene.height);
    this.pass(this.prefilter, this.rtDown[0]);
    for (let i = 1; i < BLOOM_LEVELS; i++) {
      this.down.uniforms.tSrc.value = this.rtDown[i - 1].texture;
      this.down.uniforms.uTexel.value.set(1 / this.rtDown[i - 1].width, 1 / this.rtDown[i - 1].height);
      this.pass(this.down, this.rtDown[i]);
    }
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const src = i === BLOOM_LEVELS - 2 ? this.rtDown[BLOOM_LEVELS - 1] : this.rtUp[i + 1];
      this.up.uniforms.tSrc.value = src.texture;
      this.up.uniforms.tAdd.value = this.rtDown[i].texture;
      this.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.up, this.rtUp[i]);
    }
    const cu = this.composite.uniforms;
    cu.tScene.value = this.rtScene.texture;
    cu.tBloom.value = this.rtUp[0].texture;
    this.pass(this.composite, null);
  }
}
