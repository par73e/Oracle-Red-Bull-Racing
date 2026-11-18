import * as T from 'three';
export function positionCopy(attribute){const p=new Float32Array(attribute.count*3);for(let i=0;i<attribute.count;i++){p[i*3]=attribute.getX(i);p[i*3+1]=attribute.getY(i);p[i*3+2]=attribute.getZ(i);}return p;}
export function describeModel(rig){const meshes=[];rig.model.traverse(o=>{if(o.isMesh)meshes.push(o);});return {meshes,description:meshes.map(o=>({position:positionCopy(o.geometry.attributes.position),index:o.geometry.index?.array.slice()||null}))};}
export function snapshotRig(rig,meshes,versions){const matrices=new Float64Array(meshes.length*16),visible=[],changed=[];
 const parent=rig.model?.parent;
 parent?.updateMatrixWorld(true);
 const invParent=parent?new T.Matrix4().copy(parent.matrixWorld).invert():null;
 const invQuat=invParent?new T.Quaternion().setFromRotationMatrix(invParent):null;
 const rel=new T.Matrix4();
 meshes.forEach((o,i)=>{rel.copy(o.matrixWorld);if(invParent)rel.premultiply(invParent);matrices.set(rel.elements,i*16);visible.push(o.visible);const p=o.geometry.attributes.position;if(versions[i]!==p.version){if(versions[i]!==undefined)changed.push({index:i,position:positionCopy(p)});versions[i]=p.version;}});
 const wheels=Object.fromEntries(Object.entries(rig.wheels).map(([k,w])=>{const pos=w.spinNode.getWorldPosition(new T.Vector3()),quat=w.spinNode.getWorldQuaternion(new T.Quaternion());if(invParent){pos.applyMatrix4(invParent);quat.premultiply(invQuat);}return [k,{position:pos.toArray(),quaternion:quat.toArray(),radius:w.radius}];}));
 const links=Object.fromEntries(Object.entries(rig.links||{}).map(([k,l])=>{const inner=l.innerNode.getWorldPosition(new T.Vector3()),outer=l.outerNode.getWorldPosition(new T.Vector3());if(invParent){inner.applyMatrix4(invParent);outer.applyMatrix4(invParent);}return [k,{inner:inner.toArray(),outer:outer.toArray()}];}));
 return {matrices,visible,changed,wheels,links};
}
