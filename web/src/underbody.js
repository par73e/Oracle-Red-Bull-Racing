import * as T from 'three';

// The fine baseline plus coarse-field deltas is an exploratory surrogate, not a new solve.
export class UnderbodyFlow {
 constructor(parent, material){this.material=material;this.group=new T.Group();this.group.name='UNDERBODY_BASELINE';parent.add(this.group);this.geometry=new T.BufferGeometry();this.lines=new T.LineSegments(this.geometry,material);this.lines.frustumCulled=false;this.group.add(this.lines);this.serial=0;this.data=null;this.key='';this.count=0;this.status='loading';}
 async load(car){const serial=++this.serial;this.data=null;this.key='';this.status='loading';this.group.visible=false;
  try{const [m,b]=await Promise.all([fetch(`/flow/${car}/underbody.json`),fetch(`/flow/${car}/underbody.bin`)]);if(!m.ok||!b.ok)throw Error('missing');const meta=await m.json(),data=new Int16Array(await b.arrayBuffer());if(serial!==this.serial)return;if(data.length!==meta.shape.reduce((a,v)=>a*v,1)*4)throw Error('shape');this.meta=meta;this.data=data;this.status='ready';}
  catch{if(serial===this.serial){this.data=null;this.status='unavailable';}}
 }
 sample(p,out){const {shape,min,max,scale}=this.meta;const xyz=[-p.z,-p.x,p.y-.005].map((x,i)=>(x-min[i])/(max[i]-min[i])*(shape[i]-1));
  const outside=xyz.findIndex((v,i)=>v<0||v>=shape[i]-1);if(outside>=0){this.sampleStop='boundary';this.boundaryAxis=['x','y','z'][outside];return false;}
  const base=xyz.map(Math.floor),f=xyz.map((v,i)=>v-base[i]);let x=0,y=0,z=0;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const i=(((base[2]+dz)*shape[1]+base[1]+dy)*shape[0]+base[0]+dx)*4;
   const w=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);if(!this.data[i+3]&&w>1e-8){this.sampleStop='masked';return false;}x+=w*this.data[i];y+=w*this.data[i+1];z+=w*this.data[i+2];
  }out.set(-y*scale,z*scale,-x*scale);return Number.isFinite(x+y+z);
 }
 update(state,rig,airflow){const U=state.speed/3.6,W=state.wheelSpeedMps;
  const active=state.flow&&this.data&&airflow.stats.ready&&rig&&state.flowDensity>0&&(U>.001||W>.001);
  this.group.visible=Boolean(active);if(!active)return false;
  // Wait for the coarse field to match the current controls before blending.
  const desired=[U.toFixed(3),W.toFixed(3),state.steer.toFixed(2),state.drsCurrent.toFixed(3),state.flowDensity].join(':');
  if(airflow.stats.inputKey!==desired)return true;
  const key=`${state.model}:${desired}`;if(key===this.key)return true;this.key=key;
  const exact=Math.abs(U-50)<1e-6&&Math.abs(W-50)<1e-6&&Math.abs(state.steer)<.001&&Math.abs(state.drsCurrent)<.001;
  const baseScale=U/50,coarse=new T.Vector3(),reference=new T.Vector3();
  const positions=[],colors=[],flight=[],alpha=[],point=new T.Vector3(),last=new T.Vector3(),vel=new T.Vector3(),direction=new T.Vector3(),color=new T.Color();const nearby=airflow.rayBins(rig.model);let count=0;const stops={boundary:0,masked:0,slow:0,collision:0,limit:0},boundaryAxes={x:0,y:0,z:0};
  const nx=Math.max(1,Math.round(21*Math.sqrt(state.flowDensity/100))),ny=Math.max(1,Math.round(4*Math.sqrt(state.flowDensity/100)));
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const start=flight.length;let reason='limit';point.set(-(-.72+1.44*(i+.5)/nx),.035+.07*(j+.5)/ny+.005,1.78);let travel=0,segments=0;
   for(let n=0;n<350;n++){
    if(!this.sample(point,vel)){reason=this.sampleStop||'masked';break;}
    if(!exact){const x=-point.z,y=-point.x,z=point.y-.005;
     if(!airflow.sample(x,y,z,reference,airflow.data.base,true)||!airflow.sample(x,y,z,coarse)){reason='masked';break;}
     vel.multiplyScalar(baseScale).add(coarse).addScaledVector(reference,-baseScale);
    }
    const speed=vel.length();if(speed<Math.max(.005,Math.max(U,W)*.005)){reason='slow';break;}last.copy(point);direction.copy(vel).normalize();point.addScaledVector(direction,.02);
    airflow.ray.set(last,direction);airflow.ray.far=.022;if(airflow.ray.intersectObjects(nearby(last),false).length){reason='collision';break;}
    const next=travel+.02/speed;color.setHSL(.55-.52*T.MathUtils.clamp(speed/120,0,1),.85,.65);
    positions.push(...last.toArray(),...point.toArray());colors.push(...color.toArray(),...color.toArray());flight.push(travel,next);alpha.push(1,1);travel=next;segments++;
   }stops[reason]++;if(reason==='boundary')boundaryAxes[this.boundaryAxis]++;
   if(segments<4){positions.length=start*3;colors.length=start*3;flight.length=start;alpha.length=start;continue;}
   for(let n=0;n<segments;n++){alpha[start+2*n]=Math.min(1,n*.02/.14,(segments-n)*.02/.14);alpha[start+2*n+1]=Math.min(1,(n+1)*.02/.14,(segments-n-1)*.02/.14);}
   count++;
  }
  this.geometry.dispose();this.geometry=new T.BufferGeometry();this.geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));this.geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));this.geometry.setAttribute('flight',new T.Float32BufferAttribute(flight,1));this.geometry.setAttribute('lineAlpha',new T.Float32BufferAttribute(alpha,1));this.lines.geometry=this.geometry;this.count=count;this.stops=stops;this.boundaryAxes=boundaryAxes;this.mode=exact?'baseline':'surrogate';return true;
 }
}
