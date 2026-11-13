// Pré-calcule, pour chaque modèle, une grille d'intervalles solides verticaux [bas, haut] (coordonnées du modèle)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import fs from 'fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const out = {};
for (const name of process.argv.slice(2)) {
  const doc = await io.read(`/home/claude/assets_hd/${name}.glb`);
  const pos = [], idx = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const mat = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION'); const base = pos.length / 3;
      const v = new THREE.Vector3(), el = [];
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, el); v.fromArray(el).applyMatrix4(mat); pos.push(v.x, v.y, v.z); }
      const ix = p.getIndices(); for (let i = 0; i < ix.getCount(); i++) idx.push(base + ix.getScalar(i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const bvh = new MeshBVH(g);
  const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
  const cell = Math.max(sx, sz) / 128;
  const nx = Math.ceil(sx / cell), nz = Math.ceil(sz / cell);
  const K = 3; const data = new Array(nx * nz * K * 2).fill(0);
  // intervalles issus des triangles (murs fins) : échantillonnage de chaque triangle
  const triIv = Array.from({ length: nx * nz }, () => []);
  const P = g.attributes.position.array, I = g.index.array;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), Q = new THREE.Vector3();
  for (let t = 0; t < I.length; t += 3) {
    A.fromArray(P, I[t] * 3); B.fromArray(P, I[t + 1] * 3); C.fromArray(P, I[t + 2] * 3);
    const n = Math.max(2, Math.ceil(Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)) / (cell * 0.4)));
    const local = new Map();
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
      const u = a / n, v = b / n, w = 1 - u - v;
      Q.set(A.x * w + B.x * u + C.x * v, A.y * w + B.y * u + C.y * v, A.z * w + B.z * u + C.z * v);
      const i = Math.floor((Q.x - bb.min.x) / cell), j = Math.floor((Q.z - bb.min.z) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const key = j * nx + i; const r = local.get(key);
      if (r) { r[0] = Math.min(r[0], Q.y); r[1] = Math.max(r[1], Q.y); } else local.set(key, [Q.y, Q.y]);
    }
    for (const [key, r] of local) triIv[key].push(r);
  }
  const ray = new THREE.Ray(); const down = new THREE.Vector3(0, -1, 0);
  let solidCells = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = bb.min.x + (i + 0.5) * cell, z = bb.min.z + (j + 0.5) * cell;
    ray.origin.set(x, bb.max.y + 1, z); ray.direction.copy(down);
    const hits = bvh.raycast(ray, THREE.DoubleSide).sort((a, b) => a.point.y - b.point.y).reverse();
    // fusion des intersections : on parcourt du haut vers le bas, une face orientée vers le haut ouvre un solide
    // parité : 1er impact = entrée (dessus), 2e = sortie (dessous)… (indépendant de l'orientation des faces)
    const ys = [];
    for (const h of hits) if (!ys.length || ys[ys.length - 1] - h.point.y > 0.0015) ys.push(h.point.y);
    const iv = [];
    for (let k = 0; k < ys.length; k += 2) iv.push([k + 1 < ys.length ? ys[k + 1] : bb.min.y, ys[k]]);
    for (const r of triIv[j * nx + i]) iv.push([r[0], r[1]]);
    // fusionner les intervalles qui se touchent, garder les K plus hauts
    iv.sort((a, b) => b[1] - a[1]);
    const merged = [];
    for (const it of iv) { const m = merged[merged.length - 1]; if (m && m[0] - it[1] < 0.006) m[0] = Math.min(m[0], it[0]); else merged.push([...it]); }
    for (let k = 0; k < Math.min(K, merged.length); k++) { const o = ((j * nx + i) * K + k) * 2; data[o] = merged[k][0]; data[o + 1] = merged[k][1]; }
    if (merged.length) solidCells++;
  }
  // quantification 16 bits relative à la boîte
  const hy = bb.max.y - bb.min.y;
  const q = new Uint16Array(data.length);
  for (let k = 0; k < data.length; k += 2) {
    if (data[k] === 0 && data[k + 1] === 0) { q[k] = 0; q[k + 1] = 0; continue; }
    q[k] = Math.round((data[k] - bb.min.y) / hy * 65000) + 1; q[k + 1] = Math.round((data[k + 1] - bb.min.y) / hy * 65000) + 1;
  }
  out[name] = { min: bb.min.toArray(), max: bb.max.toArray(), cell, nx, nz, K, data: Buffer.from(q.buffer).toString('base64') };
  // carte ASCII : hauteur max (0-9) vue de dessus
  let s = '';
  for (let j = 0; j < nz; j += 5) { for (let i = 0; i < nx; i += 3) { const o = ((j * nx + i) * K) * 2; const t = data[o + 1]; s += (data[o] === 0 && t === 0) ? '.' : String(Math.min(9, Math.floor((t - bb.min.y) / hy * 10))); } s += '\n'; }
  console.log(name, `grid ${nx}x${nz} cell=${cell.toFixed(4)} solid=${solidCells}`); console.log(s);
}
fs.writeFileSync('/home/claude/assets_hd/heightfields.json', JSON.stringify(out));
