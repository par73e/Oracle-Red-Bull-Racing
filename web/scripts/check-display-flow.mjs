import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig, applyRig } from '../src/rig.js';
import { describeModel, snapshotRig } from '../src/flow-worker-protocol.js';
import { captureCondition } from '../src/flow-condition.js';
import { FlowCatalog, readCatalog, selectCoverage } from '../src/flow-catalog.js';

T.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
T.Mesh.prototype.raycast = acceleratedRaycast;
const publicFile = file => new URL(`../public${file}`, import.meta.url);
const decode = async node => {
  const [raw, mask] = await Promise.all([fs.readFile(publicFile(node.file)), fs.readFile(publicFile(node.mask))]);
  assert.equal(createHash('sha256').update(raw).digest('hex'), node.sha256);
  assert.equal(createHash('sha256').update(mask).digest('hex'), node.maskSha256);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return { id: node.id, velocity: Float32Array.from({ length: raw.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true) * node.scale), mask: new Uint8Array(mask) };
};
const measure = process.argv[2] === '--measure';
const catalogFrom = file => fs.readFile(file).then(JSON.parse);
const cases = JSON.parse(await fs.readFile(new URL('./flow-audit-cases.json', import.meta.url)));
const baseline = { groundSpeed: 10, ambientWindMps: 0, windAngle: 0, steer: 0, drsCurrent: 0, flowDensity: 100 };
const makeCondition = (model, input) => captureCondition({ model, ...baseline, ...input });

function inspectGeometry(result, model) {
  const ray = new T.Raycaster(), origin = new T.Vector3(), direction = new T.Vector3();
  ray.firstHitOnly = true;
  for (const [name, layer] of Object.entries(result.layers)) {
    const { position, flight, color, lineAlpha } = layer.attributes;
    assert.equal(position.length / 3, flight.length);
    assert.equal(position.length, color.length);
    assert.equal(flight.length, lineAlpha.length);
    assert(position.every(Number.isFinite) && flight.every(Number.isFinite));
    assert(lineAlpha.every(a => a >= 0 && a <= 1));
    for (let i = 0; i < position.length; i += 6) {
      origin.fromArray(position, i);
      direction.fromArray(position, i + 3).sub(origin);
      const length = direction.length();
      ray.set(origin, direction.divideScalar(length));
      ray.near = .00002;
      ray.far = length - .00002;
      assert.equal(ray.intersectObject(model, true).length, 0, `${name} crosses the displayed car`);
    }
  }
}

// Compare where matched seeds cross physical planes. Path truncation is recorded separately.
function crossPlanes(layer) {
  const crossings = new Map();
  const { position, flight } = layer.attributes;
  let seed;
  for (let i = 0; i < flight.length; i += 2) {
    const j = 3 * i;
    if (flight[i] === 0) seed = [...position.subarray(j, j + 3)].map(x => x.toFixed(5)).join(',');
    const start = position[j + 2], end = position[j + 5];
    for (const z of [2, 0, -1.4, -2.8, -3.5]) {
      const k = `${seed}:${z}`;
      if (!(start > z && end <= z) || crossings.has(k)) continue;
      const t = (start - z) / (start - end);
      crossings.set(k, [0, 1].map(axis => T.MathUtils.lerp(position[j + axis], position[j + 3 + axis], t)));
    }
  }
  return crossings;
}
function trajectoryComparison(a, b) {
  const actual = crossPlanes(a), expected = crossPlanes(b), errors = [];
  for (const [key, [x, y]] of actual) {
    if (expected.has(key)) {
      const [xe, ye] = expected.get(key);
      errors.push(Math.hypot(x - xe, y - ye));
    }
  }
  errors.sort((x, y) => x - y);
  return { compare: errors.length, a: actual.size, b: expected.size,
    p90: errors.length ? +errors[Math.round((errors.length - 1) * .9)].toFixed(4) : null };
}

