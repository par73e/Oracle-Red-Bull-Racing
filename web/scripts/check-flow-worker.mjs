import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { stationaryWeights } from '../src/stationary-fields.js';
import * as T from 'three';
import { computeBoundsTree,acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { loadRollingFixture } from './rolling-fixture.mjs';
import { bindRig,applyRig } from '../src/rig.js';
import { Airflow,rollingWeights } from '../src/airflow.js';
import { UnderbodyFlow } from '../src/underbody.js';
import { SidepodFlow } from '../src/sidepod.js';
import { describeModel,snapshotRig } from '../src/flow-worker-protocol.js';
T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;T.Mesh.prototype.raycast=acceleratedRaycast;

function checkRegionalGeometry(positions, model) {
 const ray = new T.Raycaster(), start = new T.Vector3(), direction = new T.Vector3();
 ray.firstHitOnly = true;
 let rear = 0, floorCenter = 0, crossings = 0;
 for (let i = 0; i < positions.length; i += 6) {
  start.fromArray(positions, i);
  direction.fromArray(positions, i + 3).sub(start);
  const length = direction.length();
  ray.set(start, direction.divideScalar(length));
  ray.near = .00002;
  ray.far = length - .00002;
  if (ray.intersectObject(model, true).length) crossings++;
  if (Math.abs(start.x) < 1 && start.z > -2.8 && start.z < -1.7 && start.y > .4 && start.y < 1.45) rear++;
  if (Math.abs(start.x) < .6 && Math.abs(start.z) < .8) floorCenter++;
 }
 assert.equal(crossings, 0, 'Flow segments intersect the full car mesh');
 return { rear, floorCenter };
}

// Measure the floor itself, independently of the inlet line count and the
// whole-car layer. Count downstream crossings to exclude lateral/backward paths.
function rearFloorCrossings(positions) {
 let crossings = 0;
 const plane = -1.4;
 for (let i = 0; i < positions.length; i += 6) {
  const z0 = positions[i + 2], z1 = positions[i + 5];
  if (z0 < plane || z1 >= plane) continue;
  const fraction = (plane - z0) / (z1 - z0);
  const x = T.MathUtils.lerp(positions[i], positions[i + 3], fraction);
  const y = T.MathUtils.lerp(positions[i + 1], positions[i + 4], fraction);
  if (Math.abs(x) < .72 && y < .15) crossings++;
 }
 return crossings;
}

function checkBottomWindow(positions) {
 for (let i = 0; i < positions.length; i += 3) {
  assert.ok(positions[i] >= -1.4 - 1e-6 && positions[i] <= 1.4 + 1e-6);
  assert.ok(positions[i + 1] >= .015 - 1e-6 && positions[i + 1] <= .455 + 1e-6, 'Bottom layer escaped the underbody height window');
  assert.ok(positions[i + 2] >= -4 - 1e-6 && positions[i + 2] <= 1.8 + 1e-6);
 }
}

for(const car of ['rb19','rb16b']){
 const {model,config}=await loadGeometry(car),rig=bindRig(model,config),scene=new T.Scene();scene.add(model);model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
 const flow=new Airflow(scene),bottom=new UnderbodyFlow(scene,flow.material),side=new SidepodFlow(scene,flow.material);await loadRollingFixture(flow,car);
 for(const [target,name] of [[bottom,'underbody'],[side,'sidepod']]){const url=new URL(`../public/flow/${car}/${name}`,import.meta.url),b=await fs.readFile(new URL(url.href+'.bin'));target.meta=JSON.parse(await fs.readFile(new URL(url.href+'.json')));target.data=new Int16Array(b.buffer,b.byteOffset,b.length/2);target.status='ready';}
 const worker = new Worker(new URL('./legacy-flow-worker-node.mjs', import.meta.url));
 const send = message => new Promise((resolve, reject) => {
  const onReply = reply => {
   worker.off('error', onError);
   if (reply.type === 'error') reject(new Error(reply.message));
   else resolve(reply);
  };
  const onError = error => {
   worker.off('message', onReply);
   reject(error);
  };
  worker.once('message', onReply);
  worker.once('error', onError);
  worker.postMessage(message);
 });
 try{const {meshes,description}=describeModel(rig),versions=meshes.map(m=>m.geometry.attributes.position.version);
 await send({type:'init',car,meshes:description,spec:flow.spec,baseline:flow.data.base,bottom:{data:bottom.data,meta:bottom.meta},side:{data:side.data,meta:side.meta}});
 const yawManifest = JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/yaw/manifest.json`, import.meta.url)));
 flow.yaw.manifest = yawManifest;
 const coverageCases = [0, -5, 5, -45, 45, -90, 90].map(windAngle => ({
  windAngle, speed: Math.abs(windAngle) <= 5 ? 180 : 54, wheelSpeedMps: Math.abs(windAngle) <= 5 ? 50 : 0,
  steer: 0, drsCurrent: 0,
 }));
 const parityCases = [
  { speed: 180, wheelSpeedMps: 25, steer: 0, drsCurrent: 0 },
  { speed: 180, wheelSpeedMps: 50, steer: 12, drsCurrent: .5 },
  { speed: 0, wheelSpeedMps: 50, steer: 0, drsCurrent: 0 },
  { speed: 0, wheelSpeedMps: 0, steer: 0, drsCurrent: 0 },
 ];
 let id = 0, headwindRear = 0, headwindFloor = 0;
 for (const p of [...coverageCases, ...parityCases]) {
  let yawSelection, yawData;
  if (p.windAngle) {
   const record = yawManifest.fields.find(field => field.windAngleDeg === p.windAngle);
   assert.ok(record, `${car} has no yaw anchor for ${p.windAngle}°`);
   const bytes = await fs.readFile(new URL(`../public${record.file}`, import.meta.url));
   const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
   yawData = { [record.key]: Float32Array.from(samples, value => value * record.scale) };
   yawSelection = { weights: { [record.key]: 1 }, spec: record.grid, exact: true, mirror: false };
   flow.yaw.selection = () => ({ ...yawSelection, data: yawData });
  }
  const state={model:car,flow:true,flowDensity:100,...p};applyRig(rig,{steer:p.steer,drs:p.drsCurrent,spin:0});const now=++id*1000;
  flow.lastKey='';bottom.key='';side.key='';side.pendingKey='';flow.update(state,rig,0,now);bottom.update(state,rig,flow);side.update(state,rig,flow,now);side.update(state,rig,flow,now+200);
  const weights=rollingWeights(p.speed/3.6,p.wheelSpeedMps,p.steer,p.drsCurrent),fields=Object.fromEntries(Object.entries(weights).filter(([,v])=>Math.abs(v)>1e-7).map(([k])=>[k,flow.data[k]]));
  Object.assign(fields, yawData);
  const result=await send({type:'compute',id,key:flow.stats.inputKey,state,rig:snapshotRig(rig,meshes,versions),selection:{weights,axisSweep:false},yawSelection,fields});
  for (const [name, layer] of [['flow', flow], ['bottom', bottom], ['side', side]]) {
   const actual = result[name].attributes.position;
   const expected = layer.group.visible && layer.geometry.drawRange.count !== 0
    ? layer.geometry.attributes.position.array : new Float32Array();
   assert.equal(actual.length, expected.length, `${car} ${name} segment count differs`);
   let max = 0;
   for (let i = 0; i < actual.length; i++) max = Math.max(max, Math.abs(actual[i] - expected[i]));
   assert.ok(max < 1e-5, `${car} ${name}: geometry drift ${max}`);
   if (p.speed === 0 && p.wheelSpeedMps === 0) assert.equal(actual.length, 0, `${car} ${name} draws at rest`);
  }
  if (p.windAngle !== undefined) {
   const { rear } = checkRegionalGeometry(result.flow.attributes.position, model);
   const { floorCenter } = checkRegionalGeometry(result.bottom.attributes.position, model);
   if (p.windAngle === 0) {
    assert.ok(rear > 0 && floorCenter > 0);
    headwindRear = rear;
    headwindFloor = floorCenter;
   } else if (Math.abs(p.windAngle) === 5) {
    assert.ok(Math.abs(rear / headwindRear - 1) < .15, `${car} rear coverage jumps at ${p.windAngle}°: ${headwindRear} to ${rear}`);
    assert.ok(floorCenter >= .75 * headwindFloor, `${car} floor coverage drops at ${p.windAngle}°: ${headwindFloor} to ${floorCenter}`);
   } else {
    assert.ok(floorCenter >= 150, `${car} floor center sparse at ${p.windAngle}°: ${floorCenter} segments`);
   }
   console.log(`${car} yaw=${p.windAngle}° coverage: ${rear} rear segments, ${floorCenter} floor center segments, no full-mesh crossings`);
  }
  console.log(`${car} yaw=${p.windAngle ?? 0}° air=${p.speed} road=${p.wheelSpeedMps*3.6} steer=${p.steer} drs=${p.drsCurrent}: worker/main tracing parity, ${result.workerMs.toFixed(1)} ms off-thread`);
 }
 // Exercise the solved low-speed fields through the same worker that
 // produces the rendered paths. Check inflow magnitude and coverage.
 const sweep = flow.sweep;
 const sweepManifest = JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/sweep/manifest.json`, import.meta.url)));
 sweep.manifest = sweepManifest;
 sweep.lastRefresh = Infinity;
 sweep.records = new Map(sweepManifest.fields.map(field => [field.key, field]));
 sweep.cache.set('base', flow.data.base);
 for (const key of ['air-010', 'air-025', 'air-050', 'ground-010']) {
  const field = sweep.records.get(key);
  const bytes = await fs.readFile(new URL(`../public${field.file}`, import.meta.url));
  sweep.cache.set(key, Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), value => value * field.scale));
 }
 applyRig(rig,{steer:0,drs:0,spin:0});
 const heights = [];
 for (const speed of [10, 25, 50]) {
  const U = speed / 3.6, W = 10 / 3.6;
  const state = { model: car, flow: true, flowDensity: 100, speed, wheelSpeedMps: W, steer: 0, drsCurrent: 0, windAngle: 0 };
  const { weights, data: fields } = sweep.selection(U, W, 0, 0, { inflowBlend: 1 });
  const result = await send({ type: 'compute', id: ++id, key: `${speed}`, state, rig: snapshotRig(rig, meshes, versions), selection: { weights, axisSweep: true }, fields });
  const { position, flight } = result.flow.attributes;
  const rear = [], inflow = [];
  for (let i = 0; i < flight.length; i += 2) {
   const j = i * 3;
   const [x, y, z] = position.subarray(j, j + 3);
   if (Math.abs(x) > .95 || y < .46) continue;
   if (z > -3.45 && z < -2.55) rear.push(y);
   const dt = flight[i + 1] - flight[i];
   if (z > 3.65 && dt > 0) inflow.push(Math.hypot(position[j + 3] - x, position[j + 4] - y, position[j + 5] - z) / dt);
  }
  const medianInflow = inflow.sort((a,b) => a-b)[Math.floor(inflow.length / 2)];
  assert(Math.abs(medianInflow / U - 1) < .08, `${car}: ${speed} km/h inflow speed is ${medianInflow} m/s`);
  heights.push(rear.sort((a,b) => a-b)[Math.round((rear.length - 1) * .9)]);
 }
 assert(heights.every(Number.isFinite), `${car}: missing rear streamline coverage`);
 console.log(`${car}: rear streamline height at 10/25/50 km/h: ${heights.map(h => h.toFixed(3)).join(' / ')} m`);
 if (car === 'rb19') {
  // Replay the normal sweep used by the browser with road speed fixed at
  // 10 km/h. A total seed/line count misses paths cut short before the rear.
  for (const key of ['air-060', 'air-065']) {
   const record = sweep.records.get(key);
   const bytes = await fs.readFile(new URL(`../public${record.file}`, import.meta.url));
   sweep.cache.set(key, Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), value => value * record.scale));
  }
  const rearCrossings = [];
  for (const wind of [0, 15]) {
   const W = 10 / 3.6, U = W + wind;
   const state = { model: car, flow: true, flowDensity: 100, speed: U * 3.6, wheelSpeedMps: W, steer: 0, drs: 0, drsCurrent: 0, windAngle: 0 };
   const { weights, data: fields } = sweep.selection(U, W, 0, 0, { inflowBlend: 1, drsEndpoints: true });
   const result = await send({ type: 'compute', id: ++id, key: `floor:${wind}`, state, rig: snapshotRig(rig, meshes, versions), selection: { weights, axisSweep: true }, fields });
   const positions = result.bottom.attributes.position;
   checkRegionalGeometry(positions, model);
   rearCrossings.push(rearFloorCrossings(positions));
  }
  assert.ok(rearCrossings[1] >= 45 && rearCrossings[1] >= .6 * rearCrossings[0],
   `RB19 forward flow through rear floor at 0/15 m/s: ${rearCrossings.join('/')}`);
  console.log(`RB19 rear-floor crossings at 0/15 m/s, road speed 10 km/h: ${rearCrossings.join('/')}`);
 }
 if (car === 'rb19') {
  const matched = JSON.parse(await fs.readFile(new URL('../public/flow/rb19/road010/manifest.json', import.meta.url)));
  const W = 10 / 3.6;
  assert.deepEqual(matched.fields.map(record => record.naturalWindMps), [0, 4, 11, 15]);
  for (const record of matched.fields) {
   const U = W + record.naturalWindMps;
   assert.equal(record.speedMps, U);
   assert.equal(record.groundSpeedMps, W);
   assert.equal(record.wheelSpeedMps, W);
   assert.deepEqual([record.yawDeg, record.steer, record.drs], [0, 0, 0]);
   assert.deepEqual(record.grid, flow.baseSpec);
   const bytes = await fs.readFile(new URL(`../public${record.file}`, import.meta.url));
   assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
   const fields = { [record.anchor]: Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), value => value * record.scale) };
   const state = { model: car, flow: true, flowDensity: 100, speed: U * 3.6, wheelSpeedMps: W, steer: 0, drsCurrent: 0, windAngle: 0 };
   const weights = { [record.anchor]: 1 };
   const result = await send({ type: 'compute', id: ++id, state, rig: snapshotRig(rig, meshes, versions), selection: { weights, axisSweep: false, matchedHeadwind: true }, fields });
   assert.deepEqual(result.flow.stats.activeAnchors, weights);
   const { rear } = checkRegionalGeometry(result.flow.attributes.position, model);
   assert.ok(rear > 100, `Missing rear wake at wind ${record.naturalWindMps}`);
   const floor = result.bottom.attributes.position;
   assert.equal(result.bottom.mode, 'coarse');
   assert.equal(result.bottom.fallbackSamples, 0);
   assert.ok(rearFloorCrossings(floor) >= 24, `Missing rear-floor coverage at wind ${record.naturalWindMps}`);
   checkRegionalGeometry(floor, model);
   checkBottomWindow(floor);
  }
 }
 const stationary = JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/stationary/manifest.json`, import.meta.url)));
 assert.deepEqual(stationary.fields.map(record => record.speedMps), [.5, 1, 2, 5, 15]);
 const stationaryData = {};
 for (const record of stationary.fields) {
  assert.equal(record.car, car);
  assert.equal(record.family, 'stationary');
  assert.equal(record.wheelSpeedMps, 0);
  assert.equal(record.groundSpeedMps, 0);
  assert.equal(record.yawDeg, 0);
  assert.equal(record.drs, 0);
  assert.equal(record.steer, 0);
  assert.equal(record.lastIteration, 650);
  assert.equal(record.meshOk, true);
  assert.deepEqual(record.grid, flow.baseSpec);
  const bytes = await fs.readFile(new URL(`../public${record.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  stationaryData[record.anchor] = Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), value => value * record.scale);
 }
 assert.deepEqual(stationaryWeights(stationary.fields, .5), { 'wind-00500': 1 });
 assert.deepEqual(stationaryWeights(stationary.fields, 1), { 'wind-01000': 1 });
 assert.deepEqual(stationaryWeights(stationary.fields, .75), { 'wind-00500': .5, 'wind-01000': .5 });
 assert.deepEqual(stationaryWeights(stationary.fields, 0), {});
 assert.equal(stationaryWeights(stationary.fields, 16), null);
 for (const U of [.25, .5, .75, 1, 1.5, 2, 3.5, 5, 10, 15]) {
  const weights = stationaryWeights(stationary.fields, U);
  assert(weights && Object.keys(weights).length <= 2 && Object.values(weights).every(weight => weight > 0 && weight <= 1));
  const fields = Object.fromEntries(Object.keys(weights).map(key => [key, stationaryData[key]]));
  const state = { model: car, flow: true, flowDensity: 100, speed: U * 3.6, wheelSpeedMps: 0, steer: 0, drsCurrent: 0, windAngle: 0 };
  const result = await send({ type: 'compute', id: ++id, key: `stationary:${U}`, state, rig: snapshotRig(rig, meshes, versions), selection: { weights, axisSweep: false, stationary: true }, fields });
  assert.deepEqual(result.flow.stats.activeAnchors, weights);
  assert.equal(result.flow.stats.sourceMode, stationary.fields.some(record => record.speedMps === U) ? 'anchor' : 'surrogate');
  const { position, flight } = result.flow.attributes;
  const { rear, floorCenter } = checkRegionalGeometry(position, model);
  const inflow = [], heights = [];
  for (let i = 0; i < flight.length; i += 2) {
   const j = i * 3;
   const [x, y, z] = position.subarray(j, j + 3);
   if (Math.abs(x) > .95 || y < .46) continue;
   if (z > -3.45 && z < -2.55) heights.push(y);
   const dt = flight[i + 1] - flight[i];
   if (z > 3.65 && dt > 0) inflow.push(Math.hypot(position[j + 3] - x, position[j + 4] - y, position[j + 5] - z) / dt);
  }
  const median = inflow.sort((a, b) => a - b)[Math.floor(inflow.length / 2)];
  assert.ok(Math.abs(median / U - 1) < .05, `${car}: stationary ${U} m/s inflow = ${median} m/s`);
  assert.ok(rear > 0 && heights.length > 0, `${car}: missing rear coverage`);
  for (const layer of [result.bottom, result.side]) {
   assert.equal(layer.mode, 'coarse');
   assert.equal(layer.fallbackSamples, 0);
   assert.ok(layer.attributes.position.length > 0, `${car}: missing stationary local streamline layer`);
   checkRegionalGeometry(layer.attributes.position, model);
  }
  checkBottomWindow(result.bottom.attributes.position);
  if (car === 'rb19' && [0.5, 15].includes(U)) {
   const crossings = rearFloorCrossings(result.bottom.attributes.position);
   assert.ok(crossings >= 24, `RB19 stationary ${U} m/s leaves the rear floor sparse (${crossings} crossings)`);
  }
  const p90 = heights.sort((a, b) => a - b)[Math.round((heights.length - 1) * .9)];
  console.log(`${car}: stationary U=${U}, inflow=${median.toFixed(4)}, rear height P90=${p90.toFixed(4)} m, rear/floor segments=${rear}/${floorCenter}, bottom/side lines=${result.bottom.count}/${result.side.count}`);
 }
 }finally{await worker.terminate();}
}
