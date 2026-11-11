import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig,applyRig } from '../src/rig.js';
import { Airflow } from '../src/airflow.js';
import { SidepodFlow } from '../src/sidepod.js';
T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;T.Mesh.prototype.raycast=acceleratedRaycast;
const car=process.argv[2],path=process.argv[3];assert(['rb19','rb16b'].includes(car)&&path);
const {model,config}=await loadGeometry(car),rig=bindRig(model,config),scene=new T.Scene();scene.add(model);model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundsTree();o.material.side=T.DoubleSide;}});
const flow=new Airflow(scene),side=new SidepodFlow(scene,flow.material),buffer=await fs.readFile(path);side.data=new Int16Array(buffer.buffer,buffer.byteOffset,buffer.length/2);side.meta=JSON.parse(await fs.readFile(path.replace(/\.bin$/,'.json')));
const manifest=JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/manifest.json`,import.meta.url)));flow.data={};for(const a of manifest.anchors){const raw=await fs.readFile(new URL(`../public${a.file}`,import.meta.url));const i=new Int16Array(raw.buffer,raw.byteOffset,raw.length/2);flow.data[a.anchor]=Float32Array.from(i,v=>v*a.scale);}flow.spec=manifest.anchors[0].grid;flow.grid=new Float32Array(flow.data.base.length);flow.stats.ready=true;
const scenarios=[{name:'baseline',speed:180,wheelSpeedMps:50,steer:0,drs:0,drsCurrent:0},{name:'DRS open',speed:180,wheelSpeedMps:50,steer:0,drs:1,drsCurrent:1},{name:'low speed',speed:30,wheelSpeedMps:30/3.6,steer:0,drs:0,drsCurrent:0},{name:'high combined',speed:350,wheelSpeedMps:350/3.6,steer:-18,drs:1,drsCurrent:1},{name:'wheel only',speed:0,wheelSpeedMps:50,steer:0,drs:0,drsCurrent:0},{name:'combined',speed:180,wheelSpeedMps:35,steer:12,drs:.5,drsCurrent:.5},{name:'stationary',speed:0,wheelSpeedMps:0,steer:0,drs:0,drsCurrent:0}];let now=100;
for(const item of scenarios){const state={model:car,flow:true,flowDensity:100,...item};applyRig(rig,{drs:item.drsCurrent,steer:item.steer,spin:0});model.updateMatrixWorld(true);flow.update(state,rig,0,now+=200);side.update(state,rig,flow,now);const active=side.update(state,rig,flow,now+200);if(item.name==='stationary'){assert.equal(active,false);continue;}assert.equal(active,true);assert.ok(side.count>0);if(item.name==='baseline'){assert.ok(side.regions.suspension>0&&side.layers.undercut>0&&side.layers.upper>0);}
 const values=side.geometry.attributes.position.array,ray=new T.Raycaster(),a=new T.Vector3(),b=new T.Vector3(),dir=new T.Vector3();ray.firstHitOnly=true;let intersections=0;
 for(let i=0;i<values.length;i+=6){a.fromArray(values,i);b.fromArray(values,i+3);dir.copy(b).sub(a);const distance=dir.length();ray.set(a,dir.divideScalar(distance));ray.near=.00002;ray.far=distance-.00002;if(ray.intersectObject(model,true).length)intersections++;}
 console.log(car,item.name,'lines',side.count,'regions',side.regions,'side layers',side.layers,'fallback samples',side.fallbackSamples,'blocked seed rays',side.blockedSeeds,'segments',values.length/6,'intersections',intersections);assert.equal(intersections,0);
}