const cars = measure ? [process.argv[3]] : ['rb19', 'rb16b'];
for (const modelId of cars) {
  const catalogPath = measure ? process.argv[4] : publicFile(`/flow/${modelId}/display/manifest.json`);
  const reportPath = measure ? process.argv[5] : new URL(`../../cfd/library/reports/${modelId}-display-validation.json`, import.meta.url);
  const catalog = readCatalog(await catalogFrom(catalogPath), modelId);
  const { model, config } = await loadGeometry(modelId);
  const rig = bindRig(model, config);
  model.traverse(item => { if (item.isMesh) { item.geometry.computeBoundsTree(); item.material.side = T.DoubleSide; } });
  const worker = new Worker(new URL('./flow-worker-node.mjs', import.meta.url));
  const request = message => new Promise((resolve, reject) => {
    const fail = error => { worker.off('message', done); reject(error); };
    const done = reply => { worker.off('error', fail); if (reply.type === 'error') reject(new Error(reply.message)); else resolve(reply); };
    worker.once('message', done);
    worker.once('error', fail);
    worker.postMessage(message);
  });
  const { meshes, description } = describeModel(rig);
  const versions = meshes.map(mesh => mesh.geometry.attributes.position.version);
  let id = 0;
  const trace = async (condition, selection, stepScale = 1) => {
    applyRig(rig, { steer: condition.steer, drs: condition.drs, spin: 0 });
    model.updateMatrixWorld(true);
    return request({ type: 'compute', id: ++id, key: id, condition, stepScale,
      fields: await Promise.all(selection.sources.map(({ node }) => decode(node))),
      grid: selection.grid, sources: selection.sources.map(({ node, weight }) => ({ id: node.id, weight })),
      rig: snapshotRig(rig, meshes, versions) });
  };
  try {
    await request({ type: 'init', car: modelId, meshes: description });
    if (!measure) await checkRuntime();
    const report = await catalogFrom(reportPath);
    const decisions = [];
    for (const item of report.checks.filter(item => item.vectorPassed)) {
      const mid = catalog.byId.get(item.heldOut), [a, b] = item.endpoints.map(key => catalog.byId.get(key));
      const condition = { ...makeCondition(modelId, {}), speed: mid.at[0] * 3.6, wheelSpeedMps: mid.at[1],
        effWindAngle: mid.at[2], steer: mid.at[3], drs: mid.at[4], coordinates: mid.at };
      const exact = await trace(condition, { grid: catalog.grids[mid.grid], sources: [{ node: mid, weight: 1 }] });
      const prediction = await trace(condition, { grid: catalog.grids[mid.grid], sources: [{ node: a, weight: 1 - item.weight }, { node: b, weight: item.weight }] });
      inspectGeometry(prediction, model);
      const comparisons = Object.fromEntries(Object.keys(exact.layers).map(name => [name, trajectoryComparison(prediction.layers[name], exact.layers[name])]));
      const passed = Object.values(comparisons).every(result => !result.b || result.compare >= result.b * .85 && result.p90 < .06);
      decisions.push({ heldOut: item.heldOut, endpoints: item.endpoints, comparisons, trajectoryPassed: passed });
      if (!measure) {
        assert.equal(passed, item.passed, `${modelId}/${item.heldOut} trajectory verdict drifted`);
        console.log(`${modelId} ${item.heldOut} ${passed ? 'accepted' : 'excluded'} interpolation`, comparisons);
      }
    }
    if (measure) console.log(JSON.stringify(decisions));
  } finally { await worker.terminate(); }

  async function checkRuntime() {
    const modes = {};
    for (const [, label, groundSpeed, ambientWindMps, windAngle, steer, drs, drsCurrent] of cases.filter(([car]) => car === modelId)) {
      const condition = makeCondition(modelId, { groundSpeed, ambientWindMps, windAngle, steer, drs, drsCurrent });
      if (condition.speed === 0 && condition.wheelSpeedMps === 0) { modes[label] = 'rest'; continue; }
      const selection = selectCoverage(catalog, condition.coordinates);
      modes[label] = selection.mode;
      if (selection.mode === 'unsupported') continue;
      const result = await trace(condition, selection);
      assert(result.layers.whole.lines > 0, `${modelId}/${label} must show traces`);
      for (const layer of Object.values(result.layers)) assert(layer.attributes.position.every(Number.isFinite));
      assert.equal(result.key, id);
    }
    assert.equal(modes['low-closed'], 'exact');
    assert.equal(modes['low-open'], 'exact');
    for (const drsCurrent of [.25, .75]) {
      const partOpen = makeCondition(modelId, { drsCurrent });
      assert.equal(selectCoverage(catalog, partOpen.coordinates).mode, 'interpolated');
    }
    if (modelId === 'rb16b') {
      const drsNodes = [0, .25, .5, .75, 1];
      const forces = new FlowCatalog();
      forces.catalog = catalog;
      for (let i = 0; i <= 8; i++) {
        const drsCurrent = i / 8;
        const atSpeed = makeCondition(modelId, { groundSpeed: 180, drsCurrent });
        const expected = drsNodes.includes(drsCurrent) ? 'exact' : 'interpolated';
        const selection = selectCoverage(catalog, atSpeed.coordinates);
        assert.equal(selection.mode, expected, `RB16B 180 km/h at DRS ${drsCurrent}`);
        assert.equal(forces.forcesAt(atSpeed)?.mode, expected, `RB16B 180 km/h forces at DRS ${drsCurrent}`);
        const result = await trace(atSpeed, selection);
        assert(Object.values(result.layers).every(layer => layer.lines > 0));
      }
    }
    assert.equal(modes['low-command-only'], modes['low-closed']);
    assert.equal(modes['still-0.5'], 'exact');
    assert.equal(modes['high-ambient15'], 'unsupported');
    assert.equal(modes['low-yaw90'], 'exact', 'A zero-strength natural wind has no angle');
    assert.equal(modes['baseline-yaw45'], 'exact');
    assert.equal(modes['still-zero'], 'rest');
    const condition = makeCondition(modelId, {});
    const selection = selectCoverage(catalog, condition.coordinates);
    const [lo, hi] = [await trace(condition, selection), await trace(condition, selection, .5)];
    inspectGeometry(lo, model);
    const convergence = Object.fromEntries(Object.keys(lo.layers).map(name => [name, trajectoryComparison(lo.layers[name], hi.layers[name])]));
    for (const [name, result] of Object.entries(convergence)) {
      assert(result.compare > 10 && result.p90 < .035, `${modelId}/${name} fails step convergence: ${JSON.stringify(result)}`);
    }
    console.log(modelId, modes, 'step convergence', convergence);
  }
}

