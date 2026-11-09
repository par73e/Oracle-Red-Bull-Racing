/** Independent checks against exported GLB vertices, rather than controller values. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

const root=path.resolve(import.meta.dirname,'../..');
const baseline=process.argv.includes('--baseline');
const reports=[];
for(const car of (baseline?['rb16b']:['rb16b','rb19'])){
  const folder=`assets/exports/${car}${baseline?'/versions/before-fixes-2026-11-09':''}`;
  const config=JSON.parse(await fs.readFile(path.join(root,`${folder}/${car}.json`),'utf8'));
  const bytes=await fs.readFile(path.join(root,`${folder}/${car}.glb`));
  const size=bytes.readUInt32LE(12), gltf=JSON.parse(bytes.subarray(20,20+size));
  const bin=bytes.subarray(28+size), parents=new Map();
  gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
  const index=name=>{const i=gltf.nodes.findIndex(n=>n.name===name);if(i<0)throw Error(`Missing ${name}`);return i;};
  const overrides=new Map(),cache=new Map();
  function world(i){
    if(cache.has(i))return cache.get(i);
    const n=gltf.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(
      new Vector3().fromArray(n.translation||[0,0,0]),
      overrides.get(i)||new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]));
    const m=parents.has(i)?world(parents.get(i)).clone().multiply(local):local;cache.set(i,m);return m;
  }
  const positions=new Map();
  function points(i){
    if(!positions.has(i)){
      const data=[];
      for(const primitive of gltf.meshes[gltf.nodes[i].mesh].primitives){
        const a=gltf.accessors[primitive.attributes.POSITION],v=gltf.bufferViews[a.bufferView];
        if(a.componentType!==5126)throw Error('Unexpected packed positions');
        for(let j=0;j<a.count;j++){
          const o=(v.byteOffset||0)+(a.byteOffset||0)+j*(v.byteStride||12);
          data.push(new Vector3(bin.readFloatLE(o),bin.readFloatLE(o+4),bin.readFloatLE(o+8)));
        }
      }
      positions.set(i,data);
    }
    return positions.get(i).map(p=>p.clone().applyMatrix4(world(i)));
  }
  function fittedAxis(points){
    const c=points.reduce((s,p)=>s.add(p),new Vector3()).divideScalar(points.length);
    let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;
    for(const p of points){const d=p.clone().sub(c);xx+=d.x*d.x;xy+=d.x*d.y;xz+=d.x*d.z;yy+=d.y*d.y;yz+=d.y*d.z;zz+=d.z*d.z;}
    const inverse=new Matrix3().set(xx,xy,xz,xy,yy,yz,xz,yz,zz).invert();
    let axis=new Vector3(1,0,0);
    for(let j=0;j<70;j++)axis.applyMatrix3(inverse).normalize();
    return axis;
  }
  function connectedSheets(i){
    // Weld export-only UV/material seams by position before counting physical
    // sheets. Counting nodes alone missed a fixed lip inside the old flap node.
    const vertices=points(i),weld=new Map(),parents=[],ids=vertices.map(p=>{
      const key=p.toArray().map(v=>Math.round(v*1e6)).join(',');
      if(!weld.has(key)){weld.set(key,parents.length);parents.push(parents.length);}
      return weld.get(key);
    });
    function find(k){while(parents[k]!==k){parents[k]=parents[parents[k]];k=parents[k];}return k;}
    const used=new Set();let base=0;
    for(const primitive of gltf.meshes[gltf.nodes[i].mesh].primitives){
      if((primitive.mode??4)!==4)throw Error('Expected triangle wing mesh');
      const count=gltf.accessors[primitive.attributes.POSITION].count;
      let indices=Array.from({length:count},(_,j)=>j);
      if(primitive.indices!==undefined){
        const a=gltf.accessors[primitive.indices],view=gltf.bufferViews[a.bufferView];
        const readers={5121:['readUInt8',1],5123:['readUInt16LE',2],5125:['readUInt32LE',4]};
        const [read,size]=readers[a.componentType]||[];
        if(!read)throw Error('Unexpected wing index encoding');
        indices=Array.from({length:a.count},(_,j)=>bin[read]((view.byteOffset||0)+(a.byteOffset||0)+j*(view.byteStride||size)));
      }
      for(let j=0;j<indices.length;j+=3){
        const triangle=indices.slice(j,j+3).map(k=>ids[base+k]);
        triangle.forEach(k=>used.add(k));
        for(const k of triangle.slice(1))parents[find(k)]=find(triangle[0]);
      }
      base+=count;
    }
    return new Set([...used].map(find)).size;
  }
  const report={car,wheels:{},fixedWing:[],flapDecals:[],revision:config.revision};
  // The reported oscillation concerns RB16B; RB19 wheel geometry is unchanged.
  for(const key of (car==='rb16b'?['FL','FR','RL','RR']:[])){
    const spec=config.wheels[key];
    const name=spec.spin_meshes.find(n=>n.includes('tyre')&&n.endsWith('SUB1'))||spec.spin_meshes[0];
    const mesh=index(name),spin=index(spec.spin),restAxis=fittedAxis(points(mesh));
    let maxDrift=0;
    for(let step=0;step<=24;step++){
      overrides.set(spin,new Quaternion().setFromAxisAngle(new Vector3(1,0,0),step*Math.PI/12));cache.clear();
      const axis=fittedAxis(points(mesh));
      maxDrift=Math.max(maxDrift,Math.acos(Math.min(1,Math.abs(axis.dot(restAxis))))*180/Math.PI);
    }
    overrides.delete(spin);cache.clear();
    report.wheels[key]={maxGeometricAxisDriftDegrees:maxDrift,samples:25};
    if(maxDrift>.15&&!baseline)throw Error(`${car} ${key} axle still wobbles ${maxDrift} degrees`);
  }
  if(baseline){reports.push(report);console.log(JSON.stringify(report));continue;}
  if(car==='rb16b'){
    report.brakeDiscs=[];
    for(const [name,key] of [['DISK_LF','FL'],['DISK_RF','FR'],['DISK_LR','RL'],['DISK_RR','RR']]){
      let i=index(name),attached=false;
      while(parents.has(i)){i=parents.get(i);if(i===index(config.wheels[key].spin))attached=true;}
      const materials=gltf.meshes[gltf.nodes[index(name)].mesh].primitives.map(p=>gltf.materials[p.material]);
      if(!attached||materials.some(m=>m.name!=='RB16B_CarbonDisc_Outer'||m.pbrMetallicRoughness.metallicFactor!==0))throw Error(`Incorrect visible brake disc ${name}`);
      report.brakeDiscs.push({name,attachedTo:config.wheels[key].spin,materials:materials.map(m=>m.name)});
    }
  }
  const pivot=index(config.drs.pivot);
  for(const name of config.drs.fixed_meshes){
    overrides.delete(pivot);cache.clear();const before=points(index(name));
    overrides.set(pivot,new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-config.drs.max_angle_radians));cache.clear();
    const after=points(index(name));let delta=0;
    for(let j=0;j<before.length;j++)delta=Math.max(delta,before[j].distanceTo(after[j]));
    report.fixedWing.push({name,maxVertexMovement:delta});
    if(delta>1e-7)throw Error(`${name} should remain fixed`);
  }
  for(const name of config.quality_fixes.flap_decal_meshes||[]){
    let i=index(name),attached=false;
    while(parents.has(i)){i=parents.get(i);if(i===pivot)attached=true;}
    if(!attached)throw Error(`${name} is not attached to the flap`);
    overrides.delete(pivot);cache.clear();const before=points(index(name));
    overrides.set(pivot,new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-config.drs.max_angle_radians));cache.clear();
    const after=points(index(name));const delta=Math.max(...before.map((p,j)=>p.distanceTo(after[j])));
    if(delta<.01)throw Error(`${name} livery remains stationary`);
    report.flapDecals.push({name,maxMovement:delta});
  }
  overrides.delete(pivot);cache.clear();
  if(car==='rb19'){
    const fixedLip='DRS_Fixed_Mainplane_Lip';
    if(!config.drs.fixed_meshes.includes(fixedLip))throw Error('RB19 mainplane trailing lip is not a fixed mesh');
    report.flapConnectedSheets=config.drs.flap_meshes.map(name=>({name,count:connectedSheets(index(name))}));
    if(report.flapConnectedSheets.some(sheet=>sheet.count!==1))throw Error('A disconnected fixed wing sheet is still included in DRS');
    const before=points(index(fixedLip));let delta=0;
    for(let step=1;step<=20;step++){
      overrides.set(pivot,new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-config.drs.max_angle_radians*step/20));cache.clear();
      const after=points(index(fixedLip));
      for(let j=0;j<before.length;j++)delta=Math.max(delta,before[j].distanceTo(after[j]));
    }
    overrides.delete(pivot);cache.clear();
    report.fixedMainplaneLip={name:fixedLip,maxVertexMovement:delta,samples:21};
    if(delta>1e-7)throw Error('RB19 mainplane trailing lip moves with DRS');
    report.flapMaxAbsX=Math.max(...config.drs.flap_meshes.flatMap(n=>points(index(n)).map(p=>Math.abs(p.x))));
    if(report.flapMaxAbsX>.5351)throw Error('Fixed outer wing tips are included in DRS');
  }
  reports.push(report);console.log(JSON.stringify(report));
}
await fs.writeFile(path.join(root,`docs/research/${baseline?'before-fix-wheel-checks':'moving-geometry-checks'}-2026-11-09.json`),JSON.stringify(reports,null,2)+'\n');
