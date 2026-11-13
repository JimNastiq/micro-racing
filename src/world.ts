import * as THREE from 'three';
import { Track } from './track';
import { floorTexture } from './textures';
import { Assets, Prop, extractGeometry } from './assets';

export const FLOOR_Y = -76;
/** Échelle de la table Meshy (modèle 1.9 × 1.24 → ~297 × 193) */
export const TABLE_S = 156;
export const TABLE_HW = 0.948 * TABLE_S;
export const TABLE_HD = 0.617 * TABLE_S;
export const STEP_H = 1.7;   // marche franchissable
export const CAR_H = 2.2;    // hauteur de la voiture (pour les collisions)

export type ZoneKind = 'slip' | 'slow';
export interface Zone { kind: ZoneKind; x: number; z: number; r: number }
export interface Ramp { x: number; z: number; hl: number; hw: number; rot: number; height: number }
interface Platform { x: number; z: number; hw: number; hd: number; y: number }
export interface Contact { nx: number; nz: number; pen: number }

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

function shadowAll(o: THREE.Object3D, cast = true, receive = true) {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
}

export class World {
  props: Prop[] = [];
  ramps: Ramp[] = [];
  zones: Zone[] = [];
  /** Zones d'envol : vitesse verticale donnée quand la voiture quitte le sol ici */
  launchPads: { x: number; z: number; r: number; vy: number }[] = [];
  platforms: Platform[] = [];
  occluders: THREE.Object3D[] = [];
  warnings: string[] = [];
  private ray = new THREE.Raycaster();
  private iv: number[] = new Array(16).fill(0);
  private hint = -1;

  constructor(public scene: THREE.Scene, public track: Track, assets: Assets) {
    this.buildRoom();
    this.buildTable(assets);
    this.buildTrack(assets);
    this.buildProps(assets);
  }

  // ---------------------------------------------------------------- requêtes physiques

  /** Position sur la route (avec mémoire de l'index précédent) */
  road(x: number, z: number) {
    const n = this.track.nearest(x, z, this.hint);
    this.hint = n.i;
    return n;
  }

  /** Hauteur du sol porteur sous (x,z) pour un objet dont le bas est à y */
  groundAt(x: number, z: number, y: number): number {
    let g = FLOOR_Y;
    for (const p of this.platforms)
      if (Math.abs(x - p.x) <= p.hw && Math.abs(z - p.z) <= p.hd && p.y <= y + STEP_H) g = Math.max(g, p.y);
    if (Math.abs(x) <= TABLE_HW && Math.abs(z) <= TABLE_HD) {
      g = Math.max(g, 0);
      const n = this.road(x, z);
      if (Math.abs(n.lateral) <= this.track.outerHalf && this.track.roadTop <= y + STEP_H) g = Math.max(g, this.track.roadTop);
      for (const r of this.ramps) {
        const dx = x - r.x, dz = z - r.z;
        const c = Math.cos(r.rot), s = Math.sin(r.rot);
        const along = dx * c + dz * s, across = -dx * s + dz * c;
        if (Math.abs(along) <= r.hl && Math.abs(across) <= r.hw) {
          const h = r.height * (along + r.hl) / (2 * r.hl);
          if (h <= y + STEP_H) g = Math.max(g, h);
        }
      }
    }
    for (const p of this.props) {
      const k = p.intervals(x, z, this.iv);
      for (let i = 0; i < k; i++) {
        const top = this.iv[i * 2 + 1];
        if (top <= y + STEP_H && top > g) g = top;
      }
    }
    return g;
  }

  /** Un obstacle occupe-t-il le volume de la voiture en (x,z) ? */
  blocked(x: number, z: number, y: number): boolean {
    for (const p of this.props) {
      const k = p.intervals(x, z, this.iv);
      for (let i = 0; i < k; i++) {
        const bot = this.iv[i * 2], top = this.iv[i * 2 + 1];
        if (top > y + STEP_H && bot < y + CAR_H) return true;
      }
    }
    return false;
  }

