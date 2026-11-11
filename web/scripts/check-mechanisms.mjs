import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Object3D, Matrix4, Vector3 } from 'three';
import { bindRig, applyRig, inspectRig } from '../src/rig.js';

const root=path.resolve(import.meta.dirname,'../..'),reports=[];
for(const car of ['rb19','rb16b']){
  const config=JSON.parse(await fs.readFile(`${root}/assets/exports/${car}/${car}.json`));
  const bytes=await fs.readFile(`${root}/assets/exports/${car}/${car}.glb`);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  const binary=bytes.subarray(28+bytes.readUInt32LE(12)),vertexCache=new Map();
  const nodes=gltf.nodes.map(n=>{
    const obj=new Object3D();obj.name=n.name;
    if(n.matrix)new Matrix4().fromArray(n.matrix).decompose(obj.position,obj.quaternion,obj.scale);
    else{obj.position.fromArray(n.translation||[0,0,0]);obj.quaternion.fromArray(n.rotation||[0,0,0,1]);obj.scale.fromArray(n.scale||[1,1,1]);}
    return obj;
  });
  gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>nodes[i].add(nodes[c])));
  const model=new Object3D();gltf.scenes[gltf.scene||0].nodes.forEach(i=>model.add(nodes[i]));
  const rig=bindRig(model,config),report={car,revision:config.revision,steeringSamples:0,drsSamples:0,
    maxTrackRodLengthError:0,maxTrackRodEndpointError:0,maxKingpinJointMovement:0,maxPistonTipError:0,
    minPistonInsertion:Infinity,minCylinderBackClearance:Infinity};
  function localPoints(name){
    if(!vertexCache.has(name)){
      const i=gltf.nodes.findIndex(n=>n.name===name),points=[];
      for(const primitive of gltf.meshes[gltf.nodes[i].mesh].primitives){
        const a=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[a.bufferView];
        assert.equal(a.componentType,5126);
        for(let j=0;j<a.count;j++){
          const o=(view.byteOffset||0)+(a.byteOffset||0)+j*(view.byteStride||12);
          points.push(new Vector3(binary.readFloatLE(o),binary.readFloatLE(o+4),binary.readFloatLE(o+8)));
        }
      }
      vertexCache.set(name,points);
    }
    return vertexCache.get(name);
  }
  function worldPoints(name){return localPoints(name).map(p=>p.clone().applyMatrix4(model.getObjectByName(name).matrixWorld));}
  applyRig(rig,{steer:0,drs:0,spin:1.1});
  const visual={};
  for(const [key,spec] of Object.entries(config.suspension.wheels)){
    const wheel=rig.wheels[key],tyre=config.wheels[key].spin_meshes.find(n=>n.includes('tyre')&&n.endsWith('SUB1'))||config.wheels[key].spin_meshes[0];
    const axis=new Vector3(1,0,0).transformDirection(wheel.spinNode.matrixWorld);
    // Select the real exported cut-face vertices in the rod frame, rather than
    // trusting the logical joint center that passed the previous checks.
    const link=model.getObjectByName(spec.link);
    const capIndices=worldPoints(spec.tie_mesh).map((p,i)=>({point:link.worldToLocal(p),i})).filter(p=>p.point.y<spec.port.cap_limit).map(p=>p.i);
    visual[key]={tyre,axis,capIndices,bottom:Math.min(...worldPoints(tyre).map(p=>p.y)),maxCamberChange:0,maxBottomChange:0,minCapMargin:Infinity,maxCapEllipse:0,
      fixedBaseline:spec.fixed_fairing?worldPoints(spec.fixed_fairing):null,maxFairingMovement:0};
  }
  for(const transformed of [false,true]){
    model.position.set(transformed?2:0,transformed?.5:0,transformed?-3:0);
    model.rotation.set(0,transformed?.4:0,0);model.scale.setScalar(transformed?1.7:1);
    for(let input=-18;input<=18;input+=.5){
      applyRig(rig,{steer:input,drs:0,spin:1.1});const inspection=inspectRig(rig);
      for(const [key,spec] of Object.entries(config.suspension.wheels)){
        const sample=inspection.suspension[key];
        report.maxTrackRodLengthError=Math.max(report.maxTrackRodLengthError,sample.lengthError);
        report.maxTrackRodEndpointError=Math.max(report.maxTrackRodEndpointError,sample.endpointError);
        const rootNode=model.getObjectByName('AERO_CAR');
        const length=new Vector3(...spec.upper).distanceTo(new Vector3(...spec.lower));
        const actual=rig.wheels[key].steerNode.localToWorld(new Vector3(0,length,0));
        const expected=rootNode.localToWorld(new Vector3(...spec.upper));
        report.maxKingpinJointMovement=Math.max(report.maxKingpinJointMovement,actual.distanceTo(expected));
        if(!transformed){
          const v=visual[key],axis=new Vector3(1,0,0).transformDirection(rig.wheels[key].spinNode.matrixWorld);
          v.maxCamberChange=Math.max(v.maxCamberChange,Math.abs(Math.asin(axis.y)-Math.asin(v.axis.y))*180/Math.PI);
          v.maxBottomChange=Math.max(v.maxBottomChange,Math.abs(Math.min(...worldPoints(v.tyre).map(p=>p.y))-v.bottom));
          const sleeve=model.getObjectByName(spec.port.mesh),all=worldPoints(spec.tie_mesh);
          for(const i of v.capIndices){
            const p=sleeve.worldToLocal(all[i]);
            v.minCapMargin=Math.min(v.minCapMargin,p.y-spec.port.begin,spec.port.end-p.y);
            v.maxCapEllipse=Math.max(v.maxCapEllipse,(p.x/spec.port.bore_rx)**2+(p.z/spec.port.bore_rz)**2);
          }
          if(v.fixedBaseline){
            const current=worldPoints(spec.fixed_fairing);
            for(let j=0;j<current.length;j++)v.maxFairingMovement=Math.max(v.maxFairingMovement,current[j].distanceTo(v.fixedBaseline[j]));
          }
        }
      }
      report.steeringSamples++;
    }
    for(let amount=0;amount<=40;amount++){
      applyRig(rig,{steer:18,drs:amount/40,spin:0});const sample=inspectRig(rig);
      report.maxPistonTipError=Math.max(report.maxPistonTipError,sample.rodError);
      assert.equal(rig.rod.scale.y,1,'Piston must not stretch');assert.equal(rig.cylinder.scale.y,1,'Body must not stretch');
      // Insertion is measured in model units even when the whole scene is scaled.
      const a=rig.cylinder.parent.worldToLocal(rig.base.getWorldPosition(new Vector3()));
      const b=rig.cylinder.parent.worldToLocal(rig.attachment.getWorldPosition(new Vector3()));
      const distance=a.distanceTo(b),insertion=config.drs.rod_length-(distance-config.drs.cylinder_length);
      report.minPistonInsertion=Math.min(report.minPistonInsertion,insertion);
      report.minCylinderBackClearance=Math.min(report.minCylinderBackClearance,distance-config.drs.rod_length);
      report.drsSamples++;
    }
  }
  assert(report.maxTrackRodLengthError<1e-5,`${car}: track rod stretched`);
  assert(report.maxTrackRodEndpointError<1e-5,`${car}: track rod detached`);
  assert(report.maxKingpinJointMovement<1e-5,`${car}: wishbone joint detached`);
  assert(report.maxPistonTipError<1e-5,`${car}: hydraulic rod detached`);
  assert(report.minPistonInsertion>=.0179,`${car}: piston leaves gland`);
  assert(report.minCylinderBackClearance>=.0099,`${car}: piston exits cylinder back`);
  report.exterior=Object.fromEntries(Object.entries(visual).map(([key,v])=>[key,{
    maxCamberChangeDegrees:v.maxCamberChange,maxTreadBottomHeightChange:v.maxBottomChange,
    minRootCapAxialMargin:v.minCapMargin,maxRootCapBoreEllipse:v.maxCapEllipse,
    fixedFairingMaxMovement:v.maxFairingMovement,
  }]));
  for(const [key,v] of Object.entries(visual)){
    assert(v.minCapMargin>.005,`${car} ${key}: rod root exposed outside sleeve`);
    assert(v.maxCapEllipse<1,`${car} ${key}: rod root protrudes through sleeve`);
    assert(v.maxFairingMovement<1e-7,`${car} ${key}: native nose fairing should remain fixed`);
    if(car==='rb16b'){
      assert(v.maxCamberChange<.15,`${car} ${key}: excessive steering camber`);
      assert(v.maxBottomChange<1e-5,`${car} ${key}: tyre lifts during steering`);
    }
  }
  if(car==='rb16b'){
    model.position.set(0,0,0);model.rotation.set(0,0,0);model.scale.setScalar(1);applyRig(rig,{steer:0,drs:0,spin:0});
    assert(!gltf.nodes.some(n=>n.name==='rearwing_top_SUB0'),'Legacy central wing profile remains');
    const oldBar=worldPoints('safetycell_SUB1').filter(p=>Math.abs(p.x)<.02&&p.z<-2.28&&p.z>-2.46&&p.y>.985);
    assert.equal(oldBar.length,0,'Legacy gray DRS bar remains in the chassis');
    assert(!gltf.nodes.some(n=>n.name==='DRS_BASE_MOUNT_PAD'),'Old block mount remains');
    for(const name of ['DRS_BASE_MOLDED_CARBON','DRS_TIP_MOLDED_CARBON']){
      const node=gltf.nodes.find(n=>n.name===name);assert(node);
      for(const primitive of gltf.meshes[node.mesh].primitives)assert.equal(gltf.materials[primitive.material].name,'AERO_DRS_Woven_Carbon');
    }
  }
  report.drsMounts={};
  model.position.set(0,0,0);model.rotation.set(0,0,0);model.scale.setScalar(1);
  applyRig(rig,{steer:0,drs:0,spin:0});
  for(const label of ['BASE','TIP']){
    const name=`DRS_${label}_MOLDED_CARBON`,node=gltf.nodes.find(n=>n.name===name);
    assert(node,`${car}: missing molded support`);
    for(const primitive of gltf.meshes[node.mesh].primitives){
      const mat=gltf.materials[primitive.material];
      assert.equal(mat.name,'AERO_DRS_Woven_Carbon');
      assert(mat.pbrMetallicRoughness.baseColorTexture && mat.normalTexture,'Carbon needs exported color and normal textures');
      assert(primitive.attributes.TEXCOORD_0!==undefined,'Carbon needs UVs');
    }
    const points=worldPoints(name);
    // glTF duplicates vertices at UV seams, so an arithmetic vertex mean is
    // biased toward the seam. Use the spatial extent and mirrored surface set.
    const centerX=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2;
    const cell=p=>[p.x,p.y,p.z].map(v=>Math.floor(v/1e-5));
    const buckets=new Map();
    for(const p of points){const k=cell(p).join(',');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
    let mirrorError=0;
    for(const p of points){
      const target=new Vector3(-p.x,p.y,p.z),[x,y,z]=cell(target);let nearest=Infinity;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)
        for(const q of buckets.get([x+dx,y+dy,z+dz].join(','))||[])nearest=Math.min(nearest,target.distanceTo(q));
      mirrorError=Math.max(mirrorError,nearest);
    }
    assert(Math.abs(centerX)<1e-6,`${car} ${label}: support leans sideways`);
    // Subdivision at world coordinates near 2.5 uses float32; allow its
    // measured micron-scale rounding while rejecting a visible lateral lean.
    assert(mirrorError<2e-6,`${car} ${label}: asymmetric support surface (${mirrorError}, center ${centerX})`);
    report.drsMounts[label]={centerX,mirrorError,vertices:points.length};
    assert(!gltf.nodes.some(n=>n.name===`DRS_${label}_MOUNT_PAD`),'Old block pad remains');
    assert(!gltf.nodes.some(n=>n.name===`DRS_${label}_CARBON_HORN`),'Old conical horn remains');
  }
  for(const [name,rough] of [['AERO_DRS_Anodized_Alloy',.32],['AERO_DRS_Polished_Piston',.17]]){
    const material=gltf.materials.find(m=>m.name===name);assert(material,`${car}: missing ${name}`);
    assert(Math.abs(material.pbrMetallicRoughness.roughnessFactor-rough)<1e-6);
    assert((material.pbrMetallicRoughness.metallicFactor??1)>=.8);
  }
  reports.push(report);console.log(JSON.stringify(report));
}
await fs.writeFile(`${root}/docs/research/exported-mechanisms-2026-11-09.json`,JSON.stringify(reports,null,2)+'\n');
