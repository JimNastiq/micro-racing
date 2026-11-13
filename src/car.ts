import * as THREE from 'three';
import { World, FLOOR_Y } from './world';
import { numberTexture } from './textures';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface Controls { steer: number; throttle: number; brake: number; drift: boolean }

export type CarEvent =
  | { type: 'bump'; strength: number }
  | { type: 'boost'; level: number }
  | { type: 'driftStart' }
  | { type: 'land'; strength: number; air?: number }
  | { type: 'fall' };

// Réglages de conduite (unités : cm et secondes, échelle « jouet »)
export const TUNING = {
  maxSpeed: 72,
  boostSpeed: 102,
  accel: 115,
  boostAccel: 260,
  brake: 170,
  reverseMax: 22,
  drag: 0.35,
  rolling: 1.1,
  steerRate: 2.7,
  grip: 13,
  driftGrip: 3.4,
  milkGrip: 1.3,
  offTrackFactor: 0.82,
  sugarFactor: 0.5,
  gravity: 170,
  fallGravity: 320,
  launchBoost: 1.8,
  radius: 2.0,
  driftLvl1: 0.75,
  driftLvl2: 1.6,
  stepH: 1.7,     // marche franchissable
  halfW: 1.3,     // demi-largeur (collisions avec les objets)
  halfL: 2.3,     // demi-longueur
};
export type Tuning = typeof TUNING;

export class Car {
  // état physique
  x = 0; z = 0; y = 0;
  vx = 0; vz = 0; vy = 0;
  heading = 0;
  onGround = true;
  airTime = 0;
  drifting = false;
  driftDir = 0;
  driftCharge = 0;
  boostTime = 0;
  falling = false;
  fallTime = 0;
  offTrack = false;
  surface: 'slip' | 'slow' | null = null;
  frozen = false;
  events: CarEvent[] = [];
  /** réglages de conduite propres à la voiture choisie */
  t: Tuning = { ...TUNING };
  private modelObj: THREE.Object3D | null = null;
  private len = 5.3;

  // visuel
  mesh = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private frontPivots: THREE.Object3D[] = [];
  private flame: THREE.Mesh;
  private roll = 0; private pitch = 0; private hop = 0; private hopV = 0;
  private visSteer = 0; private wheelSpin = 0; private visSlip = 0;
  private prevSpeed = 0;
  blink = 0;

  private contacts: { nx: number; nz: number; pen: number }[] = [];

