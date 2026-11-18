import * as T from 'three';
import { TraceScratch } from './airflow.js';

// The fine baseline plus coarse-field deltas is an exploratory surrogate, not a new solve.
export class UnderbodyFlow {
 constructor(parent, material){this.material=material;this.group=new T.Group();this.group.name='UNDERBODY_BASELINE';parent.add(this.group);this.geometry=new T.BufferGeometry();this.lines=new T.LineSegments(this.geometry,material);this.lines.frustumCulled=false;this.group.add(this.lines);this.serial=0;this.data=null;this.key='';this.count=0;this.status='loading';this._scratch=new TraceScratch(65536);}
 async load(car){const serial=++this.serial;this.data=null;this.key='';this.status='loading';this.group.visible=false;
  try{const [m,b]=await Promise.all([fetch(`/flow/${car}/underbody.json`),fetch(`/flow/${car}/underbody.bin`)]);if(!m.ok||!b.ok)throw Error('missing');const meta=await m.json(),data=new Int16Array(await b.arrayBuffer());if(serial!==this.serial)return;if(data.length!==meta.shape.reduce((a,v)=>a*v,1)*4)throw Error('shape');this.meta=meta;this.data=data;this.status='ready';}
  catch{if(serial===this.serial){this.data=null;this.status='unavailable';}}
 }
 sample(p,out){const {shape,min,max,scale}=this.meta;const sx=shape[0],sy=shape[1],sz=shape[2];
  const gx=(-p.z-min[0])/(max[0]-min[0])*(sx-1);if(gx<0||gx>=sx-1){this.sampleStop='boundary';this.boundaryAxis='x';return false;}
  const gy=(-p.x-min[1])/(max[1]-min[1])*(sy-1);if(gy<0||gy>=sy-1){this.sampleStop='boundary';this.boundaryAxis='y';return false;}
  const gz=(p.y-.005-min[2])/(max[2]-min[2])*(sz-1);if(gz<0||gz>=sz-1){this.sampleStop='boundary';this.boundaryAxis='z';return false;}
  const ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz),fx=gx-ix,fy=gy-iy,fz=gz-iz,omx=1-fx,omy=1-fy,omz=1-fz;
  const sxy=sx*sy,d=this.data,i000=(iz*sxy+iy*sx+ix)*4,i100=i000+4,i010=i000+sx*4,i110=i010+4,sxy4=sxy*4,i001=i000+sxy4,i101=i100+sxy4,i011=i010+sxy4,i111=i110+sxy4;
  const w000=omx*omy*omz,w100=fx*omy*omz,w010=omx*fy*omz,w110=fx*fy*omz,w001=omx*omy*fz,w101=fx*omy*fz,w011=omx*fy*fz,w111=fx*fy*fz;
  if((!d[i000+3]&&w000>1e-8)||(!d[i100+3]&&w100>1e-8)||(!d[i010+3]&&w010>1e-8)||(!d[i110+3]&&w110>1e-8)||(!d[i001+3]&&w001>1e-8)||(!d[i101+3]&&w101>1e-8)||(!d[i011+3]&&w011>1e-8)||(!d[i111+3]&&w111>1e-8)){this.sampleStop='masked';return false;}
  const x=w000*d[i000]+w100*d[i100]+w010*d[i010]+w110*d[i110]+w001*d[i001]+w101*d[i101]+w011*d[i011]+w111*d[i111];
  const y=w000*d[i000+1]+w100*d[i100+1]+w010*d[i010+1]+w110*d[i110+1]+w001*d[i001+1]+w101*d[i101+1]+w011*d[i011+1]+w111*d[i111+1];
  const z=w000*d[i000+2]+w100*d[i100+2]+w010*d[i010+2]+w110*d[i110+2]+w001*d[i001+2]+w101*d[i101+2]+w011*d[i011+2]+w111*d[i111+2];
  out.set(-y*scale,z*scale,-x*scale);return Number.isFinite(x+y+z);
 }
 update(state,rig,airflow){const U=state.speed/3.6,W=state.wheelSpeedMps;
  const active=state.flow&&this.data&&airflow.stats.ready&&rig&&state.flowDensity>0&&(U>.001||W>.001);
  this.group.visible=Boolean(active);if(!active)return false;
  // Wait for the coarse field to match the current controls before blending.
  const desired=[U.toFixed(3),W.toFixed(3),state.steer.toFixed(2),state.drsCurrent.toFixed(3),state.flowDensity,(state.effWindAngle??state.windAngle??0).toFixed(1)].join(':');
  if(airflow.stats.inputKey!==desired){this.group.visible=false;return false;}
  const key=`${state.model}:${desired}`;if(key===this.key)return true;this.key=key;
  const exact=Math.abs(U-50)<1e-6&&Math.abs(W-50)<1e-6&&Math.abs(state.steer)<.001&&Math.abs(state.drsCurrent)<.001&&Math.abs(state.effWindAngle??state.windAngle??0)<.001;
  const baseScale=U/50,coarse=new T.Vector3(),reference=new T.Vector3();
  const scratch=this._scratch;scratch.reset();const point=new T.Vector3(),last=new T.Vector3(),vel=new T.Vector3(),direction=new T.Vector3(),color=new T.Color();const {nearby}=airflow.getRayContext(rig.model);let count=0;const stops={boundary:0,masked:0,slow:0,collision:0,limit:0},boundaryAxes={x:0,y:0,z:0};
  const nx=Math.max(1,Math.round(21*Math.sqrt(state.flowDensity/100))),ny=Math.max(1,Math.round(4*Math.sqrt(state.flowDensity/100)));
  const inv120=1/120,invFade=.02/.14;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const start=scratch.len;let reason='limit';point.set(-(-.72+1.44*(i+.5)/nx),.035+.07*(j+.5)/ny+.005,1.78);let travel=0,segments=0;
   for(let n=0;n<350;n++){
    if(!this.sample(point,vel)){reason=this.sampleStop||'masked';break;}
    if(!exact){const x=-point.z,y=-point.x,z=point.y-.005;
     if(!airflow.sample(x,y,z,reference,airflow.data.base,true,airflow.baseSpec||airflow.spec)||!airflow.sample(x,y,z,coarse)){reason='masked';break;}
     vel.multiplyScalar(baseScale).add(coarse).addScaledVector(reference,-baseScale);
    }
    const speed=vel.length();if(speed<Math.max(.005,Math.max(U,W)*.005)){reason='slow';break;}last.copy(point);direction.copy(vel).normalize();point.addScaledVector(direction,.02);
    if(airflow.hasRayHit(last,direction,.022,nearby(last))){reason='collision';break;}
    const next=travel+.02/speed;color.setHSL(.55-.52*T.MathUtils.clamp(speed*inv120,0,1),.85,.65);
    scratch.pushSeg(last.x,last.y,last.z,point.x,point.y,point.z,color.r,color.g,color.b,travel,next);
    travel=next;segments++;
   }stops[reason]++;if(reason==='boundary')boundaryAxes[this.boundaryAxis]++;
   if(segments<4){scratch.len=start;continue;}
   for(let n=0;n<segments;n++){scratch.alp[start+2*n]=Math.min(1,n*invFade,(segments-n)*invFade);scratch.alp[start+2*n+1]=Math.min(1,(n+1)*invFade,(segments-n-1)*invFade);}
   count++;
  }
  this.geometry=scratch.commit(this.geometry);this.lines.geometry=this.geometry;this.count=count;this.stops=stops;this.boundaryAxes=boundaryAxes;this.mode=exact?'baseline':'surrogate';return true;
 }
}
