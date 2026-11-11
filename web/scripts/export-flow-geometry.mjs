/** Export the actual articulated GLB pose to CFD surfaces; no Blender instance. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Vector3,Quaternion } from 'three';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig,applyRig } from '../src/rig.js';
const root=path.resolve(import.meta.dirname,'../..');
const [car='rb19',pose='neutral']=process.argv.slice(2);
const {model,config,bytes}=await loadGeometry(car);
const rig=bindRig(model,config),steer=pose==='left'?-18:pose==='right'?18:0,drs=pose==='open'?1:0;
applyRig(rig,{steer,drs,spin:0});model.updateMatrixWorld(true);
const wheelNames=Object.fromEntries(Object.entries(config.wheels).flatMap(([key,w])=>w.spin_meshes.map(n=>[n,key])));
const lists=Object.fromEntries(['body','FL','FR','RL','RR'].map(k=>[k,[]]));
const point=new Vector3(),a=new Vector3(),b=new Vector3(),normal=new Vector3();
model.traverse(mesh=>{if(!mesh.isMesh)return;const name=mesh.parent.name,key=wheelNames[name]||'body',g=mesh.geometry,p=g.attributes.position,idx=g.index;
 for(let f=0;f<(idx?idx.count:p.count);f+=3){const v=[];
  for(let k=0;k<3;k++){point.fromBufferAttribute(p,idx?idx.getX(f+k):f+k).applyMatrix4(mesh.matrixWorld);v.push([-point.z,-point.x,point.y]);}
  lists[key].push(v);
 }
});
const folder=`${root}/cfd/library/geometry/${car}/${pose}`;await fs.mkdir(folder,{recursive:true});
for(const [key,faces] of Object.entries(lists)){
 const buffer=Buffer.alloc(84+50*faces.length);buffer.writeUInt32LE(faces.length,80);
 for(let i=0;i<faces.length;i++){const v=faces[i];a.fromArray(v[1]).sub(point.fromArray(v[0]));b.fromArray(v[2]).sub(point.fromArray(v[0]));normal.crossVectors(a,b).normalize();const values=[...normal.toArray(),...v.flat()];for(let j=0;j<12;j++)buffer.writeFloatLE(values[j],84+i*50+j*4);}
 await fs.writeFile(`${folder}/${key}-raw.stl`,buffer);
}
const wheels=Object.fromEntries(Object.entries(rig.wheels).map(([key,w])=>{const c=w.spinNode.getWorldPosition(new Vector3()),q=w.spinNode.getWorldQuaternion(new Quaternion()),axis=new Vector3(1,0,0).applyQuaternion(q);return [key,{center:[-c.z,-c.x,c.y-.005],axis:[-axis.z,-axis.x,axis.y],radius:w.radius}];}));
await fs.writeFile(`${folder}/pose.json`,JSON.stringify({car,pose,steer,drs,wheels,sourceGlbSha256:crypto.createHash('sha256').update(bytes).digest('hex'),modelRevision:config.revision},null,2));console.log({car,pose,triangles:Object.fromEntries(Object.entries(lists).map(([k,v])=>[k,v.length]))});