  /** Murets de dominos le long de la route */
  roadContacts(x: number, z: number, y: number, r: number, out: Contact[]) {
    out.length = 0;
    if (y > this.track.wallTop) return out;
    const n = this.road(x, z);
    const side = n.lateral >= 0 ? 1 : -1;
    if (!this.track.hasWall(n.i, side)) return out;
    const s = this.track.samples[n.i];
    const a = Math.abs(n.lateral), inner = this.track.halfWidth, outer = this.track.outerHalf;
    let dir = 0, pen = 0;
    if (a < inner) { if (a > inner - r) { dir = -side; pen = a - (inner - r); } }
    else if (a > outer) { if (a < outer + r) { dir = side; pen = outer + r - a; } }
    else if (a - inner < outer - a) { dir = -side; pen = a - inner + r; }
    else { dir = side; pen = outer - a + r; }
    if (dir) out.push({ nx: s.nx * dir, nz: s.nz * dir, pen });
    return out;
  }

  launchAt(x: number, z: number): number {
    for (const l of this.launchPads) if ((x - l.x) ** 2 + (z - l.z) ** 2 < l.r * l.r) return l.vy;
    return 0;
  }

  surfaceAt(x: number, z: number): ZoneKind | null {
    for (const zn of this.zones) if ((x - zn.x) ** 2 + (z - zn.z) ** 2 < zn.r * zn.r) return zn.kind;
    return null;
  }

  // ---------------------------------------------------------------- transparence des objets qui cachent la voiture

  private registerOccluder(obj: THREE.Object3D, hideFully = false) {
    obj.userData.fade = 1;
    obj.userData.minFade = hideFully ? 0 : 0.25;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData.occRoot = obj;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    this.occluders.push(obj);
  }

