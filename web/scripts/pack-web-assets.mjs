/** Keep geometry/4K resolution; quantize 16-bit PNG channels to web-standard 8-bit. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);name.copy(result, 4);data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function png8(png) {
  if (png.readUInt32BE(0) !== 0x89504e47 || png[24] !== 16) return png;
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), color = png[25];
  if (![2, 6].includes(color) || png[28] !== 0) throw new Error('Unsupported 16-bit PNG');
  const channels = color === 2 ? 3 : 4, bpp = channels * 2, stride = width * bpp;
  const parts = [], ancillary = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') parts.push(data);
    else if (['gAMA', 'cHRM', 'sRGB', 'iCCP'].includes(type)) ancillary.push(chunk(type, data));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const outputStride = width * channels, output = Buffer.alloc((outputStride + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const inputOffset = y * (stride + 1), filter = raw[inputOffset];
    const row = Buffer.from(raw.subarray(inputOffset + 1, inputOffset + stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = previous[x], c = x >= bpp ? previous[x - bpp] : 0;
      if (filter === 1) row[x] += a;
      else if (filter === 2) row[x] += b;
      else if (filter === 3) row[x] += Math.floor((a + b) / 2);
      else if (filter === 4) row[x] += paeth(a, b, c);
      else if (filter !== 0) throw new Error('Unknown PNG filter');
    }
    const o = y * (outputStride + 1);output[o] = 1;
    // Sub-filter the quantized channels before compression.
    for (let x = 0; x < outputStride; x++) output[o + x + 1] = (row[x * 2] - (x >= channels ? row[(x - channels) * 2] : 0)) & 255;
    previous = row;
  }
  const header = Buffer.from(png.subarray(16, 29));header[8] = 8;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), ...ancillary, chunk('IDAT', deflateSync(output, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const root = path.resolve(import.meta.dirname, '../..');
const previousReport = JSON.parse(await fs.readFile(path.join(root, 'docs/research/asset-packing.json'), 'utf8').catch(() => '[]'));
const models = [], report = [];
for (const car of ['rb19', 'rb16b']) {
  const dir = path.join(root, 'assets/exports', car), file = path.join(dir, `${car}.glb`);
  const bytes = await fs.readFile(file), jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const binary = bytes.subarray(28 + jsonSize);
  let repairedTangents = 0;
  const checked = new Set();
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const material = gltf.materials[primitive.material];
    const textureCoords = new Set();
    function textureReferences(object) {
      if (!object || typeof object !== 'object') return;
      if (typeof object.index === 'number') textureCoords.add(object.extensions?.KHR_texture_transform?.texCoord ?? object.texCoord ?? 0);
      for (const value of Object.values(object)) if (value && typeof value === 'object') textureReferences(value);
    }
    textureReferences(material);
    for (const attribute of Object.keys(primitive.attributes)) {
      if (attribute.startsWith('TEXCOORD_') && !textureCoords.has(Number(attribute.slice(9)))) delete primitive.attributes[attribute];
    }
    if (!material?.normalTexture) { delete primitive.attributes.TANGENT;continue; }
    const tangentIndex = primitive.attributes.TANGENT;
    if (tangentIndex === undefined || checked.has(tangentIndex)) continue;
    checked.add(tangentIndex);
    const accessor = gltf.accessors[tangentIndex], normal = gltf.accessors[primitive.attributes.NORMAL];
    if (accessor.componentType !== 5126 || normal.componentType !== 5126) throw new Error('Expected float tangent/normal');
    const view = gltf.bufferViews[accessor.bufferView], nView = gltf.bufferViews[normal.bufferView];
    for (let i = 0; i < accessor.count; i++) {
      const o = (view.byteOffset || 0) + (accessor.byteOffset || 0) + i * (view.byteStride || 16);
      const x = binary.readFloatLE(o), y = binary.readFloatLE(o + 4), z = binary.readFloatLE(o + 8);
      if (Math.hypot(x, y, z) > .999) continue;
      const n = (nView.byteOffset || 0) + (normal.byteOffset || 0) + i * (nView.byteStride || 12);
      const nx = binary.readFloatLE(n), ny = binary.readFloatLE(n + 4), nz = binary.readFloatLE(n + 8);
      // Degenerate UV triangles have no unique tangent: choose a unit vector
      // perpendicular to their supplied normal rather than exporting zero.
      let tx, ty, tz;
      if (Math.abs(ny) < .9) { tx = nz;ty = 0;tz = -nx; }
      else { tx = 0;ty = -nz;tz = ny; }
      const length = Math.hypot(tx, ty, tz) || 1;
      binary.writeFloatLE(tx / length, o);binary.writeFloatLE(ty / length, o + 4);binary.writeFloatLE(tz / length, o + 8);
      repairedTangents++;
    }
  }
  const imageViews = new Set(gltf.images.filter(i => i.mimeType === 'image/png').map(i => i.bufferView));
  const buffers = [];let offset = 0, converted = 0;
  for (const [i, view] of gltf.bufferViews.entries()) {
    let data = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    if (imageViews.has(i)) { const next = png8(data);if (next !== data) converted++;data = next; }
    view.byteOffset = offset;view.byteLength = data.length;
    buffers.push(data);offset += data.length;
    if (offset % 4) { const padding = Buffer.alloc(4 - offset % 4);buffers.push(padding);offset += padding.length; }
  }
  gltf.buffers[0].byteLength = offset;
  const jsonRaw = Buffer.from(JSON.stringify(gltf)), json = Buffer.alloc(Math.ceil(jsonRaw.length / 4) * 4, 0x20);jsonRaw.copy(json);
  const bin = Buffer.concat(buffers), header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2, 4);header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942, 4);
  const packed = Buffer.concat([header, json, binHeader, bin]);
  await fs.writeFile(file, packed);
  await fs.copyFile(file, path.join(root, 'web/public/models', `${car}.glb`));
  const config = JSON.parse(await fs.readFile(path.join(dir, `${car}.json`), 'utf8'));
  config.glb_bytes = packed.length;
  config.texture_encoding = 'PNG 8-bit; source resolution retained';
  await fs.writeFile(path.join(dir, `${car}.json`), JSON.stringify(config, null, 2) + '\n');models.push(config);
  const previous = previousReport.find(r => r.car === car);
  report.push({ car, sourceBytes: Math.max(bytes.length, previous?.sourceBytes || 0), webBytes: packed.length,
    convertedPngImages: Math.max(converted, previous?.convertedPngImages || 0), repairedTangents, resolutionChanged: false });
}
await fs.writeFile(path.join(root, 'web/public/models/manifest.json'), JSON.stringify(models, null, 2) + '\n');
await fs.writeFile(path.join(root, 'docs/research/asset-packing.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
