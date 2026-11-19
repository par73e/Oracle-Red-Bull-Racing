import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
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

for(const car of ['rb19','rb16b']){
 const {model,config}=await loadGeometry(car),rig=bindRig(model,config),scene=new T.Scene();scene.add(model);model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
 const flow=new Airflow(scene),bottom=new UnderbodyFlow(scene,flow.material),side=new SidepodFlow(scene,flow.material);await loadRollingFixture(flow,car);
 for(const [target,name] of [[bottom,'underbody'],[side,'sidepod']]){const url=new URL(`../public/flow/${car}/${name}`,import.meta.url),b=await fs.readFile(new URL(url.href+'.bin'));target.meta=JSON.parse(await fs.readFile(new URL(url.href+'.json')));target.data=new Int16Array(b.buffer,b.byteOffset,b.length/2);target.status='ready';}
 const worker = new Worker(new URL('./flow-worker-node.mjs', import.meta.url));
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
 }finally{await worker.terminate();}
}
