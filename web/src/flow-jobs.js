import * as T from 'three';
import { describeModel,snapshotRig } from './flow-worker-protocol.js';
import { rollingWeights } from './airflow.js';
const inputKey=s=>[s.speed/3.6,s.wheelSpeedMps].map(v=>v.toFixed(3)).concat(s.steer.toFixed(2),s.drsCurrent.toFixed(3),s.flowDensity,(s.effWindAngle??s.windAngle??0).toFixed(1)).join(':');
function applyLayer(layer,result){layer.geometry.dispose();const geometry=new T.BufferGeometry();for(const [key,array] of Object.entries(result.attributes))geometry.setAttribute(key,new T.BufferAttribute(array,key==='position'||key==='color'?3:1));layer.geometry=geometry;layer.lines.geometry=geometry;layer.group.visible=result.visible;for(const key of ['count','mode','stops','boundaryAxes','regions','layers','seedPoints','blockedSeeds','fallbackSamples'])if(result[key]!==undefined)layer[key]=result[key];}
export class FlowJobs {
 constructor(flow,bottom,side,{onWorkerReady=null}={}){Object.assign(this,{flow,bottom,side,onWorkerReady,serial:0,jobId:0,busy:false,ready:false,bottomSent:false,sideSent:false,known:new Set(),appliedKey:'',lastSent:0});}
 // Worker crashes or a transient trace failure restart the worker automatically,
 // with backoff, before the UI ever asks the visitor to retry by hand.
 recover(serial){if(serial!==this.serial)return;this.busy=false;this.recoveries=(this.recoveries||0)+1;
  if(this.recoveries>4){this.failed=true;this.flow.onStatus('气流暂不可用 · 流线计算失败，请重试');return;}
  this.failed=true;this.flow.onStatus('正在恢复流线计算…');clearTimeout(this.recoverTimer);
  this.recoverTimer=setTimeout(()=>{if(serial!==this.serial)return;this.model=null;this.failed=false;},Math.min(4000,500*2**(this.recoveries-1)));
 }
 initialize(state,rig){if(this.loadSerial!==this.flow.serial)this.recoveries=0;clearTimeout(this.recoverTimer);this.worker?.terminate();this.serial++;this.ready=false;this.busy=false;this.appliedKey='';this.failed=false;this.model=rig;this.loadSerial=this.flow.serial;const serial=this.serial;this.known=new Set(['base']);const {meshes,description}=describeModel(rig);this.meshes=meshes;this.versions=meshes.map(m=>m.geometry.attributes.position.version);
  this.bottomSent=this.bottom.status==='ready'&&Boolean(this.bottom.data);
  this.sideSent=this.side.status==='ready'&&Boolean(this.side.data);
  this.worker=new Worker(new URL('./flow-worker.js',import.meta.url),{type:'module'});
  this.worker.onmessage=({data:m})=>{if(serial!==this.serial||this.loadSerial!==this.flow.serial)return;if(m.type==='ready'){this.ready=true;this.onWorkerReady?.(state.model);return;}if(m.type==='error'){this.recover(serial);return;}
   if(m.type!=='result')return;this.busy=false;this.recoveries=0;this.known=new Set(m.cachedKeys);this.appliedKey=m.key;
   const current=this.current;
   // A worker result naturally trails an animated pose. Keep publishing completed
   // frames while coalescing new input; exact pose equality starves DRS animation.
   if(!current?.flow||current.flowDensity===0||current.speed===0&&current.wheelSpeedMps===0)return;
   applyLayer(this.flow,m.flow);applyLayer(this.bottom,m.bottom);applyLayer(this.side,m.side);
   const coverage=this.flow.stats.sweepCoverage,yawCoverage=this.flow.stats.yawCoverage;this.flow.stats={...m.flow.stats,sweepCoverage:coverage,yawCoverage,workerMs:m.workerMs,worker:true,mainThreadMs:this.mainThreadMs};this.flow.stats.buildMs=m.workerMs;
   this.flow.onStatus(m.key!==inputKey(current)?'正在更新流线…':m.flow.stats.sourceMode==='anchor'?'粗网格 CFD · 已计算工况':m.flow.stats.yawMirror?'粗网格 CFD · 该侧风角计算中，暂用对称近似':m.flow.stats.yawActive?'粗网格 CFD · 侧风组合实时预览':m.flow.stats.axisSweep?'粗网格 CFD · 多参数组合近似':'粗网格 CFD · 当前档位尚在计算，暂用近似预览');
  };
  this.worker.onerror=e=>{e?.preventDefault?.();if(serial!==this.serial||this.loadSerial!==this.flow.serial)return;this.recover(serial);};
  this.worker.postMessage({type:'init',car:state.model,meshes:description,spec:this.flow.spec,baseline:this.flow.data.base,bottom:this.bottomSent?{data:this.bottom.data,meta:this.bottom.meta}:{data:null,meta:null},side:this.sideSent?{data:this.side.data,meta:this.side.meta}:{data:null,meta:null}});
 }
 update(state,rig,dt,now){this.current={...state};this.flow.elapsed+=dt;this.flow.material.uniforms.clock.value=this.flow.elapsed;
  if(!this.flow.stats.ready||!rig)return;
  const sweep=this.flow.sweep,yaw=this.flow.yaw;if(state.flow&&now-sweep.lastRefresh>30000&&!sweep.manifest?.complete)sweep.refresh();
  if(state.flow&&yaw&&now-yaw.lastRefresh>30000&&!yaw.manifest?.complete)yaw.refresh();
  this.flow.stats.sweepCoverage=sweep.manifest?{completed:sweep.manifest.completedUnique,planned:sweep.manifest.plannedUnique,complete:sweep.manifest.complete,queueState:sweep.queue?.state}:null;
  this.flow.stats.yawCoverage=yaw?.manifest?{completed:yaw.manifest.completedUnique,planned:yaw.manifest.plannedUnique,complete:yaw.manifest.complete,queueState:yaw.queue?.state}:null;
  if(this.model!==rig||this.loadSerial!==this.flow.serial){this.initialize(state,rig);}
  if(this.ready){
   if(!this.bottomSent&&this.bottom.status==='ready'&&this.bottom.data){this.worker.postMessage({type:'layer',kind:'bottom',data:this.bottom.data,meta:this.bottom.meta});this.bottomSent=true;this.appliedKey='';}
   if(!this.sideSent&&this.side.status==='ready'&&this.side.data){this.worker.postMessage({type:'layer',kind:'side',data:this.side.data,meta:this.side.meta});this.sideSent=true;this.appliedKey='';}
  }
  const active=state.flow&&state.flowDensity>0&&(state.speed>0||state.wheelSpeedMps>0);
  if(!active){for(const x of [this.flow,this.bottom,this.side])x.group.visible=false;this.appliedKey='';if(state.flow&&state.speed===0&&state.wheelSpeedMps===0){this.flow.stats.lines=0;this.flow.onStatus('静止 · 来流与车轮均为 0');}return;}
  if(!this.ready||this.busy||this.failed||now-this.lastSent<16)return;
  const key=inputKey(state),fieldRevision=`${this.flow.revision||0}:${sweep.manifest?.completedUnique||0}:${sweep.revision||0}:${yaw?.manifest?.completedUnique||0}:${yaw?.revision||0}:${this.bottomSent?1:0}:${this.sideSent?1:0}`;
  if(key===this.appliedKey&&this.fieldRevision===fieldRevision)return;
  const start=performance.now(),U=state.speed/3.6,W=state.wheelSpeedMps,windAngle=state.effWindAngle??state.windAngle??0,useYaw=Math.abs(windAngle)>=1e-6;
  const cosB=useYaw?Math.abs(Math.cos(windAngle*Math.PI/180)):1,effSteer=state.steer*cosB,effDrs=state.drsCurrent*cosB;
  const selected=sweep.selection(U,W,effSteer,effDrs),yawSel=useYaw&&yaw?yaw.selection(windAngle):null;
  // Solved fields can arrive after the slider has moved again. Trace the rolling
  // approximation during loading rather than freezing until the drag finishes.
  let weights=selected?.weights||rollingWeights(U,W,effSteer,effDrs);const source=selected?.data||this.flow.data,fields={};
  if(!selected){const missing=Object.keys(weights).filter(k=>Math.abs(weights[k])>1e-7&&!source[k]);if(missing.length){missing.forEach(k=>this.flow.ensureAnchor?.(k));weights=source.base?{base:U/50}:{};}}
  for(const name of Object.keys(weights))if(Math.abs(weights[name])>1e-7&&!this.known.has(name)&&source[name])fields[name]=source[name];
  let yawSelection=null;
  if(yawSel&&!yawSel.loading){
   const yWeights={};
   for(const [name,weight] of Object.entries(yawSel.weights)){
    if(Math.abs(weight)<=1e-7)continue;
    const workerKey=`yaw:${name}`;yWeights[workerKey]=weight;
    if(!this.known.has(workerKey))fields[workerKey]=yawSel.data[name];
   }
   yawSelection={weights:yWeights,spec:yawSel.spec,exact:yawSel.exact,mirror:yawSel.mirror};
  }
  this.busy=true;this.lastSent=now;this.fieldRevision=fieldRevision;
  this.worker.postMessage({type:'compute',id:++this.jobId,key,state:{...state},rig:snapshotRig(rig,this.meshes,this.versions),selection:{weights,axisSweep:Boolean(selected&&!selected.loading)},yawSelection,fields});this.mainThreadMs=performance.now()-start;
 }
}
