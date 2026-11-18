import * as T from 'three';
import { SweepFields } from './sweep-field.js';
import { YawFields } from './yaw-field.js';

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
export class Airflow {
 constructor(parent,{onStatus=()=>{}}={}){this.sweep=new SweepFields(()=>{this.lastKey='';});this.yaw=new YawFields(()=>{this.lastKey='';});this.parent=parent;this.onStatus=onStatus;this.serial=0;this.data=null;this.enabled=true;this.elapsed=0;this.lastKey='';this.grid=null;this.baseGrid=null;this.baseSpec=null;this.yawGrid=null;this.group=new T.Group();this.group.name='CFD_FLOW';parent.add(this.group);this.ray=new T.Raycaster();this.ray.firstHitOnly=true;this.colliders=new WeakMap();this.colliderMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});this.lastBuild=0;this.stats={ready:false,lines:0,peakMps:0,blocked:0};
  this.material=new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,uniforms:{clock:{value:0},opacity:{value:1}},vertexShader:`attribute vec3 color;attribute float flight;attribute float lineAlpha;varying vec3 tint;varying float travel;varying float fade;void main(){tint=color;travel=flight;fade=lineAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float clock,opacity;varying vec3 tint;varying float travel;varying float fade;void main(){float p=fract((clock-travel)*4.);float pulse=exp(-pow((p-.22)*8.,2.));gl_FragColor=vec4(tint,opacity*fade*(.55+.45*pulse));}`});
  this.geometry=new T.BufferGeometry();this.lines=new T.LineSegments(this.geometry,this.material);this.lines.frustumCulled=false;this.group.add(this.lines);
 }
 async load(car){const serial=++this.serial;this.data=null;this.stats.ready=false;this.group.visible=false;this.onStatus('正在加载气流数据…');
  try{const responses=await Promise.all([fetch(`/flow/${car}/manifest.json`),fetch(`/flow/${car}/rolling/manifest.json`)]);if(responses.some(r=>!r.ok))throw Error('工况清单不可用');const [manifest,rolling]=await Promise.all(responses.map(r=>r.json()));manifest.anchors=[...manifest.anchors,...rolling.anchors];const map={};for(const key of ROLLING_FLOW_ANCHORS){const a=manifest.anchors.find(v=>v.anchor===key);if(!a)throw Error(`${car.toUpperCase()} 的 ${key} 工况尚未准备好`);map[key]=a;}
   const results=await Promise.all(ROLLING_FLOW_ANCHORS.map(async key=>{const a=map[key],r=await fetch(a.file);if(!r.ok)throw Error('流场文件加载失败');const buffer=await r.arrayBuffer();if(buffer.byteLength!==a.grid.shape.reduce((p,n)=>p*n,1)*6)throw Error('流场文件缺失或尺寸不符，请重试');const raw=new Int16Array(buffer);const field=new Float32Array(raw.length);for(let i=0;i<raw.length;i++)field[i]=raw[i]*a.scale;return [key,field];}));
   if(serial!==this.serial)return;this.data=Object.fromEntries(results);this.meta=manifest;this.baseSpec=map.base.grid;this.spec=this.baseSpec;this.baseGrid=new Float32Array(this.data.base.length);this.grid=this.baseGrid;this.yawGrid=null;this.lastKey='';this.stats.ready=true;this.stats.error=null;await Promise.all([this.sweep.load(car,this.data.base),this.yaw.load(car).catch(()=>{})]);this.onStatus('粗网格 CFD · 实时插值预览');
  }catch(e){if(serial!==this.serial)return;this.stats.error=e.message;this.onStatus('气流暂不可用 · '+(/[\u4e00-\u9fff]/.test(e.message)?e.message:'数据加载失败，请检查网络后重试')); }
 }
 setEnabled(enabled){this.enabled=enabled;this.group.visible=enabled&&this.stats.ready;}
 sampleRaw(x,y,z,out,grid=this.grid,requireValid=false,spec=this.spec){const {shape,min,max}=spec;const gx=(x-min[0])/(max[0]-min[0])*(shape[0]-1),gy=(y-min[1])/(max[1]-min[1])*(shape[1]-1),gz=(z-min[2])/(max[2]-min[2])*(shape[2]-1);
  if(gx<0||gy<0||gz<0||gx>=shape[0]-1||gy>=shape[1]-1||gz>=shape[2]-1){out.set(0,0,0);return false;}
  const ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz),fx=gx-ix,fy=gy-iy,fz=gz-iz;let a=0,b=0,c=0;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const wt=(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz),i=(((iz+dz)*shape[1]+iy+dy)*shape[0]+ix+dx)*3;if(requireValid&&wt>1e-8&&grid[i]===0&&grid[i+1]===0&&grid[i+2]===0){out.set(0,0,0);return false;}a+=grid[i]*wt;b+=grid[i+1]*wt;c+=grid[i+2]*wt;}
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
  const yawSel=useYaw?this.yaw.selection(windAngle):null;if(yawSel?.loading){this.lastKey='';this.onStatus('正在加载侧风 CFD 数据…');return;}
  const weights=sweep?.weights||rollingWeights(U,W,effSteer,effDrs),fields=sweep?.data||this.data,active=Object.entries(weights).filter(([,v])=>Math.abs(v)>1e-7);const started=performance.now();
  const hasHeadDelta=useYaw&&(Math.abs(U-50)>.01||Math.abs(W-50)>.01||Math.abs(effSteer)>.01||Math.abs(effDrs)>.001);
  if(yawSel){
   const ySpec=yawSel.spec,yLen=ySpec.shape[0]*ySpec.shape[1]*ySpec.shape[2]*3;
   if(!this.yawGrid||this.yawGrid.length!==yLen)this.yawGrid=new Float32Array(yLen);
   this.spec=ySpec;this.grid=this.yawGrid;this.yawGrid.fill(0);
   const uScale=U/50,yActive=Object.entries(yawSel.weights).filter(([,v])=>Math.abs(v)>1e-7);
   for(const [name,weight] of yActive){const data=yawSel.data[name];const w=weight*uScale;for(let i=0;i<yLen;i++)this.yawGrid[i]+=data[i]*w;}
   // Add longitudinal ground/air/DRS/steer deltas inside the headwind lattice when deviating from 180 km/h neutral.
   if(hasHeadDelta){
    this.baseGrid.fill(0);
    for(const [name,weight] of active){const data=fields[name];for(let i=0;i<data.length;i++)this.baseGrid[i]+=data[i]*weight;}
    const baseData=this.data.base,bSpec=this.baseSpec;
    for(let i=0;i<this.baseGrid.length;i++)this.baseGrid[i]-=baseData[i]*uScale;
    const [nx,ny,nz]=ySpec.shape,[x0,y0,z0]=ySpec.min,[x1,y1,z1]=ySpec.max;
    const dx=(x1-x0)/(nx-1),dy=(y1-y0)/(ny-1),dz=(z1-z0)/(nz-1),delta=new T.Vector3();
    for(let iz=0;iz<nz;iz++){const z=z0+iz*dz;if(z<bSpec.min[2]||z>bSpec.max[2])continue;
     for(let iy=0;iy<ny;iy++){const y=y0+iy*dy;if(y<bSpec.min[1]||y>bSpec.max[1])continue;
      for(let ix=0;ix<nx;ix++){const x=x0+ix*dx;if(x<bSpec.min[0]||x>bSpec.max[0])continue;
       const idx=((iz*ny+iy)*nx+ix)*3;
       if(this.yawGrid[idx]===0&&this.yawGrid[idx+1]===0&&this.yawGrid[idx+2]===0&&U>.1)continue;
       if(this.sampleRaw(x,y,z,delta,this.baseGrid,false,bSpec)){this.yawGrid[idx]+=delta.x;this.yawGrid[idx+1]+=delta.y;this.yawGrid[idx+2]+=delta.z;}
      }
     }
    }
   }
   this.stats.axisSweep=Boolean(sweep);this.stats.yawActive=true;this.stats.yawExact=Boolean(yawSel.exact&&!hasHeadDelta);this.stats.yawMirror=Boolean(yawSel.mirror);
   this.stats.activeAnchors={...Object.fromEntries(yActive)};this.stats.sourceMode=this.stats.yawExact?'anchor':'surrogate';
  }else{
   this.spec=this.baseSpec;this.grid=this.baseGrid;this.baseGrid.fill(0);
   for(const [name,weight] of active){const data=fields[name];for(let i=0;i<data.length;i++)this.baseGrid[i]+=data[i]*weight;}
   this.stats.axisSweep=Boolean(sweep);this.stats.yawActive=false;this.stats.yawExact=false;this.stats.yawMirror=false;
   this.stats.activeAnchors=Object.fromEntries(active);this.stats.sourceMode=active.length===1&&Math.abs(active[0][1]-1)<1e-7?'anchor':'surrogate';
  }
  if(U<.001&&W<.001){this.geometry.setDrawRange(0,0);this.stats.lines=0;this.stats.vertices=0;this.stats.signature=0;this.stats.blocked=0;this.stats.peakMps=0;this.stats.buildMs=performance.now()-started;this.stats.inputKey=key;this.onStatus('静止 · 来流与车轮均为 0');return;}
  this.onStatus(this.stats.sourceMode==='anchor'?'粗网格 CFD · 已计算工况':yawSel?.mirror?'粗网格 CFD · 该侧风角计算中，暂用对称近似':yawSel?'粗网格 CFD · 侧风组合实时预览':sweep?'粗网格 CFD · 多参数组合近似':'粗网格 CFD · 当前档位尚在计算，暂用近似预览');
  this.rebuild(rig,U,W,state.flowDensity,windAngle);this.stats.buildMs=performance.now()-started;this.stats.inputKey=key;this.stats.signature=this.geometry.attributes.position?.array.reduce((a,v,i)=>a+(i%97===0?Math.round(v*10000):0),0)||0;
 }
 rayBins(model){model.updateMatrixWorld(true);this.parent?.updateMatrixWorld(true);const invParent=this.parent?new T.Matrix4().copy(this.parent.matrixWorld).invert():null;const size=.4,nx=12,ny=7,nz=17,origin=new T.Vector3(-2.4,-.4,-3.4),bins=Array.from({length:nx*ny*nz},()=>[]),box=new T.Box3();
  model.traverse(o=>{if(!o.isMesh||!o.visible)return;let collider=this.colliders.get(o);if(!collider){collider=new T.Mesh(o.geometry,this.colliderMaterial);collider.matrixAutoUpdate=false;this.colliders.set(o,collider);}if(invParent)collider.matrixWorld.multiplyMatrices(invParent,o.matrixWorld);else collider.matrixWorld.copy(o.matrixWorld);if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();box.copy(o.geometry.boundingBox).applyMatrix4(collider.matrixWorld).expandByScalar(.09);const lo=box.min.clone().sub(origin).divideScalar(size).floor(),hi=box.max.clone().sub(origin).divideScalar(size).floor();
   for(let z=Math.max(0,lo.z);z<=Math.min(nz-1,hi.z);z++)for(let y=Math.max(0,lo.y);y<=Math.min(ny-1,hi.y);y++)for(let x=Math.max(0,lo.x);x<=Math.min(nx-1,hi.x);x++)bins[(z*ny+y)*nx+x].push(collider);
  });return p=>{const x=Math.floor((p.x-origin.x)/size),y=Math.floor((p.y-origin.y)/size),z=Math.floor((p.z-origin.z)/size);return bins[(z*ny+y)*nx+x]||[];};
 }
 rebuild(rig,U,W,density,windAngle=0){const positions=[],colors=[],flight=[],alpha=[],velocity=new T.Vector3(),last=new T.Vector3(),point=new T.Vector3(),mid=new T.Vector3(),color=new T.Color();let count=0,peak=0,blocked=0;
  const nearby=this.rayBins(rig.model);
  const invParent=this.parent?new T.Matrix4().copy(this.parent.matrixWorld).invert():null;
  const invQuat=invParent?new T.Quaternion().setFromRotationMatrix(invParent):null;
  const wheels=Object.entries(rig.wheels).map(([key,w])=>{const center=w.spinNode.getWorldPosition(new T.Vector3()),quat=w.spinNode.getWorldQuaternion(new T.Quaternion());if(invParent){center.applyMatrix4(invParent);quat.premultiply(invQuat);}return {center,axis:new T.Vector3(1,0,0).applyQuaternion(quat),radius:w.radius,width:rig.config.id==='rb19'?(key.startsWith('R')?.47:.43):.45};});
  const insideWheel=p=>wheels.some(w=>{mid.copy(p).sub(w.center);const along=mid.dot(w.axis);return Math.abs(along)<w.width/2+.012&&mid.lengthSq()-along*along<(w.radius+.009)**2;});
  const seeds=[];
  if(Math.abs(windAngle)<1e-6){
   if(U>.02&&density>0){const nx=Math.max(1,Math.round(21*Math.sqrt(density/100))),ny=Math.max(1,Math.round(7*Math.sqrt(density/100)));for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)seeds.push(new T.Vector3(-1.5+3*(i+.5)/nx,.08+.96*(j+.5)/ny,3.85));}
   // Sample the solved field locally ahead of the rear wing as well as at the
   // inlet. Upstream trajectories can terminate on the car long before reaching
   // this region; seed density is a visualization choice, not physical density.
   if(U>.02&&density>0){const nx=Math.max(1,Math.round(15*Math.sqrt(density/100))),ny=Math.max(1,Math.round(6*Math.sqrt(density/100)));
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)seeds.push(new T.Vector3(-.95+1.9*(i+.5)/nx,.64+.68*(j+.5)/ny,-1.72));
   }
  }else if(U>.02&&density>0){
   const beta=windAngle*Math.PI/180,cb=Math.cos(beta),sb=Math.sin(beta);
   // Downstream wind in display frame: (sin(beta), 0, -cos(beta)); upstream is opposite.
   const ux=-sb,uz=cb,tx=cb,tz=sb;
   const upDist=3.8*Math.abs(cb)+3.4*Math.abs(sb),halfW=1.45*Math.abs(cb)+2.85*Math.abs(sb);
   const nx=Math.max(1,Math.round((21+8*Math.abs(sb))*Math.sqrt(density/100))),ny=Math.max(1,Math.round(7*Math.sqrt(density/100)));
   for(let j=0;j<ny;j++){const y=.08+1.04*(j+.5)/ny;
    for(let i=0;i<nx;i++){const s=-halfW+2*halfW*(i+.5)/nx;seeds.push(new T.Vector3(ux*upDist+tx*s,y,uz*upDist+tz*s));}
   }
   // Local near-body upper rake so crosswind separation over sidepods & wings stays visible.
   const upNear=1.55*Math.abs(cb)+1.15*Math.abs(sb),hwNear=1.1*Math.abs(cb)+2.4*Math.abs(sb);
   const nx2=Math.max(1,Math.round(14*Math.sqrt(density/100))),ny2=Math.max(1,Math.round(5*Math.sqrt(density/100)));
   for(let j=0;j<ny2;j++){const y=.52+.72*(j+.5)/ny2;
    for(let i=0;i<nx2;i++){const s=-hwNear+2*hwNear*(i+.5)/nx2;seeds.push(new T.Vector3(ux*upNear+tx*s,y,uz*upNear+tz*s));}
   }
  }
  // Additional wheel neighbourhood seeds expose the rotation-driven component,
  // including stationary-car wheel rotation. They are not invented trajectories.
  const wheelSeeds=Math.round(10*density/100);for(const w of wheels)for(let i=0;i<wheelSeeds;i++){const a=i*Math.PI*2/wheelSeeds;seeds.push(w.center.clone().add(new T.Vector3(.26*Math.sign(w.center.x),Math.sin(a)*(w.radius+.1),Math.cos(a)*(w.radius+.1))));}
  const maxSteps=Math.abs(windAngle)<1e-6?190:220;
  for(const seed of seeds){const start=flight.length;point.copy(seed);let travel=0,segments=0;
   for(let step=0;step<maxSteps;step++){
    if(!this.sample(-point.z,-point.x,point.y-.005,velocity))break;const speed=velocity.length();if(speed<Math.max(.07,Math.max(U,W)*.005))break;
    peak=Math.max(peak,speed);last.copy(point);const ds=.065;
    point.addScaledVector(velocity,ds/speed);
    if(insideWheel(point)){blocked++;break;}
    // The field's solid mask is part of each solved geometry. A conservative
    // speed threshold terminates paths at walls; exact geometry rays below
    // catch thin wing sheets missed by the coarser sampling lattice.
    if(Math.abs(point.x)<1.2&&point.z<2.95&&point.z>-2.95&&point.y<1.35){
     mid.copy(point).sub(last);this.ray.set(last,mid.clone().normalize());this.ray.far=ds+.012;
     if(this.ray.intersectObjects(nearby(last),false).length){blocked++;break;}
    }
    const nextTime=travel+ds/speed;
    color.setHSL(.55-.52*T.MathUtils.clamp(speed/120,0,1),.85,.65);
    positions.push(...last.toArray(),...point.toArray());colors.push(...color.toArray(),...color.toArray());flight.push(travel,nextTime);alpha.push(1,1);travel=nextTime;segments++;
    if(step>30&&point.distanceTo(seed)<.04)break;
   }
   if(segments<4){positions.length=start*3;colors.length=start*3;flight.length=start;alpha.length=start;continue;}
   for(let n=0;n<segments;n++){alpha[start+2*n]=Math.min(1,n*.065/.22,(segments-n)*.065/.22);alpha[start+2*n+1]=Math.min(1,(n+1)*.065/.22,(segments-n-1)*.065/.22);}
   count++;
  }
  this.geometry.dispose();this.geometry=new T.BufferGeometry();this.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));this.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));this.geometry.setAttribute('flight',new T.Float32BufferAttribute(flight,1));this.geometry.setAttribute('lineAlpha',new T.Float32BufferAttribute(alpha,1));this.lines.geometry=this.geometry;this.stats={...this.stats,ready:true,lines:count,peakMps:peak,blocked,vertices:positions.length/3};
 }
}
