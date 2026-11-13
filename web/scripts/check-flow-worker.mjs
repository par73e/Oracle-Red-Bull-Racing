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
for(const car of ['rb19','rb16b']){
 const {model,config}=await loadGeometry(car),rig=bindRig(model,config),scene=new T.Scene();scene.add(model);model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
 const flow=new Airflow(scene),bottom=new UnderbodyFlow(scene,flow.material),side=new SidepodFlow(scene,flow.material);await loadRollingFixture(flow,car);
 for(const [target,name] of [[bottom,'underbody'],[side,'sidepod']]){const url=new URL(`../public/flow/${car}/${name}`,import.meta.url),b=await fs.readFile(new URL(url.href+'.bin'));target.meta=JSON.parse(await fs.readFile(new URL(url.href+'.json')));target.data=new Int16Array(b.buffer,b.byteOffset,b.length/2);target.status='ready';}
 const worker=new Worker(new URL('./flow-worker-node.mjs',import.meta.url));const send=m=>new Promise((resolve,reject)=>{worker.once('message',r=>r.type==='error'?reject(Error(r.message)):resolve(r));worker.once('error',reject);worker.postMessage(m);});
 try{const {meshes,description}=describeModel(rig),versions=meshes.map(m=>m.geometry.attributes.position.version);
 await send({type:'init',car,meshes:description,spec:flow.spec,baseline:flow.data.base,bottom:{data:bottom.data,meta:bottom.meta},side:{data:side.data,meta:side.meta}});
 let id=0;for(const p of [{speed:180,wheelSpeedMps:25,steer:0,drsCurrent:0},{speed:180,wheelSpeedMps:50,steer:12,drsCurrent:.5},{speed:0,wheelSpeedMps:50,steer:0,drsCurrent:0}]){
  const state={model:car,flow:true,flowDensity:100,...p};applyRig(rig,{steer:p.steer,drs:p.drsCurrent,spin:0});const now=++id*1000;
  flow.lastKey='';bottom.key='';side.key='';side.pendingKey='';flow.update(state,rig,0,now);bottom.update(state,rig,flow);side.update(state,rig,flow,now);side.update(state,rig,flow,now+200);
  const weights=rollingWeights(p.speed/3.6,p.wheelSpeedMps,p.steer,p.drsCurrent),fields=Object.fromEntries(Object.entries(weights).filter(([,v])=>Math.abs(v)>1e-7).map(([k])=>[k,flow.data[k]]));
  const result=await send({type:'compute',id,key:flow.stats.inputKey,state,rig:snapshotRig(rig,meshes,versions),selection:{weights,axisSweep:false},fields});
  for(const [name,layer] of [['flow',flow],['bottom',bottom],['side',side]]){const actual=result[name].attributes.position,expected=layer.geometry.attributes.position.array;assert.equal(actual.length,expected.length,`${car} ${name} segment count differs`);let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));assert(max<1e-5,`${car} ${name}: geometry drift ${max}`);}
  console.log(`${car} air=${p.speed} road=${p.wheelSpeedMps*3.6} steer=${p.steer} drs=${p.drsCurrent}: worker/main tracing parity, ${result.workerMs.toFixed(1)} ms off-thread`);
 }
 }finally{await worker.terminate();}
}
