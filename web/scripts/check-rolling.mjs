import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { rollingWeights,ROLLING_FLOW_ANCHORS } from '../src/airflow.js';
const exact=[['base',50,50,0,0],['low',50/3.6,50/3.6,0,0],['high',350/3.6,350/3.6,0,0],['open',50,50,0,1],['left',50,50,-18,0],['right',50,50,18,0],['road-stop',50,0,0,0],['road-slow',50,25,0,0],['road-fast',50,100,0,0],['still-air',0,50,0,0]];
for(const [key,u,g,s,d] of exact){const w=rollingWeights(u,g,s,d);for(const k of ROLLING_FLOW_ANCHORS)assert(Math.abs(w[k]-(k===key?1:0))<1e-10,`${key}: ${k}`);}
assert(Object.values(rollingWeights(0,0)).every(v=>v===0));
for(let u=0;u<=100;u+=2)for(let g=0;g<=100;g+=2)for(const [s,d] of [[0,0],[-18,1],[9,.5]]){
 const a=rollingWeights(u,g,s,d);assert(Object.values(a).every(Number.isFinite));
 for(const [v,z] of [[u+.00001,g],[u,g+.00001]]){const b=rollingWeights(v,z,s,d);assert(Math.max(...ROLLING_FLOW_ANCHORS.map(k=>Math.abs(a[k]-b[k])))<.0001,`discontinuous ${u},${g}`);}
}
for(const car of ['rb19','rb16b']){
 const manifest=JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/rolling/manifest.json`,import.meta.url)));
 assert.equal(manifest.anchors.length,4);
 for(const a of manifest.anchors){
  assert(a.meshOk&&a.lastIteration===650&&a.noSlipRolling);assert.equal(a.groundSpeedMps,a.wheelSpeedMps);
  const b=await fs.readFile(new URL(`../public${a.file}`,import.meta.url));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),a.sha256);assert.equal(b.length,a.grid.shape.reduce((n,v)=>n*v,1)*6);
  const config=await fs.readFile(new URL(`../../cfd/library/cases/${car}-rolling-${a.anchor}/0/U`,import.meta.url),'utf8');
  const inlet=+config.match(/inlet \{type fixedValue; value uniform \(([^ ]+)/)[1],ground=+config.match(/ground \{type fixedValue; value uniform \(([^ ]+)/)[1];assert.equal(inlet,a.speedMps);assert.equal(ground,a.groundSpeedMps);
  for(const [key,w] of Object.entries(a.wheels)){const omega=+config.match(new RegExp(key+' \\{[^\\n]*omega ([^;]+)'))[1];assert(Math.abs(omega*w.radius-ground)<1e-9);}
 }
 console.log(`${car}: four solved air/road cases; actual boundary velocities, all tyre angular speeds, hashes and final iteration verified`);
}
console.log('Ten solved nodes reproduced exactly; two-dimensional speed space finite and continuous, including zero air and zero road.');
