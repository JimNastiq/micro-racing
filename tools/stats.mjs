import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  let tris = 0, verts = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); const pos = p.getAttribute('POSITION');
    verts += pos.getCount(); tris += idx ? idx.getCount() / 3 : pos.getCount() / 3;
  }
  const b = getBounds(root.listScenes()[0]);
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2));
  const tex = root.listTextures().map(t => { const s = t.getSize(); return `${t.getMimeType().split('/')[1]}${s ? s.join('x') : ''}`; });
  const mats = root.listMaterials().map(m => `${m.getName()}[base:${!!m.getBaseColorTexture()} nrm:${!!m.getNormalTexture()} mr:${!!m.getMetallicRoughnessTexture()} emis:${!!m.getEmissiveTexture()}]`);
  console.log(f.split('/').pop(), `meshes=${root.listMeshes().length} tris=${Math.round(tris)} verts=${verts} size=${size.join('x')} min=${b.min.map(v=>v.toFixed(2))}`, 'tex=', tex.join(','), mats.join(' '));
}
