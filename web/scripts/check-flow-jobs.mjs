import assert from 'node:assert/strict';
import * as T from 'three';
import { FlowJobs } from '../src/flow-jobs.js';
import { SweepFields } from '../src/sweep-field.js';

class FakeWorker {
  messages = [];
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
  get jobs() { return this.messages.filter(message => message.type === 'compute'); }
}
globalThis.Worker = FakeWorker;
const layer = () => ({ geometry: new T.BufferGeometry(), lines: {}, group: { visible: false }, status: 'ready' });
const material = new T.ShaderMaterial({ uniforms: { clock: { value: 0 }, opacity: { value: 1 } } });
const field = new Float32Array(3);
const base = { base: field, open: field, right: field, low: field, 'road-slow': field, 'still-air': field };
let yawState = 'loading';
const yawRequests = [];
const statusUpdates = [];
const flow = {
  ...layer(), parent: new T.Group(), serial: 1, elapsed: 0, material, data: base, stats: { ready: true },
  onStatus(value) { statusUpdates.push(value); this.statusText = value; },
  sweep: { lastRefresh: Infinity, selection: () => null },
  yaw: {
    lastRefresh: Infinity, cancelRequestsExcept() {},
    selection(angle) {
      yawRequests.push(angle);
      if (yawState !== 'ready') return { [yawState]: true };
      return { weights: { angle: 1 }, data: { angle: field }, spec: { shape: [1, 1, 1] }, exact: true };
    },
  },
};
const bottom = layer(), side = layer();
const jobs = new FlowJobs(flow, bottom, side, { reducedMotion: true });
const rig = { model: new T.Group(), wheels: {}, config: { id: 'rb19' } };
const state = { model: 'rb19', flow: true, flowDensity: 150, speed: 180, wheelSpeedMps: 50, steer: 0, drsCurrent: 0, windAngle: 0 };
function update(now, patch) {
  Object.assign(state, patch);
  statusUpdates.length = 0;
  jobs.update(state, rig, .016, now);
  assert(statusUpdates.length <= 1, `Publish at most one HUD status per frame: ${statusUpdates.join(' / ')}`);
}
function complete(worker, job) {
  const result = { visible: true, attributes: { position: new Float32Array([job.state.drsCurrent, 0, 0]) }, stats: { inputKey: job.key, yawActive: Boolean(job.yawSelection), sourceMode: job.selection.stationary && Object.values(job.selection.weights).every(w => w === 1) ? 'anchor' : 'surrogate' } };
  worker.emit({ type: 'result', id: job.id, key: job.key, cachedKeys: ['base'], flow: result, bottom: result, side: result });
}
function assertNoFlow() {
  for (const layer of [flow, bottom, side]) assert.equal(layer.group.visible, false);
  assert(flow.parent.children.every(line => !line.visible));
}

update(1000);
assertNoFlow();
const worker = jobs.worker;
worker.emit({ type: 'ready' });
update(1150);
const headwind = worker.jobs.at(-1);
assert(headwind);
update(1170, { windAngle: -85 });
assertNoFlow();
complete(worker, headwind); // result buffered just before the next render
update(1190, { windAngle: 70 });
assertNoFlow();
assert.deepEqual(yawRequests, []);
update(1340);
assertNoFlow();
assert.deepEqual(yawRequests, [70]);
assert.equal(worker.jobs.length, 1);

yawState = 'error';
update(1420);
assertNoFlow();
assert.match(flow.statusText, /请重试/);
yawState = 'ready';
update(1500);
const crosswind = worker.jobs.at(-1);
assert.equal(crosswind.state.windAngle, 70);
assert(crosswind.yawSelection);
complete(worker, crosswind);
update(1520);
assert.equal(flow.group.visible, true);
assert.equal(jobs.detailAngle, 70);
assert.match(flow.statusText, /^粗网格 CFD/, 'Show the completed status even between field polls');

