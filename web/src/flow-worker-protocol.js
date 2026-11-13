import * as T from 'three';
export function positionCopy(attribute){const p=new Float32Array(attribute.count*3);for(let i=0;i<attribute.count;i++){p[i*3]=attribute.getX(i);p[i*3+1]=attribute.getY(i);p[i*3+2]=attribute.getZ(i);}return p;}
export function describeModel(rig){const meshes=[];rig.model.traverse(o=>{if(o.isMesh)meshes.push(o);});return {meshes,description:meshes.map(o=>({position:positionCopy(o.geometry.attributes.position),index:o.geometry.index?.array.slice()||null}))};}
export function snapshotRig(rig,meshes,versions){const matrices=new Float64Array(meshes.length*16),visible=[],changed=[];
 meshes.forEach((o,i)=>{matrices.set(o.matrixWorld.elements,i*16);visible.push(o.visible);const p=o.geometry.attributes.position;if(versions[i]!==p.version){if(versions[i]!==undefined)changed.push({index:i,position:positionCopy(p)});versions[i]=p.version;}});
 const wheels=Object.fromEntries(Object.entries(rig.wheels).map(([k,w])=>[k,{position:w.spinNode.getWorldPosition(new T.Vector3()).toArray(),quaternion:w.spinNode.getWorldQuaternion(new T.Quaternion()).toArray(),radius:w.radius}]));
 const links=Object.fromEntries(Object.entries(rig.links||{}).map(([k,l])=>[k,{inner:l.innerNode.getWorldPosition(new T.Vector3()).toArray(),outer:l.outerNode.getWorldPosition(new T.Vector3()).toArray()}]));
 return {matrices,visible,changed,wheels,links};
}
