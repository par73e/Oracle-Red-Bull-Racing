import assert from 'node:assert/strict';
import * as T from 'three';
import { FlowJobs } from '../src/flow-jobs.js';

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
const flow = {
  ...layer(), serial: 1, elapsed: 0, material, data: base, stats: { ready: true },
  onStatus(value) { this.statusText = value; },
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
  jobs.update(state, rig, .016, now);
}
function complete(worker, job) {
  const result = { visible: true, attributes: { position: new Float32Array([job.state.drsCurrent, 0, 0]) }, stats: { inputKey: job.key, yawActive: Boolean(job.yawSelection) } };
  worker.emit({ type: 'result', id: job.id, key: job.key, cachedKeys: ['base'], flow: result, bottom: result, side: result });
}
function assertPreview(angle) {
  assert.equal(jobs.preview.lines.visible, true);
  assert.equal(jobs.preview.angle, angle);
  assert.equal(flow.group.visible, false);
  assert.equal(bottom.group.visible, false);
  assert.equal(side.group.visible, false);
  const geometry = jobs.preview.lines.geometry;
  const { array, count } = geometry.attributes.position;
  assert(geometry.drawRange.count > 0 && geometry.drawRange.count <= count);
  if (!state.speed) return;
  const beta = angle * Math.PI / 180;
  const first = new T.Vector3().fromArray(array, 0);
  const last = new T.Vector3().fromArray(array, 71 * 3);
  const local = last.sub(first).normalize();
  assert(local.distanceTo(new T.Vector3(Math.sin(beta), 0, -Math.cos(beta))) < 1e-5);
  assert(local.applyAxisAngle(new T.Vector3(0, 1, 0), beta).distanceTo(new T.Vector3(0, 0, -1)) < 1e-5);
}

update(1000);
assertPreview(0);
const worker = jobs.worker;
worker.emit({ type: 'ready' });
update(1150);
const headwind = worker.jobs.at(-1);
assert(headwind);
update(1170, { windAngle: -85 });
assertPreview(-85);
complete(worker, headwind); // result buffered just before the next render
update(1190, { windAngle: 70 });
assertPreview(70);
assert.deepEqual(yawRequests, []);
update(1340);
assertPreview(70);
assert.deepEqual(yawRequests, [70]);
assert.equal(worker.jobs.length, 1);

yawState = 'error';
update(1420);
assertPreview(70);
assert.match(flow.statusText, /请重试/);
yawState = 'ready';
update(1500);
const crosswind = worker.jobs.at(-1);
assert.equal(crosswind.state.windAngle, 70);
assert(crosswind.yawSelection);
complete(worker, crosswind);
update(1520);
assert.equal(flow.group.visible, true);
assert.equal(jobs.preview.lines.visible, false);
assert.equal(jobs.detailAngle, 70);

// At fixed yaw, keep the full geometry visible and stream completed poses
// while the next slider values are still arriving.
const previewGeometry = jobs.preview.lines.geometry;
const previewVersion = previewGeometry.attributes.position.version;
const assertDetail = () => {
  assert.equal(jobs.preview.lines.visible, false);
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
  assert.equal(jobs.appliedKey, previous.key, 'Apply the intermediate pose even as the input advances');
  assert.equal(flow.geometry.attributes.position.array[0], Math.fround(previous.state.drsCurrent));
  const current = worker.jobs.at(-1);
  assert.notEqual(current, previous, 'Schedule changed input without waiting for it to settle');
  for (const key of Object.keys(patch)) assert.equal(current.state[key], patch[key]);
  assert.equal(current.state.windAngle, 70);
  assert(current.yawSelection);
  previous = current;
}
assert.equal(previewGeometry.attributes.position.version, previewVersion, 'Do not rebuild hidden previews');
update(1660, { drsCurrent: .9 });
update(1680, { drsCurrent: .95 });
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
assert(!jobs.preview.lines.visible && !flow.group.visible);
update(2260, { flow: true, speed: 0 });
assertPreview(0);
update(2280, { wheelSpeedMps: 0 });
assert(!jobs.preview.lines.visible && !flow.group.visible);

update(2300, { speed: 180, wheelSpeedMps: 50, windAngle: -45 });
update(2460);
const started = worker.jobs.at(-1);
assert.equal(started.state.windAngle, -45);
jobs.recover(jobs.serial, true);
update(2470);
assertPreview(-45);
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
assertPreview(85);
assert(recovered.terminated);
jobs.retry();
console.log('Wind previews, live detailed poses, coalescing, timeouts, retries and car isolation passed');
