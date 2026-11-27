import * as T from 'three';

export function makeFlowMaterial() {
  return new T.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending,uniforms:{clock:{value:0},opacity:{value:0.62},brightness:{value:1}},vertexShader:`attribute vec3 color;attribute float flight;attribute float lineAlpha;varying vec3 tint;varying float travel;varying float fade;void main(){tint=color;travel=flight;fade=lineAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float clock,opacity,brightness;varying vec3 tint;varying float travel;varying float fade;void main(){float p=fract((clock-travel)*4.);float pulse=exp(-pow((p-.22)*8.,2.));gl_FragColor=vec4(tint*brightness,opacity*fade*(.35+.65*pulse));}`});
}

export class FlowLayer {
  constructor(parent, material, name) {
    this.group = new T.Group();
    this.group.name = name;
    this.group.visible = false;
    parent.add(this.group);
    this.geometry = new T.BufferGeometry();
    this.lines = new T.LineSegments(this.geometry, material);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
  }
}

const _invParent=new T.Matrix4(),_invQuat=new T.Quaternion(),_relMat=new T.Matrix4(),_box=new T.Box3(),_center=new T.Vector3(),_axis=new T.Vector3(),_rayHits=[];
export class TraceScratch {
 constructor(cap=131072){this.cap=cap;this.pos=new Float32Array(cap*3);this.col=new Float32Array(cap*3);this.flt=new Float32Array(cap);this.alp=new Float32Array(cap);this.len=0;}
 reset(){this.len=0;}
 ensure(verts){if(verts<=this.cap)return;let next=this.cap*2;while(next<verts)next*=2;const grow=(src,s)=>{const d=new Float32Array(next*s);d.set(src);return d;};this.pos=grow(this.pos,3);this.col=grow(this.col,3);this.flt=grow(this.flt,1);this.alp=grow(this.alp,1);this.cap=next;}
 pushSeg(ax,ay,az,bx,by,bz,r,g,b,t0,t1){const v=this.len,v2=v+2;if(v2>this.cap)this.ensure(v2);this.len=v2;const p=v*3;this.pos[p]=ax;this.pos[p+1]=ay;this.pos[p+2]=az;this.pos[p+3]=bx;this.pos[p+4]=by;this.pos[p+5]=bz;this.col[p]=r;this.col[p+1]=g;this.col[p+2]=b;this.col[p+3]=r;this.col[p+4]=g;this.col[p+5]=b;this.flt[v]=t0;this.flt[v+1]=t1;}
 commit(geometry){const n=this.len;geometry.dispose();const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.pos.slice(0,n*3),3));g.setAttribute('color',new T.Float32BufferAttribute(this.col.slice(0,n*3),3));g.setAttribute('flight',new T.Float32BufferAttribute(this.flt.slice(0,n),1));g.setAttribute('lineAlpha',new T.Float32BufferAttribute(this.alp.slice(0,n),1));return g;}
}

export class FlowSampler {
 constructor(parent){this.parent=parent;this.ray=new T.Raycaster();this.ray.firstHitOnly=true;this.colliders=new WeakMap();this.colliderMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});this._rayContext=null;}
 sampleRaw(x,y,z,out,grid=this.grid,requireValid=false,spec=this.spec){const {shape,min,max}=spec;const gx=(x-min[0])/(max[0]-min[0])*(shape[0]-1),gy=(y-min[1])/(max[1]-min[1])*(shape[1]-1),gz=(z-min[2])/(max[2]-min[2])*(shape[2]-1);
  if(gx<0||gy<0||gz<0||gx>=shape[0]-1||gy>=shape[1]-1||gz>=shape[2]-1){out.set(0,0,0);return false;}
  const ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz),fx=gx-ix,fy=gy-iy,fz=gz-iz,omx=1-fx,omy=1-fy,omz=1-fz;
  const sx=shape[0],sxy=sx*shape[1],i000=(iz*sxy+iy*sx+ix)*3,i100=i000+3,i010=i000+sx*3,i110=i010+3,sxy3=sxy*3,i001=i000+sxy3,i101=i100+sxy3,i011=i010+sxy3,i111=i110+sxy3;
  const w000=omx*omy*omz,w100=fx*omy*omz,w010=omx*fy*omz,w110=fx*fy*omz,w001=omx*omy*fz,w101=fx*omy*fz,w011=omx*fy*fz,w111=fx*fy*fz;
  if(requireValid){const valid = this.mask && grid === this.grid
    ? i => (this.mask[(i / 3) >> 3] & (1 << ((i / 3) & 7))) !== 0
    : i => grid[i] !== 0 || grid[i + 1] !== 0 || grid[i + 2] !== 0;
if((w000>1e-8&&!valid(i000))||(w100>1e-8&&!valid(i100))||(w010>1e-8&&!valid(i010))||(w110>1e-8&&!valid(i110))||(w001>1e-8&&!valid(i001))||(w101>1e-8&&!valid(i101))||(w011>1e-8&&!valid(i011))||(w111>1e-8&&!valid(i111))){out.set(0,0,0);return false;}}
  const a=grid[i000]*w000+grid[i100]*w100+grid[i010]*w010+grid[i110]*w110+grid[i001]*w001+grid[i101]*w101+grid[i011]*w011+grid[i111]*w111;
  const b=grid[i000+1]*w000+grid[i100+1]*w100+grid[i010+1]*w010+grid[i110+1]*w110+grid[i001+1]*w001+grid[i101+1]*w101+grid[i011+1]*w011+grid[i111+1]*w111;
  const c=grid[i000+2]*w000+grid[i100+2]*w100+grid[i010+2]*w010+grid[i110+2]*w110+grid[i001+2]*w001+grid[i101+2]*w101+grid[i011+2]*w011+grid[i111+2]*w111;
  out.set(a,b,c);return Number.isFinite(a+b+c);
 }
 sample(x,y,z,out,grid=this.grid,requireValid=false,spec=this.spec){if(!this.sampleRaw(x,y,z,out,grid,requireValid,spec))return false;
  // Convert solver X downstream, Y right, Z up to the display frame.
  out.set(-out.y,out.z,-out.x);return true;
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
}

export function wholeCarSeeds(parent,rig,U,density,windAngle){
  const hasParent=Boolean(parent);
  if(hasParent){_invParent.copy(parent.matrixWorld).invert();_invQuat.setFromRotationMatrix(_invParent);}
  const wheels=Object.entries(rig.wheels).map(([key,w])=>{const center=w.spinNode.getWorldPosition(new T.Vector3()),quat=w.spinNode.getWorldQuaternion(new T.Quaternion());if(hasParent){center.applyMatrix4(_invParent);quat.premultiply(_invQuat);}return {center,axis:new T.Vector3(1,0,0).applyQuaternion(quat),radius:w.radius,width:rig.config.id==='rb19'?(key.startsWith('R')?.47:.43):.45};});
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
  return {seeds,wheels};
}
