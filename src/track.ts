import * as THREE from 'three';
import { checkerTexture, asphaltTexture } from './textures';

export interface Sample {
  x: number; z: number;   // position
  tx: number; tz: number; // tangente (unitaire)
  nx: number; nz: number; // normale (vers la gauche du sens de course)
  d: number;              // distance cumulée
}

/** Circuit défini par une courbe fermée, échantillonnée régulièrement */
export class Track {
  samples: Sample[] = [];
  length = 0;
  readonly N = 640;
  readonly halfWidth = 10;

  constructor(points: [number, number][]) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const pts = curve.getSpacedPoints(this.N);
    this.length = curve.getLength();
    for (let i = 0; i < this.N; i++) {
      const p = pts[i], q = pts[(i + 1) % this.N], o = pts[(i - 1 + this.N) % this.N];
      let tx = q.x - o.x, tz = q.z - o.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      this.samples.push({ x: p.x, z: p.z, tx, tz, nx: tz, nz: -tx, d: (i / this.N) * this.length });
    }
  }

  /** Échantillon le plus proche (recherche locale autour de `hint` si fourni) */
  nearest(x: number, z: number, hint = -1): { i: number; dist: number; lateral: number } {
    let best = 0, bd = Infinity;
    const scan = (i: number) => {
      const s = this.samples[i];
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    };
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) scan((hint + k + this.N) % this.N);
      // si trop loin, recherche globale
      if (bd > (this.halfWidth * 3) ** 2) for (let i = 0; i < this.N; i++) scan(i);
    } else for (let i = 0; i < this.N; i++) scan(i);
    const s = this.samples[best];
    const lateral = (x - s.x) * s.nx + (z - s.z) * s.nz;
    return { i: best, dist: Math.sqrt(bd), lateral };
  }

  /** Point à une fraction du circuit + décalage latéral, avec cap (heading) */
  at(frac: number, lateral = 0) {
    const i = Math.floor(((frac % 1) + 1) % 1 * this.N);
    const s = this.samples[i];
    return { x: s.x + s.nx * lateral, z: s.z + s.nz * lateral, heading: Math.atan2(s.tx, s.tz), i };
  }

  /** Repère interpolé à une distance curviligne s : position, tangente, normale (gauche) */
  frame(s: number) {
    const L = this.length, N = this.N;
    const f = ((s % L) + L) % L / L * N;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f);
    const a = this.samples[i0], b = this.samples[i1];
    let tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, nx: tz, nz: -tx };
  }

  /** Paramètres de la route en tronçons (renseignés par buildPieces) */
  roadTop = 0.4;
  outerHalf = 13;
  wallTop = 3.3;
  /** Brèches dans les murets : [début, fin] en fraction du tour, côté (+1 = intérieur/gauche, -1 = extérieur, 0 = les deux) */
  breaches: { a: number; b: number; side: number }[] = [];

  hasWall(i: number, side: number): boolean {
    const f = i / this.N;
    for (const br of this.breaches) if (f >= br.a && f <= br.b && (br.side === 0 || br.side === side)) return false;
    return true;
  }

  /**
   * Route construite en répétant le tronçon droit (modèle) et en le courbant le long du tracé.
   * Modèle : longueur sur X, largeur sur Z, route à y = roadY, dominos au-delà de |z| > innerZ.
   */
  buildPieces(scene: THREE.Scene, src: THREE.BufferGeometry, material: THREE.Material,
              m: { minX: number; maxX: number; minY: number; roadY: number; innerZ: number; dominoScale: number }) {
    const W = this.halfWidth / m.innerZ;           // échelle en travers
    const len = m.maxX - m.minX;
    const tiles = Math.max(3, Math.round(this.length / (len * W)));
    const tileLen = this.length / tiles;
    const roadTop = this.roadTop;
    const mapY = (y: number) => y <= m.roadY
      ? (y - m.minY) / (m.roadY - m.minY) * roadTop
      : roadTop + (y - m.roadY) * W * m.dominoScale;
    this.outerHalf = 0.258 * W;
    this.wallTop = mapY(m.roadY + 0.135);

    const P = src.getAttribute('position') as THREE.BufferAttribute;
    const Nm = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const UV = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const idx = src.index!.array;
    const nV = P.count;
    const pos = new Float32Array(nV * tiles * 3), nrm = new Float32Array(nV * tiles * 3), uv = new Float32Array(nV * tiles * 2);
    const roadSurf = new Uint8Array(nV * tiles);
    const sideOf = new Int8Array(nV * tiles), sAt = new Float32Array(nV * tiles), hiY = new Uint8Array(nV * tiles);
    for (let k = 0; k < tiles; k++) {
      for (let v = 0; v < nV; v++) {
        const x = Math.max(m.minX, Math.min(m.maxX, P.getX(v))), y = P.getY(v), z = P.getZ(v);
        const sv = (k + (x - m.minX) / len) * tileLen;
        const fr = this.frame(sv);
        const lat = -z * W;
        const o = k * nV + v;
        pos[o * 3] = fr.x + fr.nx * lat;
        pos[o * 3 + 1] = mapY(y);
        pos[o * 3 + 2] = fr.z + fr.nz * lat;
        if (Nm) {
          // repère local : X modèle → tangente, Z modèle → -normale, Y → haut
          const ax = Nm.getX(v), ay = Nm.getY(v), az = Nm.getZ(v);
          let qx = fr.tx * ax - fr.nx * az, qy = ay, qz = fr.tz * ax - fr.nz * az;
          const l = Math.hypot(qx, qy, qz) || 1;
          nrm[o * 3] = qx / l; nrm[o * 3 + 1] = qy / l; nrm[o * 3 + 2] = qz / l;
        }
        if (UV) { uv[o * 2] = UV.getX(v); uv[o * 2 + 1] = UV.getY(v); }
        sideOf[o] = Math.abs(z) > m.innerZ - 0.01 ? (lat > 0 ? 1 : -1) : 0;
        hiY[o] = y > m.roadY + 0.006 ? 1 : 0;
        roadSurf[o] = y > m.roadY - 0.012 ? 1 : 0;
        sAt[o] = sv;
      }
    }
    const index: number[] = [];
    for (let k = 0; k < tiles; k++) {
      const off = k * nV;
      for (let t = 0; t < idx.length; t += 3) {
        const a = off + idx[t], b = off + idx[t + 1], c = off + idx[t + 2];
        // triangles de dominos dans une brèche : supprimés
        // surface de la route du modèle : remplacée par notre revêtement propre
        if (!sideOf[a] && !sideOf[b] && !sideOf[c] && !hiY[a] && !hiY[b] && !hiY[c] && roadSurf[a] && roadSurf[b] && roadSurf[c]) continue;
        const side = sideOf[a] || sideOf[b] || sideOf[c];
        if (side && (hiY[a] || hiY[b] || hiY[c])) {
          const i = Math.floor((((sAt[a] % this.length) + this.length) % this.length) / this.length * this.N);
          if (!this.hasWall(i, side)) continue;
        }
        index.push(a, b, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (Nm) g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); 
    if (UV) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    if (!Nm) g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);

    // revêtement continu (asphalte + marquages), posé juste au-dessus de la base du modèle
    {
      const tex = asphaltTexture();
      tex.anisotropy = 16;
      const segLen = this.length / Math.max(1, Math.round(this.length / 44));
      const a = -this.halfWidth - 0.6, b = this.halfWidth + 0.6, y = roadTop + 0.06;
      const n = this.N, posR: number[] = [], uvR: number[] = [], idxR: number[] = [];
      for (let i = 0; i <= n; i++) {
        const sm = this.samples[i % n];
        posR.push(sm.x + sm.nx * a, y, sm.z + sm.nz * a, sm.x + sm.nx * b, y, sm.z + sm.nz * b);
        const v = (i / n) * this.length / segLen;
        uvR.push(0, v, 1, v);
      }
      for (let i = 0; i < n; i++) { const k = i * 2; idxR.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      const gR = new THREE.BufferGeometry();
      gR.setAttribute('position', new THREE.Float32BufferAttribute(posR, 3));
      gR.setAttribute('uv', new THREE.Float32BufferAttribute(uvR, 2));
      gR.setIndex(idxR);
      gR.computeVertexNormals();
      const nr = gR.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
      const road = new THREE.Mesh(gR, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0 }));
      road.receiveShadow = true;
      scene.add(road);
    }

    // ligne de départ / arrivée
    const s0 = this.samples[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.halfWidth * 2, 3),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(s0.tx, s0.tz);
    line.position.set(s0.x, roadTop + 0.07, s0.z);
    line.receiveShadow = true;
    scene.add(line);

    // portique de départ (crayons + banderole)
    const hw = this.outerHalf;
    const pencil = (color: number) => {
      const g2 = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 18, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      body.position.y = 9;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xf1d2a0 }));
      tip.position.y = 19.1;
      g2.add(body, tip);
      body.castShadow = tip.castShadow = true;
      return g2;
    };
    const p1 = pencil(0x2f6fd6), p2 = pencil(0xe23b3b);
    p1.position.set(s0.x + s0.nx * (hw + 1.5), 0, s0.z + s0.nz * (hw + 1.5));
    p2.position.set(s0.x - s0.nx * (hw + 1.5), 0, s0.z - s0.nz * (hw + 1.5));
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3, 2.6, 0.2),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }));
    banner.position.set(s0.x, 16.5, s0.z);
    banner.lookAt(s0.x + s0.tx, 16.5, s0.z + s0.tz);
    banner.castShadow = true;
    scene.add(p1, p2, banner);
    return { tiles, W };
  }
}
