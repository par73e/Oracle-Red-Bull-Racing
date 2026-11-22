import assert from 'node:assert/strict';
import * as T from 'three';
import { FlowJobs } from '../src/flow-jobs.js';
import { captureCondition, conditionKey, resolveRelativeWind } from '../src/flow-condition.js';

class TestWorker {
  messages = [];
  terminate() { this.terminated = true; }
  postMessage(message) { this.messages.push(message); }
  emit(data) { this.onmessage({ data }); }
  get job() { return this.messages.findLast(message => message.type === 'compute'); }
}
globalThis.Worker = TestWorker;
const initial = { model: 'rb19', groundSpeed: 10, ambientWindMps: 0, windAngle: 0, steer: 0,
  drs: 0, drsCurrent: 0, flow: true, flowDensity: 100 };
assert.equal(resolveRelativeWind({ groundSpeed: 180, ambientWindMps: 0, windAngle: 90 }).effWindAngleDeg, 0);
assert.ok(Math.abs(resolveRelativeWind({ groundSpeed: 180, ambientWindMps: 15, windAngle: 90 }).effWindAngleDeg - 16.69924423399362) < 1e-10);
assert.equal(resolveRelativeWind({ groundSpeed: 350, ambientWindMps: 15 }).relSpeedKmh, 404);
assert.equal(conditionKey(captureCondition(initial)), conditionKey(captureCondition({ ...initial, drs: 1, windAngle: -90 })));

const makeLayer = () => ({ group: {}, lines: {}, geometry: new T.BufferGeometry() });
const layers = { whole: makeLayer(), bottom: makeLayer(), side: makeLayer() };
const state = { ...initial };
const rig = { model: new T.Group(), config: { id: 'rb19' }, wheels: {} };
let status, mode = 'exact';
const catalog = { car: 'rb19', select() { return mode !== 'exact' ? { mode } : {
  mode, sources: [{ node: { id: 'test' }, weight: 1 }], fields: [], forces: { drag: 12 },
}; } };
const jobs = new FlowJobs(catalog, layers, value => status = value);
const update = (at, patch) => { Object.assign(state, patch); jobs.update(state, rig, at); };
function complete(worker, job) {
  const reply = { lines: 1, attributes: { position: new Float32Array([job.condition.drs, 0, 0]) } };
  worker.emit({ type: 'result', id: job.id, key: job.key, cachedKeys: ['test'], layers: { whole: reply, bottom: reply, side: reply } });
}
const visible = count => assert.equal(Object.values(layers).filter(layer => layer.group.visible).length, count);
update(100);
const firstWorker = jobs.worker;
visible(0);
firstWorker.emit({ type: 'ready' });
update(120);
complete(firstWorker, firstWorker.job);
update(140);
assert.equal(status, '已求解 CFD 工况');
visible(3);
const first = firstWorker.job;
update(160, { drs: 1 });
assert.equal(firstWorker.job, first, 'Target command with fixed actual DRS does not retrace');
update(180, { drsCurrent: .25 });
const intermediate = firstWorker.job;
assert.match(status, /上一工况/);
visible(3);
update(200, { drsCurrent: .75 });
assert.equal(firstWorker.job, intermediate);
complete(firstWorker, intermediate);
update(220, { drsCurrent: 1 });
assert.equal(jobs.presented.condition.drs, 0, 'An outdated intermediate job cannot replace the currently presented result');
assert.equal(firstWorker.job.condition.drs, 1);
complete(firstWorker, firstWorker.job);
update(230, { drsCurrent: .96 });
assert.equal(jobs.presented.condition.drs, 1, 'A nearby completed trace replaces the more distant preview');
assert.match(status, /上一工况/);
visible(3);
complete(firstWorker, firstWorker.job);
update(240, { drsCurrent: 1 });
assert.equal(jobs.presented.condition.drs, 1);
assert(Object.values(layers).every(layer => layer.geometry.getAttribute('position').array[0] === 1));
mode = 'loading';
update(260, { groundSpeed: 15 });
visible(3);
update(580, { groundSpeed: 20 });
visible(3);
update(800, { groundSpeed: 25 });
visible(0);
mode = 'unsupported';
update(820);
visible(0);
assert.match(status, /暂无 CFD 覆盖/);
mode = 'error';
update(840);
assert.match(status, /请重试/);
mode = 'exact';
update(860);
const orphan = firstWorker.job;
jobs.reset();
complete(firstWorker, orphan);
update(880, { model: 'rb16b' });
assert(firstWorker.terminated);
visible(0);
assert.equal(jobs.result, null);
assert.equal(jobs.presented, null);
console.log('Relative-wind vector, frozen DRS, atomic results, stale pose rejection, missing data and car isolation passed');
