import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig, applyRig } from '../src/rig.js';
import { Airflow } from '../src/airflow.js';
import { UnderbodyFlow } from '../src/underbody.js';
T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;T.Mesh.prototype.raycast=acceleratedRaycast;
for(const car of ['rb19','rb16b']){
 const {model,config}=await loadGeometry(car),rig=bindRig(model,config),scene=new T.Scene();scene.add(model);
 model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
 const flow=new Airflow(scene),bottom=new UnderbodyFlow(scene,flow.material),base=new URL(`../public/flow/${car}/underbody`,import.meta.url),bytes=await fs.readFile(new URL(base.href+'.bin'));
 bottom.meta=JSON.parse(await fs.readFile(new URL(base.href+'.json')));bottom.data=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);
 const manifest=JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/manifest.json`,import.meta.url)));flow.data={};
 for(const anchor of manifest.anchors){const raw=await fs.readFile(new URL(`../public${anchor.file}`,import.meta.url));const ints=new Int16Array(raw.buffer,raw.byteOffset,raw.length/2);flow.data[anchor.anchor]=Float32Array.from(ints,v=>v*anchor.scale);}
 flow.spec=manifest.anchors[0].grid;flow.grid=new Float32Array(flow.data.base.length);flow.stats.ready=true;
 const scenarios=[
  {name:'baseline',speed:180,wheelSpeedMps:50,steer:0,drs:0,drsCurrent:0},
  {name:'DRS open',speed:180,wheelSpeedMps:50,steer:0,drs:1,drsCurrent:1},
  {name:'lower speed',speed:100,wheelSpeedMps:100/3.6,steer:0,drs:0,drsCurrent:0},
  {name:'very low speed',speed:1,wheelSpeedMps:1/3.6,steer:0,drs:0,drsCurrent:0},
  {name:'high speed',speed:350,wheelSpeedMps:350/3.6,steer:-18,drs:1,drsCurrent:1},
  {name:'combined',speed:180,wheelSpeedMps:35,steer:12,drs:.5,drsCurrent:.5},
  {name:'wheel only',speed:0,wheelSpeedMps:50,steer:0,drs:0,drsCurrent:0},
  {name:'stationary',speed:0,wheelSpeedMps:0,steer:0,drs:0,drsCurrent:0}
 ];let now=100, baselineGeometry=null;
 for(const item of scenarios){const state={model:car,flow:true,flowDensity:100,...item};applyRig(rig,{drs:state.drsCurrent,steer:state.steer,spin:0});model.updateMatrixWorld(true);flow.update(state,rig,0,now+=100);const visible=bottom.update(state,rig,flow);
  if(item.name==='stationary'){assert.equal(visible,false);assert.equal(bottom.group.visible,false);console.log(car,item.name,'no flow');continue;}
  assert.equal(visible,true,`${car} ${item.name} hidden`);assert.ok(bottom.count>0,`${car} ${item.name} has no lines`);
  const values=bottom.geometry.attributes.position.array;if(item.name==='baseline'){baselineGeometry=Array.from(values);assert.equal(bottom.mode,'baseline');}else{assert.equal(bottom.mode,'surrogate');if(item.name==='DRS open')assert.notDeepEqual(Array.from(values),baselineGeometry,`${car} DRS produced identical trajectories`);}const ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();ray.firstHitOnly=true;let crossings=0;
  for(let i=0;i<values.length;i+=6){a.fromArray(values,i);b.fromArray(values,i+3);direction.copy(b).sub(a);const distance=direction.length();ray.set(a,direction.divideScalar(distance));ray.near=.00002;ray.far=distance-.00002;if(ray.intersectObject(model,true).length)crossings++;}
  console.log(`${car} ${item.name}: ${bottom.count} lines, ${values.length/6} segments, ${crossings} full-mesh intersections`);assert.equal(crossings,0);
 }
}
