// Full slider-axis CFD, loaded lazily. Simultaneous changes are an additive
// surrogate around the 180 km/h, neutral, DRS-closed baseline.
import { cachedArrayBuffer } from './asset-cache.js';
// Match the speed at an upstream, off-ground rake. Mixed air/road cases
// inherit residual motion from their 180 km/h reference cases. Apply a
// uniform magnitude correction so the computed flow directions survive.
function matchUpstreamSpeed(weights, data, grid, airSpeed, blend, attenuation) {
  if (!grid || airSpeed <= 0) return weights;
  const [nx, ny, nz] = grid.shape;
  const [,, minZ] = grid.min;
  const stepZ = (grid.max[2] - minZ) / (nz - 1);
  const fields = Object.entries(weights).map(([key, weight]) => [data[key], weight]);
  const speeds = [];
  // Keep this rake within the height band of the main inlet seeds.
  for (let z = Math.max(0, Math.ceil((.46 - minZ) / stepZ)); z < Math.min(nz, (1 - minZ) / stepZ); z++) {
    for (let y = Math.ceil(ny / 4); y < Math.ceil(3 * ny / 4); y++) {
      for (let x = 1; x <= 2 && x < nx; x++) {
        const i = ((z * ny + y) * nx + x) * 3;
        let vx = 0, vy = 0, vz = 0;
        for (const [field, weight] of fields) {
          vx += weight * field[i];
          vy += weight * field[i + 1];
          vz += weight * field[i + 2];
        }
        speeds.push(Math.hypot(vx, vy, vz));
      }
    }
  }
  speeds.sort((a, b) => a - b);
  const upstream = speeds[Math.floor(speeds.length / 2)];
  if (!(upstream > 0)) return weights;
  // Bound the correction relative to the unattenuated field so a weak rake
  // cannot amplify velocities elsewhere in a mixed case without limit.
  const correction = Math.min(airSpeed / upstream, 1.25 / attenuation);
  const scale = 1 + blend * (correction - 1);
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight * scale]));
}

export class SweepFields {
 constructor(onChange){this.onChange=onChange;this.serial=0;this.revision=0;this.cache=new Map();this.pending=new Map();this.lastRefresh=0;this.manifest=null;}
 async load(car,baseline){this.serial++;this.revision++;this.car=car;this.cache.clear();this.pending.clear();this.manifest=null;this.cache.set('base',baseline);await this.refresh();}
 async refresh(){if(!this.car||this.refreshing)return;this.refreshing=true;const serial=this.serial;this.lastRefresh=performance.now();
  try{const cacheMode=import.meta.env?.DEV?'no-store':'default';const [r,q]=await Promise.all([fetch(`/flow/${this.car}/sweep/manifest.json`,{cache:cacheMode}),fetch('/flow/sweep-status.json',{cache:cacheMode})]);if(!r.ok)return;const m=await r.json(),queue=q.ok?await q.json():null;if(serial!==this.serial)return;const changed=m.completedUnique!==this.manifest?.completedUnique||queue?.state!==this.queue?.state;this.queue=queue;this.manifest=m;this.records=new Map(m.fields.map(a=>[a.key,a]));if(changed){this.revision++;this.onChange();}}catch{}finally{this.refreshing=false;}
 }
 selection(u,g,steer,drs,{drsEndpoints=false,inflowBlend=0}={}){
  if(!this.manifest?.complete&&performance.now()-this.lastRefresh>10000)this.refresh();
  if(!this.manifest)return null;
  const coefficients=new Map(),add=(key,v)=>coefficients.set(key,(coefficients.get(key)||0)+v);
  const axis=(name,value,factor=1)=>{const points=this.manifest.axes[name];let hi=points.findIndex(p=>p.value>=value-1e-8);if(hi<0)hi=points.length-1;const lo=Math.max(0,hi-1),a=points[lo],b=points[hi],t=b.value===a.value?0:Math.max(0,Math.min(1,(value-a.value)/(b.value-a.value)));add(a.key,(1-t)*factor);add(b.key,t*factor);};
  axis('air',u*3.6);axis('ground',g*3.6);add('base',-1);
  axis('steer',steer,u/50);add('base',-u/50);
  const scale=Math.min(1,(u+g)/50);
  let usesDrsFallback = false;
  if (drsEndpoints) {
   // As the tail wing animates, blend only its two solved endpoint fields.
   // Until the open field arrives, retain the air/ground/steer selection.
   const openKey = this.manifest.axes.drs.at(-1).key;
   const openWeight = Math.min(1, Math.max(0, drs)) * u / 50;
   if (openWeight * scale > 1e-8) {
    if (this.cache.has(openKey)) {
     add(openKey, openWeight);
     add('base', -openWeight);
    } else {
     usesDrsFallback = true;
     if (this.records.has(openKey)) this.request(openKey);
    }
   }
  } else {
   axis('drs',drs*100,u/50);add('base',-u/50);
  }
  const weights=Object.fromEntries([...coefficients].map(([k,v])=>[k,v*scale]).filter(([,v])=>Math.abs(v)>1e-8));
  if(Object.keys(weights).some(k=>!this.records.has(k)))return null;
  const missing=Object.keys(weights).filter(k=>!this.cache.has(k));
  for(const k of missing)this.request(k);
  if(missing.length)return {loading:true};
  const data=Object.fromEntries(Object.keys(weights).map(k=>[k,this.cache.get(k)]));
  const matchedWeights = inflowBlend > 0 && scale < 1
    ? matchUpstreamSpeed(weights, data, this.records.get('base')?.grid, u, inflowBlend, scale) : weights;
  for(const k of Object.keys(weights)){const v=this.cache.get(k);this.cache.delete(k);this.cache.set(k,v);}
  while(this.cache.size>48){const victim=[...this.cache.keys()].find(k=>k!=='base'&&!Object.hasOwn(weights,k));if(!victim)break;this.cache.delete(victim);}
  return {weights:matchedWeights,data,usesDrsFallback,exact:!usesDrsFallback&&Object.keys(matchedWeights).length===1&&Math.abs(Object.values(matchedWeights)[0]-1)<1e-7};
 }
 request(key){if(this.pending.has(key))return;const a=this.records.get(key),serial=this.serial;
  const p=(async()=>{try{const b=await cachedArrayBuffer(a.file);if(b.byteLength!==a.grid.shape.reduce((n,v)=>n*v,1)*6)throw Error('size');const raw=new Int16Array(b),field=new Float32Array(raw.length),s=a.scale;for(let i=0;i<raw.length;i++)field[i]=raw[i]*s;if(serial===this.serial){this.cache.set(key,field);this.revision++;this.onChange();}}catch{this.lastRefresh=0;}finally{if(serial===this.serial)this.pending.delete(key);}})();this.pending.set(key,p);
 }
}
