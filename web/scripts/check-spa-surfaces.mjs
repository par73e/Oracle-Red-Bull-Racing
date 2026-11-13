import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createSpaSurface } from '../src/spa-surface.js';
const data=JSON.parse(await fs.readFile(new URL('../src/spa-data.json',import.meta.url)));
const surface=createSpaSurface(data),terrain=surface.terrainGeometry(),bvh=new MeshBVH(terrain);
const base=surface.ribbonGeometry(s=>s.leftWidth+1,s=>s.leftWidth+19,{start:.27,end:.69});
const runoffBvh=new MeshBVH(base);
const ray=new T.Ray(new T.Vector3(),new T.Vector3(0,-1,0));
const parts=[
 ['road',s=>-s.rightWidth,s=>s.leftWidth,{}],
 ['runoff',s=>s.leftWidth+1,s=>s.leftWidth+19,{start:.27,end:.69}],
 ['lane',s=>-s.rightWidth-12,s=>-s.rightWidth-8,{start:.12,end:.74}],
 ...Array.from({length:5},(_,i)=>['paint'+i,s=>s.leftWidth+1+i*2.5,s=>s.leftWidth+3.5+i*2.5,{start:.28,end:.68,lift:.005}]),
 ...[-1,1].map(sign=>['curb'+sign,s=>sign*(sign>0?s.leftWidth:s.rightWidth),s=>sign*((sign>0?s.leftWidth:s.rightWidth)+1.05),{start:.22,end:.76,lift:.04}]),
];
let failures=0;
for(const [name,from,to,options] of parts){const g=surface.ribbonGeometry(from,to,options),a=g.attributes.position,idx=g.index;let count=0,minimum=Infinity,worst,paintGap=Infinity;const weights=[[1/3,1/3,1/3],[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]];
 for(let k=0;k<idx.count;k+=3)for(const w of weights){const p=new T.Vector3();for(let j=0;j<3;j++)p.addScaledVector(new T.Vector3().fromBufferAttribute(a,idx.getX(k+j)),w[j]);ray.origin.set(p.x,1000,p.z);const hit=bvh.raycastFirst(ray,T.DoubleSide);if(!hit)continue;const gap=p.y-hit.point.y;if(gap<minimum){minimum=gap;worst=p.toArray();}if(gap<.02)failures++;if(name.startsWith('paint')){const under=runoffBvh.raycastFirst(ray,T.DoubleSide);assert(under,`${name} must be supported by runoff`);paintGap=Math.min(paintGap,p.y-under.point.y);assert(p.y-under.point.y>.001,'Paint must stay above its supporting pavement');}count++;}
 console.log({name,samples:count,minimumClearanceM:minimum,worst,...(Number.isFinite(paintGap)?{paintClearanceM:paintGap}:{})});g.dispose();
}
base.dispose();terrain.dispose();assert.equal(failures,0,`${failures} pavement samples have insufficient terrain clearance`);
