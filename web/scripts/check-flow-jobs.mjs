import assert from 'node:assert/strict';
import * as T from 'three';
import { FlowJobs } from '../src/flow-jobs.js';
class FakeWorker {
 constructor(){this.messages=[];}
 postMessage(m){this.messages.push(m);}
 terminate(){}
 emit(data){this.onmessage({data});}
}
globalThis.Worker=FakeWorker;
const layer=()=>({geometry:new T.BufferGeometry(),lines:{},group:{visible:true},status:'ready'});
const flow={...layer(),serial:1,elapsed:0,data:{base:new Float32Array(3),open:new Float32Array(3)},stats:{ready:true},material:{uniforms:{clock:{value:0}}},onStatus(){},sweep:{lastRefresh:Infinity,revision:0,selection:()=>null}};
const bottom=layer(),side=layer(),jobs=new FlowJobs(flow,bottom,side),rig={model:new T.Group(),wheels:{}};
const state={model:'rb19',flow:true,flowDensity:100,speed:180,wheelSpeedMps:50,steer:0,drsCurrent:0};
jobs.update(state,rig,.016,1000);const worker=jobs.worker;worker.emit({type:'ready'});
function send(drs,now){state.drsCurrent=drs;jobs.update(state,rig,.016,now);return worker.messages.at(-1);}
function complete(m){const output={visible:true,attributes:{position:new Float32Array([m.state.drsCurrent,0,0])},stats:{ready:true,inputKey:m.key}};worker.emit({type:'result',key:m.key,cachedKeys:['base','open'],pose:{steer:0,drs:m.state.drsCurrent},flow:output,bottom:output,side:output,workerMs:150});}
let m=send(.1,1100);send(.4,1200);
assert.equal(flow.group.visible,true,'Moving DRS must not hide existing flow');
complete(m);assert.equal(flow.geometry.attributes.position.array[0],Math.fround(.1),'Publish completed flow while DRS is still moving');
m=send(.7,1300);assert.equal(m.state.drsCurrent,.7,'Coalesce intermediate input to newest pose');send(.9,1400);complete(m);
assert.equal(flow.geometry.attributes.position.array[0],Math.fround(.7));
m=send(1,1500);complete(m);assert.equal(flow.stats.inputKey,m.key,'Settle to final opening');
const count=worker.messages.length;send(1,1600);assert.equal(worker.messages.length,count,'Do not recompute unchanged input');
flow.sweep.selection=()=>({loading:true});m=send(.5,1700);assert.equal(m.type,'compute','Keep computing approximation while fields load');assert.equal(m.selection.axisSweep,false);complete(m);
flow.sweep.selection=()=>({weights:{base:1},data:flow.data});flow.sweep.revision++;m=send(.5,1800);assert.equal(m.selection.axisSweep,true,'Use newly available solved field without further slider motion');complete(m);
m=send(.3,1900);state.flow=false;jobs.update(state,rig,.016,1950);complete(m);assert.equal(flow.group.visible,false,'Disabled flow stays hidden when pending result arrives');
state.flow=true;m=send(.2,2100);const geometry=flow.geometry;flow.serial++;complete(m);assert.equal(flow.geometry,geometry,'Reject result from obsolete model load');
console.log('DRS motion, latest input, loading fallback, field revision, disabled flow and obsolete model guards passed');
