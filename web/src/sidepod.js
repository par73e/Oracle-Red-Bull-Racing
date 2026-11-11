import * as T from 'three';
import { UnderbodyFlow } from './underbody.js';

// Locally refined baseline. Other poses reuse coarse-field differences and
// are explicitly approximate; invalid data or actual mesh crossings stop paths.
export class SidepodFlow extends UnderbodyFlow {
 constructor(parent,material){super(parent,material);this.group.name='SIDEPOD_SUSPENSION_FLOW';this.lastBuild=0;this.pendingKey='';this.changedAt=0;}
 async load(car){const serial=++this.serial;this.data=null;this.meta=null;this.key='';this.pendingKey='';this.status='loading';this.group.visible=false;
  try{const [m,b]=await Promise.all([fetch(`/flow/${car}/sidepod.json`),fetch(`/flow/${car}/sidepod.bin`)]);if(!m.ok||!b.ok)throw Error('missing');const meta=await m.json(),data=new Int16Array(await b.arrayBuffer());if(serial!==this.serial)return;if(data.length!==meta.shape.reduce((a,v)=>a*v,1)*4)throw Error('shape');this.meta=meta;this.data=data;this.status='ready';}
  catch{if(serial===this.serial){this.data=null;this.status='unavailable';}}
 }
 update(state,rig,airflow,now=performance.now()){
  const U=state.speed/3.6,W=state.wheelSpeedMps,active=state.flow&&this.data&&airflow.stats.ready&&rig&&state.flowDensity>0&&(U>.001||W>.001);
  this.group.visible=Boolean(active);if(!active)return false;
  const desired=[U.toFixed(3),W.toFixed(3),state.steer.toFixed(2),state.drsCurrent.toFixed(3),state.flowDensity].join(':');
  if(airflow.stats.inputKey!==desired){this.group.visible=false;return false;}
  const key=`${state.model}:${desired}`;if(key===this.key)return true;
  if(key!==this.pendingKey){this.pendingKey=key;this.changedAt=now;this.group.visible=false;return false;}
  if(now-this.changedAt<180){this.group.visible=false;return false;}
  this.lastBuild=now;this.key=key;
  const exact=Math.abs(U-50)<1e-6&&Math.abs(W-50)<1e-6&&Math.abs(state.steer)<.001&&Math.abs(state.drsCurrent)<.001,baseScale=U/50;
  const positions=[],colors=[],flight=[],alpha=[],point=new T.Vector3(),last=new T.Vector3(),vel=new T.Vector3(),direction=new T.Vector3(),coarse=new T.Vector3(),reference=new T.Vector3(),color=new T.Color();
  rig.model.updateMatrixWorld(true);const nearby=airflow.rayBins(rig.model),all=[];rig.model.traverse(o=>{if(o.isMesh&&o.visible){const collider=airflow.colliders.get(o);if(collider)all.push(collider);}});
  const sides=Math.max(1,Math.round(6*Math.sqrt(state.flowDensity/100))),heights=Math.max(1,Math.round(6*Math.sqrt(state.flowDensity/100)));let count=0,blockedSeeds=0,fallbackSamples=0;const seedPoints=[];const regions={suspension:0,sidepod:0},layers={undercut:0,upper:0};
  const candidates=[];
  for(const sign of [-1,1])for(let j=0;j<heights;j++)for(let i=0;i<sides;i++){
   const solverY=sign*(.28+.90*(i+.5)/sides),solverZ=.14+.94*(j+.5)/heights;
   candidates.push({name:'suspension',position:new T.Vector3(-solverY,solverZ+.005,2.05)});
  }
  // Additional local seeds around the actual articulated front track rods.
  // The existing proxy validity mask and collision tests still apply.
  for(const name of ['FL','FR']){const link=rig.links?.[name];if(!link)continue;
   const inner=link.innerNode.getWorldPosition(new T.Vector3()),outer=link.outerNode.getWorldPosition(new T.Vector3());
   const axis=outer.clone().sub(inner).normalize(),a=new T.Vector3().crossVectors(axis,new T.Vector3(0,1,0)).normalize(),b=new T.Vector3().crossVectors(axis,a).normalize();
   if(a.lengthSq()<.5||b.lengthSq()<.5)continue;
   for(const t of [.3,.55,.8])for(const d of [a,a.clone().negate(),b,b.clone().negate()])for(const radius of [.045,.085]){
    const center=inner.clone().lerp(outer,t);candidates.push({name:'suspension',position:center.addScaledVector(d,radius),escape:d.clone()});
   }
  }
  // Probe from outside towards the actual displayed surfaces.  Seed short
  // distances outside each first hit, then require a valid CFD fluid sample.
  const probeLevels=Math.max(1,Math.round(7*Math.sqrt(state.flowDensity/100)));
  for(const station of [{x:-.55,name:'sidepod'},{x:.15,name:'sidepod'},{x:.85,name:'sidepod'},{x:1.55,name:'sidepod'},{x:-1.65,name:'suspension'}])for(const sign of [-1,1])for(let j=0;j<probeLevels;j++){
   const z=.17+.83*(j+.5)/probeLevels,outer=station.name==='suspension'?.54:1.23;
   airflow.ray.set(point.set(-sign*outer,z+.005,-station.x),direction.set(sign,0,0));airflow.ray.near=.0001;airflow.ray.far=outer-.16;
   const hit=airflow.ray.intersectObjects(all,false)[0];airflow.ray.near=0;if(!hit)continue;
   for(const offset of [.04,.09])candidates.push({name:station.name,position:hit.point.clone().add(new T.Vector3(-sign*offset,0,0))});
  }
  for(const station of candidates){point.copy(station.position);
   // Only seed where the sampled proxy field exists and a clear outward ray
   // reaches the exterior of the display car; conservative for open meshes.
   if(!this.sample(point,vel))continue;
   airflow.ray.set(point,station.escape?direction.copy(station.escape):direction.set(Math.sign(point.x),0,0));airflow.ray.near=.0001;airflow.ray.far=station.escape?.04:3;
   const obstructed=airflow.ray.intersectObjects(all,false).length>0;airflow.ray.near=0;if(obstructed){blockedSeeds++;continue;}
   const seed=point.clone();const start=flight.length;let travel=0,segments=0;
   for(let n=0;n<210;n++){
    if(!this.sample(point,vel))break;
    if(!exact){const x=-point.z,y=-point.x,z=point.y-.005;
     const haveDelta=airflow.sample(x,y,z,reference,airflow.data.base,true)&&airflow.sample(x,y,z,coarse);
     vel.multiplyScalar(baseScale);if(haveDelta)vel.add(coarse).addScaledVector(reference,-baseScale);else fallbackSamples++;
    }
    const speed=vel.length();if(speed<Math.max(.005,Math.max(U,W)*.005))break;last.copy(point);direction.copy(vel).normalize();point.addScaledVector(direction,.025);
    airflow.ray.set(last,direction);airflow.ray.far=.027;if(airflow.ray.intersectObjects(nearby(last),false).length)break;
    const next=travel+.025/speed;color.setHSL(.55-.52*T.MathUtils.clamp(speed/120,0,1),.85,.65);positions.push(...last.toArray(),...point.toArray());colors.push(...color.toArray(),...color.toArray());flight.push(travel,next);alpha.push(1,1);travel=next;segments++;
   }
   if(segments<4){positions.length=start*3;colors.length=start*3;flight.length=start;alpha.length=start;continue;}
   for(let n=0;n<segments;n++){alpha[start+2*n]=Math.min(1,n*.025/.16,(segments-n)*.025/.16);alpha[start+2*n+1]=Math.min(1,(n+1)*.025/.16,(segments-n-1)*.025/.16);}count++;regions[station.name]++;if(station.name==='sidepod')layers[seed.y-.005<.55?'undercut':'upper']++;seedPoints.push({region:station.name,point:seed.toArray()});
  }
  this.geometry.dispose();this.geometry=new T.BufferGeometry();this.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));this.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));this.geometry.setAttribute('flight',new T.Float32BufferAttribute(flight,1));this.geometry.setAttribute('lineAlpha',new T.Float32BufferAttribute(alpha,1));this.lines.geometry=this.geometry;this.count=count;this.regions=regions;this.layers=layers;this.seedPoints=seedPoints;this.blockedSeeds=blockedSeeds;this.fallbackSamples=fallbackSamples;this.mode=exact?'baseline':'surrogate';return true;
 }
}
