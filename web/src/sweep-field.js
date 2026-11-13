// Full slider-axis CFD, loaded lazily. Simultaneous changes are an additive
// surrogate around the 180 km/h, neutral, DRS-closed baseline.
export class SweepFields {
 constructor(onChange){this.onChange=onChange;this.serial=0;this.revision=0;this.cache=new Map();this.pending=new Map();this.lastRefresh=0;this.manifest=null;}
 async load(car,baseline){this.serial++;this.revision++;this.car=car;this.cache.clear();this.pending.clear();this.manifest=null;this.cache.set('base',baseline);await this.refresh();}
 async refresh(){if(!this.car||this.refreshing)return;this.refreshing=true;const serial=this.serial;this.lastRefresh=performance.now();
  try{const [r,q]=await Promise.all([fetch(`/flow/${this.car}/sweep/manifest.json`,{cache:'no-store'}),fetch('/flow/sweep-status.json',{cache:'no-store'})]);if(!r.ok)return;const m=await r.json(),queue=q.ok?await q.json():null;if(serial!==this.serial)return;const changed=m.completedUnique!==this.manifest?.completedUnique||queue?.state!==this.queue?.state;this.queue=queue;this.manifest=m;this.records=new Map(m.fields.map(a=>[a.key,a]));if(changed){this.revision++;this.onChange();}}catch{}finally{this.refreshing=false;}
 }
 selection(u,g,steer,drs){
  if(!this.manifest?.complete&&performance.now()-this.lastRefresh>10000)this.refresh();
  if(!this.manifest)return null;
  const coefficients=new Map(),add=(key,v)=>coefficients.set(key,(coefficients.get(key)||0)+v);
  const axis=(name,value,factor=1)=>{const points=this.manifest.axes[name];let hi=points.findIndex(p=>p.value>=value-1e-8);if(hi<0)hi=points.length-1;const lo=Math.max(0,hi-1),a=points[lo],b=points[hi],t=b.value===a.value?0:Math.max(0,Math.min(1,(value-a.value)/(b.value-a.value)));add(a.key,(1-t)*factor);add(b.key,t*factor);};
  axis('air',u*3.6);axis('ground',g*3.6);add('base',-1);
  axis('drs',drs*100,u/50);add('base',-u/50);axis('steer',steer,u/50);add('base',-u/50);
  const scale=Math.min(1,(u+g)/50),weights=Object.fromEntries([...coefficients].map(([k,v])=>[k,v*scale]).filter(([,v])=>Math.abs(v)>1e-8));
  if(Object.keys(weights).some(k=>!this.records.has(k)))return null;
  const missing=Object.keys(weights).filter(k=>!this.cache.has(k));
  for(const k of missing)this.request(k);
  if(missing.length)return {loading:true};
  const data=Object.fromEntries(Object.keys(weights).map(k=>[k,this.cache.get(k)]));
  for(const k of Object.keys(weights)){const v=this.cache.get(k);this.cache.delete(k);this.cache.set(k,v);}
  while(this.cache.size>16){const victim=[...this.cache.keys()].find(k=>k!=='base'&&!Object.hasOwn(weights,k));if(!victim)break;this.cache.delete(victim);}
  return {weights,data,exact:Object.keys(weights).length===1&&Math.abs(Object.values(weights)[0]-1)<1e-7};
 }
 request(key){if(this.pending.has(key))return;const a=this.records.get(key),serial=this.serial;
  const p=(async()=>{try{const r=await fetch(a.file);if(!r.ok)throw Error('missing');const b=await r.arrayBuffer();if(b.byteLength!==a.grid.shape.reduce((n,v)=>n*v,1)*6)throw Error('size');const raw=new Int16Array(b),field=Float32Array.from(raw,v=>v*a.scale);if(serial===this.serial){this.cache.set(key,field);this.revision++;this.onChange();}}catch{this.lastRefresh=0;}finally{if(serial===this.serial)this.pending.delete(key);}})();this.pending.set(key,p);
 }
}
