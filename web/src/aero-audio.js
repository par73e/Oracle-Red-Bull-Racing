function createPinkNoiseBuffer(ctx, seconds = 3) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
    b6 = white * 0.115926;
  }
  // Crossfade last 2048 samples into start for seamless looping
  const fade = Math.min(2048, Math.floor(length * 0.1));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + data[length - fade + i] * (1 - t);
  }
  return buffer;
}

export class AeroAudio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.master = null;
    this.rushFilter = null;
    this.rushGain = null;
    this.rumbleFilter = null;
    this.rumbleGain = null;
    this.noiseBuffer = null;
    this.lastDrs = null;

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx || !this.master) return;
      const target = (!document.hidden && this.enabled) ? 1 : 0;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
    });
  }

  ensureContext() {
    if (this.ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      const ctx = new AudioCtx();
      const noiseBuffer = createPinkNoiseBuffer(ctx, 3);
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      // Channel 1: Wind tunnel rush (bandpass)
      const rushSrc = ctx.createBufferSource();
      rushSrc.buffer = noiseBuffer;
      rushSrc.loop = true;
      const rushFilter = ctx.createBiquadFilter();
      rushFilter.type = 'bandpass';
      rushFilter.frequency.value = 260;
      rushFilter.Q.value = 0.85;
      const rushGain = ctx.createGain();
      rushGain.gain.value = 0;
      rushSrc.connect(rushFilter).connect(rushGain).connect(master);
      rushSrc.start();

      // Channel 2: Fan & rolling-road low rumble (lowpass)
      const rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = noiseBuffer;
      rumbleSrc.loop = true;
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.value = 110;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0;
      rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(master);
      rumbleSrc.start();

      Object.assign(this, { ctx, noiseBuffer, master, rushFilter, rushGain, rumbleFilter, rumbleGain });
      return true;
    } catch {
      return false;
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) {
      if (!this.ensureContext()) { this.enabled = false; return false; }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(document.hidden ? 0 : 1, this.ctx.currentTime, 0.08);
    } else if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
    }
    return this.enabled;
  }

  syncDrs(drs) {
    this.lastDrs = drs;
  }

  update(speedKmh, yawDeg = 0, drs = 0) {
    if (this.lastDrs !== null && this.lastDrs !== drs && this.enabled) {
      this.triggerDrs(drs === 1);
    }
    this.lastDrs = drs;
    if (!this.enabled || !this.ctx || document.hidden) return;
    const now = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, (speedKmh || 0) / 350));
    const yawBoost = 1 + 0.35 * Math.min(1, Math.abs(yawDeg || 0) / 60);

    const rushFreq = (135 + 1120 * (s * s)) * (0.94 + 0.06 * yawBoost);
    const rushLevel = s < 0.01 ? 0 : Math.min(0.19, (0.02 + 0.15 * Math.pow(s, 1.35)) * yawBoost);
    const rushQ = 0.78 + 0.65 * Math.min(1, Math.abs(yawDeg || 0) / 75);

    const rumbleFreq = 80 + 135 * s;
    const rumbleLevel = s < 0.01 ? 0 : Math.min(0.14, 0.02 + 0.11 * s);

    this.rushFilter.frequency.setTargetAtTime(rushFreq, now, 0.08);
    this.rushFilter.Q.setTargetAtTime(rushQ, now, 0.08);
    this.rushGain.gain.setTargetAtTime(rushLevel, now, 0.08);
    this.rumbleFilter.frequency.setTargetAtTime(rumbleFreq, now, 0.08);
    this.rumbleGain.gain.setTargetAtTime(rumbleLevel, now, 0.08);
  }

  triggerDrs(opening) {
    if (!this.enabled || !this.ctx || !this.noiseBuffer || !this.master) return;
    const now = this.ctx.currentTime;
    // Hydraulic air hiss
    const hissSrc = this.ctx.createBufferSource();
    hissSrc.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = opening ? 2400 : 1900;
    const hg = this.ctx.createGain();
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.exponentialRampToValueAtTime(0.11, now + 0.015);
    hg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    hissSrc.connect(hp).connect(hg).connect(this.master);
    hissSrc.start(now, Math.random() * 1.5, 0.2);

    // Subtle actuator latch click
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(opening ? 580 : 760, now);
    osc.frequency.exponentialRampToValueAtTime(opening ? 920 : 310, now + 0.045);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.045, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.055);
  }
}
