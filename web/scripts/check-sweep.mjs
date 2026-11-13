import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { SweepFields } from '../src/sweep-field.js';
const root=new URL('../public/',import.meta.url),nativeFetch=globalThis.fetch;
globalThis.fetch=async url=>{try{const b=await fs.readFile(new URL(String(url).replace(/^\//,''),root));return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
try{for(const car of ['rb19','rb16b']){
 const manifest=JSON.parse(await fs.readFile(new URL(`flow/${car}/sweep/manifest.json`,root)));
 assert.equal(manifest.plannedUnique,277);assert.equal(manifest.complete,manifest.completedUnique===277);assert.equal(manifest.completedUnique,manifest.fields.length);
 for(const [axis,count,step] of [['air',71,5],['ground',71,5],['drs',101,1],['steer',37,1]]){const points=manifest.axes[axis];assert.equal(points.length,count);for(let i=1;i<points.length;i++)assert.equal(points[i].value-points[i-1].value,step);}
 for(const a of manifest.fields){const b=await fs.readFile(new URL(a.file.slice(1),root));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),a.sha256);assert(a.meshOk&&a.lastIteration===650);if(!a.reused){assert.equal(a.groundSpeedMps,a.wheelSpeedMps);assert(a.noSlipRolling);}}
 const base=manifest.fields.find(a=>a.key==='base'),b=await fs.readFile(new URL(base.file.slice(1),root));const ints=new Int16Array(b.buffer,b.byteOffset,b.length/2),baseline=Float32Array.from(ints,v=>v*base.scale);
 const sweep=new SweepFields(()=>{});await sweep.load(car,baseline);
 for(const [u,g,s,d,key] of [[50,50,0,0,'base'],[50,25,0,0,'ground-090'],[0,50,0,0,'air-000'],[50,50,-18,0,'steer-m018'],[50,50,0,1,'drs-100']]){
  let selected=sweep.selection(u,g,s,d);if(selected?.loading){await Promise.all(sweep.pending.values());selected=sweep.selection(u,g,s,d);}assert(selected&&!selected.loading);assert.deepEqual(selected.weights,{[key]:1});assert(selected.exact);assert.equal(selected.data[key].length,baseline.length);
 }
 const known=new Set(manifest.fields.map(a=>a.key)),missing=manifest.axes.air.find(a=>!known.has(a.key));if(missing)assert.equal(sweep.selection(missing.value/3.6,50,0,0),null,'uncomputed node must fall back explicitly');
 console.log(`${car}: ${manifest.completedUnique}/277 files verified; 5 km/h axes, 1% DRS, 1 degree steering, exact node selection and lazy loading verified`);
}}finally{globalThis.fetch=nativeFetch;}
