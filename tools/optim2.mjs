import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, meshopt, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
// usage: entree sortie trianglesCible tailleCouleur tailleNormale tailleAutres
const [inp, out, targetTris, cSize, nSize, oSize] = process.argv.slice(2);
const outDir = out;
const doc = await io.read(inp);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
const ratio = Math.min(1, Number(targetTris) / tris);
await doc.transform(
  dedup(), weld({}),
  // erreur faible : la simplification s'arrête avant d'abîmer la forme
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0015 }),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /baseColor/, resize: [+cSize, +cSize], quality: 92 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /normal/, resize: [+nSize, +nSize], quality: 90 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /metallicRoughness|occlusion|emissive/, resize: [+oSize, +oSize], quality: 85 }),
);
let t2 = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t2 += p.getIndices().getCount() / 3;
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log(out.split('/').pop(), Math.round(tris), '->', Math.round(t2));
