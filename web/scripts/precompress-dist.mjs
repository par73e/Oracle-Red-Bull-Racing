import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const distDir = path.resolve(import.meta.dirname, '../dist');
const COMPRESS_EXTS = new Set(['.html', '.js', '.css', '.json', '.glb', '.bin', '.hdr', '.wasm', '.txt', '.csv']);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(distDir);
let created = 0;
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESS_EXTS.has(ext)) continue;
  const raw = await fs.readFile(file);
  if (raw.length < 1024) continue;
  const gz = zlib.gzipSync(raw, { level: 9 });
  if (gz.length < raw.length * 0.98) {
    await fs.writeFile(`${file}.gz`, gz);
    created++;
  }
}
console.log(`Precompressed ${created} static assets in dist/`);
