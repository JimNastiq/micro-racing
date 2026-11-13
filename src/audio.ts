/** Sons synthétisés (aucun fichier) : moteur de jouet, crissement, turbo, chocs */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode;
  private osc1!: OscillatorNode; private osc2!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private noise!: AudioBuffer;
  muted = false;

  /** À appeler depuis un geste utilisateur (clic / touche) */
  init() {
    if (this.ctx) { this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // moteur : deux oscillateurs désaccordés filtrés → bourdonnement de voiture radiocommandée
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.engFilter); this.osc2.connect(g2); g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // bruit blanc pour crissement / turbo
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    src.connect(bp); bp.connect(this.skidGain); this.skidGain.connect(this.master);
    src.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  engine(speed: number, throttle: number, boost: boolean, active: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 70 + speed * 3.2 + (boost ? 60 : 0) + throttle * 15;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 1.505, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(600 + speed * 18 + throttle * 300, t, 0.08);
    this.engGain.gain.setTargetAtTime(active ? 0.06 + throttle * 0.06 + Math.min(speed, 100) * 0.0008 : 0, t, 0.08);
  }

  skid(amount: number) {
    if (!this.ctx) return;
    this.skidGain.gain.setTargetAtTime(Math.min(0.12, amount * 0.12), this.ctx.currentTime, 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private burst(dur: number, f0: number, f1: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  bump(strength: number) { this.tone('square', 520, 160, 0.14, 0.12 * (0.4 + strength)); }
  boost(level: number) { this.burst(level === 2 ? 0.6 : 0.35, 400, 3000, 0.35); }
  land() { this.tone('sine', 180, 60, 0.15, 0.25); }
  fall() { this.tone('sine', 1400, 200, 0.9, 0.12); }
  beep(high: boolean) { this.tone('square', high ? 1040 : 520, high ? 1040 : 520, high ? 0.5 : 0.18, 0.1); }
  lap() { this.tone('triangle', 660, 1320, 0.25, 0.15); }
}
