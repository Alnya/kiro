// 効果音(WebAudioの合成)。外部の音声ファイルは使わない。
export class DuelAudio {
  constructor() { this.ctx = null; this.on = true; this.master = null; this.ambient = null; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.9 : 0; }

  tone(f0, f1, dur, { type = "sine", vol = 0.2, delay = 0, attack = 0.002 } = {}) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { f0 = 1000, f1 = 1000, q = 1, vol = 0.2, type = "bandpass", delay = 0, attack = 0.004 } = {}) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  startAmbient() {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 380; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.05;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
    // 低いドローン
    const o = c.createOscillator(), og = c.createGain(); o.type = "sine"; o.frequency.value = 55; og.gain.value = 0.018; o.connect(og); og.connect(this.master); o.start();
    this.ambient = { s, o };
  }
  stop() { if (this.ctx) { try { this.ctx.close(); } catch { /* noop */ } this.ctx = null; } }

  play(k, a = 1) {
    switch (k) {
      case "swing": this.noise(0.22, { f0: 600, f1: 2600, q: 0.8, vol: 0.18 * a }); break;
      case "bossSwing": this.noise(0.4, { f0: 220, f1: 1200, q: 0.6, vol: 0.32 * a }); this.tone(90, 50, 0.3, { type: "sawtooth", vol: 0.05 }); break;
      case "parry":
        this.tone(2400, 2380, 0.55, { vol: 0.2 }); this.tone(3600, 3550, 0.45, { vol: 0.12 }); this.tone(5400, 5300, 0.3, { vol: 0.07 }); this.tone(1200, 1190, 0.6, { vol: 0.1 });
        this.noise(0.12, { f0: 6000, f1: 3000, q: 0.5, vol: 0.28, type: "highpass" }); break;
      case "block": this.tone(900, 700, 0.18, { type: "square", vol: 0.06 }); this.noise(0.14, { f0: 3000, f1: 800, q: 1, vol: 0.25 }); this.tone(180, 90, 0.2, { vol: 0.12 }); break;
      case "bossHit": this.noise(0.18, { f0: 4000, f1: 600, q: 0.7, vol: 0.3 }); this.tone(220, 70, 0.22, { type: "triangle", vol: 0.2 }); break;
      case "playerHit": this.tone(140, 45, 0.45, { type: "sawtooth", vol: 0.22 }); this.noise(0.3, { f0: 1800, f1: 300, q: 0.6, vol: 0.35 }); break;
      case "dodge": this.noise(0.3, { f0: 300, f1: 1500, q: 0.5, vol: 0.12 }); break;
      case "peril": this.tone(180, 360, 0.5, { type: "sawtooth", vol: 0.1 }); this.tone(540, 1080, 0.5, { type: "square", vol: 0.04 }); this.noise(0.5, { f0: 500, f1: 3000, q: 2, vol: 0.12 }); break;
      case "postureBreak": this.tone(700, 120, 0.8, { type: "triangle", vol: 0.25 }); this.noise(0.5, { f0: 5000, f1: 400, q: 0.5, vol: 0.3 }); this.tone(1800, 900, 0.6, { vol: 0.08 }); break;
      case "deathblow": this.tone(60, 28, 1.4, { type: "sine", vol: 0.5 }); this.noise(0.6, { f0: 5000, f1: 200, q: 0.4, vol: 0.55 }); this.tone(1600, 400, 0.5, { vol: 0.12 }); break;
      case "roar": this.tone(80, 55, 1.8, { type: "sawtooth", vol: 0.28 }); this.noise(1.6, { f0: 400, f1: 180, q: 1.4, vol: 0.2 }); this.tone(160, 110, 1.8, { type: "sawtooth", vol: 0.14 }); break;
      case "heal": this.tone(300, 520, 0.18, { vol: 0.1 }); this.tone(420, 700, 0.2, { vol: 0.1, delay: 0.14 }); break;
      case "lose": this.tone(330, 110, 1.6, { type: "triangle", vol: 0.28 }); this.tone(60, 40, 2, { vol: 0.25 }); break;
      case "win": [392, 523, 659, 784].forEach((f, i) => this.tone(f, f, 1.4, { type: "triangle", vol: 0.12, delay: i * 0.22 })); this.tone(98, 98, 2.4, { vol: 0.2 }); break;
      case "kneel": this.tone(120, 60, 0.7, { type: "triangle", vol: 0.2 }); break;
      case "gong": this.tone(146, 142, 2.4, { type: "triangle", vol: 0.26 }); this.tone(293, 288, 1.6, { vol: 0.08 }); this.tone(73, 72, 2.6, { vol: 0.18 }); this.noise(0.1, { f0: 900, f1: 300, q: 1, vol: 0.15 }); break;
      case "step": this.noise(0.08, { f0: 300, f1: 200, q: 1, vol: 0.05, type: "lowpass" }); break;
      default: break;
    }
  }
}
