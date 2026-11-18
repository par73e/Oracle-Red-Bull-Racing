import * as T from 'three';
import { computeBoundsTree,acceleratedRaycast } from 'three-mesh-bvh';
import { Airflow } from './airflow.js';
import { UnderbodyFlow } from './underbody.js';
import { SidepodFlow } from './sidepod.js';
T.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;T.Mesh.prototype.raycast=acceleratedRaycast;
let flow,bottom,side,rig,meshes,cache,selection,yawSelection;
function init(m){const scene=new T.Scene(),model=new T.Group(),material=new T.MeshBasicMaterial({side:T.DoubleSide});scene.add(model);
 meshes=m.meshes.map(item=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(item.position,3));if(item.index)g.setIndex(new T.BufferAttribute(item.index,1));g.computeBoundsTree();const mesh=new T.Mesh(g,material);mesh.matrixAutoUpdate=false;model.add(mesh);return mesh;});
 rig={model,config:{id:m.car},wheels:{},links:{}};flow=new Airflow(scene);cache={base:m.baseline};flow.data=cache;flow.baseSpec=m.spec;flow.spec=m.spec;flow.baseGrid=new Float32Array(m.baseline.length);flow.grid=flow.baseGrid;flow.stats.ready=true;
 // Selection/file loading stays with the caller. This thread receives only
 // immutable solved fields, and does the same tracing/collision calculations.
 flow.sweep={manifest:{complete:true},lastRefresh:0,selection:()=>({weights:selection.weights,data:cache})};
 flow.yaw={manifest:{complete:true},lastRefresh:0,selection:()=>yawSelection};
 bottom=new UnderbodyFlow(scene,flow.material);side=new SidepodFlow(scene,flow.material);
 for(const [target,source] of [[bottom,m.bottom],[side,m.side]]){target.meta=source.meta;target.data=source.data;target.status=source.data?'ready':'unavailable';}
 self.postMessage({type:'ready'});
}
function applySnapshot(s){meshes.forEach((o,i)=>{o.matrix.fromArray(s.matrices,i*16);o.visible=s.visible[i];});
 for(const item of s.changed){const g=meshes[item.index].geometry;g.attributes.position.array.set(item.position);g.attributes.position.needsUpdate=true;g.computeBoundingBox();g.boundsTree.refit();}
 for(const [k,w] of Object.entries(s.wheels)){let slot=rig.wheels[k];if(!slot){slot={spinNode:new T.Object3D(),radius:w.radius};rig.wheels[k]=slot;}slot.spinNode.position.fromArray(w.position);slot.spinNode.quaternion.fromArray(w.quaternion);slot.radius=w.radius;}
 for(const [k,l] of Object.entries(s.links)){let slot=rig.links[k];if(!slot){slot={innerNode:new T.Object3D(),outerNode:new T.Object3D()};rig.links[k]=slot;}slot.innerNode.position.fromArray(l.inner);slot.outerNode.position.fromArray(l.outer);}
 rig.model.updateMatrixWorld(true);
}
function pack(layer,visible=layer.group.visible){const attributes={};for(const key of ['position','color','flight','lineAlpha'])attributes[key]=visible&&layer.geometry.drawRange.count!==0?layer.geometry.attributes[key]?.array||new Float32Array():new Float32Array();return {visible,attributes,count:visible?layer.count:0,mode:layer.mode,stops:layer.stops,boundaryAxes:layer.boundaryAxes,regions:layer.regions,layers:layer.layers,seedPoints:layer.seedPoints,blockedSeeds:layer.blockedSeeds,fallbackSamples:layer.fallbackSamples};}
self.onmessage=({data:m})=>{try{if(m.type==='init'){init(m);return;}if(m.type!=='compute')return;
 const start=performance.now();applySnapshot(m.rig);Object.assign(cache,m.fields);selection=m.selection;yawSelection=m.yawSelection?{...m.yawSelection,data:cache}:null;
 flow.lastKey='';flow.lastBuild=0;bottom.key='';side.key='';side.pendingKey='';
 const now=m.id*1000;flow.update(m.state,rig,0,now);bottom.update(m.state,rig,flow);side.update(m.state,rig,flow,now,true);
 const coarse=pack(flow,flow.group.visible),underbody=pack(bottom),sidepod=pack(side);coarse.stats={...flow.stats,axisSweep:m.selection.axisSweep};
 for(const key of Object.keys(cache))if(Object.keys(cache).length>64&&key!=='base'&&key!=='yaw-000'&&!Object.hasOwn(selection.weights,key)&&(!yawSelection||!Object.hasOwn(yawSelection.weights,key)))delete cache[key];
 const result={type:'result',id:m.id,key:m.key,pose:{steer:m.state.steer,drs:m.state.drsCurrent},flow:coarse,bottom:underbody,side:sidepod,workerMs:performance.now()-start,cachedKeys:Object.keys(cache)};
 self.postMessage(result,[coarse,underbody,sidepod].flatMap(layer=>Object.values(layer.attributes).map(a=>a.buffer)));
 }catch(error){self.postMessage({type:'error',message:error.message,id:m.id});}};
