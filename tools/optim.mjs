import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, meshopt, resample, quantize, reorder, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const [inp, out, targetTris, texSize] = process.argv.slice(2);
const doc = await io.read(inp);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
const ratio = Math.min(1, Number(targetTris) / tris);
await doc.transform(
  dedup(),
  weld({}),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(texSize), Number(texSize)], quality: 82 }),
);
// textures normales/MR plus petites
let t2 = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t2 += p.getIndices().getCount() / 3;
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log(inp.split('/').pop(), Math.round(tris), '->', Math.round(t2));
