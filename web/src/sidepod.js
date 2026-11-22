import * as T from 'three';
import { sideSeeds } from './flow-seeds.js';
import { UnderbodyFlow } from './underbody.js';
import { cachedArrayBuffer } from './asset-cache.js';

// Locally refined baseline. Other poses reuse coarse-field differences and
// are explicitly approximate; invalid data or actual mesh crossings stop paths.
export class SidepodFlow extends UnderbodyFlow {
 constructor(parent,material){super(parent,material);this.group.name='SIDEPOD_SUSPENSION_FLOW';this.lastBuild=0;this.pendingKey='';this.changedAt=0;}
 async load(car){const serial=++this.serial;this.data=null;this.meta=null;this.key='';this.pendingKey='';this.status='loading';this.group.visible=false;
  try{const cacheMode=import.meta.env.DEV?'no-store':'default';const [m,buf]=await Promise.all([fetch(`/flow/${car}/sidepod.json`,{cache:cacheMode}),cachedArrayBuffer(`/flow/${car}/sidepod.bin`)]);if(!m.ok)throw Error('missing');const meta=await m.json(),data=new Int16Array(buf);if(serial!==this.serial)return;if(data.length!==meta.shape.reduce((a,v)=>a*v,1)*4)throw Error('shape');this.meta=meta;this.data=data;this.status='ready';}
  catch{if(serial===this.serial){this.data=null;this.status='unavailable';}}
 }
 update(state,rig,airflow,now=performance.now(),immediate=false,{stationary=false}={}){
  const U=state.speed/3.6,W=state.wheelSpeedMps,active=state.flow&&(stationary||this.data)&&airflow.stats.ready&&rig&&state.flowDensity>0&&(U>.001||W>.001);
  this.group.visible=Boolean(active);if(!active)return false;
  const desired=[U.toFixed(3),W.toFixed(3),state.steer.toFixed(2),state.drsCurrent.toFixed(3),state.flowDensity,(state.effWindAngle??state.windAngle??0).toFixed(1)].join(':');
  if(airflow.stats.inputKey!==desired){this.group.visible=false;return false;}
  const key=`${state.model}:${desired}`;if(key===this.key)return true;
  if(!immediate){
   if(key!==this.pendingKey){this.pendingKey=key;this.changedAt=now;this.group.visible=false;return false;}
   if(now-this.changedAt<180){this.group.visible=false;return false;}
  }
  this.lastBuild=now;this.key=key;
  const exact=Math.abs(U-50)<1e-6&&Math.abs(W-50)<1e-6&&Math.abs(state.steer)<.001&&Math.abs(state.drsCurrent)<.001&&Math.abs(state.effWindAngle??state.windAngle??0)<.001,baseScale=U/50;
  const scratch=this._scratch;scratch.reset();const point=new T.Vector3(),last=new T.Vector3(),vel=new T.Vector3(),direction=new T.Vector3(),coarse=new T.Vector3(),reference=new T.Vector3(),color=new T.Color();
  const {nearby,all}=airflow.getRayContext(rig.model);
  const candidates = sideSeeds(state, rig, airflow);
  let count=0,blockedSeeds=0,fallbackSamples=0;const seedPoints=[];const regions={suspension:0,sidepod:0},layers={undercut:0,upper:0};
  const sampleVelocity=stationary
   ? (point,velocity)=>airflow.sample(-point.z,-point.x,point.y-.005,velocity,airflow.grid,true)
   : (point,velocity)=>this.sample(point,velocity);
  const inv120=1/120,invFade=.025/.16;
  for(const station of candidates){point.copy(station.position);
   // Only seed where the sampled proxy field exists and a clear outward ray
   // reaches the exterior of the display car; conservative for open meshes.
   if(!sampleVelocity(point,vel))continue;
   const obstructed=airflow.hasRayHit(point,station.escape?direction.copy(station.escape):direction.set(Math.sign(point.x),0,0),station.escape?.04:3,all,.0001);if(obstructed){blockedSeeds++;continue;}
   const seed=point.clone();const start=scratch.len;let travel=0,segments=0;
   for(let n=0;n<210;n++){
    if(!sampleVelocity(point,vel))break;
    if(!stationary&&!exact){const x=-point.z,y=-point.x,z=point.y-.005;
     const haveDelta=airflow.sample(x,y,z,reference,airflow.data.base,true,airflow.baseSpec||airflow.spec)&&airflow.sample(x,y,z,coarse);
     vel.multiplyScalar(baseScale);if(haveDelta)vel.add(coarse).addScaledVector(reference,-baseScale);else fallbackSamples++;
    }
    const speed=vel.length();if(speed<Math.max(.005,Math.max(U,W)*.005))break;last.copy(point);direction.copy(vel).normalize();point.addScaledVector(direction,.025);
    if(airflow.hasRayHit(last,direction,.027,nearby(last)))break;
    const next=travel+.025/speed;color.setHSL(.55-.52*T.MathUtils.clamp(speed*inv120,0,1),.85,.65);
    scratch.pushSeg(last.x,last.y,last.z,point.x,point.y,point.z,color.r,color.g,color.b,travel,next);
    travel=next;segments++;
   }
   if(segments<4){scratch.len=start;continue;}
   for(let n=0;n<segments;n++){scratch.alp[start+2*n]=Math.min(1,n*invFade,(segments-n)*invFade);scratch.alp[start+2*n+1]=Math.min(1,(n+1)*invFade,(segments-n-1)*invFade);}count++;regions[station.name]++;if(station.name==='sidepod')layers[seed.y-.005<.55?'undercut':'upper']++;seedPoints.push({region:station.name,point:seed.toArray()});
  }
  this.geometry=scratch.commit(this.geometry);this.lines.geometry=this.geometry;this.count=count;this.regions=regions;this.layers=layers;this.seedPoints=seedPoints;this.blockedSeeds=blockedSeeds;this.fallbackSamples=fallbackSamples;this.mode=stationary?'coarse':exact?'baseline':'surrogate';return true;
 }
}
