import fs from 'node:fs/promises';
import path from 'node:path';
import validator from 'gltf-validator';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/models/manifest.json'), 'utf8'));
const report = [];
for (const config of manifest) {
  const bytes = await fs.readFile(path.join(root, 'public', config.file));
  const validation = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 2000 });
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const names = new Set(gltf.nodes.map(n => n.name));
  const required = ['AERO_CAR', 'DRS_BASE', config.drs.pivot, config.drs.attachment, config.drs.cylinder, config.drs.rod,
    ...Object.values(config.wheels).flatMap(w => [w.steer, w.spin])];
  const missing = required.filter(n => !names.has(n));
  const triangles = gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((s, primitive) => s + (gltf.accessors[primitive.indices]?.count || 0) / 3, 0), 0);
  const record = { model: config.id, bytes: bytes.length, triangles, nodes: gltf.nodes.length,
    images: gltf.images?.length, errors: validation.issues.numErrors, warnings: validation.issues.numWarnings,
    missingRigNodes: missing,
    informationalCounts: validation.issues.messages.filter(m => m.severity > 1).reduce((counts, m) => {
      counts[m.code] = (counts[m.code] || 0) + 1;return counts;
    }, {}),
    messages: validation.issues.messages.filter(m => m.severity <= 1) };
  report.push(record);
  console.log(JSON.stringify({ ...record, messages: record.messages.slice(0, 8) }));
  if (record.errors || missing.length) process.exitCode = 1;
}
await fs.writeFile(path.join(root, '../docs/research/web-asset-validation.json'), JSON.stringify(report, null, 2) + '\n');
