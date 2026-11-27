import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig, applyRig } from '../src/rig.js';
import { describeModel, snapshotRig } from '../src/flow-worker-protocol.js';
import { captureCondition } from '../src/flow-condition.js';
import { readCatalog } from '../src/flow-catalog.js';

T.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
T.Mesh.prototype.raycast = acceleratedRaycast;

const publicFile = file => new URL(`../public${file}`, import.meta.url);
const catalog = readCatalog(JSON.parse(await fs.readFile(publicFile('/flow/rb16b/display/manifest.json'), 'utf8')), 'rb16b');
const baseNode = catalog.byId.get('base');
const [raw, mask] = await Promise.all([fs.readFile(publicFile(baseNode.file)), fs.readFile(publicFile(baseNode.mask))]);
const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const field = {
  id: baseNode.id,
  velocity: Float32Array.from({ length: raw.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true) * baseNode.scale),
  mask: new Uint8Array(mask),
};

const { model, config } = await loadGeometry('rb16b');
const rig = bindRig(model, config);
model.traverse(item => { if (item.isMesh) { item.geometry.computeBoundsTree(); item.material.side = T.DoubleSide; } });
applyRig(rig, { steer: 0, drs: 0, spin: 0 });
model.updateMatrixWorld(true);

const worker = new Worker(new URL('./flow-worker-node.mjs', import.meta.url));
const request = message => new Promise((resolve, reject) => {
  const fail = err => { worker.off('message', done); reject(err); };
  const done = reply => {
    worker.off('error', fail);
    if (reply.type === 'error') reject(new Error(reply.message));
    else resolve(reply);
  };
  worker.once('message', done);
  worker.once('error', fail);
  worker.postMessage(message);
});

try {
  const { meshes, description } = describeModel(rig);
  const versions = meshes.map(m => m.geometry.attributes.position.version);
  await request({ type: 'init', car: 'rb16b', meshes: description });

  const condition = captureCondition({ model: 'rb16b', groundSpeed: 180, windAngle: 0, steer: 0, drs: 0, drsCurrent: 0, flowDensity: 100 });
  const res = await request({
    type: 'compute',
    id: 1,
    key: 'rb16b-smoke-slice',
    condition,
    grid: catalog.grids[baseNode.grid],
    sources: [{ id: baseNode.id, weight: 1 }],
    deltas: [],
    fields: [field],
    smoke: true,
    smokeRakeX: 0,
    slice: { axis: 'x', position: 0, metric: 'speed', refSpeedMps: 50 },
    rig: snapshotRig(rig, meshes, versions),
  });

  // 1. Smoke rake geometry check
  assert(res.smoke && res.smoke.lines >= 7, `Expected >=7 smoke ribbons, got ${res.smoke?.lines}`);
  assert(res.smoke.attributes.position.length > 1000 && res.smoke.attributes.position.every(Number.isFinite));
  assert(res.smoke.attributes.sideDir.length === res.smoke.attributes.position.length);
  assert(Array.isArray(res.smoke.rakeOrigin) && res.smoke.rakeOrigin.length === 4);

  // 2. PIV speed slice check (88x32)
  assert(res.slice && res.slice.width === 88 && res.slice.height === 32);
  let opaque = 0, cutout = 0;
  for (let i = 3; i < res.slice.rgba.length; i += 4) {
    if (res.slice.rgba[i] > 0) opaque++; else cutout++;
  }
  assert(opaque > 1500 && cutout > 30, `Slice must have both fluid (${opaque}) and car cutout (${cutout}) pixels`);

  // 3. Standalone vorticity slice check (horizontal Y floor plane)
  const t0 = performance.now();
  const vort = await request({
    type: 'slice',
    id: 2,
    slice: { axis: 'y', position: 0.18, metric: 'vorticity', refSpeedMps: 50 },
  });
  const sliceMs = performance.now() - t0;
  assert(vort.slice && vort.slice.width === 34 && vort.slice.height === 88);
  let vortLit = 0;
  for (let i = 3; i < vort.slice.rgba.length; i += 4) if (vort.slice.rgba[i] > 20) vortLit++;
  assert(vortLit > 100, `Vorticity slice should illuminate wake vortices (${vortLit} lit pixels)`);

  // 4. Virtual Pitot Probe check (freestream valid, solid chassis masked when allowMarch=false, near-wall marching succeeds when allowMarch=true)
  const pFree = await request({ type: 'probe', id: 3, point: [0, 0.85, 3.2] });
  assert.equal(pFree.probe.valid, true, 'Upstream freestream point must be valid');
  assert(pFree.probe.speedKmh > 140 && pFree.probe.speedKmh < 210, `Freestream speed expected ~180 km/h, got ${pFree.probe.speedKmh}`);
  const pSolid = await request({ type: 'probe', id: 4, point: [0, 0.35, 0.0] });
  assert.equal(pSolid.probe.valid, false, 'Interior chassis point must be masked invalid when allowMarch=false');
  const pNearWall = await request({
    type: 'probe',
    id: 5,
    point: { point: [0.68, 0.42, 0.35], normal: [1, 0.2, 0], viewDir: [0.8, 0.4, 0.4], allowMarch: true },
  });
  assert.equal(pNearWall.probe.valid, true, 'Close-up near-wall car surface hover with allowMarch=true must snap to valid fluid');
  assert(pNearWall.probe.speedKmh > 20 && pNearWall.probe.speedKmh < 300, `Near-wall fluid speed out of range: ${pNearWall.probe.speedKmh}`);

  console.log(`Expansion worker checks passed: smoke=${res.smoke.lines} ribbons, sliceX=${opaque} fluid/${cutout} cutout, vortY=${vortLit} lit (${sliceMs.toFixed(1)} ms), probe=${pFree.probe.speedKmh.toFixed(1)} km/h, nearWall=${pNearWall.probe.speedKmh.toFixed(1)} km/h`);
} finally {
  await worker.terminate();
}
