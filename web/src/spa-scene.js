import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import survey from './spa-data.json';
import { createSpaSurface } from './spa-surface.js';
const random=seed=>()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const asset='/environments/spa/';
const surface=createSpaSurface(survey);
export const spaCurve=surface.curve;
const length=spaCurve.getLength(),anchorT=(212-175)/(survey.road.length-1);
const sample=surface.sample;
export const spaHeight=surface.measuredHeight;
const textureLoader=new T.TextureLoader();
function photoTexture(id,role){const t=textureLoader.load(`${asset}${id}-${role}.jpg`);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;if(role==='diff')t.colorSpace=T.SRGBColorSpace;return t;}
function pbr(id,color='#ffffff',normal=.5){const m=new T.MeshStandardMaterial({map:photoTexture(id,'diff'),normalMap:photoTexture(id,'nor_gl'),normalScale:new T.Vector2(normal,normal),color,roughness:.92});return m;}
function roadPaint(road,color){const m=road.clone();m.color.set(color);m.vertexColors=false;m.roughness=.94;m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-1;m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',T.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;','diffuseColor *= vec4(mix(vec3(1.),sampledDiffuseColor.rgb,.22),sampledDiffuseColor.a);'));};m.customProgramCacheKey=()=> 'spa-weathered-paint-v1';return m;}
function solid(color,roughness=.8,metalness=0){return new T.MeshStandardMaterial({color,roughness,metalness});}
function box(root,w,h,d,p,material,rotation=0){const o=new T.Mesh(new T.BoxGeometry(w,h,d),material);o.position.copy(p);o.rotation.y=rotation;o.receiveShadow=true;o.castShadow=true;root.add(o);return o;}
function ribbon(root,from,to,material,options){const m=new T.Mesh(surface.ribbonGeometry(from,to,options),material);m.receiveShadow=true;root.add(m);return m;}
function terrain(root,material){const mesh=new T.Mesh(surface.terrainGeometry(),material);mesh.receiveShadow=true;root.add(mesh);}
function guardrail(root,sign,start=0,end=1,extra=5){const metal=solid('#969d9f',.44,.76),post=solid('#5e6668',.68,.65),positions=[],indices=[];let vertex=0;
 const n=Math.round((end-start)*length/2.5),extraAt=(s,t)=>typeof extra==='function'?extra(s,t):extra;
 for(let i=0;i<=n;i++){const t=T.MathUtils.lerp(start,end,i/n),s=sample(t),off=sign*(sign>0?s.leftWidth:s.rightWidth)+sign*extraAt(s,t),base=surface.point(s,off);
  if(i%2===0)box(root,.12,1.05,.12,base.clone().add(new T.Vector3(0,.47,0)),post);
  for(let rail=0;rail<3;rail++)for(const dy of [-.095,.095]){positions.push(base.x,base.y+.29+rail*.21+dy,base.z);}
  if(i<n)for(let rail=0;rail<3;rail++){const k=vertex+rail*2;indices.push(k,k+1,k+6,k+1,k+7,k+6);}vertex+=6;
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();metal.side=T.DoubleSide;root.add(new T.Mesh(g,metal));
 // Real posts and woven fence planes stand above the three metal beams.
 const fencePositions=[],fenceUv=[],fenceIndices=[];let run=0,previous;for(let i=0;i<=n;i++){const t=T.MathUtils.lerp(start,end,i/n),s=sample(t),off=sign*((sign>0?s.leftWidth:s.rightWidth)+extraAt(s,t)+.2),p=surface.point(s,off);if(previous)run+=previous.distanceTo(p);previous=p;fencePositions.push(p.x,p.y+1.05,p.z,p.x-sign*.35,p.y+3.6,p.z);fenceUv.push(run/.9,0,run/.9,2.55/.9);if(i<n){const k=i*2;fenceIndices.push(k,k+1,k+2,k+1,k+3,k+2);}if(i%2===0)box(root,.075,3.6,.075,p.clone().add(new T.Vector3(0,1.8,0)),post);}
 const fg=new T.BufferGeometry();fg.setAttribute('position',new T.Float32BufferAttribute(fencePositions,3));fg.setAttribute('uv',new T.Float32BufferAttribute(fenceUv,2));fg.setIndex(fenceIndices);fg.computeVertexNormals();const fm=new T.MeshStandardMaterial({map:fenceTexture(),color:'#4e6b56',roughness:.8,metalness:.35,transparent:true,depthWrite:false,side:T.DoubleSide});root.add(new T.Mesh(fg,fm));
}
// Diamond-woven debris fence. Mipmapped alpha keeps it a soft green veil at a
// distance and a readable mesh close to the car.
let meshCanvas;function fenceTexture(){if(!meshCanvas){meshCanvas=document.createElement('canvas');meshCanvas.width=meshCanvas.height=64;const c=meshCanvas.getContext('2d');c.strokeStyle='rgba(255,255,255,.95)';c.lineWidth=3;c.beginPath();c.moveTo(0,0);c.lineTo(64,64);c.moveTo(64,0);c.lineTo(0,64);c.stroke();c.fillStyle='rgba(255,255,255,.9)';c.fillRect(0,0,64,2);}const t=new T.CanvasTexture(meshCanvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;return t;}

function boardTexture(kind){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d');
 if(kind==='magenta'){
  c.fillStyle='#b52163';c.fillRect(0,0,256,64);
  c.fillStyle='#ffffff';c.fillRect(28,18,142,26);
  c.fillStyle='#b52163';c.fillRect(34,23,130,16);
  c.fillStyle='#ffffff';c.fillRect(40,26,92,10);
  c.fillStyle='#d8262c';c.fillRect(180,16,44,30);
  c.fillStyle='#ffffff';c.fillRect(188,22,28,18);
 }else if(kind==='yellow'){
  c.fillStyle='#ebd036';c.fillRect(0,0,256,64);
  c.fillStyle='#242629';c.fillRect(62,20,86,22);
  c.fillStyle='#ebd036';c.fillRect(68,24,48,14);
  c.fillStyle='#1f8a4c';c.fillRect(156,22,42,18);
 }else{
  c.fillStyle='#f3f4f1';c.fillRect(0,0,256,64);
  c.strokeStyle='#d6d8d2';c.lineWidth=3;c.strokeRect(2,2,252,60);
  c.strokeStyle='#d62828';c.lineWidth=6;c.beginPath();c.arc(124,26,16,Math.PI*.15,Math.PI*1.35);c.stroke();
  c.strokeStyle='#f29f05';c.lineWidth=4;c.beginPath();c.arc(132,28,12,Math.PI*1.1,Math.PI*2.1);c.stroke();
  c.fillStyle='#21579c';c.fillRect(72,46,112,7);
  c.fillStyle='#c8262b';c.fillRect(92,36,72,5);
 }
 const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;
}

// Energy-absorbing barrier modules in front of the outer guardrail, as on the
// 2023 reference photo: alternating red/yellow blocks, trackside sponsor boards
// on the lower climb, and CCTV masts behind the fence.
function barrierWall(root,sign,offset,start,end){const positions=[],colors=[],indices=[],c=new T.Color();let run=0,v=0;const n=Math.round((end-start)*length/1.6);
 for(let i=0;i<n;i++){
  const t0=T.MathUtils.lerp(start,end,i/n),t1=T.MathUtils.lerp(start,end,(i+1)/n),s0=sample(t0),s1=sample(t1);
  const e0=sign*((sign>0?s0.leftWidth:s0.rightWidth)+offset),e1=sign*((sign>0?s1.leftWidth:s1.rightWidth)+offset);
  const f0=surface.point(s0,e0),b0=surface.point(s0,e0+sign*.9),f1=surface.point(s1,e1),b1=surface.point(s1,e1+sign*.9);
  run+=f0.distanceTo(f1);
  c.set(Math.floor(run/3.2)%2===1?'#eab916':'#cc2420');
  for(const [f,b] of [[f0,b0],[f1,b1]])for(const [p,y] of [[f,-.2],[f,1.08],[b,1.08],[b,-.2]]){
   positions.push(p.x,p.y+y,p.z);colors.push(c.r,c.g,c.b);
  }
  for(let face=0;face<3;face++){const k=v+face;indices.push(k,k+4,k+1,k+1,k+4,k+5);}
  v+=8;
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();const m=solid('#ffffff',.75);m.vertexColors=true;m.side=T.DoubleSide;const mesh=new T.Mesh(g,m);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
 const frameMat=solid('#f2f2ef',.68),poleMat=solid('#adb4b8',.45,.65),masts=[0.365,0.428,0.495];
 const magMat=new T.MeshStandardMaterial({map:boardTexture('magenta'),roughness:.58}),yelMat=new T.MeshStandardMaterial({map:boardTexture('yellow'),roughness:.58});
 [0.388,0.412,0.436,0.46].forEach((t,idx)=>{const s=sample(t),edge=sign*((sign>0?s.leftWidth:s.rightWidth)+offset+1.15),p=surface.point(s,edge);const yaw=Math.atan2(-s.v.z,s.v.x);box(root,7.2,1.55,.09,p.clone().add(new T.Vector3(0,1.85,0)),frameMat,yaw);box(root,6.8,1.26,.12,p.clone().add(new T.Vector3(0,1.85,0)),idx%2===0?magMat:yelMat,yaw);});
 masts.forEach(t=>{const s=sample(t),edge=sign*((sign>0?s.leftWidth:s.rightWidth)+offset+2.6),p=surface.point(s,edge);box(root,.14,6.4,.14,p.clone().add(new T.Vector3(0,3.2,0)),poleMat);box(root,1.1,.12,.18,p.clone().add(new T.Vector3(0,6.35,0)),frameMat);});
}
function carContact(root){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const c=canvas.getContext('2d');for(const [x,z,rx,rz,alpha] of [[0,0,.75,2,.23],[-.84,1.8,.26,.42,.7],[.84,1.8,.26,.42,.7],[-.84,-1.75,.3,.44,.7],[.84,-1.75,.3,.44,.7]]){c.save();c.translate((x+2)/4*128,(z+3.5)/7*256);c.scale(rx/4*128,rz/7*256);const gradient=c.createRadialGradient(0,0,0,0,0,1);gradient.addColorStop(0,`rgba(0,0,0,${alpha})`);gradient.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=gradient;c.fillRect(-1,-1,2,2);c.restore();}const map=new T.CanvasTexture(canvas),g=new T.PlaneGeometry(4,7,8,28);g.rotateX(-Math.PI/2);const a=g.attributes.position;for(let i=0;i<a.count;i++){const z=a.getZ(i),t=T.MathUtils.clamp(anchorT+z/(survey.road.length-1)/5,0,1);a.setY(i,spaCurve.getPoint(t).y+.003);}g.computeVertexNormals();const m=new T.Mesh(g,new T.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));m.renderOrder=2;root.add(m);}
function grandstand(root){const g=new T.Group();g.name='RAIDILLON_GRANDSTAND_2022';const s=sample(.54),aim=sample(.50),p=s.p.clone().addScaledVector(s.left,30);p.y=s.p.y+.6;g.position.copy(p);const fwd=new T.Vector3(aim.v.x,s.v.y,aim.v.z).normalize(),left=new T.Vector3(fwd.z,0,-fwd.x).normalize();g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(left,new T.Vector3().crossVectors(fwd,left).normalize(),fwd));root.add(g);
 const darkBase=solid('#1f2327',.82,.18),concrete=solid('#c8cbc6',.86),trim=solid('#e2e4df',.72),slabBand=solid('#aeb3b5',.74),roofTop=solid('#dce1e3',.46,.42),roofUnder=solid('#8b9398',.64,.32),steel=solid('#394147',.50,.68),lightSteel=solid('#b8c0c4',.48,.58),white=solid('#f0f1ef',.55,.08),seat=solid('#d8dcdd',.72),aisle=solid('#3c4246',.85),glass=solid('#15222b',.12,.52),red=solid('#c8262b',.68),shaleRock=solid('#846a48',.94,.04),retaining=solid('#9e9b90',.9);
 const bannerMat=new T.MeshStandardMaterial({map:boardTexture('podium'),roughness:.55});
 // Built for 2022 on the outside of Raidillon: a dark anthracite hospitality
 // podium with panoramic VIP glazing and white sponsor banners, an open-sided
 // raked seating bowl (~4,400 seats), and a cantilevered steel roof canopy.
 const L=112;box(g,19.5,11,L,new T.Vector3(7.6,1.1,0),darkBase);
 // Exposed Ardennes shale/rock cut bank & retaining wall along the foot of the podium
 // (visible beneath and to the right of the 3 white TotalEnergies banners in the 2023 photo)
 for(let i=0;i<16;i++){
  const z=-14+i*4.2,h=1.6+.55*Math.sin(i*1.9)+.35*Math.cos(i*.7);
  box(g,2.2,h,4.4,new T.Vector3(-3.1,.85+h*.35,z),shaleRock);
 }
 box(g,.45,1.2,68,new T.Vector3(-4.0,.55,18),retaining);
 box(g,.48,1.15,.95,new T.Vector3(-4.25,1.45,4),red);

 // Second-tier hospitality/press box tucked under the upper raked seating bowl.
 box(g,10.5,3.2,L-1,new T.Vector3(12,8.1,0),darkBase);
 box(g,9.6,2.1,.16,new T.Vector3(11.8,8.2,-L/2-.06),glass);
 box(g,11.2,.28,.24,new T.Vector3(11.8,9.4,-L/2-.08),slabBand);
 box(g,11.2,.28,.24,new T.Vector3(11.8,6.9,-L/2-.08),slabBand);
 // Panoramic VIP box glazing along the front and wrapping the downhill side.
 box(g,.14,2.3,L-3,new T.Vector3(-2.18,4.85,0),glass);
 box(g,.24,.32,L-1,new T.Vector3(-2.2,6.12,0),slabBand);
 box(g,.24,.28,L-1,new T.Vector3(-2.2,3.58,0),slabBand);
 box(g,14.5,2.3,.16,new T.Vector3(5.2,4.85,-L/2-.06),glass);
 box(g,15.2,.32,.24,new T.Vector3(5.2,6.12,-L/2-.08),slabBand);
 box(g,15.2,.28,.24,new T.Vector3(5.2,3.58,-L/2-.08),slabBand);
 for(let z=-L/2+1.5;z<=L/2-1.5;z+=3.5)box(g,.2,5.6,.12,new T.Vector3(-2.22,3.6,z),steel);
 for(let x=-1.5;x<=12;x+=2.7)box(g,.12,5.4,.22,new T.Vector3(x,4.8,-L/2-.08),steel);
 // Rear-left external steel access stair tower visible on the downhill end
 box(g,3.2,14.5,3.4,new T.Vector3(16.2,5.2,-L/2-1.8),steel);
 for(let y=0;y<=12;y+=3)box(g,3.4,.28,3.6,new T.Vector3(16.2,y,-L/2-1.8),slabBand);

 // White trackside banner panels (e.g. TotalEnergies in 2023 reference) on
 // the lower front wall of the podium.
 for(let i=0;i<3;i++){const z=-L/2+11+i*13.5;box(g,.18,2.65,12.4,new T.Vector3(-2.22,1.85,z),white);box(g,.22,2.45,11.8,new T.Vector3(-2.26,1.85,z),bannerMat);}
 // Lower forward seating tier on the uphill half of the podium (to the right of banners)
 for(let row=0;row<5;row++){
  const x=-3.6+row*.42,y=3.6+row*.52;
  box(g,.52,.55,58,new T.Vector3(x,y,24),concrete);
 }
 // Raked concrete seating bowl; the sides above the stepped stringer stay open
 // under the canopy just like the real structure.
 const rows=22,run=.82,rise=.45;
 for(let row=0;row<rows;row++){const x=-1.5+row*run,y=6.8+row*rise;box(g,run+.08,rise+.22,L,new T.Vector3(x,y,0),concrete);for(const z of [-L/2+.35,L/2-.35])box(g,run+.42,1.45,.62,new T.Vector3(x,y-.3,z),trim);}
 // Vomitory entrance portals cut into the mid-tier seating bowl
 for(let z=-38;z<=42;z+=20)box(g,1.8,1.35,2.4,new T.Vector3(3.2,9.4,z),aisle);
 // Continuous diagonal raked fascia beam along the exposed ends of the bowl.
 const rakeLen=Math.hypot(rows*run,rows*rise)+1.2,rakeAngle=Math.atan2(rows*rise,rows*run);
 for(const z of [-L/2-.18,L/2+.18]){const b=box(g,rakeLen,1.22,.32,new T.Vector3(-1.5+(rows-1)*run/2,6.45+(rows-1)*rise/2,z),trim);b.rotation.z=rakeAngle;}
 box(g,.08,1.05,L,new T.Vector3(-1.95,7.35,0),steel);
 const count=rows*200,seatBase=new T.InstancedMesh(new T.BoxGeometry(.46,.08,.44),seat,count),seatBack=new T.InstancedMesh(new T.BoxGeometry(.06,.42,.44),seat,count),dummy=new T.Object3D();let si=0;
 for(let row=0;row<rows;row++)for(let j=0;j<200;j++){if(j%25===12)continue;dummy.position.set(-1.62+row*run,6.8+row*rise+.32,-54.7+j*.55);dummy.updateMatrix();seatBase.setMatrixAt(si,dummy.matrix);dummy.position.x+=.22;dummy.position.y+=.23;dummy.updateMatrix();seatBack.setMatrixAt(si++,dummy.matrix);}
 seatBase.count=seatBack.count=si;seatBase.castShadow=seatBack.castShadow=true;g.add(seatBase,seatBack);g.userData.seats=si;
 for(let j=12;j<200;j+=25)for(let row=0;row<rows;row++)box(g,run+.04,.06,.56,new T.Vector3(-1.5+row*run,6.8+row*rise+.14,-54.7+j*.55),aisle);
 const top=6.8+rows*rise;
 // Low rear parapet at the top concourse only; upper rear stays open between
 // the steel columns so trees and sky show through behind the bowl.
 box(g,.32,1.6,L,new T.Vector3(17.2,top+.6,0),trim);
 const roof=new T.Group();roof.position.set(6.8,top+4.8,0);roof.rotation.z=-.055;g.add(roof);
 box(roof,26,.18,L+4,new T.Vector3(0,.14,0),roofTop);box(roof,26,.12,L+4,new T.Vector3(0,-.04,0),roofUnder);box(roof,.48,1.18,L+4.2,new T.Vector3(-13,.06,0),white);
 for(const z of [-L/2-1.9,L/2+1.9])box(roof,26,.95,.36,new T.Vector3(0,-.25,z),white);
 for(let z=-L/2;z<=L/2;z+=11.2){box(roof,25.6,.86,.32,new T.Vector3(0,-.54,z),lightSteel);box(g,.52,top+8.4,.52,new T.Vector3(17.8,(top+4.8)/2-1,z),steel);box(g,.32,top+4.4,.32,new T.Vector3(9.2,(top+4.8)/2+1,z),steel);box(g,.2,9,.2,new T.Vector3(14.4,top+.5,z),steel).rotation.z=.58;}
 for(const z of [-L/2+.4,L/2-.4]){box(g,.38,top+6,.38,new T.Vector3(-1.6,(top+6)/2+1,z),steel);box(g,.24,12.8,.24,new T.Vector3(3.2,top-1.1,z),steel).rotation.z=-.48;}
 for(let z=-L/2-1.5;z<=L/2+1.5;z+=2.8)box(roof,25.2,.22,.1,new T.Vector3(0,-.2,z),lightSteel);
 for(const x of [-9.5,-3.2,3.2,9.5])box(roof,.18,.32,L+3.6,new T.Vector3(x,-.28,0),lightSteel);
}
// Crossed branch cards occupy the original 3D needle canopy. They are baked
// from actual source triangles, not whole-tree camera-facing billboards.
function branchGeometry(centres,level){const pos=[],uv=[],idx=[],r=random(level==='near'?610:197);for(const centre of centres){const angle=r()*Math.PI,tile=Math.floor(r()*3),size=level==='near'?2.2:2.8;for(let side=0;side<2;side++){const a=angle+side*Math.PI/2,dx=Math.cos(a)*size/2,dz=Math.sin(a)*size/2,k=pos.length/3;for(const [x,y,z] of [[-dx,-size/2,-dz],[dx,-size/2,dz],[-dx,size/2,-dz],[dx,size/2,dz]])pos.push(centre[0]+x,centre[1]+y,centre[2]+z);uv.push(tile/3,0,(tile+1)/3,0,tile/3,1,(tile+1)/3,1);idx.push(k,k+1,k+2,k+1,k+3,k+2);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}
// Conical spruce LOD assembled from the same baked needle-branch renders:
// sixty branch groups stacked from 1.4m to the leader, narrowing upward.
function spruceGeometry(centres){const r=random(4721),pick=centres.map(c=>[r(),c]).sort((a,b)=>a[0]-b[0]).slice(0,60).map(e=>e[1]).sort((a,b)=>a[1]-b[1]),pos=[],uv=[],idx=[];
 const card=(cx,cy,cz,size,angle,tile)=>{for(let side=0;side<2;side++){const a=angle+side*Math.PI/2,dx=Math.cos(a)*size/2,dz=Math.sin(a)*size/2,k=pos.length/3;for(const [x,y,z] of [[-dx,-size/2,-dz],[dx,-size/2,dz],[-dx,size/2,-dz],[dx,size/2,dz]])pos.push(cx+x,cy+y,cz+z);uv.push(tile/3,0,(tile+1)/3,0,tile/3,1,(tile+1)/3,1);idx.push(k,k+1,k+2,k+1,k+3,k+2);}};
 pick.forEach((c,i)=>{const h=(i+r())/pick.length,radius=3.1*Math.pow(1-h,.95)*(.55+.45*r()),a0=Math.atan2(c[2],c[0])+r()*.6;card(Math.cos(a0)*radius,1.4+h*17.4,Math.sin(a0)*radius,3.6*(1-.5*h)+.5,r()*Math.PI,Math.floor(r()*3));});
 card(0,19.3,0,1.8,r()*Math.PI,0);const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}
function loadForest(root){const r=random(93041),placements=[];for(let i=0;i<(innerWidth<620?650:950);i++){const z=-100+r()*670,x=(r()<.5?-1:1)*(35+r()*170);if(surface.forestClearing(x,z)>.05)continue;const y=surface.groundHeight(x,z);placements.push({x,y,z,h:17+r()*10,angle:r()*Math.PI*2});}
 // Spa's hills are mostly planted Norway spruce: a dense, dark wall with
 // foliage almost to the ground, framing the left hillside behind the catch
 // fence and rising directly behind the 2022 Raidillon grandstand roof.
 const spruce=[],rs=random(51277);
 for(let i=0;i<(innerWidth<620?2400:4800);i++){const x=-236+rs()*472,z=-146+rs()*792;if(Math.hypot(x,z)<68||surface.forestClearing(x,z)>.05)continue;spruce.push({x,y:surface.groundHeight(x,z),z,h:18+rs()*11,angle:rs()*Math.PI*2});}
 // Dense trackside spruce curtain on the left hillside and behind the grandstand.
 for(let i=0;i<(innerWidth<620?450:900);i++){const t=.22+rs()*.52,s=sample(t),minOff=t>.34&&t<.46?43:(t>=.46&&t<.66?54:23.5),off=minOff+rs()*58,p=s.p.clone().addScaledVector(s.left,off).addScaledVector(s.v,(rs()-.5)*14);if(surface.forestClearing(p.x,p.z)>.05)continue;spruce.push({x:p.x,y:surface.groundHeight(p.x,p.z),z:p.z,h:20+rs()*11,angle:rs()*Math.PI*2});}
 Promise.all([new GLTFLoader().loadAsync(asset+'mature-pine-lods.glb'),fetch(asset+'pine-branch-centres.json').then(r=>{if(!r.ok)throw Error('Pine canopy failed');return r.json();}),textureLoader.loadAsync(asset+'pine-branches.webp')]).then(([gltf,centres,map])=>{if(root.userData.disposed){map.dispose();gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}gltf.scene.updateMatrixWorld(true);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;let triangles=0,batches=0;const height=20.29,foliage=new T.MeshStandardMaterial({map,alphaTest:.35,side:T.DoubleSide,roughness:1,color:'#98b086',envMapIntensity:.55}),spruceFoliage=foliage.clone();spruceFoliage.color.set('#6a825d');
  const owner=gltf.scene.getObjectByName('near_mature_bark'),sources=[];owner.traverse(o=>{if(o.isMesh)sources.push(o);});
  for(const level of ['near','far','spruce']){const cells=new Map();for(const p of level==='spruce'?spruce:placements){if(level!=='spruce'&&(Math.hypot(p.x,p.z)<90)!==(level==='near'))continue;const k=`${Math.floor(p.x/90)}:${Math.floor(p.z/90)}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(p);}
   const pieces=[level==='spruce'?{geometry:spruceGeometry(centres.far),material:spruceFoliage}:{geometry:branchGeometry(centres[level],level),material:foliage}];
   if(level==='near')for(const source of sources){const geometry=source.geometry.clone();geometry.applyMatrix4(source.matrixWorld);const material=source.material.clone();material.roughness=1;material.envMapIntensity=.45;pieces.push({geometry,material});}
   else if(level==='far'){const geometry=new T.CylinderGeometry(.055,.22,19,5,1);geometry.translate(0,9.5,0);pieces.push({geometry,material:sources[0].material.clone()});}
   for(const {geometry,material} of pieces)for(const subset of cells.values()){const mesh=new T.InstancedMesh(geometry,material,subset.length),dummy=new T.Object3D();for(let i=0;i<subset.length;i++){const p=subset[i],scale=p.h/height;dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.angle,0);dummy.scale.set(scale*(.92+.12*Math.sin(p.angle)),scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.castShadow=level==='near';root.add(mesh);triangles+=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*subset.length;batches++;}
  }root.userData.forestReady=true;root.userData.forestTriangles=triangles;root.userData.treeCount=placements.length+spruce.length;root.userData.spruceCount=spruce.length;root.userData.forestBatches=batches;
 }).catch(error=>{root.userData.forestError=error.message;});
}
export function createSpaScene(){const root=new T.Group();root.name='SPA_EAU_ROUGE_LIDAR';root.userData.keepMeshes=false;root.userData.metadata={units:'metres',roadSource:survey.source.plan,elevationSource:survey.source.elevation,roadWidthAtCar:survey.road[212-175][3]+survey.road[212-175][4],registrationMedianM:survey.source.registrationMedianM,roadStations:survey.road.length,terrainSamples:survey.terrain.heights.length};
 const grass=pbr('leafy_grass','#ffffff',.5);grass.vertexColors=true;terrain(root,grass);
 const road=pbr('asphalt_02','#63696e',.45);road.vertexColors=true;
 const baseCol=new T.Color('#ffffff'),rubberCol=new T.Color('#c8cdd1'),edgeCol=new T.Color('#eef0f2'),tmpCol=new T.Color();
 ribbon(root,s=>-s.rightWidth,s=>s.leftWidth,road,{uvScale:3,colorFn:(s,offset,distance)=>{
  // Racing line sweeps from left kerb at Eau Rouge bottom (t~0.25) to right apex at Raidillon (t~0.44) and back left at crest (t~0.65)
  const wL=s.leftWidth,wR=s.rightWidth;
  const toRight=T.MathUtils.smoothstep(s.t,.24,.40)*(1-T.MathUtils.smoothstep(s.t,.50,.64));
  const raceOffset=T.MathUtils.lerp(wL*.52,-wR*.58,toRight);
  const dLine=Math.abs(offset-raceOffset);
  const rubber=Math.exp(-(dLine*dLine)/3.4)*(.88+.12*Math.sin(distance*.15));
  const seam=Math.exp(-Math.pow(Math.abs(offset)-.15,2)/.04)*.06;
  tmpCol.copy(edgeCol).lerp(baseCol,T.MathUtils.smoothstep(Math.min(wL-offset,offset+wR),.2,1.4));
  tmpCol.lerp(rubberCol,rubber+seam);
  return '#'+tmpCol.getHexString();
 }});
 const white=solid('#eae8dc',.82);ribbon(root,s=>s.leftWidth-.13,s=>s.leftWidth+.02,white,{lift:.012});ribbon(root,s=>-s.rightWidth-.02,s=>-s.rightWidth+.13,white,{lift:.012});
 const curb=solid('#ffffff',.86);curb.vertexColors=true;for(const sign of [-1,1])ribbon(root,s=>sign*(sign>0?s.leftWidth:s.rightWidth),s=>sign*((sign>0?s.leftWidth:s.rightWidth)+1.05),curb,{lift:.04,start:.22,end:.76,curb:true});
 // Concrete slotted drainage gutter along the right-hand valley edge (as in reference-bottom-older.jpg)
 const gutter=solid('#bab6aa',.88);ribbon(root,s=>-s.rightWidth-.48,s=>-s.rightWidth-.04,gutter,{lift:.008,start:.08,end:.25});
 // Foreground bottom-left exit double-kerb and separate crisp green astro-turf verge apron
 ribbon(root,s=>s.leftWidth+1.05,s=>s.leftWidth+2.45,curb,{lift:.026,start:.22,end:.295,curb:true});
 const astroTurf=solid('#127e3d',.9);ribbon(root,s=>s.leftWidth+2.45,s=>s.leftWidth+3.35,astroTurf,{lift:.02,start:.22,end:.295});
 // The post-2022 widened outer runoff is on the left when climbing from the valley.
 const runoff=roadPaint(road,'#32363a');runoff.polygonOffset=false;ribbon(root,s=>s.leftWidth+1,s=>s.leftWidth+14.2,runoff,{lift:0,start:.27,end:.69});
 for(const [a,b,col] of [[1.55,2.95,'#cf2c26'],[2.95,3.18,'#eceae2'],[4.45,4.68,'#eceae2'],[4.68,6.15,'#de5248'],[6.15,7.55,'#c92824'],[7.55,9.05,'#eceae2'],[10.65,12.85,'#ebb918'],[12.85,13.12,'#eceae2']])ribbon(root,s=>s.leftWidth+a,s=>s.leftWidth+b,roadPaint(road,col),{lift:.005,start:.28,end:.68});
 // The narrow legacy access lane diverges smoothly from the right edge at the
 // bottom of Eau Rouge and frames the mown inner grass wedge.
 const laneSplit=t=>T.MathUtils.smoothstep(t,.13,.27)*(1-T.MathUtils.smoothstep(t,.65,.74));
 const wedgeGrass=grass.clone();wedgeGrass.polygonOffset=true;wedgeGrass.polygonOffsetFactor=-1;wedgeGrass.polygonOffsetUnits=-1;
 ribbon(root,s=>-s.rightWidth-.15-7.75*laneSplit(s.t),s=>-s.rightWidth-.12,wedgeGrass,{lift:.004,start:.23,end:.69,colorFn:(s,offset)=>Math.floor(Math.abs(offset+s.rightWidth)/1.15)%2?'#88bf4e':'#6ca138'});
 const laneRoad=pbr('asphalt_02','#7e8488',.38);laneRoad.vertexColors=false;
 ribbon(root,s=>-s.rightWidth-3.6-8.4*laneSplit(s.t),s=>-s.rightWidth-8*laneSplit(s.t),laneRoad,{lift:0,start:.13,end:.74,uvScale:3});
 ribbon(root,s=>-s.rightWidth-8*laneSplit(s.t)-.18,s=>-s.rightWidth-8*laneSplit(s.t)-.03,white,{lift:.012,start:.14,end:.73});
 ribbon(root,s=>-s.rightWidth-3.6-8.4*laneSplit(s.t)+.03,s=>-s.rightWidth-3.6-8.4*laneSplit(s.t)+.18,white,{lift:.012,start:.14,end:.73});
 guardrail(root,1,.04,.85,17);guardrail(root,-1,.02,.9,(s,t)=>4.8+8.6*laneSplit(t));barrierWall(root,1,15.6,.26,.72);grandstand(root);carContact(root);loadForest(root);root.userData.dispose=()=>{root.userData.disposed=true;};return root;
}
