import * as T from 'three';
import { createSpaScene } from './spa-scene.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Site-inspired, metric 3D reconstruction. Terrain/architecture are documented
// visual approximations, never presented as surveyed Spa CAD.
const rand = seed => { let s=seed;return ()=>((s=Math.imul(1664525,s)+1013904223)>>>0)/4294967296; };
const mat=(color,roughness=.8,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
function box(group,w,h,d,x,y,z,material){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.receiveShadow=true;group.add(m);return m;}
function tube(group,a,b,r,material,segments=6){const d=b.clone().sub(a);const m=new T.Mesh(new T.CylinderGeometry(r,r,d.length(),segments),material);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());group.add(m);return m;}
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
 for(const {material,geometry} of groups.values()){const merged=mergeGeometries(geometry,false);geometry.forEach(g=>g.dispose());if(merged){const mesh=new T.Mesh(merged,material);mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);}}
}
export class Environments {
 constructor(renderer,roomTexture){this.renderer=renderer;this.roomTexture=roomTexture;this.scene=new T.Scene();this.scene.background=new T.Color('#bec9cb');this.scene.add(new T.HemisphereLight(0xdde7eb,0x6b7259,.75));const sun=new T.DirectionalLight(0xfff4dd,1.35);sun.position.set(-20,70,-30);this.scene.add(sun);this.sun=sun;sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-180,right:180,top:180,bottom:-180,near:.5,far:450});sun.shadow.bias=-.00025;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;this.kind='studio';this.year=2023;
  this.target=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.target.depthTexture=new T.DepthTexture(640,360);
  this.output=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.output.texture.colorSpace=T.SRGBColorSpace;this.quadScene=new T.Scene();this.quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  this.blur=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{map:{value:this.target.texture},depthMap:{value:this.target.depthTexture},pixel:{value:new T.Vector2(1/640,1/360)},near:{value:.025},far:{value:700},strength:{value:1}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D map,depthMap;uniform vec2 pixel;uniform float near,far,strength;varying vec2 uv0;void main(){float z=texture2D(depthMap,uv0).x;float d=(near*far)/(far-z*(far-near));float r=smoothstep(8.,65.,d)*strength*2.6;vec3 c=texture2D(map,uv0).rgb*.28;c+=texture2D(map,uv0+pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(r,r)).rgb*.11;c+=texture2D(map,uv0-pixel*vec2(r,r)).rgb*.11;gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});this.quadScene.add(new T.Mesh(new T.PlaneGeometry(2,2),this.blur));
  this.depthScene=new T.Scene();this.depthScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({colorWrite:false,depthWrite:true,depthTest:true,depthFunc:T.AlwaysDepth,uniforms:{depthMap:{value:this.target.depthTexture}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D depthMap;varying vec2 uv0;void main(){gl_FragDepth=texture2D(depthMap,uv0).r;gl_FragColor=vec4(0.);}' })));
  // Outdoor sky/ground radiance replaces indoor studio reflections on track.
  const sky=new T.Scene();sky.background=new T.Color('#b7c7cf');sky.add(new T.HemisphereLight(0xdce7ed,0x526044,2));const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshBasicMaterial({color:'#4a5942'}));ground.rotation.x=-Math.PI/2;ground.position.y=-5;sky.add(ground);const pmrem=new T.PMREMGenerator(renderer);this.skyTarget=pmrem.fromScene(sky,.08);pmrem.dispose();
  new RGBELoader().load('/environments/spa/cloud-sky.hdr',texture=>{texture.mapping=T.EquirectangularReflectionMapping;this.skyPhoto=texture;const generator=new T.PMREMGenerator(renderer),target=generator.fromEquirectangular(texture);generator.dispose();this.skyTarget.dispose();this.skyTarget=target;if(this.kind==='eau-rouge'){this.scene.background=texture;this.scene.environment=target.texture;}});
 }
 set(kind,year=2023){if(this.kind===kind&&this.root)return;this.kind=kind;this.year=year;
  if(this.root){this.scene.remove(this.root);this.root.userData.dispose?.();const textures=new Set(),materials=new Set(),geometries=new Set();this.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());}
  this.root=kind==='studio'?new T.Group():kind==='wind'?windTunnel():createSpaScene();if(!this.root.userData.keepMeshes)mergeStatic(this.root);this.scene.add(this.root);
  this.scene.environment=kind==='wind'?this.roomTexture:this.skyTarget.texture;this.scene.environmentIntensity=kind==='wind'?.8:.65;
  this.scene.fog=kind==='wind'?new T.Fog('#111b21',22,65):new T.Fog('#c5cdd0',220,950);
  this.sun.castShadow=kind==='eau-rouge';this.sun.shadow.needsUpdate=true;this.lastForestReady=false;
  this.scene.background=kind==='eau-rouge'&&this.skyPhoto?this.skyPhoto:new T.Color(kind==='wind'?'#111b21':'#c5cdd0');
 }
 update(dt,speed,groundSpeed=speed){if(this.kind==='eau-rouge'&&this.root.userData.forestReady&&!this.lastForestReady){this.sun.shadow.needsUpdate=true;this.lastForestReady=true;}if(this.kind==='wind'&&this.root.userData.rotor)this.root.userData.rotor.rotation.z-=dt*speed/35;if(this.kind==='wind'&&this.root.userData.beltTexture)this.root.userData.beltTexture.offset.y=(this.root.userData.beltTexture.offset.y+groundSpeed/3.6*dt/2)%1;}
 resize(w,h){const scale=(innerWidth<620?.7:.85)*this.renderer.getPixelRatio();this.target.setSize(Math.round(w*scale),Math.round(h*scale));this.output.setSize(Math.round(w*scale),Math.round(h*scale));this.blur.uniforms.pixel.value.set(1/this.target.width,1/this.target.height);}
 render(camera,main,occlude=true){this.renderer.autoClear=true;if(this.kind==='studio'){main.background=new T.Color('#f4f5f4');main.environment=this.roomTexture;return;}const r=this.renderer;r.setRenderTarget(this.target);r.render(this.scene,camera);this.environmentTriangles=r.info.render.triangles;this.environmentCalls=r.info.render.calls;this.blur.uniforms.near.value=camera.near;this.blur.uniforms.far.value=camera.far;this.blur.uniforms.strength.value=this.kind==='wind'?.25:.1;r.setRenderTarget(this.output);r.render(this.quadScene,this.quadCamera);r.setRenderTarget(null);if(occlude&&this.kind!=='wind'){r.clear();r.render(this.depthScene,this.quadCamera);r.autoClear=false;}main.background=this.output.texture;main.environment=this.kind==='wind'?this.roomTexture:this.skyTarget.texture;}
}
