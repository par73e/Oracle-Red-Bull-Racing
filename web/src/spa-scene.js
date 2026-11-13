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
function roadPaint(road,color){const m=road.clone();m.color.set(color);m.roughness=.96;m.polygonOffset=true;m.polygonOffsetFactor=-1;m.polygonOffsetUnits=-1;m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',T.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;','diffuseColor *= vec4(mix(vec3(1.),sampledDiffuseColor.rgb,.22),sampledDiffuseColor.a);'));};m.customProgramCacheKey=()=> 'spa-weathered-paint-v1';return m;}
function solid(color,roughness=.8,metalness=0){return new T.MeshStandardMaterial({color,roughness,metalness});}
function box(root,w,h,d,p,material,rotation=0){const o=new T.Mesh(new T.BoxGeometry(w,h,d),material);o.position.copy(p);o.rotation.y=rotation;o.receiveShadow=true;o.castShadow=true;root.add(o);return o;}
function ribbon(root,from,to,material,options){const m=new T.Mesh(surface.ribbonGeometry(from,to,options),material);m.receiveShadow=true;root.add(m);return m;}
function terrain(root,material){const mesh=new T.Mesh(surface.terrainGeometry(),material);mesh.receiveShadow=true;root.add(mesh);}
function guardrail(root,sign,start=0,end=1,extra=5){const metal=solid('#9ca2a2',.48,.72),post=solid('#737b7c',.7,.65),positions=[],indices=[];let vertex=0;
 const n=Math.round((end-start)*length/2.5);
 for(let i=0;i<=n;i++){const t=T.MathUtils.lerp(start,end,i/n),s=sample(t),off=sign*(sign>0?s.leftWidth:s.rightWidth)+sign*extra,base=surface.point(s,off);
  if(i%2===0)box(root,.12,1.05,.12,base.clone().add(new T.Vector3(0,.47,0)),post);
  for(let rail=0;rail<3;rail++)for(const dy of [-.095,.095]){positions.push(base.x,base.y+.29+rail*.21+dy,base.z);}
  if(i<n)for(let rail=0;rail<3;rail++){const k=vertex+rail*2;indices.push(k,k+1,k+6,k+1,k+7,k+6);}vertex+=6;
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();metal.side=T.DoubleSide;root.add(new T.Mesh(g,metal));
 // Real posts and woven fence planes stand above the three metal beams.
 const fencePositions=[],fenceIndices=[];for(let i=0;i<=n;i++){const s=sample(T.MathUtils.lerp(start,end,i/n)),off=sign*((sign>0?s.leftWidth:s.rightWidth)+extra+.2),p=surface.point(s,off);fencePositions.push(p.x,p.y+1.05,p.z,p.x-sign*.35,p.y+3.2,p.z);if(i<n){const k=i*2;fenceIndices.push(k,k+1,k+2,k+1,k+3,k+2);}if(i%3===0)box(root,.065,3.2,.065,p.clone().add(new T.Vector3(0,1.6,0)),post);}
 const fg=new T.BufferGeometry();fg.setAttribute('position',new T.Float32BufferAttribute(fencePositions,3));fg.setIndex(fenceIndices);fg.computeVertexNormals();const fm=solid('#5b6467',.9,.3);fm.transparent=true;fm.opacity=.17;fm.depthWrite=false;fm.side=T.DoubleSide;root.add(new T.Mesh(fg,fm));
}
function carContact(root){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const c=canvas.getContext('2d');for(const [x,z,rx,rz,alpha] of [[0,0,.75,2,.23],[-.84,1.8,.26,.42,.7],[.84,1.8,.26,.42,.7],[-.84,-1.75,.3,.44,.7],[.84,-1.75,.3,.44,.7]]){c.save();c.translate((x+2)/4*128,(z+3.5)/7*256);c.scale(rx/4*128,rz/7*256);const gradient=c.createRadialGradient(0,0,0,0,0,1);gradient.addColorStop(0,`rgba(0,0,0,${alpha})`);gradient.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=gradient;c.fillRect(-1,-1,2,2);c.restore();}const map=new T.CanvasTexture(canvas),g=new T.PlaneGeometry(4,7,8,28);g.rotateX(-Math.PI/2);const a=g.attributes.position;for(let i=0;i<a.count;i++){const z=a.getZ(i),t=T.MathUtils.clamp(anchorT+z/(survey.road.length-1)/5,0,1);a.setY(i,spaCurve.getPoint(t).y+.003);}g.computeVertexNormals();const m=new T.Mesh(g,new T.MeshBasicMaterial({map,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));m.renderOrder=2;root.add(m);}
function grandstand(root){const g=new T.Group();g.name='RAIDILLON_GOLD_3';const s=sample(.57),p=s.p.clone().addScaledVector(s.left,39);p.y=s.p.y+1;g.position.copy(p);g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(s.left,new T.Vector3().crossVectors(s.v,s.left).normalize(),s.v));root.add(g);
 const concrete=solid('#a8a9a4',.93),roof=solid('#9eaaa9',.62,.35),steel=solid('#626d71',.55,.65),seat=solid('#a1a4a0',.88),glass=solid('#45545b',.18,.25);
 // The long axis follows the hill. Rows rise away from the circuit and the
 // cantilevered canopy has thickness, ribs, columns and rear glazing.
 for(let row=0;row<15;row++){box(g,.95,.5,110,new T.Vector3(row*.82,row*.47,0),concrete);}
 const seatBase=new T.InstancedMesh(new T.BoxGeometry(.5,.08,.44),seat,3000),seatBack=new T.InstancedMesh(new T.BoxGeometry(.06,.42,.44),seat,3000),dummy=new T.Object3D();let si=0;for(let row=0;row<15;row++)for(let j=0;j<200;j++){dummy.position.set(row*.82-.15,row*.47+.31,-54.7+j*.55);dummy.updateMatrix();seatBase.setMatrixAt(si,dummy.matrix);dummy.position.x+=.22;dummy.position.y+=.23;dummy.updateMatrix();seatBack.setMatrixAt(si++,dummy.matrix);}g.add(seatBase,seatBack);
 box(g,16,4,112,new T.Vector3(5,-2.2,0),concrete);box(g,.16,2,109,new T.Vector3(-3.2,1.6,0),glass);
 for(let z=-54;z<=54;z+=12){box(g,.24,12,.24,new T.Vector3(13,3,z),steel);box(g,21,.24,.22,new T.Vector3(5,9.1,z),steel);}
 const canopy=box(g,25,.22,120,new T.Vector3(4.8,9.5,0),roof);canopy.rotation.z=-.06;
 for(let z=-57;z<=57;z+=3)box(g,24,.07,.06,new T.Vector3(4.8,9.68,z),steel);
}
// Crossed branch cards occupy the original 3D needle canopy. They are baked
// from actual source triangles, not whole-tree camera-facing billboards.
function branchGeometry(centres,level){const pos=[],uv=[],idx=[],r=random(level==='near'?610:197);for(const centre of centres){const angle=r()*Math.PI,tile=Math.floor(r()*3),size=level==='near'?2.2:2.8;for(let side=0;side<2;side++){const a=angle+side*Math.PI/2,dx=Math.cos(a)*size/2,dz=Math.sin(a)*size/2,k=pos.length/3;for(const [x,y,z] of [[-dx,-size/2,-dz],[dx,-size/2,dz],[-dx,size/2,-dz],[dx,size/2,dz]])pos.push(centre[0]+x,centre[1]+y,centre[2]+z);uv.push(tile/3,0,(tile+1)/3,0,tile/3,1,(tile+1)/3,1);idx.push(k,k+1,k+2,k+1,k+3,k+2);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;}
function loadForest(root){const r=random(93041),placements=[];for(let i=0;i<(innerWidth<620?650:950);i++){const z=-100+r()*670,x=(r()<.5?-1:1)*(35+r()*170),y=surface.groundHeight(x,z);let distance=Infinity;for(const p of survey.road)distance=Math.min(distance,Math.hypot(x-p[0],z-p[2]));if(distance<23||x>15&&x<90&&z>50&&z<260)continue;placements.push({x,y,z,h:17+r()*10,angle:r()*Math.PI*2});}
 Promise.all([new GLTFLoader().loadAsync(asset+'mature-pine-lods.glb'),fetch(asset+'pine-branch-centres.json').then(r=>{if(!r.ok)throw Error('Pine canopy failed');return r.json();}),textureLoader.loadAsync(asset+'pine-branches.webp')]).then(([gltf,centres,map])=>{if(root.userData.disposed){map.dispose();gltf.scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}gltf.scene.updateMatrixWorld(true);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;let triangles=0,batches=0;const height=20.29,foliage=new T.MeshStandardMaterial({map,alphaTest:.35,side:T.DoubleSide,roughness:1,color:'#b6c5a5',envMapIntensity:.6});
  const owner=gltf.scene.getObjectByName('near_mature_bark'),sources=[];owner.traverse(o=>{if(o.isMesh)sources.push(o);});
  for(const level of ['near','far']){const cells=new Map();for(const p of placements){if((Math.hypot(p.x,p.z)<90)!==(level==='near'))continue;const k=`${Math.floor(p.x/90)}:${Math.floor(p.z/90)}`;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(p);}
   const pieces=[{geometry:branchGeometry(centres[level],level),material:foliage}];
   if(level==='near')for(const source of sources){const geometry=source.geometry.clone();geometry.applyMatrix4(source.matrixWorld);const material=source.material.clone();material.roughness=1;material.envMapIntensity=.45;pieces.push({geometry,material});}
   else {const geometry=new T.CylinderGeometry(.055,.22,19,5,1);geometry.translate(0,9.5,0);pieces.push({geometry,material:sources[0].material.clone()});}
   for(const {geometry,material} of pieces)for(const subset of cells.values()){const mesh=new T.InstancedMesh(geometry,material,subset.length),dummy=new T.Object3D();for(let i=0;i<subset.length;i++){const p=subset[i],scale=p.h/height;dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.angle,0);dummy.scale.set(scale*(.92+.12*Math.sin(p.angle)),scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.castShadow=level==='near';root.add(mesh);triangles+=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*subset.length;batches++;}
  }root.userData.forestReady=true;root.userData.forestTriangles=triangles;root.userData.treeCount=placements.length;root.userData.forestBatches=batches;
 }).catch(error=>{root.userData.forestError=error.message;});
}
export function createSpaScene(){const root=new T.Group();root.name='SPA_EAU_ROUGE_LIDAR';root.userData.keepMeshes=false;root.userData.metadata={units:'metres',roadSource:survey.source.plan,elevationSource:survey.source.elevation,roadWidthAtCar:survey.road[212-175][3]+survey.road[212-175][4],registrationMedianM:survey.source.registrationMedianM,roadStations:survey.road.length,terrainSamples:survey.terrain.heights.length};
 const grass=pbr('leafy_grass','#ffffff',.5);grass.vertexColors=true;terrain(root,grass);const road=pbr('asphalt_02','#62686c',.38);ribbon(root,s=>-s.rightWidth,s=>s.leftWidth,road,{uvScale:3});
 const white=solid('#e2e0d1',.85);ribbon(root,s=>s.leftWidth-.13,s=>s.leftWidth+.02,white,{lift:.012});ribbon(root,s=>-s.rightWidth-.02,s=>-s.rightWidth+.13,white,{lift:.012});
 const curb=solid('#ffffff',.88);curb.vertexColors=true;for(const sign of [-1,1])ribbon(root,s=>sign*(sign>0?s.leftWidth:s.rightWidth),s=>sign*((sign>0?s.leftWidth:s.rightWidth)+1.05),curb,{lift:.04,start:.22,end:.76,curb:true});
 // The post-2022 widened outer runoff is on the left when climbing from the valley.
 const runoff=roadPaint(road,'#787b72');runoff.polygonOffset=false;ribbon(root,s=>s.leftWidth+1,s=>s.leftWidth+19,runoff,{lift:0,start:.27,end:.69});
 for(let i=0;i<5;i++){const col=['#a49a25','#8a3029','#222923','#a49a25','#8a3029'][i];ribbon(root,s=>s.leftWidth+1+i*2.5,s=>s.leftWidth+3.5+i*2.5,roadPaint(road,col),{lift:.005,start:.28,end:.68});}
 // The narrow legacy access lane follows the inner grass wedge.
 ribbon(root,s=>-s.rightWidth-12,s=>-s.rightWidth-8,pbr('asphalt_02','#bfc4c6',.35),{lift:0,start:.12,end:.74,uvScale:3});
 guardrail(root,1,.04,.83,22);guardrail(root,-1,.02,.9,15);grandstand(root);carContact(root);loadForest(root);root.userData.dispose=()=>{root.userData.disposed=true;};return root;
}
