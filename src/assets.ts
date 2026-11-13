import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const MODEL_NAMES = ['car', 'table', 'track_straight', 'tunnel', 'soap', 'mug', 'juicebox', 'track_ramp'] as const;
export type ModelName = typeof MODEL_NAMES[number];

/** Grille d'intervalles solides verticaux pré-calculée hors-ligne (voir tools/heightfield.mjs) */
export interface HeightField {
  min: [number, number, number]; max: [number, number, number];
  cell: number; nx: number; nz: number; K: number;
  q: Uint16Array;
}

export interface Assets {
  models: Record<ModelName, THREE.Group>;
  hf: Record<string, HeightField>;
}

export async function loadAssets(set: 'hd' | 'sd', onProgress: (p: number) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = './assets/';
  let done = 0;
  const total = MODEL_NAMES.length + 1;
  const tick = () => onProgress(++done / total);
  const models = {} as Record<ModelName, THREE.Group>;
  const jobs: Promise<void>[] = MODEL_NAMES.map(async (n) => {
    // modèles stockés en base64 dans du JSON (le serveur d'artefacts ne sert pas les .glb)
    const j = await (await fetch(base + set + '/' + n + '.model.json')).json();
    const bin = atob(j.glb);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const g = await loader.parseAsync(buf.buffer, '');
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (t) t.anisotropy = 16;
      }
    });
    models[n] = g.scene;
    tick();
  });
  const hfJob = fetch(base + 'heightfields.json').then((r) => r.json()).then((j) => {
    const out: Record<string, HeightField> = {};
    for (const k of Object.keys(j)) {
      const bin = atob(j[k].data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      out[k] = { ...j[k], q: new Uint16Array(buf.buffer) };
    }
    tick();
    return out;
  });
  const [, hf] = await Promise.all([Promise.all(jobs), hfJob]);
  return { models, hf };
}

/** Géométrie du premier mesh d'un modèle, en coordonnées du modèle et en flottants (déquantifiée) */
export function extractGeometry(root: THREE.Object3D): { geo: THREE.BufferGeometry; material: THREE.Material } {
  let mesh: THREE.Mesh | null = null;
  root.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
  const m = mesh! as THREE.Mesh;
  const src = m.geometry;
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  geo.setIndex(src.index ? Array.from(src.index.array) : null);
  m.updateMatrixWorld(true);
  geo.applyMatrix4(m.matrixWorld);
  return { geo, material: m.material as THREE.Material };
}

/** Objet posé dans le monde, avec sa grille de hauteurs */
export class Prop {
  obj: THREE.Object3D;
  private c: number; private s: number;
  constructor(model: THREE.Object3D, public hf: HeightField | null,
              public x: number, public y: number, public z: number, public rot: number,
              public sx: number, public sy: number, public sz: number) {
    this.obj = model.clone(true);
    this.obj.position.set(x, y, z);
    this.obj.rotation.y = rot;
    this.obj.scale.set(sx, sy, sz);
    this.c = Math.cos(rot); this.s = Math.sin(rot);
  }

  /** Remplit `out` avec les intervalles solides [bas, haut] (monde) au point (x,z). Renvoie leur nombre. */
  intervals(wx: number, wz: number, out: number[]): number {
    const h = this.hf;
    if (!h) return 0;
    const dx = wx - this.x, dz = wz - this.z;
    // inverse de la rotation Y de three.js
    const lx = (dx * this.c - dz * this.s) / this.sx;
    const lz = (dx * this.s + dz * this.c) / this.sz;
    const i = Math.floor((lx - h.min[0]) / h.cell), j = Math.floor((lz - h.min[2]) / h.cell);
    if (i < 0 || j < 0 || i >= h.nx || j >= h.nz) return 0;
    const hy = h.max[1] - h.min[1];
    let n = 0;
    for (let k = 0; k < h.K; k++) {
      const o = ((j * h.nx + i) * h.K + k) * 2;
      const a = h.q[o], b = h.q[o + 1];
      if (a === 0 && b === 0) continue;
      out[n * 2] = this.y + (h.min[1] + (a - 1) / 65000 * hy) * this.sy;
      out[n * 2 + 1] = this.y + (h.min[1] + (b - 1) / 65000 * hy) * this.sy;
      n++;
    }
    return n;
  }

  /** Point du monde correspondant à un point du modèle */
  toWorld(mx: number, my: number, mz: number): THREE.Vector3 {
    const lx = mx * this.sx, lz = mz * this.sz;
    return new THREE.Vector3(this.x + lx * this.c + lz * this.s, this.y + my * this.sy, this.z - lx * this.s + lz * this.c);
  }
}
