import { Controls } from './car';

/**
 * Système d'entrées unifié : clavier, manette (API Gamepad) et tactile.
 * Toutes les sources sont fusionnées en « actions » abstraites → prêt pour le multijoueur.
 */
export class Input implements Controls {
  steer = 0; throttle = 0; brake = 0; drift = false;
  // actions ponctuelles (vraies pendant une seule frame)
  respawn = false; camera = false; pause = false; confirm = false;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  autoAccel = true; // en tactile

  private keys = new Set<string>();
  private pressedOnce = new Set<string>();
  private padPrev: boolean[] = [];
  // tactile
  private touchSteer = 0; private touchDrift = false; private touchBrake = false;
  private stickId: number | null = null; private stickX0 = 0;
  touchActive = false;
  onDeviceChange: (d: Input['lastDevice']) => void = () => {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
      this.setDevice('keyboard');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private setDevice(d: Input['lastDevice']) {
    if (d !== this.lastDevice) { this.lastDevice = d; this.onDeviceChange(d); }
  }

  /** Branche les contrôles tactiles sur les éléments du DOM */
  bindTouch(stickZone: HTMLElement, knob: HTMLElement, base: HTMLElement, driftBtn: HTMLElement, brakeBtn: HTMLElement) {
    const opts = { passive: false } as AddEventListenerOptions;
    stickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setDevice('touch'); this.touchActive = true;
      this.stickId = e.pointerId; this.stickX0 = e.clientX;
      base.style.left = `${e.clientX}px`; base.style.top = `${e.clientY}px`;
      base.classList.add('on');
      knob.style.transform = 'translate(-50%,-50%)';
      try { stickZone.setPointerCapture(e.pointerId); } catch {}
    }, opts);
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = Math.max(-55, Math.min(55, e.clientX - this.stickX0));
      this.touchSteer = dx / 55;
      knob.style.transform = `translate(calc(-50% + ${dx}px),-50%)`;
    }, opts);
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.touchSteer = 0; base.classList.remove('on');
    };
    stickZone.addEventListener('pointerup', end);
    stickZone.addEventListener('pointercancel', end);

    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setDevice('touch'); this.touchActive = true; set(true); el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch {} }, opts);
      const up = () => { set(false); el.classList.remove('on'); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    };
    hold(driftBtn, (v) => (this.touchDrift = v));
    hold(brakeBtn, (v) => (this.touchBrake = v));
  }

  /** Lit toutes les sources ; à appeler une fois par frame */
  poll() {
    const k = this.keys;
    let steer = 0, thr = 0, brk = 0, drift = false;
    // clavier
    if (k.has('ArrowLeft') || k.has('KeyA') || k.has('KeyQ')) steer -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1;
    if (k.has('ArrowUp') || k.has('KeyW') || k.has('KeyZ')) thr = 1;
    if (k.has('ArrowDown') || k.has('KeyS')) brk = 1;
    if (k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight')) drift = true;
    const once = this.pressedOnce;
    this.respawn = once.has('KeyR');
    this.camera = once.has('KeyC');
    this.pause = once.has('Escape') || once.has('KeyP');
    this.confirm = once.has('Enter');
    once.clear();

    // manette (mapping standard)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (i: number) => (p.buttons[i] ? p.buttons[i].value : 0);
      const pressed = (i: number) => !!p.buttons[i]?.pressed;
      const edge = (i: number) => { const now = pressed(i); const was = this.padPrev[i] || false; this.padPrev[i] = now; return now && !was; };
      let ax = p.axes[0] || 0;
      if (Math.abs(ax) < 0.15) ax = 0; else ax = Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85;
      if (pressed(14)) ax = -1; if (pressed(15)) ax = 1; // croix directionnelle
      const pThr = Math.max(b(7), b(0));       // RT ou A
      const pBrk = Math.max(b(6), b(2));       // LT ou X
      const pDrift = pressed(5) || pressed(4) || pressed(1); // RB, LB ou B
      const r = edge(3), cam = edge(8), st = edge(9), conf = edge(0);
      if (ax || pThr > 0.05 || pBrk > 0.05 || pDrift || r || cam || st || conf) this.setDevice('gamepad');
      if (Math.abs(ax) > Math.abs(steer)) steer = ax;
      thr = Math.max(thr, pThr); brk = Math.max(brk, pBrk); drift = drift || pDrift;
      this.respawn ||= r; this.camera ||= cam; this.pause ||= st; this.confirm ||= conf;
      break; // une seule manette pour le joueur 1
    }

    // tactile
    if (this.touchActive && this.lastDevice === 'touch') {
      if (Math.abs(this.touchSteer) > Math.abs(steer)) steer = this.touchSteer;
      if (this.touchBrake) brk = 1;
      else if (this.autoAccel) thr = Math.max(thr, 1);
      drift = drift || this.touchDrift;
    }

    this.steer = Math.max(-1, Math.min(1, steer));
    this.throttle = thr; this.brake = brk; this.drift = drift;
  }
}
