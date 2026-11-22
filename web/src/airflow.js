import * as T from 'three';
import { FlowSampler, TraceScratch, makeFlowMaterial, wholeCarSeeds } from './flow-tracing.js';
export { TraceScratch } from './flow-tracing.js';
import { SweepFields } from './sweep-field.js';
import { YawFields } from './yaw-field.js';
import { FixedRoadHeadwindFields, ROAD010_MPS } from './stationary-fields.js';
import { cachedArrayBuffer, deleteCachedAsset } from './asset-cache.js';
const FLOW_LOAD_ATTEMPTS=5;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

export const FLOW_ANCHORS=['base','low','high','open','left','right','locked','fast','spin'];
export const ROLLING_ANCHORS=['road-stop','road-slow','road-fast','still-air'];
export const ROLLING_FLOW_ANCHORS=['base','low','high','open','left','right',...ROLLING_ANCHORS];
// Air and road speeds are independent. Every rolling anchor has omega=G/r.
// Signed differences preserve solved nodes; other combinations are a surrogate.
export function rollingWeights(speed,groundSpeed,steer=0,drs=0){
 const u=Math.max(0,speed),g=Math.max(0,groundSpeed),w=Object.fromEntries(ROLLING_FLOW_ANCHORS.map(k=>[k,0]));
 if(u===0&&g===0)return w;
 const add=(k,v)=>w[k]+=v;
 const diagonal=(v,factor=1)=>{const low=50/3.6,high=350/3.6;
  if(v<=low)add('low',factor*v/low);
  else if(v<=50){const t=(v-low)/(50-low);add('low',factor*(1-t)*v/low);add('base',factor*t*v/50);}
  else{const t=T.MathUtils.clamp((v-50)/(high-50),0,1);add('base',factor*(1-t)*v/50);add('high',factor*t*v/high);}
 };
 if(g>2*u){const t=2*u/g;diagonal(g/2,t);add('base',-t*g/100);add('road-fast',t*g/100);add('still-air',(1-t)*g/50);}
 else{diagonal(u);const r=g/u,nodes=[[0,'road-stop'],[.5,'road-slow'],[1,'base'],[2,'road-fast']];
  for(let i=1;i<nodes.length;i++)if(r<=nodes[i][0]){const [a,ka]=nodes[i-1],[b,kb]=nodes[i],t=(r-a)/(b-a);add('base',-u/50);add(ka,(1-t)*u/50);add(kb,t*u/50);break;}
 }
 add('open',drs*u/50);add('base',-drs*u/50);
 const turn=Math.abs(steer)/18*u/50;add(steer<0?'left':'right',turn);add('base',-turn);
 return w;
}
export function anchorWeights(speed,wheelSpeed,steer,drs){
 const u=Math.max(0,speed),w=Math.max(0,wheelSpeed),weights=Object.fromEntries(FLOW_ANCHORS.map(k=>[k,0]));
 if(u<1e-8&&w<1e-8)return weights;
 const wheelOnly=1-T.MathUtils.smoothstep(u,0,8),air=1-wheelOnly;
 weights.spin=wheelOnly*w/50;
 const add=(key,value)=>weights[key]+=value;
 const low=50/3.6,high=350/3.6;
 if(u<=low)add('low',u/low);
 else if(u<=50){const t=(u-low)/(50-low);add('low',(1-t)*u/low);add('base',t*u/50);}
 else{const t=T.MathUtils.clamp((u-50)/(high-50),0,1);add('base',(1-t)*u/50);add('high',t*u/high);}
 add('open',drs*u/50);add('base',-drs*u/50);
 const steering=Math.abs(steer)/18*u/50;add(steer<0?'left':'right',steering);add('base',-steering);
 if(w<u){const t=air*(u-w)/50;add('locked',t);add('base',-t);}else{const t=air*(w-u)/50;add('fast',t);add('base',-t);}
 return weights;
}
export class Airflow extends FlowSampler {
 constructor(parent,{onStatus=()=>{}}={}){super(parent);this.sweep=new SweepFields(()=>{this.lastKey='';});this.stationary=new FixedRoadHeadwindFields('stationary',0);this.road010=new FixedRoadHeadwindFields('road010',ROAD010_MPS);this.yaw=new YawFields(()=>{this.lastKey='';});this.parent=parent;this.onStatus=onStatus;this.serial=0;this.revision=0;this.car=null;this.anchorMeta=null;this.anchorPending=new Map();this._secondaryFn=null;this.data=null;this.enabled=true;this.elapsed=0;this.lastKey='';this.grid=null;this.baseGrid=null;this.baseSpec=null;this.yawGrid=null;this.group=new T.Group();this.group.name='CFD_FLOW';parent.add(this.group);this.lastBuild=0;this._rayContext=null;this._scratch=new TraceScratch(131072);this.stats={ready:false,lines:0,peakMps:0,blocked:0};
  this.material=makeFlowMaterial();
  this.geometry=new T.BufferGeometry();this.lines=new T.LineSegments(this.geometry,this.material);this.lines.frustumCulled=false;this.group.add(this.lines);
 }
 async fetchAnchor(key,a){
  const expected=a.grid.shape.reduce((p,n)=>p*n,1)*6;
  let buffer=null;
  for(let attempt=0;attempt<3;attempt++){
   try{buffer=await cachedArrayBuffer(a.file);}catch(e){buffer=null;if(attempt===2)throw e;await wait(600*(attempt+1));continue;}
   if(buffer.byteLength===expected)break;
   // A truncated or stale cached copy must not poison later visits.
   await deleteCachedAsset(a.file);buffer=null;
   if(attempt<2)await wait(400*(attempt+1));
  }
  if(!buffer)throw Error('流场文件缺失或尺寸不符，请重试');
  const raw=new Int16Array(buffer);const field=new Float32Array(raw.length);
  for(let i=0;i<raw.length;i++)field[i]=raw[i]*a.scale;
  return field;
 }
 ensureAnchor(key,car=this.car,serial=this.serial){
  if(this.data?.[key])return Promise.resolve(this.data[key]);
  const a=this.anchorMeta?.[key];if(!a)return Promise.resolve(null);
  const existing=this.anchorPending.get(key);if(existing)return existing;
  const p=(async()=>{try{const field=await this.fetchAnchor(key,a);if(serial===this.serial&&this.data){this.data[key]=field;this.revision++;this.lastKey='';}return field;}catch{return null;}finally{if(serial===this.serial)this.anchorPending.delete(key);}})();
  this.anchorPending.set(key,p);return p;
 }
 startSecondary(){if(!this._secondaryFn)return Promise.resolve();const fn=this._secondaryFn;this._secondaryFn=null;return fn();}
 async load(car,{deferSecondary=true,autoSecondary=true}={}){const serial=++this.serial;this.car=car;this.yaw.setCar(car);this.stationary.setCar(car);this.road010.setCar(car);this.data=null;this.anchorMeta=null;this.anchorPending.clear();this._secondaryFn=null;this.stats.ready=false;this.group.visible=false;this.onStatus('正在加载气流数据…');
  let lastError=null;
  for(let attempt=1;attempt<=FLOW_LOAD_ATTEMPTS;attempt++){
  if(serial!==this.serial)return;
  if(attempt>1){this.onStatus(`正在重新连接气流数据（${attempt}/${FLOW_LOAD_ATTEMPTS}）…`);await wait(Math.min(6000,800*2**(attempt-2)));if(serial!==this.serial)return;}
  try{const cacheMode=import.meta.env.DEV?'no-store':(attempt>1?'no-cache':'default');
   const responses=await Promise.all([fetch(`/flow/${car}/manifest.json`,{cache:cacheMode}),fetch(`/flow/${car}/rolling/manifest.json`,{cache:cacheMode})]);
   if(responses.some(r=>!r.ok))throw Error('工况清单不可用');
   const [manifest,rolling]=await Promise.all(responses.map(r=>r.json()));manifest.anchors=[...manifest.anchors,...rolling.anchors];
   const map={};for(const key of ROLLING_FLOW_ANCHORS){const a=manifest.anchors.find(v=>v.anchor===key);if(!a)throw Error(`${car.toUpperCase()} 的 ${key} 工况尚未准备好`);map[key]=a;}
   const baseField=await this.fetchAnchor('base',map.base);
   if(serial!==this.serial)return;
   this.anchorMeta=map;this.data={base:baseField};this.meta=manifest;this.baseSpec=map.base.grid;this.spec=this.baseSpec;this.baseGrid=new Float32Array(baseField.length);this.grid=this.baseGrid;this.yawGrid=null;this.lastKey='';this.revision++;this.stats.ready=true;this.stats.error=null;
   this.onStatus('粗网格 CFD · 实时插值预览');
   const bg=async()=>{
    await Promise.all([this.sweep.load(car,baseField),this.yaw.refresh()]);
    const rest=ROLLING_FLOW_ANCHORS.filter(k=>k!=='base');
    for(let i=0;i<rest.length;i+=3){
     if(serial!==this.serial)return;
     await Promise.all(rest.slice(i,i+3).map(k=>this.ensureAnchor(k,car,serial)));
    }
   };
   if(!deferSecondary)await bg();
   else if(autoSecondary)void bg();
   else this._secondaryFn=bg;
   return;
  }catch(e){if(serial!==this.serial)return;lastError=e;}
  }
  if(serial!==this.serial)return;{const e=lastError||Error('');this.stats.error=e.message;this.onStatus('气流暂不可用 · '+(/[\u4e00-\u9fff]/.test(e.message)?e.message:'数据加载失败，请检查网络后重试'));}
 }
 setEnabled(enabled){this.enabled=enabled;this.group.visible=enabled&&this.stats.ready;}
 update(state,rig,dt,now,{stationary=false}={}){this.elapsed+=dt;this.material.uniforms.clock.value=this.elapsed;this.group.visible=this.enabled&&this.stats.ready;
  if(!this.stats.ready||!this.enabled||!rig)return;
  if(!this.baseSpec)this.baseSpec=this.spec;if(!this.baseGrid)this.baseGrid=this.grid;
  const U=state.speed/3.6,W=state.wheelSpeedMps,windAngle=state.effWindAngle??state.windAngle??0,key=[U.toFixed(3),W.toFixed(3),state.steer.toFixed(2),state.drsCurrent.toFixed(3),state.flowDensity,windAngle.toFixed(1)].join(':');
  if(now-this.sweep.lastRefresh>10000&&!this.sweep.manifest?.complete)this.sweep.refresh();
  if(now-this.yaw.lastRefresh>10000&&!this.yaw.manifest?.complete)this.yaw.refresh();
  this.stats.sweepCoverage=this.sweep.manifest?{completed:this.sweep.manifest.completedUnique,planned:this.sweep.manifest.plannedUnique,complete:this.sweep.manifest.complete,queueState:this.sweep.queue?.state}:null;
  this.stats.yawCoverage=this.yaw.manifest?{completed:this.yaw.manifest.completedUnique,planned:this.yaw.manifest.plannedUnique,complete:this.yaw.manifest.complete,queueState:this.yaw.queue?.state}:null;
  if(key===this.lastKey||now-this.lastBuild<65)return;this.lastBuild=now;this.lastBuildAngle=windAngle;this.lastKey=key;
  const useYaw=Math.abs(windAngle)>=1e-6;
  const cosB=useYaw?Math.abs(Math.cos(windAngle*Math.PI/180)):1;
  const effSteer=state.steer*cosB,effDrs=state.drsCurrent*cosB;
  const sweep=this.sweep.selection(U,W,effSteer,effDrs);if(sweep?.loading){this.lastKey='';this.onStatus('正在加载此档位的 CFD 数据…');return;}
  const yawSel=useYaw?this.yaw.selection(windAngle):null;if(yawSel?.loading||yawSel?.error){this.lastKey='';this.onStatus(yawSel.error?'侧风气流暂不可用 · 请重试':'正在加载侧风 CFD 数据…');return;}
  let weights=sweep?.weights||rollingWeights(U,W,effSteer,effDrs);const fields=sweep?.data||this.data;
  if(!sweep){const missing=Object.keys(weights).filter(k=>Math.abs(weights[k])>1e-7&&!fields[k]);if(missing.length){missing.forEach(k=>this.ensureAnchor(k));weights=fields.base?{base:U/50}:{};}}
  const active=Object.entries(weights).filter(([,v])=>Math.abs(v)>1e-7);const started=performance.now();
  const hasHeadDelta=useYaw&&(Math.abs(U-50)>.01||Math.abs(W-50)>.01||Math.abs(effSteer)>.01||Math.abs(effDrs)>.001);
   if(yawSel){
   const ySpec=yawSel.spec,yLen=ySpec.shape[0]*ySpec.shape[1]*ySpec.shape[2]*3;
   if(!this.yawGrid||this.yawGrid.length!==yLen)this.yawGrid=new Float32Array(yLen);
   this.spec=ySpec;this.grid=this.yawGrid;
   const uScale=U/50,yActive=Object.entries(yawSel.weights).filter(([,v])=>Math.abs(v)>1e-7);
   if(!yActive.length){this.yawGrid.fill(0);}
   else{
    const [yn0,yw0]=yActive[0],yd0=yawSel.data[yn0],ys0=yw0*uScale;
    for(let i=0;i<yLen;i++)this.yawGrid[i]=yd0[i]*ys0;
    for(let a=1;a<yActive.length;a++){const data=yawSel.data[yActive[a][0]],w=yActive[a][1]*uScale;for(let i=0;i<yLen;i++)this.yawGrid[i]+=data[i]*w;}
   }
   // Add longitudinal ground/air/DRS/steer deltas inside the headwind lattice when deviating from 180 km/h neutral.
   if(hasHeadDelta){
    const bLen=this.baseGrid.length;
    if(!active.length){this.baseGrid.fill(0);}
    else{
     const [an0,aw0]=active[0],ad0=fields[an0];
     for(let i=0;i<bLen;i++)this.baseGrid[i]=ad0[i]*aw0;
     for(let a=1;a<active.length;a++){const data=fields[active[a][0]],w=active[a][1];for(let i=0;i<bLen;i++)this.baseGrid[i]+=data[i]*w;}
    }
    const baseData=this.data.base,bSpec=this.baseSpec,bg=this.baseGrid,yg=this.yawGrid;
    for(let i=0;i<bLen;i++)bg[i]-=baseData[i]*uScale;
    const [nx,ny,nz]=ySpec.shape,[x0,y0,z0]=ySpec.min,[x1,y1,z1]=ySpec.max;
    const dx=(x1-x0)/(nx-1),dy=(y1-y0)/(ny-1),dz=(z1-z0)/(nz-1);
    const [bnx,bny,bnz]=bSpec.shape,[bx0,by0,bz0]=bSpec.min,[bx1,by1,bz1]=bSpec.max;
    const bsx=bnx,bsxy=bnx*bny,bsx3=bsx*3,bsxy3=bsxy*3;
    const xMap=[],yMap=[],zMap=[];
    for(let ix=0;ix<nx;ix++){const x=x0+ix*dx,gx=(x-bx0)/(bx1-bx0)*(bnx-1);if(x>=bx0&&x<=bx1&&gx>=0&&gx<bnx-1){const i=Math.floor(gx);xMap.push(ix,i,gx-i);}}
    for(let iy=0;iy<ny;iy++){const y=y0+iy*dy,gy=(y-by0)/(by1-by0)*(bny-1);if(y>=by0&&y<=by1&&gy>=0&&gy<bny-1){const i=Math.floor(gy);yMap.push(iy,i,gy-i);}}
    for(let iz=0;iz<nz;iz++){const z=z0+iz*dz,gz=(z-bz0)/(bz1-bz0)*(bnz-1);if(z>=bz0&&z<=bz1&&gz>=0&&gz<bnz-1){const i=Math.floor(gz);zMap.push(iz,i,gz-i);}}
    for(let kz=0;kz<zMap.length;kz+=3){const iz=zMap[kz],bz=zMap[kz+1],fz=zMap[kz+2],omz=1-fz,zOff=iz*ny,bzOff=bz*bsxy;
     for(let ky=0;ky<yMap.length;ky+=3){const iy=yMap[ky],by=yMap[ky+1],fy=yMap[ky+2],omy=1-fy,row=(zOff+iy)*nx,brow=bzOff+by*bsx;
      const w000=(1-fz)*omy,w010=omz*fy,w001=fz*omy,w011=fz*fy;
      for(let kx=0;kx<xMap.length;kx+=3){const ix=xMap[kx],idx=(row+ix)*3;
       if(yg[idx]===0&&yg[idx+1]===0&&yg[idx+2]===0&&U>.1)continue;
       const fx=xMap[kx+2],omx=1-fx,i000=(brow+xMap[kx+1])*3,i100=i000+3,i010=i000+bsx3,i110=i010+3,i001=i000+bsxy3,i101=i100+bsxy3,i011=i010+bsxy3,i111=i110+bsxy3;
       const c000=omx*w000,c100=fx*w000,c010=omx*w010,c110=fx*w010,c001=omx*w001,c101=fx*w001,c011=omx*w011,c111=fx*w011;
       const a=bg[i000]*c000+bg[i100]*c100+bg[i010]*c010+bg[i110]*c110+bg[i001]*c001+bg[i101]*c101+bg[i011]*c011+bg[i111]*c111;
       const b=bg[i000+1]*c000+bg[i100+1]*c100+bg[i010+1]*c010+bg[i110+1]*c110+bg[i001+1]*c001+bg[i101+1]*c101+bg[i011+1]*c011+bg[i111+1]*c111;
       const c=bg[i000+2]*c000+bg[i100+2]*c100+bg[i010+2]*c010+bg[i110+2]*c110+bg[i001+2]*c001+bg[i101+2]*c101+bg[i011+2]*c011+bg[i111+2]*c111;
       if(Number.isFinite(a+b+c)){yg[idx]+=a;yg[idx+1]+=b;yg[idx+2]+=c;}
      }
     }
    }
   }
   this.stats.axisSweep=Boolean(sweep);this.stats.yawActive=true;this.stats.yawExact=Boolean(yawSel.exact&&!hasHeadDelta);this.stats.yawMirror=Boolean(yawSel.mirror);
   this.stats.activeAnchors={...Object.fromEntries(yActive)};this.stats.sourceMode=this.stats.yawExact?'anchor':'surrogate';
  }else{
   this.spec=this.baseSpec;this.grid=this.baseGrid;const bLen=this.baseGrid.length;
   if(!active.length){this.baseGrid.fill(0);}
   else{
    const [an0,aw0]=active[0],ad0=fields[an0];
    for(let i=0;i<bLen;i++)this.baseGrid[i]=ad0[i]*aw0;
    for(let a=1;a<active.length;a++){const data=fields[active[a][0]],w=active[a][1];for(let i=0;i<bLen;i++)this.baseGrid[i]+=data[i]*w;}
   }
   this.stats.axisSweep=Boolean(sweep);this.stats.yawActive=false;this.stats.yawExact=false;this.stats.yawMirror=false;
   this.stats.activeAnchors=Object.fromEntries(active);this.stats.sourceMode=active.length===1&&Math.abs(active[0][1]-1)<1e-7?'anchor':'surrogate';
  }
  this._rayContext=null;
  if(U<.001&&W<.001){this.geometry.setDrawRange(0,0);this.stats.lines=0;this.stats.vertices=0;this.stats.signature=0;this.stats.blocked=0;this.stats.peakMps=0;this.stats.buildMs=performance.now()-started;this.stats.inputKey=key;this.onStatus('静止 · 来流与车轮均为 0');return;}
  this.onStatus(this.stats.sourceMode==='anchor'?'粗网格 CFD · 已计算工况':yawSel?.mirror?'粗网格 CFD · 该侧风角计算中，暂用对称近似':yawSel?'粗网格 CFD · 侧风组合实时预览':sweep?'粗网格 CFD · 多参数组合近似':'粗网格 CFD · 当前档位尚在计算，暂用近似预览');
  this.rebuild(rig,U,W,state.flowDensity,windAngle,stationary);this.stats.buildMs=performance.now()-started;this.stats.inputKey=key;const pArr=this.geometry.attributes.position?.array;let sig=0;if(pArr)for(let i=0;i<pArr.length;i+=97)sig+=Math.round(pArr[i]*10000);this.stats.signature=sig;
 }
 rebuild(rig,U,W,density,windAngle=0,stationary=false){const scratch=this._scratch;scratch.reset();const velocity=new T.Vector3(),last=new T.Vector3(),point=new T.Vector3(),mid=new T.Vector3(),color=new T.Color();let count=0,peak=0,blocked=0;
  const {nearby}=this.getRayContext(rig.model);
  const {seeds,wheels}=wholeCarSeeds(this.parent,rig,U,density,windAngle);
  const insideWheel=p=>wheels.some(w=>{mid.copy(p).sub(w.center);const along=mid.dot(w.axis);return Math.abs(along)<w.width/2+.012&&mid.lengthSq()-along*along<(w.radius+.009)**2;});
  const absAngle=Math.abs(windAngle);
  const maxSteps=absAngle<1e-6?190:220,inv120=1/120,ds=.065,invFade=ds/.22;
  for(const seed of seeds){const start=scratch.len;point.copy(seed);let travel=0,segments=0;
   for(let step=0;step<maxSteps;step++){
    if(!this.sample(-point.z,-point.x,point.y-.005,velocity,this.grid,stationary))break;const speed=velocity.length();if(speed<Math.max(stationary ? .001 : .07,Math.max(U,W)*.005))break;
    peak=Math.max(peak,speed);last.copy(point);
    point.addScaledVector(velocity,ds/speed);
    if(insideWheel(point)){blocked++;break;}
    // The field's solid mask is part of each solved geometry. A conservative
    // speed threshold terminates paths at walls; exact geometry rays below
    // catch thin wing sheets missed by the coarser sampling lattice.
    if(Math.abs(point.x)<1.2&&point.z<2.95&&point.z>-2.95&&point.y<1.35){
     mid.copy(point).sub(last).normalize();
     if(this.hasRayHit(last,mid,ds+.012,nearby(last))){blocked++;break;}
    }
    const nextTime=travel+ds/speed;
    color.setHSL(.55-.52*T.MathUtils.clamp(speed*inv120,0,1),.85,.65);
    scratch.pushSeg(last.x,last.y,last.z,point.x,point.y,point.z,color.r,color.g,color.b,travel,nextTime);
    travel=nextTime;segments++;
    if(step>30&&point.distanceTo(seed)<.04)break;
   }
   if(segments<4){scratch.len=start;continue;}
   for(let n=0;n<segments;n++){scratch.alp[start+2*n]=Math.min(1,n*invFade,(segments-n)*invFade);scratch.alp[start+2*n+1]=Math.min(1,(n+1)*invFade,(segments-n-1)*invFade);}
   count++;
  }
  this.geometry=scratch.commit(this.geometry);this.lines.geometry=this.geometry;this.stats={...this.stats,ready:true,lines:count,peakMps:peak,blocked,vertices:scratch.len};
 }
}
