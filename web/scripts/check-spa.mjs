import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig,applyRig } from '../src/rig.js';
const root=new URL('../../',import.meta.url),data=JSON.parse(await fs.readFile(new URL('web/src/spa-data.json',root)));const road=data.road,curve=new T.CatmullRomCurve3(road.map(p=>new T.Vector3(...p.slice(0,3))),false,'centripetal');
assert.equal(data.units,'metres');assert.equal(road.length,135);assert.equal(data.terrain.heights.length,1881);assert(data.terrain.heights.every(Number.isFinite));assert.equal(road[37][0],0);assert.equal(road[37][1],0);assert.equal(road[37][2],0);
let maxGrade=0;for(let i=1;i<road.length;i++){const a=road[i-1],b=road[i],d=Math.hypot(b[0]-a[0],b[2]-a[2]);assert(d>4&&d<6);maxGrade=Math.max(maxGrade,Math.abs((b[1]-a[1])/d));assert(b[3]+b[4]>8&&b[3]+b[4]<11);}
const html=await fs.readFile(new URL('web/index.html',root),'utf8');assert.deepEqual([...html.matchAll(/data-environment="([^"]+)"/g)].map(m=>m[1]),['wind','eau-rouge','studio']);
const environments=await fs.readFile(new URL('web/src/environments.js',root),'utf8');assert(!environments.includes('ardennes-beech-v1'));assert(!environments.includes('function track('));
const samples=Array.from({length:10001},(_,i)=>curve.getPoint(i/10000));
for(const car of ['rb19','rb16b']){const {model,config}=await loadGeometry(car),rig=bindRig(model,config);applyRig(rig,{drs:0,steer:0,spin:0});const width=new T.Box3().setFromObject(model).getSize(new T.Vector3()).x;assert(width>1.9&&width<2.2);const contact=[];
 for(const [name,w] of Object.entries(rig.wheels)){const c=w.spinNode.getWorldPosition(new T.Vector3());const p=samples.reduce((best,p)=>Math.abs(p.z-c.z)<Math.abs(best.z-c.z)?p:best);const gap=c.y-w.radius-(p.y-.005);assert(Math.abs(gap)<.035,`${car} ${name} wheel contact gap ${gap}`);contact.push({wheel:name,gapM:gap});}
 console.log(car,{carWidthM:width,roadWidthAtCarM:road[37][3]+road[37][4],contact});}
console.log({roadStations:road.length,terrainSamples:data.terrain.heights.length,maximumSampledGrade:maxGrade,localRiseM:Math.max(...road.map(p=>p[1]))});
