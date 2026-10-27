// Infinity Castle — sound, all made live with the Web Audio API: Nakime's biwa (plucked strings with the
// buzz of the sawari bridge), the wind of the fall, shoji slamming, rooms grinding into place, a low pulse. Near silence
// otherwise: no music, no drone; the biwa sounds only when a door opens under you.

function noiseBuffer(ctx, sec) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export class Score {
  constructor() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004;
    this.master.connect(comp).connect(ctx.destination);
    // a hall without walls: long and dark
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(6.5);
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    this.verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 0.9;
    this.send.connect(this.verb);
    this.noise = noiseBuffer(ctx, 4);
    // E2, A2, B2, D3, E3: the open courses Nakime strikes
    this.notes = [82.41, 110.0, 123.47, 146.83, 164.81].map((f) => this.biwaBuffer(f, 4.2));
    this.muted = false;
    this.lastNote = -1;
  }

  impulse(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const pre = Math.floor(ctx.sampleRate * 0.035);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        lp += ((Math.random() * 2 - 1) - lp) * (0.5 - 0.42 * t);
        d[i] = lp * Math.pow(1 - t, 2.6) * Math.min(1, (i - pre) / 600);
      }
    }
    return buf;
  }

  // Karplus-Strong with a one-sided clip in the loop: the string slaps the flat bridge and buzzes
  biwaBuffer(f0, dur) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(2, n, sr);
    const out = new Float32Array(n);
    const courses = [[f0, 1.0, 0, 0.986], [f0 * 1.498, 0.55, 0.009, 0.984], [f0 * 2.0, 0.42, 0.017, 0.98]];
    for (const [f, amp, delay, loss] of courses) {
      const len = Math.max(4, Math.round(sr / f));
      const line = new Float32Array(len);
      // the bachi hits hard and near the bridge: a bright, uneven burst
      for (let i = 0; i < len; i++) line[i] = (Math.random() * 2 - 1) * (i < len * 0.18 ? 1.0 : 0.45);
      let idx = 0;
      for (let i = Math.floor(delay * sr); i < n; i++) {
        const a = line[idx], b = line[(idx + 1) % len];
        let y = 0.5 * (a + b) * loss;
        if (y > 0.2) y = 0.2 + (y - 0.2) * 0.3;
        line[idx] = y;
        out[i] += a * amp;
        idx = (idx + 1) % len;
      }
    }
    // remove the DC the clip leaves behind, normalise, a slight stereo spread
    let prevX = 0, prevY = 0, peak = 1e-6;
    for (let i = 0; i < n; i++) {
      const y = out[i] - prevX + 0.995 * prevY;
      prevX = out[i]; prevY = y; out[i] = y;
      peak = Math.max(peak, Math.abs(y));
    }
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const fade = i > n - 2000 ? (n - i) / 2000 : 1;
      L[i] = out[i] / peak * fade;
      R[i] = (i > 24 ? out[i - 24] : 0) / peak * fade;
    }
    return buf;
  }

  start() {
    const ctx = this.ctx, now = ctx.currentTime;
    ctx.resume();
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.9, now + 2.5);
    // the wind of the fall
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    this.windBand = ctx.createBiquadFilter(); this.windBand.type = 'bandpass'; this.windBand.Q.value = 0.6; this.windBand.frequency.value = 300;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    src.connect(hp).connect(this.windBand).connect(this.windGain).connect(this.bus);
    const whistle = ctx.createBiquadFilter(); whistle.type = 'bandpass'; whistle.Q.value = 7; whistle.frequency.value = 1400;
    this.whistleGain = ctx.createGain(); this.whistleGain.gain.value = 0;
    src.connect(whistle).connect(this.whistleGain).connect(this.bus);
    src.start(now);
  }

  // a low pulse, two beats like a heart, felt more than heard
  pulse(delay = 0, vol = 0.34) {
    const ctx = this.ctx;
    for (const [d, v] of [[0, 1], [0.32, 0.7]]) {
      const t = ctx.currentTime + delay + d;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.025); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g); g.connect(this.bus); g.connect(this.send);
      o.start(t); o.stop(t + 0.55);
    }
  }

  setFall(v, dt) {
    if (!this.windGain) return;
    const t = this.ctx.currentTime, k = Math.min(1, dt * 4);
    const g = Math.min(0.32, 0.015 + v * 0.0075);
    this.windGain.gain.setTargetAtTime(g, t, 0.15 / k);
    this.windBand.frequency.setTargetAtTime(220 + v * 28, t, 0.2);
    this.whistleGain.gain.setTargetAtTime(Math.max(0, v - 14) * 0.0022, t, 0.3);
  }

  biwa(strength = 1) {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    let k;
    do { k = Math.floor(Math.random() * this.notes.length); } while (k === this.lastNote && this.notes.length > 1);
    this.lastNote = k;
    const src = ctx.createBufferSource();
    src.buffer = this.notes[k];
    // the attack pitches high and settles; sometimes she pushes the string behind the fret and it wails up
    src.playbackRate.setValueAtTime(1.035, t);
    src.playbackRate.exponentialRampToValueAtTime(1.0, t + 0.12);
    if (Math.random() < 0.4) {
      src.playbackRate.setValueAtTime(1.0, t + 0.5);
      src.playbackRate.linearRampToValueAtTime(1.06, t + 0.9);
      src.playbackRate.linearRampToValueAtTime(1.0, t + 1.8);
    }
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 240; body.Q.value = 1.4; body.gain.value = 5;
    const g = ctx.createGain(); g.gain.value = 0.55 * strength;
    src.connect(body).connect(g);
    g.connect(this.bus); g.connect(this.send);
    src.start(t);
    // the bachi's click on the skin
    const c = ctx.createBufferSource(); c.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600; hp.Q.value = 1.2;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5 * strength, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    c.connect(hp).connect(cg); cg.connect(this.bus); cg.connect(this.send);
    c.start(t, Math.random() * 3, 0.05);
  }

  // shoji running in their grooves
  slide(delay = 0, pan = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(1100, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(bp).connect(g).connect(p);
    p.connect(this.bus); p.connect(this.send);
    s.start(t, Math.random() * 3, 0.3);
    // and the knock as they hit the post
    this.knock(delay + 0.24, 0.05, pan);
  }

  knock(delay = 0, vol = 0.12, pan = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p); p.connect(this.bus); p.connect(this.send);
    o.start(t); o.stop(t + 0.15);
  }

  // a room grinding into its new place
  thud(delay = 0, vol = 0.3) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g); g.connect(this.bus); g.connect(this.send);
    o.start(t); o.stop(t + 1.0);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(lp).connect(ng); ng.connect(this.bus); ng.connect(this.send);
    s.start(t, Math.random() * 3, 0.8);
  }

  setMuted(m) {
    this.muted = m;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.9, now + 0.5);
  }
}
