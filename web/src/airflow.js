import * as T from 'three';
import { SweepFields } from './sweep-field.js';
import { YawFields } from './yaw-field.js';
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
const _invParent=new T.Matrix4(),_invQuat=new T.Quaternion(),_relMat=new T.Matrix4(),_box=new T.Box3(),_center=new T.Vector3(),_axis=new T.Vector3(),_rayHits=[];
export class TraceScratch {
 constructor(cap=131072){this.cap=cap;this.pos=new Float32Array(cap*3);this.col=new Float32Array(cap*3);this.flt=new Float32Array(cap);this.alp=new Float32Array(cap);this.len=0;}
 reset(){this.len=0;}
 ensure(verts){if(verts<=this.cap)return;let next=this.cap*2;while(next<verts)next*=2;const grow=(src,s)=>{const d=new Float32Array(next*s);d.set(src);return d;};this.pos=grow(this.pos,3);this.col=grow(this.col,3);this.flt=grow(this.flt,1);this.alp=grow(this.alp,1);this.cap=next;}
 pushSeg(ax,ay,az,bx,by,bz,r,g,b,t0,t1){const v=this.len,v2=v+2;if(v2>this.cap)this.ensure(v2);this.len=v2;const p=v*3;this.pos[p]=ax;this.pos[p+1]=ay;this.pos[p+2]=az;this.pos[p+3]=bx;this.pos[p+4]=by;this.pos[p+5]=bz;this.col[p]=r;this.col[p+1]=g;this.col[p+2]=b;this.col[p+3]=r;this.col[p+4]=g;this.col[p+5]=b;this.flt[v]=t0;this.flt[v+1]=t1;}
 commit(geometry){const n=this.len;geometry.dispose();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.pos.slice(0,n*3),3));g.setAttribute('color',new T.Float32BufferAttribute(this.col.slice(0,n*3),3));g.setAttribute('flight',new T.Float32BufferAttribute(this.flt.slice(0,n),1));g.setAttribute('lineAlpha',new T.Float32BufferAttribute(this.alp.slice(0,n),1));return g;}
}
export class Airflow {
 constructor(parent,{onStatus=()=>{}}={}){this.sweep=new SweepFields(()=>{this.lastKey='';});this.yaw=new YawFields(()=>{this.lastKey='';});this.parent=parent;this.onStatus=onStatus;this.serial=0;this.revision=0;this.car=null;this.anchorMeta=null;this.anchorPending=new Map();this._secondaryFn=null;this.data=null;this.enabled=true;this.elapsed=0;this.lastKey='';this.grid=null;this.baseGrid=null;this.baseSpec=null;this.yawGrid=null;this.group=new T.Group();this.group.name='CFD_FLOW';parent.add(this.group);this.ray=new T.Raycaster();this.ray.firstHitOnly=true;this.colliders=new WeakMap();this.colliderMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});this.lastBuild=0;this._rayContext=null;this._scratch=new TraceScratch(131072);this.stats={ready:false,lines:0,peakMps:0,blocked:0};
  this.material=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,uniforms:{clock:{value:0},opacity:{value:1}},vertexShader:`attribute vec3 color;attribute float flight;attribute float lineAlpha;varying vec3 tint;varying float travel;varying float fade;void main(){tint=color;travel=flight;fade=lineAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float clock,opacity;varying vec3 tint;varying float travel;varying float fade;void main(){float p=fract((clock-travel)*4.);float pulse=exp(-pow((p-.22)*8.,2.));gl_FragColor=vec4(tint,opacity*fade*(.55+.45*pulse));}`});
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
 async load(car,{deferSecondary=true,autoSecondary=true}={}){const serial=++this.serial;this.car=car;this.yaw.setCar(car);this.data=null;this.anchorMeta=null;this.anchorPending.clear();this._secondaryFn=null;this.stats.ready=false;this.group.visible=false;this.onStatus('正在加载气流数据…');
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
 sampleRaw(x,y,z,out,grid=this.grid,requireValid=false,spec=this.spec){const {shape,min,max}=spec;const gx=(x-min[0])/(max[0]-min[0])*(shape[0]-1),gy=(y-min[1])/(max[1]-min[1])*(shape[1]-1),gz=(z-min[2])/(max[2]-min[2])*(shape[2]-1);
  if(gx<0||gy<0||gz<0||gx>=shape[0]-1||gy>=shape[1]-1||gz>=shape[2]-1){out.set(0,0,0);return false;}
  const ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz),fx=gx-ix,fy=gy-iy,fz=gz-iz,omx=1-fx,omy=1-fy,omz=1-fz;
  const sx=shape[0],sxy=sx*shape[1],i000=(iz*sxy+iy*sx+ix)*3,i100=i000+3,i010=i000+sx*3,i110=i010+3,sxy3=sxy*3,i001=i000+sxy3,i101=i100+sxy3,i011=i010+sxy3,i111=i110+sxy3;
  const w000=omx*omy*omz,w100=fx*omy*omz,w010=omx*fy*omz,w110=fx*fy*omz,w001=omx*omy*fz,w101=fx*omy*fz,w011=omx*fy*fz,w111=fx*fy*fz;
  if(requireValid){if((w000>1e-8&&grid[i000]===0&&grid[i000+1]===0&&grid[i000+2]===0)||(w100>1e-8&&grid[i100]===0&&grid[i100+1]===0&&grid[i100+2]===0)||(w010>1e-8&&grid[i010]===0&&grid[i010+1]===0&&grid[i010+2]===0)||(w110>1e-8&&grid[i110]===0&&grid[i110+1]===0&&grid[i110+2]===0)||(w001>1e-8&&grid[i001]===0&&grid[i001+1]===0&&grid[i001+2]===0)||(w101>1e-8&&grid[i101]===0&&grid[i101+1]===0&&grid[i101+2]===0)||(w011>1e-8&&grid[i011]===0&&grid[i011+1]===0&&grid[i011+2]===0)||(w111>1e-8&&grid[i111]===0&&grid[i111+1]===0&&grid[i111+2]===0)){out.set(0,0,0);return false;}}
  const a=grid[i000]*w000+grid[i100]*w100+grid[i010]*w010+grid[i110]*w110+grid[i001]*w001+grid[i101]*w101+grid[i011]*w011+grid[i111]*w111;
  const b=grid[i000+1]*w000+grid[i100+1]*w100+grid[i010+1]*w010+grid[i110+1]*w110+grid[i001+1]*w001+grid[i101+1]*w101+grid[i011+1]*w011+grid[i111+1]*w111;
  const c=grid[i000+2]*w000+grid[i100+2]*w100+grid[i010+2]*w010+grid[i110+2]*w110+grid[i001+2]*w001+grid[i101+2]*w101+grid[i011+2]*w011+grid[i111+2]*w111;
  out.set(a,b,c);return Number.isFinite(a+b+c);
 }
 sample(x,y,z,out,grid=this.grid,requireValid=false,spec=this.spec){if(!this.sampleRaw(x,y,z,out,grid,requireValid,spec))return false;
  // Convert solver X downstream, Y right, Z up to the display frame.
  out.set(-out.y,out.z,-out.x);return true;
 }
 update(state,rig,dt,now){this.elapsed+=dt;this.material.uniforms.clock.value=this.elapsed;this.group.visible=this.enabled&&this.stats.ready;
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
  this.rebuild(rig,U,W,state.flowDensity,windAngle);this.stats.buildMs=performance.now()-started;this.stats.inputKey=key;const pArr=this.geometry.attributes.position?.array;let sig=0;if(pArr)for(let i=0;i<pArr.length;i+=97)sig+=Math.round(pArr[i]*10000);this.stats.signature=sig;
 }
 buildRayContext(model){model.updateMatrixWorld(true);this.parent?.updateMatrixWorld(true);const hasParent=Boolean(this.parent);if(hasParent)_invParent.copy(this.parent.matrixWorld).invert();const size=.2,nx=24,ny=14,nz=34,ox=-2.4,oy=-.4,oz=-3.4,invSize=5,bins=Array.from({length:nx*ny*nz},()=>[]),all=[];
  model.traverse(o=>{if(!o.isMesh||!o.visible)return;let collider=this.colliders.get(o);if(!collider){collider=new T.Mesh(o.geometry,this.colliderMaterial);collider.matrixAutoUpdate=false;collider._tightBox=new T.Box3();this.colliders.set(o,collider);}if(hasParent)collider.matrixWorld.multiplyMatrices(_invParent,o.matrixWorld);else collider.matrixWorld.copy(o.matrixWorld);all.push(collider);if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();collider._tightBox.copy(o.geometry.boundingBox).applyMatrix4(collider.matrixWorld);_box.copy(collider._tightBox).expandByScalar(.09);
   const x0=Math.max(0,Math.floor((_box.min.x-ox)*invSize)),x1=Math.min(nx-1,Math.floor((_box.max.x-ox)*invSize));
   const y0=Math.max(0,Math.floor((_box.min.y-oy)*invSize)),y1=Math.min(ny-1,Math.floor((_box.max.y-oy)*invSize));
   const z0=Math.max(0,Math.floor((_box.min.z-oz)*invSize)),z1=Math.min(nz-1,Math.floor((_box.max.z-oz)*invSize));
   for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)bins[(z*ny+y)*nx+x].push(collider);
  });
  const nearby=p=>{const x=Math.floor((p.x-ox)*invSize),y=Math.floor((p.y-oy)*invSize),z=Math.floor((p.z-oz)*invSize);return (x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz)?bins[(z*ny+y)*nx+x]:[];};
  return {model,nearby,all};
 }
 hasRayHit(origin,dir,far,candidates,near=0){
  const len=candidates.length;if(!len)return false;
  const ox=origin.x,oy=origin.y,oz=origin.z,s0=near,s1=far,ax=ox+dir.x*s0,ay=oy+dir.y*s0,az=oz+dir.z*s0,bx=ox+dir.x*s1,by=oy+dir.y*s1,bz=oz+dir.z*s1;
  const minX=(ax<bx?ax:bx)-1e-4,maxX=(ax>bx?ax:bx)+1e-4,minY=(ay<by?ay:by)-1e-4,maxY=(ay>by?ay:by)+1e-4,minZ=(az<bz?az:bz)-1e-4,maxZ=(az>bz?az:bz)+1e-4;
  const ray=this.ray,hits=_rayHits;ray.set(origin,dir);ray.near=near;ray.far=far;
  for(let i=0;i<len;i++){const c=candidates[i],b=c._tightBox;if(maxX<b.min.x||minX>b.max.x||maxY<b.min.y||minY>b.max.y||maxZ<b.min.z||minZ>b.max.z)continue;hits.length=0;c.raycast(ray,hits);if(hits.length){ray.near=0;return true;}}
  ray.near=0;return false;
 }
 firstRayHit(origin,dir,near,far,candidates){
  const len=candidates.length;if(!len)return null;
  const ox=origin.x,oy=origin.y,oz=origin.z,ax=ox+dir.x*near,ay=oy+dir.y*near,az=oz+dir.z*near;
  let bx=ox+dir.x*far,by=oy+dir.y*far,bz=oz+dir.z*far;
  let minX=(ax<bx?ax:bx)-1e-4,maxX=(ax>bx?ax:bx)+1e-4,minY=(ay<by?ay:by)-1e-4,maxY=(ay>by?ay:by)+1e-4,minZ=(az<bz?az:bz)-1e-4,maxZ=(az>bz?az:bz)+1e-4;
  const ray=this.ray,hits=_rayHits;ray.set(origin,dir);ray.near=near;ray.far=far;let best=null;
  for(let i=0;i<len;i++){const c=candidates[i],b=c._tightBox;if(maxX<b.min.x||minX>b.max.x||maxY<b.min.y||minY>b.max.y||maxZ<b.min.z||minZ>b.max.z)continue;hits.length=0;c.raycast(ray,hits);
   if(hits.length){let h=hits[0];for(let k=1;k<hits.length;k++)if(hits[k].distance<h.distance)h=hits[k];if(!best||h.distance<best.distance){best=h;ray.far=h.distance;bx=ox+dir.x*h.distance;by=oy+dir.y*h.distance;bz=oz+dir.z*h.distance;minX=(ax<bx?ax:bx)-1e-4;maxX=(ax>bx?ax:bx)+1e-4;minY=(ay<by?ay:by)-1e-4;maxY=(ay>by?ay:by)+1e-4;minZ=(az<bz?az:bz)-1e-4;maxZ=(az>bz?az:bz)+1e-4;}}
  }
  ray.near=0;return best;
 }
 getRayContext(model){if(this._rayContext&&this._rayContext.model===model)return this._rayContext;this._rayContext=this.buildRayContext(model);return this._rayContext;}
 rayBins(model){return this.buildRayContext(model).nearby;}
 rebuild(rig,U,W,density,windAngle=0){const scratch=this._scratch;scratch.reset();const velocity=new T.Vector3(),last=new T.Vector3(),point=new T.Vector3(),mid=new T.Vector3(),color=new T.Color();let count=0,peak=0,blocked=0;
  const {nearby}=this.getRayContext(rig.model);
  const hasParent=Boolean(this.parent);
  if(hasParent){_invParent.copy(this.parent.matrixWorld).invert();_invQuat.setFromRotationMatrix(_invParent);}
  const wheels=Object.entries(rig.wheels).map(([key,w])=>{const center=w.spinNode.getWorldPosition(new T.Vector3()),quat=w.spinNode.getWorldQuaternion(new T.Quaternion());if(hasParent){center.applyMatrix4(_invParent);quat.premultiply(_invQuat);}return {center,axis:new T.Vector3(1,0,0).applyQuaternion(quat),radius:w.radius,width:rig.config.id==='rb19'?(key.startsWith('R')?.47:.43):.45};});
  const insideWheel=p=>wheels.some(w=>{mid.copy(p).sub(w.center);const along=mid.dot(w.axis);return Math.abs(along)<w.width/2+.012&&mid.lengthSq()-along*along<(w.radius+.009)**2;});
  const seeds=[];
  const absAngle = Math.abs(windAngle);
  const beta = T.MathUtils.degToRad(windAngle), cb = Math.cos(beta), sb = Math.sin(beta);
  if(absAngle<1e-6){
   if(U>.02&&density>0){const nx=Math.max(1,Math.round(21*Math.sqrt(density/100))),ny=Math.max(1,Math.round(7*Math.sqrt(density/100)));for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)seeds.push(new T.Vector3(-1.5+3*(i+.5)/nx,.08+.96*(j+.5)/ny,3.85));}
  }else if(U>.02&&density>0){
   // Downstream wind in display frame: (sin(beta), 0, -cos(beta)); upstream is opposite.
   const ux=-sb,uz=cb,tx=cb,tz=sb;
   const upDist=3.8*Math.abs(cb)+3.4*Math.abs(sb),halfW=1.45*Math.abs(cb)+2.85*Math.abs(sb);
   const nx=Math.max(1,Math.round((21+8*Math.abs(sb))*Math.sqrt(density/100))),ny=Math.max(1,Math.round(7*Math.sqrt(density/100)));
   for(let j=0;j<ny;j++){const y=.08+1.04*(j+.5)/ny;
    for(let i=0;i<nx;i++){const s=-halfW+2*halfW*(i+.5)/nx;seeds.push(new T.Vector3(ux*upDist+tx*s,y,uz*upDist+tz*s));}
   }
   // Local near-body upper rake so crosswind separation over sidepods & wings stays visible.
   const upNear=1.55*Math.abs(cb)+1.15*Math.abs(sb),hwNear=1.1*Math.abs(cb)+2.4*Math.abs(sb);
   const nearWeight=T.MathUtils.smoothstep(absAngle,0,35);
   const nx2=Math.round(14*nearWeight*Math.sqrt(density/100)),ny2=Math.max(1,Math.round(5*Math.sqrt(density/100)));
   for(let j=0;j<ny2;j++){const y=.52+.72*(j+.5)/ny2;
    for(let i=0;i<nx2;i++){const s=-hwNear+2*hwNear*(i+.5)/nx2;seeds.push(new T.Vector3(ux*upNear+tx*s,y,uz*upNear+tz*s));}
   }
  }
  // Keep the local rake upstream of the rear wing through shallow yaw.
  // At larger angles the side rake reaches the tail directly, so taper the
  // extra seeds to avoid piling up traces in the same region.
  if (U > .02 && density > 0 && absAngle < 65) {
   const densityScale = Math.sqrt(density / 100);
   const rearWeight = 1 - T.MathUtils.smoothstep(absAngle, 15, 65);
   const columns = Math.round(Math.max(1, 15 * densityScale) * rearWeight);
   const rows = Math.max(1, Math.round(6 * densityScale));
   const halfWidth = T.MathUtils.lerp(.95, .55, Math.abs(sb));
   const seedX = -.66 * sb, seedZ = -1.72 + .66 * (cb - 1);
   for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const offset = -halfWidth + 2 * halfWidth * (i + .5) / columns;
    seeds.push(new T.Vector3(seedX + cb * offset, .64 + .68 * (j + .5) / rows, seedZ + sb * offset));
   }
  }
  // Additional wheel neighbourhood seeds expose the rotation-driven component,
  // including stationary-car wheel rotation. They are not invented trajectories.
  const wheelSeeds=Math.round(10*density/100);for(const w of wheels)for(let i=0;i<wheelSeeds;i++){const a=i*Math.PI*2/wheelSeeds;seeds.push(w.center.clone().add(new T.Vector3(.26*Math.sign(w.center.x),Math.sin(a)*(w.radius+.1),Math.cos(a)*(w.radius+.1))));}
  const maxSteps=absAngle<1e-6?190:220,inv120=1/120,ds=.065,invFade=ds/.22;
  for(const seed of seeds){const start=scratch.len;point.copy(seed);let travel=0,segments=0;
   for(let step=0;step<maxSteps;step++){
    if(!this.sample(-point.z,-point.x,point.y-.005,velocity))break;const speed=velocity.length();if(speed<Math.max(.07,Math.max(U,W)*.005))break;
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