  updateOcclusion(cam: THREE.Camera, target: THREE.Vector3, dt: number) {
    const hit = new Set<THREE.Object3D>();
    const from = cam.position;
    for (const dy of [0.8, 2.5]) {
      const to = new THREE.Vector3(target.x, target.y + dy, target.z);
      const dir = to.clone().sub(from);
      const dist = dir.length();
      this.ray.set(from, dir.normalize());
      this.ray.far = dist - 1;
      for (const h of this.ray.intersectObjects(this.occluders, true)) hit.add(h.object.userData.occRoot);
    }
    for (const o of this.occluders) {
      const goal = hit.has(o) ? o.userData.minFade as number : 1;
      const f = o.userData.fade as number;
      if (Math.abs(f - goal) < 0.005) continue;
      let nf = f + (goal - f) * Math.min(1, dt * 10);
      if (Math.abs(nf - goal) < 0.01) nf = goal;
      o.userData.fade = nf;
      o.visible = nf > 0.02;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const tr = nf < 0.99;
          if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; }
          mat.opacity = nf;
          mat.depthWrite = !tr;
        }
      });
    }
  }

  // ---------------------------------------------------------------- décor

  private buildRoom() {
    const s = this.scene;
    const ft = floorTexture();
    ft.repeat.set(30, 30);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    s.add(floor);

    const wallMat = std(0xf3e2c2, { roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1600, 400), wallMat);
    back.position.set(0, FLOOR_Y + 200, -480);
    const left = back.clone(); left.rotation.y = Math.PI / 2; left.position.set(-600, FLOOR_Y + 200, 0);
    const right = back.clone(); right.rotation.y = -Math.PI / 2; right.position.set(600, FLOOR_Y + 200, 0);
    const front = back.clone(); front.rotation.y = Math.PI; front.position.set(0, FLOOR_Y + 200, 480);
    s.add(back, left, right, front);

    const cab = std(0x6fa8a0);
    for (let i = -3; i <= 3; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(118, 90, 60), cab);
      c.position.set(i * 120, FLOOR_Y + 45, -450);
      const h = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 3), std(0xc9c9c9, { metalness: 0.8, roughness: 0.3 }));
      h.position.set(i * 120, FLOOR_Y + 80, -419);
      s.add(c, h);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(860, 5, 66), std(0xe8e2d8));
    counter.position.set(0, FLOOR_Y + 92, -450);
    s.add(counter);

    const chair = (x: number, z: number, rot: number) => {
      const g = new THREE.Group();
      const wood = std(0x9b5d33);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(44, 4, 44), wood);
      seat.position.y = 45;
      g.add(seat);
      for (const [lx, lz] of [[-19, -19], [19, -19], [-19, 19], [19, 19]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(3.5, 45, 3.5), wood);
        leg.position.set(lx, 22.5, lz);
        g.add(leg);
      }
      const backRest = new THREE.Mesh(new THREE.BoxGeometry(44, 40, 3.5), wood);
      backRest.position.set(0, 67, 20);
      g.add(backRest);
      g.position.set(x, FLOOR_Y, z);
      g.rotation.y = rot;
      shadowAll(g);
      s.add(g);
      this.platforms.push({ x, z, hw: 22, hd: 22, y: FLOOR_Y + 47 });
    };
    chair(-70, 130, 0);
    chair(90, -130, Math.PI);
    chair(190, 20, -Math.PI / 2);
  }

  private addProp(p: Prop, occluder = false, solid = true, hideFully = false) {
    shadowAll(p.obj);
    this.scene.add(p.obj);
    if (solid) this.props.push(p);
    if (occluder) this.registerOccluder(p.obj, hideFully);
    return p;
  }

  private buildTable(a: Assets) {
    // plateau à y = 0, pieds jusqu'au sol (le modèle va de -0.451 à 0.451 en hauteur)
    const sy = -FLOOR_Y / 0.9015;
    const t = new Prop(a.models.table, null, 0, -0.4505 * sy, 0, 0, TABLE_S, sy, TABLE_S);
    this.addProp(t, false, false);
  }

  private buildTrack(a: Assets) {
    const { geo, material } = extractGeometry(a.models.track_straight);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const tr = this.track;
    // brèches : chutes possibles côté extérieur près des bords, accès au tremplin côté intérieur
    tr.breaches = [
      { a: 0.205, b: 0.255, side: -1 },
      { a: 0.700, b: 0.745, side: -1 },
      { a: 0.865, b: 0.935, side: 1 },
      { a: 0.035, b: 0.115, side: 1 },
    ];
    // extrémités coupées à la base des languettes de puzzle → tronçons collés bord à bord
    tr.buildPieces(this.scene, geo, material, { minX: -0.868, maxX: 0.868, minY: bb.min.y, roadY: -0.054, innerZ: 0.195, dominoScale: 0.75 });
  }

  /** Repère local de la route à une fraction du tour */
  private at(frac: number) {
    const tr = this.track;
    const fr = tr.frame(((frac % 1) + 1) % 1 * tr.length);
    return fr;
  }

  private buildProps(a: Assets) {
    const tr = this.track;
    const top = tr.roadTop;

    // --- Tunnel : paquet de céréales sur la ligne droite du bas (la route passe sous l'arche)
    {
      const f = this.at(0.45), s = 40;
      const rot = Math.atan2(f.tx, f.tz);            // Z modèle → sens de la route, X modèle → normale
      const archX = 0.17;                            // centre de l'arche (X modèle)
      const y = top - 0.05 + 0.571 * s;              // le sol du tunnel juste sous la route
      const p = new Prop(a.models.tunnel, null, f.x - f.nx * archX * s, y, f.z - f.nz * archX * s, rot, s, s, s);
      this.addProp(p, true, false, true);
    }

    // --- Savon sur la route (côté droit) : on peut l'éviter ou passer dessus… ça glisse !
    {
      const f = this.at(0.775), s = 9;
      const rot = Math.atan2(-f.tz, f.tx);          // X modèle le long de la route
      const lat = 4.5;
      const x = f.x + f.nx * lat, z = f.z + f.nz * lat;
      const p = new Prop(a.models.soap, a.hf.soap, x, top - 0.4 + 0.25 * s, z, rot, s, s, s);
      this.addProp(p, false, true);
      this.zones.push({ kind: 'slip', x, z, r: 9.5 });
    }

    // --- Tasse renversée : flaque de café collante qui déborde sur la route (virage en bas à droite)
    {
      const f = this.at(0.6), s = 13;
      const rot = Math.atan2(-f.nx, -f.nz);         // Z modèle → vers l'extérieur ; la tasse côté intérieur
      const off = 2 + 0.25 * s;
      const p = new Prop(a.models.mug, a.hf.mug, f.x + f.nx * off, top - 0.1 + 0.36 * s, f.z + f.nz * off, rot, s, s, s);
      this.addProp(p, true, true);
      this.zones.push({ kind: 'slow', x: f.x + f.nx * 1.5, z: f.z + f.nz * 1.5, r: 9 });
    }

    // --- Brique de jus renversée : flaque glissante (côté gauche)
    {
      const f = this.at(0.28), s = 14;
      const rot = Math.atan2(-f.nz, f.nx);           // X modèle → intérieur (la brique), la flaque vers la route
      const off = 13;
      const p = new Prop(a.models.juicebox, a.hf.juicebox, f.x + f.nx * off, top - 0.1 + 0.28 * s, f.z + f.nz * off, rot, s, s, s);
      this.addProp(p, true, true);
      this.zones.push({ kind: 'slip', x: f.x + f.nx * 4, z: f.z + f.nz * 4, r: 7.5 });
    }

    // --- Tremplin : règle posée sur un livre et des cubes, au milieu de la table (raccourci acrobatique)
    {
      const s = 22, rot = Math.PI / 2;               // la règle monte vers -X
      const x0 = 30, z0 = -28;
      const p = new Prop(a.models.track_ramp, a.hf.track_ramp, x0, 0.43 * s, z0, rot, s, s, s);
      // le bas du modèle (min y = -0.43) posé sur la table
      this.addProp(p, true, true);
      // sommet de la règle : impulsion pour un vrai saut
      const peak = p.toWorld(0, 0.4, -0.5);
      this.launchPads.push({ x: peak.x, z: peak.z, r: 7, vy: 30 });
      // petite cale en bois pour monter sur le bout de la règle
      const footX = x0 + 0.95 * s;
      const hl = 7.5, hw = 2.6, height = 4.4;
      this.ramps.push({ x: footX + hl - 0.3, z: z0, hl, hw, rot: Math.PI, height });
      const wedgeGeo = new THREE.BufferGeometry();
      const L = hl * 2;
      const v = [
        0, 0, -hw, 0, 0, hw, L, 0, -hw, L, 0, hw, // base
        0, height, -hw, 0, height, hw,             // haut côté règle
      ];
      wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      wedgeGeo.setIndex([0, 2, 1, 1, 2, 3, 4, 5, 2, 5, 3, 2, 0, 1, 4, 1, 5, 4, 0, 4, 2, 1, 3, 5]);
      wedgeGeo.computeVertexNormals();
      const wedge = new THREE.Mesh(wedgeGeo, std(0xd9a066, { flatShading: true }));
      wedge.position.set(footX - 0.3, 0, z0);
      shadowAll(wedge);
      this.scene.add(wedge);
      // flèches au sol pour montrer l'accès
      const arrowMat = std(0xffc83a, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const sh = new THREE.Shape();
      sh.moveTo(0, 2.6); sh.lineTo(2.8, -1.2); sh.lineTo(1.2, -1.2); sh.lineTo(0, 0.7); sh.lineTo(-1.2, -1.2); sh.lineTo(-2.8, -1.2); sh.closePath();
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), arrowMat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.PI / 2;                  // pointe vers -X
        m.position.set(footX + 20 + k * 8, 0.06, z0);
        this.scene.add(m);
      }
    }
  }
}
