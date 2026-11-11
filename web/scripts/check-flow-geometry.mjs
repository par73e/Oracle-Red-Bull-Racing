import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig, applyRig } from '../src/rig.js';
import { Airflow } from '../src/airflow.js';

T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
T.Mesh.prototype.raycast=acceleratedRaycast;
const root=new URL('../../',import.meta.url),reports=[];
for(const car of ['rb19','rb16b']){
 const {model,config}=await loadGeometry(car),rig=bindRig(model,config);
 model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
 const scene=new T.Scene();scene.add(model);const flow=new Airflow(scene);
 const manifest=JSON.parse(await fs.readFile(new URL(`web/public/flow/${car}/manifest.json`,root)));
 flow.data={};for(const a of manifest.anchors){const bytes=await fs.readFile(new URL('web/public'+a.file,root));const raw=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);flow.data[a.anchor]=Float32Array.from(raw,v=>v*a.scale);}
 assert.equal(Object.keys(flow.data).length,9);flow.spec=manifest.anchors[0].grid;flow.grid=new Float32Array(flow.data.base.length);flow.stats.ready=true;
 const cases=[{speed:180,wheelSpeedMps:50,steer:0,drsCurrent:0},{speed:180,wheelSpeedMps:50,steer:18,drsCurrent:1},{speed:350,wheelSpeedMps:0,steer:-18,drsCurrent:.5},{speed:0,wheelSpeedMps:50,steer:18,drsCurrent:0},{speed:0,wheelSpeedMps:0,steer:0,drsCurrent:0}];
 const ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3();ray.firstHitOnly=true;let clock=100;
 for(const item of cases){const state={flowDensity:100,...item};applyRig(rig,{drs:state.drsCurrent,steer:state.steer,spin:0});flow.update(state,rig,0,clock+=100);const data=flow.geometry.attributes.position?.array||[];let collisions=0;
  if(state.speed===0&&state.wheelSpeedMps===0){assert.equal(flow.stats.lines,0);assert.equal(flow.geometry.drawRange.count,0);continue;}
  assert(flow.stats.lines>15,'No visible flow');assert(Number.isFinite(flow.stats.peakMps));
  // Independent full-model ray test: do not reuse the runtime's spatial bins
  // or conditional car bounds. Every rendered segment is checked on real mesh.
  for(let i=0;i<data.length;i+=6){a.fromArray(data,i);b.fromArray(data,i+3);direction.copy(b).sub(a);const distance=direction.length();ray.set(a,direction.divideScalar(distance));ray.near=.00002;ray.far=distance-.00002;if(ray.intersectObject(model,true).length)collisions++;}
  assert.equal(collisions,0,`${car}: rendered streamline crosses actual geometry`);
  reports.push({car,...state,lines:flow.stats.lines,segments:data.length/6,collisions,buildMs:flow.stats.buildMs});
 }
}
await fs.writeFile(new URL('docs/research/flow-geometry-checks-2026-11-10.json',root),JSON.stringify(reports,null,2)+'\n');
console.log('Both cars: independent full-triangle checks found no rendered flow penetration in straight, combined, extreme or stationary-wheel poses; zero state stops.');
