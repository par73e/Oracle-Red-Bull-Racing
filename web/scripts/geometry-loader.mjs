// Geometry-only GLB loader for reproducible CFD export and collision QA.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Object3D,Mesh,BufferGeometry,BufferAttribute,Matrix4 } from 'three';
const root=path.resolve(import.meta.dirname,'../..');
export async function loadGeometry(car){
const configs=JSON.parse(await fs.readFile(`${root}/web/public/models/manifest.json`)),config=configs.find(c=>c.id===car);
const bytes=await fs.readFile(`${root}/web/public/models/${car}.glb`),size=bytes.readUInt32LE(12);
const gltf=JSON.parse(bytes.subarray(20,20+size)),bin=bytes.subarray(28+size);
function accessor(index){
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView];
 const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],types={5126:[4,'readFloatLE',Float32Array],5125:[4,'readUInt32LE',Uint32Array],5123:[2,'readUInt16LE',Uint16Array]};
 const [n,read,Type]=types[a.componentType],data=new Type(a.count*width);
 for(let i=0;i<a.count;i++)for(let k=0;k<width;k++)data[i*width+k]=bin[read]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||n*width)+k*n);
 return new BufferAttribute(data,width);
}
const nodes=gltf.nodes.map(n=>{
 const o=new Object3D();o.name=n.name;
 if(n.matrix)new Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);
 else{o.position.fromArray(n.translation||[0,0,0]);o.quaternion.fromArray(n.rotation||[0,0,0,1]);o.scale.fromArray(n.scale||[1,1,1]);}
 if(n.mesh!==undefined)for(const prim of gltf.meshes[n.mesh].primitives){
  const g=new BufferGeometry();for(const [semantic,name] of Object.entries({POSITION:'position',NORMAL:'normal',TANGENT:'tangent'}))if(prim.attributes[semantic]!==undefined)g.setAttribute(name,accessor(prim.attributes[semantic]));
  if(prim.indices!==undefined)g.setIndex(accessor(prim.indices));const mesh=new Mesh(g);mesh.name=n.name+'__surface';o.add(mesh);
 }
 return o;
});
gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(j=>nodes[i].add(nodes[j])));
const model=new Object3D();gltf.scenes[gltf.scene||0].nodes.forEach(i=>model.add(nodes[i]));

return {model,config,bytes};
}
