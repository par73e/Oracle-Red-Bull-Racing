import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Site-inspired, metric 3D reconstruction. Terrain/architecture are documented
// visual approximations, never presented as surveyed Spa CAD.
const rand = seed => { let s=seed;return ()=>((s=Math.imul(1664525,s)+1013904223)>>>0)/4294967296; };
const mat=(color,roughness=.8,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
function box(group,w,h,d,x,y,z,material){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.receiveShadow=true;group.add(m);return m;}
function tube(group,a,b,r,material,segments=6){const d=b.clone().sub(a);const m=new T.Mesh(new T.CylinderGeometry(r,r,d.length(),segments),material);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());group.add(m);return m;}
function asphalt(){const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),r=rand(62);ctx.fillStyle='#474b4b';ctx.fillRect(0,0,512,512);for(let i=0;i<38000;i++){const v=35+r()*75;ctx.fillStyle=`rgba(${v},${v+2},${v+1},${.15+r()*.3})`;ctx.fillRect(r()*512,r()*512,.5+r()*1.4,.5+r()*1.4);}const tex=new T.CanvasTexture(c);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;return tex;}
const path=new T.CatmullRomCurve3([
 new T.Vector3(-4,15,-190),new T.Vector3(-2,5,-70),new T.Vector3(8,0,-8),new T.Vector3(13,1,18),
 new T.Vector3(-10,11,88),new T.Vector3(-20,27,185),new T.Vector3(-9,37,245),new T.Vector3(4,38,275),new T.Vector3(7,38,390),
],false,'centripetal');
function ribbon(root,offsetA,offsetB,material,height=.015,segments=440){const vertices=[],uv=[],indices=[];let distance=0,prev=null;
 for(let i=0;i<=segments;i++){const t=i/segments,p=path.getPoint(t),tangent=path.getTangent(t),side=new T.Vector3(tangent.z,0,-tangent.x).normalize();if(prev)distance+=p.distanceTo(prev);prev=p;
  for(const off of [offsetA,offsetB]){const v=p.clone().addScaledVector(side,off);v.y+=height;vertices.push(...v.toArray());uv.push(off/4,distance/4);}
  if(i<segments){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=new T.Mesh(g,material);m.receiveShadow=true;root.add(m);return m;}
function kerbs(root,sign){const red=mat('#95302b'),yellow=mat('#d3a42d');const n=340;for(let i=0;i<n;i++){const t=i/n;if(t<.23||t>.78)continue;const p=path.getPoint(t),dir=path.getTangent(t),side=new T.Vector3(dir.z,0,-dir.x).normalize();const q=path.getPoint((i+1)/n);const m=box(root,1.0,.075,p.distanceTo(q)+.02,0,0,0,i%2?red:yellow);m.position.copy(p).addScaledVector(side,sign*6.35);m.position.y+=.025;m.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),dir);}}
function stands(root){const steel=mat('#a7aeb0',.45,.7),roof=mat('#d3d5d2',.6),seat=mat('#843a32');const group=new T.Group();group.position.set(53,18,155);group.rotation.y=-.13;root.add(group);
 for(let row=0;row<11;row++){box(group,62,.45,.8,0,row*.65,row*.95,mat(row%2?'#777f80':'#858c8c'));for(let block=0;block<6;block++)box(group,8,.18,.55,-26+block*10.3,row*.65+.3,row*.95,seat);}
 for(const x of [-29,-10,10,29]){tube(group,new T.Vector3(x,-2,9),new T.Vector3(x,12,9),.16,steel);tube(group,new T.Vector3(x,12,9),new T.Vector3(x,10,-4),.12,steel);}
 const canopy=box(group,67,.22,17,0,11.5,3,roof);canopy.rotation.x=.12;
}
function track(kind,year){const root=new T.Group();root.name='SPA_RECONSTRUCTION';const ground=mat('#4c613b'),road=mat('#aab0ad',.94);road.map=asphalt();
 // Cross-sections follow the same rising road centerline, then blend into hills.
 const v=[],indices=[],n=220,m=44;
 for(let i=0;i<=n;i++){const t=i/n,p=path.getPoint(t),tangent=path.getTangent(t),side=new T.Vector3(tangent.z,0,-tangent.x).normalize();
  for(let j=0;j<=m;j++){const off=(j/m-.5)*540;const q=p.clone().addScaledVector(side,off);const f=Math.min(1,Math.max(0,(Math.abs(off)-9)/60));q.y-=.12;q.y+=f*(12*Math.sin(t*10+off*.014)+.00042*off*off);v.push(...q.toArray());if(i<n&&j<m){const a=i*(m+1)+j;indices.push(a,a+m+1,a+1,a+1,a+m+1,a+m+2);}}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex(indices);g.computeVertexNormals();root.add(new T.Mesh(g,ground));ribbon(root,-6,6,road,0);kerbs(root,1);kerbs(root,-1);
 const white=mat('#d7d8c9');ribbon(root,-6.06,-5.96,white,.02);ribbon(root,5.96,6.06,white,.02);
 const gravel=mat('#a79d82');ribbon(root,7,year===2023?21:13,gravel,-.025);ribbon(root,-(year===2023?20:13),-7,gravel,-.025);
 if(year===2023){const colors=['#262b2b','#d3a225','#a3382b'];for(let i=0;i<3;i++){ribbon(root,8+i*3.5,11.5+i*3.5,mat(colors[i]),-.015);ribbon(root,-11.5-i*3.5,-8-i*3.5,mat(colors[2-i]),-.015);}stands(root);}
 const steel=mat('#8b9696',.48,.68),fence=mat('#667271',.6,.5);
 for(const sign of [-1,1]){const lines=[[],[],[]];for(let i=0;i<=150;i++){const t=i/150,p=path.getPoint(t),dir=path.getTangent(t),side=new T.Vector3(dir.z,0,-dir.x).normalize();p.addScaledVector(side,sign*(year===2023?23:15));
  for(let k=0;k<3;k++)lines[k].push(p.clone().add(new T.Vector3(0,.45+k*.24,0)));
  if(i%2===0)tube(root,p,p.clone().add(new T.Vector3(0,2.8,0)),.035,steel);
  if(i%3===0)tube(root,p.clone().add(new T.Vector3(0,.9,0)),p.clone().add(new T.Vector3(0,3,0)),.012,fence);
 }
 for(const points of lines){const geometry=new T.BufferGeometry().setFromPoints(points);root.add(new T.Line(geometry,new T.LineBasicMaterial({color:'#8e9998'})));}
 }
 // Alpha-tested photographic-style tree plates keep fine organic silhouettes
 // without thousands of individual leaf meshes. Generated asset provenance ships.
 const random=rand(1919),trees=1050,treeMap=new T.TextureLoader().load('/environments/ardennes-beech-v1.webp');
 treeMap.colorSpace=T.SRGBColorSpace;treeMap.anisotropy=4;
 const foliage=new T.MeshBasicMaterial({map:treeMap,color:'#ffffff',alphaTest:.32,side:T.DoubleSide,fog:true});
 const treeGeometry=new T.PlaneGeometry(1,1);treeGeometry.translate(0,.5,0);
 const forest=new T.InstancedMesh(treeGeometry,foliage,trees*2),dummy=new T.Object3D(),color=new T.Color();
 for(let i=0;i<trees;i++){const t=random(),p=path.getPoint(t),dir=path.getTangent(t),side=new T.Vector3(dir.z,0,-dir.x).normalize(),off=(random()<.5?-1:1)*(32+random()*190);p.addScaledVector(side,off);p.y+=Math.min(1,(Math.abs(off)-9)/60)*(12*Math.sin(t*10+off*.014)+.00042*off*off);
  if(year===2023&&p.x>20&&p.x<90&&p.z>95&&p.z<185)p.x+=80;
  const height=12+random()*12,width=height*(.7+random()*.24),rotation=random()*Math.PI;
  for(let k=0;k<2;k++){dummy.position.copy(p);dummy.scale.set(width,height,1);dummy.rotation.set(0,rotation+k*Math.PI/2,0);dummy.updateMatrix();forest.setMatrixAt(i*2+k,dummy.matrix);color.setHSL(.25+random()*.05,.08+random()*.15,.62+random()*.17);forest.setColorAt(i*2+k,color);}
 }root.add(forest);
 // Historic valley-side lodge: simple surveyed-style massing, no fabricated logos.
 const lodge=new T.Group();lodge.position.set(38,1,-34);root.add(lodge);box(lodge,18,5.3,9,0,2.6,0,mat('#d8d4c7'));const roof=box(lodge,20,.35,11,0,6,0,mat('#41474a'));roof.rotation.x=.16;for(let x=-7;x<=7;x+=2.8)box(lodge,1.2,1.5,.05,x,3.2,-4.53,mat('#52616a',.3,.35));
 const t=kind==='eau-rouge'?.32:.64,anchor=path.getPoint(t),forward=path.getTangent(t).normalize(),right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),forward).normalize(),up=new T.Vector3().crossVectors(forward,right).normalize();
 const basis=new T.Matrix4().makeBasis(right,up,forward);root.quaternion.setFromRotationMatrix(basis).invert();root.position.copy(anchor).applyQuaternion(root.quaternion).negate();root.position.y-=.005;
 return root;
}
function windTunnel(){const root=new T.Group();root.name='ORIGINAL_WIND_TUNNEL';const concrete=mat('#171f25'),panel=mat('#202d35',.6),metal=mat('#607780',.38,.7),black=mat('#202a2e',.72),light=new T.MeshBasicMaterial({color:'#fff1ce'});
 // A wide enclosing shell stays beyond the orbit range. Its back-facing
 // surfaces form the room without putting nearby barriers across the car.
 const shell=new T.Mesh(new T.BoxGeometry(70,55,90),new T.MeshStandardMaterial({color:'#202c33',roughness:.9,side:T.BackSide}));shell.position.set(0,2,-3);root.add(shell);
 const deck=new T.Mesh(new T.PlaneGeometry(68,88),new T.MeshBasicMaterial({color:'#192529'}));deck.rotation.x=-Math.PI/2;deck.position.y=-.19;root.add(deck);
 for(const x of [-12,12])for(let z=-25;z<=25;z+=10)box(root,4,.08,.4,x,14,z,light);

 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d'),random=rand(442);ctx.fillStyle='#222b2c';ctx.fillRect(0,0,256,256);for(let i=0;i<5000;i++){ctx.fillStyle=`rgba(150,158,150,${random()*.07})`;ctx.fillRect(random()*256,random()*256,1,2);}ctx.fillStyle='#59615c';ctx.fillRect(0,3,256,2);const rubberMap=new T.CanvasTexture(canvas);rubberMap.wrapS=rubberMap.wrapT=T.RepeatWrapping;rubberMap.repeat.set(1,6);rubberMap.colorSpace=T.SRGBColorSpace;black.color.set('#ffffff');black.map=rubberMap;root.userData.beltTexture=rubberMap;
 box(root,2.5,.028,12,0,-.012,0,black);
 box(root,8,5,.15,0,2.4,14.1,mat('#18242b'));
 // A visible upstream axial fan is a scene illustration; it does not drive the CFD field.
 const fan=new T.Group();fan.userData.dynamic=true;fan.position.set(0,2.4,13.85);root.add(fan);root.userData.fan=fan;
 const rim=new T.Mesh(new T.TorusGeometry(2.18,.12,12,72),mat('#9cabad',.35,.7));fan.add(rim);
 const rotor=new T.Group();rotor.userData.dynamic=true;fan.add(rotor);root.userData.rotor=rotor;
 for(let i=0;i<9;i++){const blade=new T.Mesh(new T.BoxGeometry(.43,1.7,.12),mat('#819095',.4,.65));blade.position.y=1.03;blade.rotation.z=-.22;const arm=new T.Group();arm.userData.dynamic=true;arm.rotation.z=i*Math.PI*2/9;arm.add(blade);rotor.add(arm);}
 const hub=new T.Mesh(new T.CylinderGeometry(.35,.4,.3,32),mat('#b7c3c3',.35,.7));hub.rotation.x=Math.PI/2;rotor.add(hub);
 const honeycomb=new T.Group();for(let x=-3.7;x<3.8;x+=.32)for(let y=.2;y<4.6;y+=.28){const geo=new T.RingGeometry(.115,.125,6);const m=new T.Mesh(geo,metal);m.position.set(x,y,14);honeycomb.add(m);}root.add(honeycomb);
 for(const x of [-1.48,1.48]){box(root,.028,.01,10,x,.006,0,mat('#c6bc85'));for(let z=-5;z<=5;z+=1)box(root,.2,.012,.025,x,.012,z,metal);}
 return root;
}
function mergeStatic(root){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),groups=new Map(),objects=[];
 root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!o.material.transparent&&!o.parent?.parent?.parent?.userData?.fanMarker&&!o.userData.dynamic&&!o.parent?.userData.dynamic&&!o.parent?.parent?.userData.dynamic){const key=o.material.uuid;if(!groups.has(key))groups.set(key,{material:o.material,geometry:[]});const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld));groups.get(key).geometry.push(g);objects.push(o);}});
 for(const o of objects){o.parent.remove(o);o.geometry.dispose();}
 for(const {material,geometry} of groups.values()){const merged=mergeGeometries(geometry,false);geometry.forEach(g=>g.dispose());if(merged)root.add(new T.Mesh(merged,material));}
}
export class Environments {
 constructor(renderer,roomTexture){this.renderer=renderer;this.roomTexture=roomTexture;this.scene=new T.Scene();this.scene.background=new T.Color('#bec9cb');this.scene.add(new T.HemisphereLight(0xdde7eb,0x6b7259,1.4));const sun=new T.DirectionalLight(0xfff4dd,1.9);sun.position.set(-20,70,-30);this.scene.add(sun);this.kind='studio';this.year=2023;
  this.target=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.target.depthTexture=new T.DepthTexture(640,360);
  this.output=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.output.texture.colorSpace=T.SRGBColorSpace;this.quadScene=new T.Scene();this.quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  this.blur=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{map:{value:this.target.texture},depthMap:{value:this.target.depthTexture},pixel:{value:new T.Vector2(1/640,1/360)},near:{value:.025},far:{value:700},strength:{value:1}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D map,depthMap;uniform vec2 pixel;uniform float near,far,strength;varying vec2 uv0;void main(){float z=texture2D(depthMap,uv0).x;float d=(near*far)/(far-z*(far-near));float r=smoothstep(8.,65.,d)*strength*2.6;vec3 c=texture2D(map,uv0).rgb*.28;c+=texture2D(map,uv0+pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(r,r)).rgb*.11;c+=texture2D(map,uv0-pixel*vec2(r,r)).rgb*.11;gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});this.quadScene.add(new T.Mesh(new T.PlaneGeometry(2,2),this.blur));
  this.depthScene=new T.Scene();this.depthScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({colorWrite:false,depthWrite:true,depthTest:true,depthFunc:T.AlwaysDepth,uniforms:{depthMap:{value:this.target.depthTexture}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D depthMap;varying vec2 uv0;void main(){gl_FragDepth=texture2D(depthMap,uv0).r;gl_FragColor=vec4(0.);}' })));
  // Outdoor sky/ground radiance replaces indoor studio reflections on track.
  const sky=new T.Scene();sky.background=new T.Color('#b7c7cf');sky.add(new T.HemisphereLight(0xdce7ed,0x526044,2));const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshBasicMaterial({color:'#4a5942'}));ground.rotation.x=-Math.PI/2;ground.position.y=-5;sky.add(ground);const pmrem=new T.PMREMGenerator(renderer);this.skyTarget=pmrem.fromScene(sky,.08);pmrem.dispose();
 }
 set(kind,year=2023){if(this.kind===kind&&this.year===year)return;this.kind=kind;this.year=year;if(this.root){this.scene.remove(this.root);const textures=new Set(),materials=new Set();this.root.traverse(o=>{o.geometry?.dispose();if(o.material){materials.add(o.material);if(o.material.map)textures.add(o.material.map);}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());}
  this.root=kind==='studio'?new T.Group():kind==='wind'?windTunnel():track(kind,year);mergeStatic(this.root);this.scene.add(this.root);this.scene.environment=kind==='wind'?this.roomTexture:this.skyTarget.texture;this.scene.environmentIntensity=.8;this.scene.fog=kind==='wind'?new T.Fog('#111b21',22,65):new T.Fog('#b6c4c8',55,280);this.scene.background.set(kind==='wind'?'#111b21':'#b6c4c8');
 }
 update(dt,speed){if(this.kind==='wind'&&this.root.userData.rotor)this.root.userData.rotor.rotation.z-=dt*speed/35;if(this.kind==='wind'&&this.root.userData.beltTexture)this.root.userData.beltTexture.offset.y=(this.root.userData.beltTexture.offset.y+speed/3.6*dt/2)%1;}
 resize(w,h){const scale=(innerWidth<620?.7:.85)*this.renderer.getPixelRatio();this.target.setSize(Math.round(w*scale),Math.round(h*scale));this.output.setSize(Math.round(w*scale),Math.round(h*scale));this.blur.uniforms.pixel.value.set(1/this.target.width,1/this.target.height);}
 render(camera,main,occlude=true){this.renderer.autoClear=true;if(this.kind==='studio'){main.background=new T.Color('#e7e8e7');main.environment=this.roomTexture;return;}const r=this.renderer;r.setRenderTarget(this.target);r.render(this.scene,camera);this.blur.uniforms.near.value=camera.near;this.blur.uniforms.far.value=camera.far;this.blur.uniforms.strength.value=this.kind==='wind'?.25:1;r.setRenderTarget(this.output);r.render(this.quadScene,this.quadCamera);r.setRenderTarget(null);if(occlude&&this.kind!=='wind'){r.clear();r.render(this.depthScene,this.quadCamera);r.autoClear=false;}main.background=this.output.texture;main.environment=this.kind==='wind'?this.roomTexture:this.skyTarget.texture;}
}