yawState = 'loading';
update(1525, { steer: 1 });
assert.equal(flow.statusText, '正在加载当前角度的侧风数据…');
update(1530);
assert.equal(flow.statusText, '正在加载当前角度的侧风数据…', 'Keep loading text between field polls');
yawState = 'error';
update(1532, { steer: 2 });
assert.match(flow.statusText, /暂不可用/);
update(1535);
assert.match(flow.statusText, /暂不可用/, 'Keep the retry status visible between field polls');
yawState = 'ready';

// At fixed yaw, keep the full geometry visible and stream completed poses
// while the next slider values are still arriving.
const assertDetail = () => {
  for (const layer of [flow, bottom, side]) assert.equal(layer.group.visible, true);
  assert.equal(flow.material.uniforms.opacity.value, 1);
};
let previous = crosswind;
for (const [i, patch] of [
  { drsCurrent: .2 }, { drsCurrent: .8 }, { steer: 16 },
  { wheelSpeedMps: 22 }, { speed: 135 }, { flowDensity: 100 },
].entries()) {
  const now = 1540 + i * 20;
  if (previous !== crosswind) complete(worker, previous);
  update(now, patch);
  assertDetail();
  assert.equal(flow.statusText, '正在更新精细流线…');
  assert.equal(jobs.appliedKey, previous.key, 'Apply the intermediate pose even as the input advances');
  assert.equal(flow.geometry.attributes.position.array[0], Math.fround(previous.state.drsCurrent));
  const current = worker.jobs.at(-1);
  assert.notEqual(current, previous, 'Schedule changed input without waiting for it to settle');
  for (const key of Object.keys(patch)) assert.equal(current.state[key], patch[key]);
  assert.equal(current.state.windAngle, 70);
  assert(current.yawSelection);
  previous = current;
}
update(1660, { drsCurrent: .9 });
update(1680, { drsCurrent: .95 });
assert.equal(flow.statusText, '正在更新精细流线…', 'Keep one loading label while the worker is busy');
assert.equal(worker.jobs.at(-1), previous, 'Coalesce input while a trace is in flight');
complete(worker, previous);
update(1700);
const finalPose = worker.jobs.at(-1);
assert.equal(finalPose.state.drsCurrent, .95);
complete(worker, finalPose);
update(1720);
assertDetail();
assert.equal(jobs.appliedKey, finalPose.key);
assert.equal(flow.geometry.attributes.position.array[0], Math.fround(.95));
const completed = worker.jobs.length;
update(1960);
assert.equal(worker.jobs.length, completed, 'Unchanged input must not trace again');
flow.sweep.selection = () => ({ weights: { base: 1 }, data: base });
update(2040);
const upgradedField = worker.jobs.at(-1);
assert(upgradedField.selection.axisSweep, 'Upgrade to newly arrived fields at the same pose');
assert.equal(flow.group.visible, true, 'Keep same-pose detail visible while refining it');
complete(worker, upgradedField);
update(2060);

update(2080, { windAngle: 0 });
update(2230);
const obsolete = worker.jobs.at(-1);
assert.equal(obsolete.state.windAngle, 0);
assert.equal(obsolete.yawSelection, null);
update(2240, { flow: false });
complete(worker, obsolete);
update(2250);
assertNoFlow();
update(2260, { flow: true, speed: 0 });
assertNoFlow();
update(2280, { wheelSpeedMps: 0 });
assertNoFlow();