  constructor(color = 0xe23b3b) {
    // matériaux : peinture laquée (vernis) façon miniature en métal
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.55, metalness: 0.2 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.88 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0f1a2e, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.16 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });

    /** Profil latéral (z = avant, y = haut) extrudé sur la largeur, avec arêtes arrondies */
    const extrude = (pts: [number, number][], width: number, bevel: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 6 });
      g.translate(0, 0, -(width - 2 * bevel) / 2);
      g.rotateY(-Math.PI / 2);
      g.computeVertexNormals();
      return g;
    };
    const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r);

    // carrosserie : capot plongeant, flancs galbés
    const bodyGeo = extrude([[-2.45, 0.46], [2.4, 0.46], [2.58, 0.6], [2.5, 0.84], [1.05, 1.04], [-1.85, 1.1], [-2.45, 1.02]], 2.5, 0.16);
    const bodyMesh = new THREE.Mesh(bodyGeo, paint);
    // habitacle vitré
    const cabin = new THREE.Mesh(extrude([[-1.7, 1.0], [0.75, 1.0], [0.08, 1.66], [-1.2, 1.7], [-1.78, 1.18]], 1.95, 0.1), glass);
    // toit peint
    const roof = new THREE.Mesh(rbox(1.62, 0.1, 1.2, 0.04), paint);
    roof.position.set(0, 1.79, -0.56);
    roof.rotation.x = 0.02;
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ map: numberTexture(7), roughness: 0.4, transparent: true }));
    num.rotation.x = -Math.PI / 2;
    num.position.set(0, 1.85, -0.56);
    // bandes de course sur le capot
    for (const sx of [-0.28, 0.28]) {
      const st = new THREE.Mesh(rbox(0.26, 0.04, 1.5, 0.015), white);
      st.position.set(sx, 1.17, 1.72);
      st.rotation.x = 0.135;
      this.body.add(st);
    }
    // calandre + pare-chocs
    const grille = new THREE.Mesh(rbox(1.7, 0.3, 0.16, 0.05), dark);
    grille.position.set(0, 0.62, 2.66);
    const bumperR = new THREE.Mesh(rbox(2.3, 0.22, 0.2, 0.07), dark);
    bumperR.position.set(0, 0.5, -2.58);
    // aileron
    const wing = new THREE.Mesh(rbox(2.7, 0.1, 0.62, 0.04), paint);
    wing.position.set(0, 1.62, -2.3);
    wing.rotation.x = -0.08;
    for (const sx of [-0.75, 0.75]) {
      const post = new THREE.Mesh(rbox(0.12, 0.5, 0.3, 0.03), dark);
      post.position.set(sx, 1.35, -2.25);
      this.body.add(post);
    }
    // phares ronds et feux arrière
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfffbea, emissive: 0xfff2c0, emissiveIntensity: 1.4, roughness: 0.1 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.1, roughness: 0.2 });
    const lamp = new THREE.CylinderGeometry(0.19, 0.19, 0.12, 20);
    lamp.rotateX(Math.PI / 2);
    for (const sx of [-0.82, 0.82]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 20), chrome);
      ring.position.set(sx, 0.78, 2.58);
      const h = new THREE.Mesh(lamp, headMat);
      h.position.set(sx, 0.78, 2.56);
      const t = new THREE.Mesh(rbox(0.55, 0.18, 0.1, 0.05), tailMat);
      t.position.set(sx, 0.92, -2.55);
      this.body.add(ring, h, t);
    }
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 14), chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0.62, 0.42, -2.62);
    // flamme de turbo
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.6, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.9 }));
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.set(0.62, 0.42, -3.55);
    this.flame.visible = false;

    this.body.add(bodyMesh, cabin, roof, num, grille, bumperR, wing, exhaust, this.flame);

    // roues : pneus au profil arrondi (tour), jantes chromées, cache-moyeu couleur carrosserie
    const tire = new THREE.LatheGeometry([
      new THREE.Vector2(0.36, -0.27), new THREE.Vector2(0.5, -0.29), new THREE.Vector2(0.58, -0.24), new THREE.Vector2(0.62, -0.12),
      new THREE.Vector2(0.63, 0), new THREE.Vector2(0.62, 0.12), new THREE.Vector2(0.58, 0.24), new THREE.Vector2(0.5, 0.29), new THREE.Vector2(0.36, 0.27),
    ], 28);
    tire.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(0.37, 0.37, 0.5, 24);
    rim.rotateZ(Math.PI / 2);
    const cap = new THREE.CylinderGeometry(0.14, 0.14, 0.56, 16);
    cap.rotateZ(Math.PI / 2);
    const spoke = new THREE.BoxGeometry(0.54, 0.07, 0.6);
    for (const [wx, wz, front] of [[-1.28, 1.62, 1], [1.28, 1.62, 1], [-1.28, -1.62, 0], [1.28, -1.62, 0]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.62, wz);
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tire, tireMat), new THREE.Mesh(rim, chrome), new THREE.Mesh(cap, paint));
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spoke, chrome);
        sp.rotation.x = (k * Math.PI) / 3;
        wheel.add(sp);
      }
      pivot.add(wheel);
      this.mesh.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }
    this.mesh.add(this.body);
    this.mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.flame.castShadow = false;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }
  get driftLevel() { return this.driftCharge >= TUNING.driftLvl2 ? 2 : this.driftCharge >= TUNING.driftLvl1 ? 1 : 0; }

  place(x: number, z: number, heading: number, y = 0) {
    this.x = x; this.z = z; this.y = y; this.heading = heading;
    this.vx = this.vz = this.vy = 0;
    this.onGround = true; this.falling = false; this.fallTime = 0;
    this.drifting = false; this.driftCharge = 0; this.boostTime = 0;
    this.airTime = 0;
  }

  step(dt: number, c: Controls, world: World) {
    const T = this.t;
    if (this.falling) {
      this.fallTime += dt;
      this.vy -= T.fallGravity * dt;
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      const g = world.groundAt(this.x, this.z, this.y);
      if (this.y < g && g < -3) { // atterrit par terre ou sur une chaise
        this.y = g;
        if (this.vy < -40) this.events.push({ type: 'land', strength: 1 });
        this.vy = -this.vy * 0.3;
        this.vx *= 0.6; this.vz *= 0.6;
      }
      return;
    }

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading);
    let fs = this.vx * fx + this.vz * fz;
    let ls = this.vx * sx + this.vz * sz;

    this.surface = this.onGround ? world.surfaceAt(this.x, this.z) : null;
    let maxS = T.maxSpeed;
    if (this.offTrack) maxS *= T.offTrackFactor;
    if (this.surface === 'slow') maxS *= T.sugarFactor;
    const boosting = this.boostTime > 0;
    if (boosting) { maxS = T.boostSpeed; this.boostTime -= dt; }

    const throttle = this.frozen ? 0 : c.throttle;
    const brake = this.frozen ? 0 : c.brake;
    const steer = this.frozen ? 0 : c.steer;

    let yawRate = 0;
    if (this.onGround) {
      // moteur / frein
      // accélération seulement jusqu'à la vitesse max ; au-delà on redescend doucement
      if (fs < maxS) {
        if (boosting) fs = Math.min(maxS, fs + T.boostAccel * dt);
        else if (throttle > 0) {
          // si la voiture recule (choc, marche arrière), l'accélérateur freine d'abord fort puis repart en avant
          const a = fs < 0 ? T.brake + T.accel : T.accel;
          fs = Math.min(maxS, fs + a * throttle * dt);
        }
      }
      if (brake > 0) {
        if (fs > 1) fs -= T.brake * brake * dt;
        else if (throttle === 0) fs = Math.max(-T.reverseMax, fs - 60 * brake * dt);
      }
      if (throttle === 0 && brake === 0 && !boosting) fs -= fs * (fs < 0 ? T.rolling * 3 : T.rolling) * dt;
      if (fs < maxS * 0.98) fs -= fs * T.drag * dt * 0.5;
      if (fs > maxS) fs = Math.max(maxS, fs - 90 * dt);

      // dérapage contrôlé
      if (!this.drifting && c.drift && !this.frozen && Math.abs(steer) > 0.3 && fs > 28) {
        this.drifting = true;
        this.driftDir = Math.sign(steer);
        this.driftCharge = 0;
        this.hopV = 9;
        this.events.push({ type: 'driftStart' });
      }
      if (this.drifting) {
        if (!c.drift || fs < 16) {
          if (!c.drift && fs >= 16) {
            const lvl = this.driftLevel;
            if (lvl > 0) {
              this.boostTime = Math.max(this.boostTime, lvl === 2 ? 1.15 : 0.55);
              this.events.push({ type: 'boost', level: lvl });
            }
          }
          this.drifting = false;
          this.driftCharge = 0;
        }
      }

      const speedF = Math.min(1, Math.abs(fs) / 22);
      if (this.drifting) {
        const into = Math.max(-1, Math.min(1, steer * this.driftDir));
        yawRate = this.driftDir * (1.75 + 1.05 * into) * speedF;
        this.driftCharge += dt * (0.8 + 0.6 * Math.max(0, into));
      } else {
        const hiSpeed = 1 - 0.28 * Math.min(1, Math.abs(fs) / T.maxSpeed);
        yawRate = steer * T.steerRate * speedF * hiSpeed * (fs < 0 ? -1 : 1);
        if (this.surface === 'slip') yawRate *= 0.7;
      }

      // adhérence latérale
      const grip = this.drifting ? T.driftGrip : this.surface === 'slip' ? T.milkGrip : T.grip;
      const before = Math.abs(ls);
      ls *= Math.exp(-grip * dt);
      // en dérapage, une partie de la glisse est convertie en vitesse avant (garde l'élan)
      if (this.drifting) fs += (before - Math.abs(ls)) * 0.45;
    } else {
      // en l'air : léger contrôle de rotation
      yawRate = steer * 0.8;
      this.airTime += dt;
    }

    this.vx = fx * fs + sx * ls;
    this.vz = fz * fs + sz * ls;
    this.heading -= yawRate * dt;

    // --- déplacement horizontal + obstacles (cartes de hauteur), avec glissement le long des parois
    const px = this.x, pz = this.z;
    let nx = px + this.vx * dt, nz = pz + this.vz * dt;
    if (this.hitProps(world, nx, nz)) {
      const sp0 = Math.hypot(this.vx, this.vz);
      if (!this.hitProps(world, nx, pz)) { nz = pz; this.vz *= -0.25; }
      else if (!this.hitProps(world, px, nz)) { nx = px; this.vx *= -0.25; }
      else { nx = px; nz = pz; this.vx *= -0.35; this.vz *= -0.35; }
      const loss = sp0 - Math.hypot(this.vx, this.vz);
      if (loss > 14) {
        this.events.push({ type: 'bump', strength: Math.min(1, loss / 60) });
        this.drifting = false; this.driftCharge = 0;
      }
    }
    this.x = nx; this.z = nz;

    // --- vertical
    const g = world.groundAt(this.x, this.z, this.y, T.stepH);
    if (this.onGround) {
      if (g < this.y - 0.8) {
        this.onGround = false;
        this.airTime = 0;
        if (this.vy > 4) this.vy = Math.min(42, this.vy * T.launchBoost); // sortie de tremplin
        const pad = world.launchAt(this.x, this.z);
        if (pad > 0 && this.forwardSpeed > 30) this.vy = Math.max(this.vy, pad);
      } else {
        const target = Math.min((g - this.y) / dt, Math.abs(fs) * 1.1 + 5);
        this.vy += (target - this.vy) * 0.5;
        this.y = g;
      }
    } else {
      this.vy -= (this.y < -1 ? T.fallGravity : T.gravity) * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        const strength = Math.min(1, -this.vy / 60);
        this.y = g; this.vy = 0; this.onGround = true;
        this.hopV = -strength * 12;
        if (strength > 0.15) this.events.push({ type: 'land', strength, air: this.airTime });
      }
    }
    if (!this.onGround && this.y < -4) {
      this.falling = true;
      this.drifting = false;
      this.boostTime = 0;
      this.events.push({ type: 'fall' });
      return;
    }

    // --- murets de dominos le long de la route
    world.roadContacts(this.x, this.z, this.y, T.radius, this.contacts);
    for (const k of this.contacts) {
      this.x += k.nx * k.pen;
      this.z += k.nz * k.pen;
      const vn = this.vx * k.nx + this.vz * k.nz;
      if (vn < 0) {
        const e = 0.3;
        this.vx -= (1 + e) * vn * k.nx;
        this.vz -= (1 + e) * vn * k.nz;
        this.vx *= 0.95; this.vz *= 0.95;
        if (-vn > 18) {
          this.events.push({ type: 'bump', strength: Math.min(1, -vn / 60) });
          this.drifting = false; this.driftCharge = 0;
        }
      }
    }
  }

  /** La silhouette de la voiture touche-t-elle un obstacle ? (centre + 4 points) */
  private hitProps(world: World, x: number, z: number): boolean {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading);
    const y = this.y, st = this.t.stepH, L = this.t.halfL, W = this.t.halfW;
    return world.blocked(x, z, y, st) ||
      world.blocked(x + fx * L, z + fz * L, y, st) || world.blocked(x - fx * L, z - fz * L, y, st) ||
      world.blocked(x + sx * W, z + sz * W, y, st) || world.blocked(x - sx * W, z - sz * W, y, st);
  }

  /** Remplace la carrosserie procédurale par un modèle 3D (avant du modèle vers -X) */
  setModel(model: THREE.Object3D, length = 5.3) {
    const box = new THREE.Box3().setFromObject(model);
    const s = length / (box.max.x - box.min.x);
    const m = model.clone(true);
    if (this.modelObj) this.body.remove(this.modelObj);
    this.len = length;
    this.modelObj = m;
    m.scale.setScalar(s);
    m.rotation.y = Math.PI / 2;
    m.position.y = -box.min.y * s;
    for (const ch of this.body.children) if (ch !== this.flame) ch.visible = false;
    for (const w of this.wheels) w.visible = false;
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.body.add(m);
    this.flame.position.set(0, 0.75 * (length / 5.3), -length * 0.55);
  }

  /** Animation visuelle (indépendante du pas physique) */
  updateVisual(dt: number, c: Controls) {
    const fs = this.forwardSpeed;
    this.mesh.position.set(this.x, this.y, this.z);
    // inclinaison visuelle supplémentaire en dérapage
    this.visSlip += ((this.drifting ? this.driftDir * 0.35 : 0) - this.visSlip) * Math.min(1, dt * 8);
    this.mesh.rotation.y = this.heading - this.visSlip;

    // roulis / tangage
    const accel = (fs - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = fs;
    const targetRoll = (this.drifting ? -this.driftDir * 0.12 : -c.steer * 0.07 * Math.min(1, Math.abs(fs) / 40));
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    const targetPitch = Math.max(-0.08, Math.min(0.08, -accel * 0.0012));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 6);
    // petit saut (début de dérapage / atterrissage)
    this.hopV -= 60 * dt;
    this.hop += this.hopV * dt;
    if (this.hop < 0) { this.hop = 0; this.hopV = 0; }
    this.body.position.y = this.hop;
    this.body.rotation.set(this.pitch + (!this.onGround ? -Math.min(0.25, this.vy * 0.01) : 0), 0, this.roll);

    // roues
    this.wheelSpin += fs * dt / 0.63;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    this.visSteer += (c.steer * -0.45 - this.visSteer) * Math.min(1, dt * 12);
    for (const p of this.frontPivots) p.rotation.y = this.visSteer;

    // flamme de turbo
    this.flame.visible = this.boostTime > 0;
    if (this.flame.visible) {
      const s = 0.8 + Math.random() * 0.6;
      this.flame.scale.set(1, s, 1);
      (this.flame.material as THREE.MeshBasicMaterial).color.setHSL(0.08 + Math.random() * 0.05, 1, 0.55);
    }

    // clignotement après réapparition
    if (this.blink > 0) {
      this.blink -= dt;
      this.mesh.visible = Math.floor(this.blink * 12) % 2 === 0 || this.blink <= 0;
    } else this.mesh.visible = true;
  }

  /** Positions monde des roues arrière (pour les particules) */
  rearWheels(): [THREE.Vector3, THREE.Vector3] {
    const h = this.heading - this.visSlip;
    const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    const b = this.len / 5.3;
    const mk = (side: number) => new THREE.Vector3(
      this.x - fx * 1.9 * b + sx * side * this.t.halfW, this.y + 0.2, this.z - fz * 1.9 * b + sz * side * this.t.halfW);
    return [mk(-1), mk(1)];
  }

  exhaust(): THREE.Vector3 {
    const h = this.heading - this.visSlip;
    const fx = Math.sin(h), fz = Math.cos(h);
    return new THREE.Vector3(this.x - fx * this.len * 0.6, this.y + 0.75 * this.len / 5.3 + this.hop, this.z - fz * this.len * 0.6);
  }
}

export { FLOOR_Y };
