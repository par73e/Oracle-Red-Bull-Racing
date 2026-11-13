import * as T from 'three';
import { describeModel,snapshotRig } from './flow-worker-protocol.js';
import { rollingWeights } from './airflow.js';
const inputKey=s=>[s.speed/3.6,s.wheelSpeedMps].map(v=>v.toFixed(3)).concat(s.steer.toFixed(2),s.drsCurrent.toFixed(3),s.flowDensity).join(':');
function applyLayer(layer,result){layer.geometry.dispose();const geometry=new T.BufferGeometry();for(const [key,array] of Object.entries(result.attributes))geometry.setAttribute(key,new T.BufferAttribute(array,key==='position'||key==='color'?3:1));layer.geometry=geometry;layer.lines.geometry=geometry;layer.group.visible=result.visible;for(const key of ['count','mode','stops','boundaryAxes','regions','layers','seedPoints','blockedSeeds','fallbackSamples'])if(result[key]!==undefined)layer[key]=result[key];}
export class FlowJobs {
 constructor(flow,bottom,side){Object.assign(this,{flow,bottom,side,serial:0,jobId:0,busy:false,ready:false,known:new Set(),appliedKey:'',lastSent:0});}
 initialize(state,rig){this.worker?.terminate();this.serial++;this.ready=false;this.busy=false;this.appliedKey='';this.failed=false;this.model=rig;this.loadSerial=this.flow.serial;const serial=this.serial;this.known=new Set(['base']);const {meshes,description}=describeModel(rig);this.meshes=meshes;this.versions=meshes.map(m=>m.geometry.attributes.position.version);
  this.worker=new Worker(new URL('./flow-worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=({data:m})=>{if(serial!==this.serial||this.loadSerial!==this.flow.serial)return;if(m.type==='ready'){this.ready=true;return;}if(m.type==='error'){this.failed=true;this.busy=false;this.flow.onStatus('气流暂不可用 · 流线计算失败，请重试');return;}
   if(m.type!=='result')return;this.busy=false;this.known=new Set(m.cachedKeys);this.appliedKey=m.key;
   const current=this.current;
   // A worker result naturally trails an animated pose. Keep publishing completed
   // frames while coalescing new input; exact pose equality starves DRS animation.
   if(!current?.flow||current.flowDensity===0||current.speed===0&&current.wheelSpeedMps===0)return;
   applyLayer(this.flow,m.flow);applyLayer(this.bottom,m.bottom);applyLayer(this.side,m.side);
   const coverage=this.flow.stats.sweepCoverage;this.flow.stats={...m.flow.stats,sweepCoverage:coverage,workerMs:m.workerMs,worker:true,mainThreadMs:this.mainThreadMs};this.flow.stats.buildMs=m.workerMs;
   this.flow.onStatus(m.key!==inputKey(current)?'正在更新流线…':m.flow.stats.sourceMode==='anchor'?'粗网格 CFD · 已计算工况':m.flow.stats.axisSweep?'粗网格 CFD · 多参数组合近似':'粗网格 CFD · 当前档位尚在计算，暂用近似预览');
  };
  this.worker.onerror=()=>{if(serial!==this.serial||this.loadSerial!==this.flow.serial)return;this.failed=true;this.busy=false;this.flow.onStatus('气流暂不可用 · 流线计算失败，请重试');};
  this.worker.postMessage({type:'init',car:state.model,meshes:description,spec:this.flow.spec,baseline:this.flow.data.base,bottom:{data:this.bottom.data,meta:this.bottom.meta},side:{data:this.side.data,meta:this.side.meta}});
 }
 update(state,rig,dt,now){this.current={...state};this.flow.elapsed+=dt;this.flow.material.uniforms.clock.value=this.flow.elapsed;
  if(!this.flow.stats.ready||!rig)return;
  const sweep=this.flow.sweep;if(now-sweep.lastRefresh>10000&&!sweep.manifest?.complete)sweep.refresh();
  this.flow.stats.sweepCoverage=sweep.manifest?{completed:sweep.manifest.completedUnique,planned:sweep.manifest.plannedUnique,complete:sweep.manifest.complete,queueState:sweep.queue?.state}:null;
  if(this.model!==rig||this.loadSerial!==this.flow.serial){if(this.bottom.status==='loading'||this.side.status==='loading')return;this.initialize(state,rig);}
  const active=state.flow&&state.flowDensity>0&&(state.speed>0||state.wheelSpeedMps>0);
  if(!active){for(const x of [this.flow,this.bottom,this.side])x.group.visible=false;this.appliedKey='';if(state.flow&&state.speed===0&&state.wheelSpeedMps===0){this.flow.stats.lines=0;this.flow.onStatus('静止 · 来流与车轮均为 0');}return;}
  if(!this.ready||this.busy||this.failed||now-this.lastSent<70)return;
  const key=inputKey(state),fieldRevision=`${sweep.manifest?.completedUnique||0}:${sweep.revision||0}`;
  if(key===this.appliedKey&&this.fieldRevision===fieldRevision)return;
  const start=performance.now(),U=state.speed/3.6,W=state.wheelSpeedMps,selected=sweep.selection(U,W,state.steer,state.drsCurrent);
  // Solved fields can arrive after the slider has moved again. Trace the rolling
  // approximation during loading rather than freezing until the drag finishes.
  const weights=selected?.weights||rollingWeights(U,W,state.steer,state.drsCurrent),source=selected?.data||this.flow.data,fields={};for(const name of Object.keys(weights))if(Math.abs(weights[name])>1e-7&&!this.known.has(name))fields[name]=source[name];
  this.busy=true;this.lastSent=now;this.fieldRevision=fieldRevision;
  this.worker.postMessage({type:'compute',id:++this.jobId,key,state:{...state},rig:snapshotRig(rig,this.meshes,this.versions),selection:{weights,axisSweep:Boolean(selected&&!selected.loading)},fields});this.mainThreadMs=performance.now()-start;
 }
}
