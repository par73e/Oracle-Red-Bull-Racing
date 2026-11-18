import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '..');
const modelsDir = path.join(root, 'public/models');
const manifestPath = path.join(modelsDir, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aero-web-glb-'));
try {
  for (const config of manifest) {
    const car = config.id;
    const srcPath = path.join(modelsDir, `${car}.glb`);
    const outPath = path.join(modelsDir, `${car}.web.glb`);
    const doc = await io.read(srcPath);
    const rootNode = doc.getRoot();
    const normalTextures = new Set();
    for (const mat of rootNode.listMaterials()) {
      const nt = mat.getNormalTexture();
      if (nt) normalTextures.add(nt);
    }

    let idx = 0;
    for (const tex of rootNode.listTextures()) {
      const mime = tex.getMimeType();
      if (mime !== 'image/png' && mime !== 'image/jpeg') continue;
      const img = tex.getImage();
      if (!img || img.byteLength < 8192) continue;
      const inFile = path.join(tmpDir, `${car}_${idx}.img`);
      const outFile = path.join(tmpDir, `${car}_${idx}.webp`);
      await fs.writeFile(inFile, img);
      const isNormal = normalTextures.has(tex);
      const args = isNormal
        ? ['-q', '96', '-m', '6', '-quiet', inFile, '-o', outFile]
        : ['-q', '92', '-m', '6', '-quiet', inFile, '-o', outFile];
      execFileSync('cwebp', args);
      const webp = await fs.readFile(outFile);
      if (webp.byteLength < img.byteLength) {
        tex.setImage(webp);
        tex.setMimeType('image/webp');
      }
      idx++;
    }

    await doc.transform(
      dedup({ propertyTypes: [PropertyType.TEXTURE, PropertyType.ACCESSOR] }),
      meshopt({ encoder: MeshoptEncoder, level: 'high' })
    );
    await io.write(outPath, doc);
    const webBytes = await fs.readFile(outPath);
    const hash = crypto.createHash('sha256').update(webBytes).digest('hex').slice(0, 12);
    config.web_file = `/models/${car}.web.glb`;
    config.web_glb_bytes = webBytes.length;
    config.web_revision = `${config.revision || 'v1'}-${hash}`;
    console.log(`${car}: ${(await fs.stat(srcPath)).size} B -> ${webBytes.length} B (${config.web_revision})`);
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