update(2300, { speed: 180, wheelSpeedMps: 50, windAngle: -45 });
update(2460);
const started = worker.jobs.at(-1);
assert.equal(started.state.windAngle, -45);
jobs.recover(jobs.serial, true);
update(2470);
assertNoFlow();
assert.match(flow.statusText, /请重试/);
jobs.retry();
update(2500);
const recovered = jobs.worker;
recovered.emit({ type: 'ready' });
update(2510);
assert.equal(recovered.jobs.at(-1).state.windAngle, -45);
flow.serial++;
rig.config.id = 'rb16b';
update(2600, { model: 'rb16b', windAngle: 85 });
complete(recovered, recovered.jobs.at(-1));
update(2610);
assertNoFlow();
assert(recovered.terminated);
jobs.retry();
// Delaying the open field must not replace a loaded sweep with rolling fallback.
const sweep = new SweepFields(() => {});
const axes = {
  air: [{ value: 10, key: 'air-010' }, { value: 180, key: 'air-180' }],
  ground: [{ value: 10, key: 'ground-010' }, { value: 180, key: 'ground-180' }],
  steer: [{ value: 0, key: 'base' }],
  drs: [{ value: 0, key: 'base' }, { value: 43, key: 'drs-043' }, { value: 100, key: 'drs-100' }],
};
sweep.manifest = { complete: true, axes };
sweep.car = 'rb16b';
sweep.records = new Map(Object.values(axes).flat().map(node => [node.key, node]));
for (const key of ['base', 'air-180', 'ground-180']) sweep.cache.set(key, field);
const drsRequests = new Set();
sweep.request = key => drsRequests.add(key);
flow.sweep = sweep;
update(2800, { windAngle: 0, speed: 180, wheelSpeedMps: 50, steer: 0, drs: 0, drsCurrent: 0 });
jobs.worker.emit({ type: 'ready' });
update(2960);
const toggleWorker = jobs.worker;
const closed = toggleWorker.jobs.at(-1);
assert.equal(closed.selection.axisSweep, true);
complete(toggleWorker, closed);
update(2980, { drs: 1, drsCurrent: .43 });
const intermediate = toggleWorker.jobs.at(-1);
assert.equal(intermediate.selection.axisSweep, true);
assert.deepEqual(intermediate.selection.weights, closed.selection.weights);
assert.deepEqual([...drsRequests], ['drs-100']);
complete(toggleWorker, intermediate);
update(3000, { drsCurrent: 1 });
const openPending = toggleWorker.jobs.at(-1);
assert.deepEqual(openPending.selection, closed.selection);
complete(toggleWorker, openPending);
sweep.cache.set('drs-100', field);
update(3080);
const open = toggleWorker.jobs.at(-1);
assert.equal(open.selection.axisSweep, true);
assert.equal(open.key, openPending.key, 'Refine the settled pose when the field arrives');
assert(open.selection.weights['drs-100'] > 0);
assert.equal(open.selection.weights['air-180'], closed.selection.weights['air-180']);
assert.equal(open.selection.weights['ground-180'], closed.selection.weights['ground-180']);
complete(toggleWorker, open);
update(3100, { drs: 0, drsCurrent: .43 });
const closing = toggleWorker.jobs.at(-1);
assert.equal(closing.selection.axisSweep, true);
assert(Math.abs(closing.selection.weights['drs-100'] / open.selection.weights['drs-100'] - .43) < 1e-8);
assert.deepEqual([...drsRequests], ['drs-100']);
complete(toggleWorker, closing);
update(3120);
const settledClosed = toggleWorker.jobs.at(-1);
complete(toggleWorker, settledClosed);
update(3140);

// Test continuous drawing at a source replacement, with more controls changed
// while the fade is in progress. It must never block the latest worker pose.
jobs.reducedMotion = false;
let disposed = false;
flow.geometry.addEventListener('dispose', () => { disposed = true; });
update(3180, { speed: 10, wheelSpeedMps: 10 / 3.6 });
const lowSpeed = toggleWorker.jobs.at(-1);
assert.equal(lowSpeed.selection.axisSweep, false, 'Use rolling while low-speed sweep data is pending');
assert(Math.abs(lowSpeed.selection.weights.low - .2) < 1e-7);
assert(drsRequests.has('air-010') && drsRequests.has('ground-010'));
complete(toggleWorker, lowSpeed);
update(3200, { flowDensity: 85 });
assert(jobs.transition && jobs.previousLines.every(line => line.visible));
assert.equal(jobs.transitionMaterial.uniforms.opacity.value, 1);
assert(!disposed);
const newDensity = toggleWorker.jobs.at(-1);
assert.equal(newDensity.state.flowDensity, 85);
complete(toggleWorker, newDensity);
update(3310);
assert.equal(jobs.appliedKey, newDensity.key);
assert.equal(jobs.transitionMaterial.uniforms.opacity.value, .5);
assert.equal(flow.material.uniforms.opacity.value, .5);
update(3430);
assert(disposed && !jobs.transition && jobs.previousLines.every(line => !line.visible));

