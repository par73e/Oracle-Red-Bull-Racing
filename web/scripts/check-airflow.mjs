import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { anchorWeights,FLOW_ANCHORS } from '../src/airflow.js';
const root=new URL('../../',import.meta.url);
const exact=[['base',50,50,0,0],['low',50/3.6,50/3.6,0,0],['high',350/3.6,350/3.6,0,0],['open',50,50,0,1],['left',50,50,-18,0],['right',50,50,18,0],['locked',50,0,0,0],['fast',50,100,0,0],['spin',0,50,0,0]];
for(const [key,u,w,s,d] of exact){const weights=anchorWeights(u,w,s,d);for(const k of FLOW_ANCHORS)assert(Math.abs(weights[k]-(k===key?1:0))<1e-10,`${key}: anchor ${k} not reproduced`);}
assert(Object.values(anchorWeights(0,0,0,0)).every(v=>v===0));
for(let speed=0;speed<=350;speed+=7)for(const steer of [-18,-3,0,7,18])for(const drs of [0,.3,1]){
 const w=anchorWeights(speed/3.6,speed/3.6,steer,drs);assert(Object.values(w).every(Number.isFinite));
 const q=anchorWeights((speed+.0001)/3.6,(speed+.0001)/3.6,steer,drs);assert(Math.max(...FLOW_ANCHORS.map(k=>Math.abs(w[k]-q[k])))<.001,'Field selection jumps');
}
for(const car of ['rb19','rb16b']){
 const manifest=JSON.parse(await fs.readFile(new URL(`web/public/flow/${car}/manifest.json`,root)));
 assert.equal(manifest.anchors.length,9);
 const arrays={};
 for(const a of manifest.anchors){assert(a.meshOk);const bytes=await fs.readFile(new URL('web/public'+a.file,root));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),a.sha256);assert.equal(bytes.length,a.grid.shape.reduce((p,n)=>p*n,1)*6);const raw=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);arrays[a.anchor]=Float32Array.from(raw,v=>v*a.scale);assert([...arrays[a.anchor]].every(Number.isFinite));assert(a.lastIteration===650);}
 for(const key of ['open','left','right','locked','fast','spin']){let difference=0;const a=arrays.base,b=arrays[key];for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]-b[i]);assert(difference>100,`${car}: ${key} field unchanged`);}
 console.log(`${car}: 9 actual CFD fields, file hashes, grid sizes, and distinct responses verified`);
}
console.log('Exact anchors, zero state and continuous 0–350 km/h coefficient transitions verified');