if (measure) process.exit(0);

// Exercise the production loader, including an initial transient failure and a persistent missing mask.
const catalog = new FlowCatalog();
let requests = 0, missingMasks = false;
globalThis.fetch = async url => {
  const file = new URL(url, 'http://example.test').pathname;
  if (++requests === 2 || missingMasks && file.endsWith('.mask')) return new Response(null, { status: 503 });
  return new Response(await fs.readFile(publicFile(file)));
};
async function waitForSelection(model, input) {
  for (let iteration = 0; iteration < 200; iteration++) {
    const result = catalog.select(makeCondition(model, input));
    if (result.mode !== 'loading') return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Catalog or field did not settle');
}
catalog.load('rb19');
assert.equal((await waitForSelection('rb19', {})).mode, 'exact');
const interpolatedForces = catalog.forcesAt(makeCondition('rb19', { drsCurrent: .25 }));
assert.equal(interpolatedForces?.mode, 'interpolated');
assert(interpolatedForces.downforce > 1 && interpolatedForces.downforce < 3);
assert.equal(catalog.forcesAt(makeCondition('rb16b', {})), undefined);
assert.equal(catalog.forcesAt(makeCondition('rb19', { groundSpeed: 350, ambientWindMps: 15 })), undefined);
missingMasks = true;
assert.equal((await waitForSelection('rb19', { drsCurrent: 1 })).mode, 'error');
missingMasks = false;
catalog.retry();
assert.equal((await waitForSelection('rb19', { drsCurrent: 1 })).mode, 'exact');
console.log('Content verification, retry after transient asset failure, and explicit missing-mask state passed');