update(3450, { windAngle: 45 });
const shown = flow.geometry;
assert.equal(flow.group.visible, true);
assertDetail();
assert(flow.parent.children.every(line => !line.visible), 'Do not overlay substitute geometry while waiting for a new direction');
assert.equal(jobs.detailAngle, 0);
update(3600);
const newAngle = toggleWorker.jobs.at(-1);
assert.equal(flow.geometry, shown, 'Keep the same detail while awaiting the requested angle');
complete(toggleWorker, newAngle);
update(3620);
assert.equal(jobs.detailAngle, 45);
assert.equal(jobs.previousLines[0].geometry, shown);
update(3640, { flow: false });
assertNoFlow();
assert(!jobs.transition);
assert(jobs.previousLines.every(line => !line.visible && !line.geometry));

// Once downloaded, fine-grained low-speed air and road fields must replace
// the single scaled low anchor. The regression flattened the settled geometry.
sweep.cache.set('air-010', field);
sweep.cache.set('ground-010', field);
update(3660, { flow: true, windAngle: 0 });
update(3810);
const refined = toggleWorker.jobs.at(-1);
assert.equal(refined.selection.axisSweep, true);
assert(refined.selection.weights['air-010'] > 0 && refined.selection.weights['ground-010'] > 0);
complete(toggleWorker, refined);
update(3830);
assert.equal(jobs.appliedKey, refined.key);
update(3840, { speed: 0 });
const wheelOnly = toggleWorker.jobs.at(-1);
assert.equal(wheelOnly.selection.axisSweep, false);
assert(wheelOnly.selection.weights['still-air'] > 0);

complete(toggleWorker, wheelOnly);
update(3850);
const nJobs = toggleWorker.jobs.length;
const stillFields = { 'wind-00500': field, 'wind-01000': field };
let stillStatus = 'loading';
flow.stationary = { selection(speed) {
  if (stillStatus !== 'ready') return { [stillStatus]: true };
  return { weights: { [speed === .5 ? 'wind-00500' : 'wind-01000']: 1 }, data: stillFields };
} };
update(3860, { wheelSpeedMps: 0, speed: .5 * 3.6, steer: 0, drs: 0, drsCurrent: 0 });
assert.equal(toggleWorker.jobs.length, nJobs, 'Do not dispatch a rolling or sweep substitute while the stationary source loads');
assert.match(flow.statusText, /显示上一工况/);
stillStatus = 'error';
update(3940);
assert.equal(toggleWorker.jobs.length, nJobs);
assert.match(flow.statusText, /请重试/);
assertNoFlow();
stillStatus = 'ready';
update(4020);
const halfWind = toggleWorker.jobs.at(-1);
assert.deepEqual(halfWind.selection, { weights: { 'wind-00500': 1 }, axisSweep: false, stationary: true });
complete(toggleWorker, halfWind);
update(4040);
assert.match(flow.statusText, /已求解 CFD/);
update(4050, { speed: 3.6 });
const oneWind = toggleWorker.jobs.at(-1);
assert.deepEqual(oneWind.selection, { weights: { 'wind-01000': 1 }, axisSweep: false, stationary: true });
assert(!oneWind.yawSelection);
complete(toggleWorker, oneWind);
update(4070);
assert.match(flow.statusText, /已求解 CFD/);
update(4080, { steer: 1 });
const otherPose = toggleWorker.jobs.at(-1);
assert.equal(otherPose.selection.stationary, false, 'Never label a steered pose as a stationary straight-wheel case');
jobs.retry();
console.log('Flow presentation, live detailed poses, DRS continuity, coalescing, timeouts, retries and car isolation passed');
