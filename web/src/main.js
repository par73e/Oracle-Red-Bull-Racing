import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bindRig, applyRig, inspectRig } from './rig.js';
import { Airflow } from './airflow.js';
import { FlowJobs } from './flow-jobs.js';
import { UnderbodyFlow } from './underbody.js';
import { SidepodFlow } from './sidepod.js';
import { Environments } from './environments.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const icons={"up": "<svg class=\"icon\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M4 12 12 4M4 4h8v8\"/></svg>", "down": "<svg class=\"icon\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M12 4 4 12M4 4v8h8\"/></svg>"};
const viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { drs: 0, steer: 0, speed: 180, spin: 0, drsCurrent: 0, model: 'rb19', view: 'hero', environment: 'wind', groundSpeed: 180, wheelRpm: 0, wheelSpeedMps: 50, flow: true, flowDensity: 100 };
let rig, currentModel, configs, loadSerial = 0, transition = null;
let lastTime = performance.now(), statsTime = lastTime, frameCount = 0, fps = 0;
let wasNarrow = innerWidth <= 620;
const loader = new GLTFLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e8e7');
const camera = new THREE.PerspectiveCamera(34, 1, .025, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 620 ? 1.25 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '赛车三维视图，拖动旋转，滚轮或双指缩放');
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment();
const envTarget = pmrem.fromScene(environment, .04);
scene.environment = envTarget.texture;
scene.environmentIntensity = .65;
environment.dispose();
pmrem.dispose();
const worlds = new Environments(renderer, envTarget.texture);
const airflow = new Airflow(scene, { onStatus: message => { if($('flow-status').textContent!==message)$('flow-status').textContent = message;$('flow-retry').hidden = !message.includes('暂不可用'); } });
const underbody = new UnderbodyFlow(scene, airflow.material);
const sidepod = new SidepodFlow(scene, airflow.material);
const flowJobs = new FlowJobs(airflow,underbody,sidepod);
worlds.set(state.environment, 2023);
const hemi = new THREE.HemisphereLight(0xdce8ff, 0x687078, .9);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff8ee, 3.2);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .5, far: 18 });
key.shadow.bias = -.00015;
key.shadow.normalBias = .025;
key.shadow.radius = 4;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdce9ff, 1.2);
fill.position.set(-4, 3, -2);scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.4);
rim.position.set(1, 4, -5);scene.add(rim);
const floorInspectionLight = new THREE.DirectionalLight(0xe7efff, 2.2);
floorInspectionLight.position.set(2, -4, 1);floorInspectionLight.visible = false;scene.add(floorInspectionLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#273945', opacity: .20 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.035;
floor.receiveShadow = true;
scene.add(floor);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .07;
orbit.minDistance = .45;
orbit.maxDistance = 18;
orbit.maxPolarAngle = Math.PI * .98;
orbit.screenSpacePanning = true;
orbit.addEventListener('start', () => { transition = null; });
let freeCamera = false, freePointer = null;
const freeKeys = new Set(), freeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
function setFreeCamera(enabled) {
  freeCamera = enabled; freeKeys.clear(); freePointer = null; transition = null;
  orbit.enabled = !enabled;
  if (enabled) freeEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  $('free-camera').setAttribute('aria-pressed', String(enabled));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(!enabled && b.dataset.view === state.view)));
  $('camera-hint').textContent = enabled ? 'WASD 移动 · Q 或空格上升 / E 下降 · Shift 加速 · 拖动看向 · Esc 退出' : '拖动旋转 · 滚轮缩放';
  renderer.domElement.setAttribute('aria-label', enabled ? '自由观察：WASD 移动，Q 或空格上升，E 下降，Shift 加速，拖动调整朝向，Esc 退出' : '赛车三维视图，拖动旋转，滚轮或双指缩放');
  if (!enabled) { const direction = new THREE.Vector3(); camera.getWorldDirection(direction); orbit.target.copy(camera.position).addScaledVector(direction, 5); orbit.update(); }
}
renderer.domElement.addEventListener('pointerdown', e => { if (!freeCamera || e.button !== 0) return; freePointer = {id:e.pointerId,x:e.clientX,y:e.clientY}; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', e => { if (!freeCamera || freePointer?.id !== e.pointerId) return; freeEuler.y -= (e.clientX-freePointer.x)*.004; freeEuler.x = THREE.MathUtils.clamp(freeEuler.x-(e.clientY-freePointer.y)*.004,-Math.PI/2+.01,Math.PI/2-.01); freePointer.x=e.clientX;freePointer.y=e.clientY;camera.quaternion.setFromEuler(freeEuler); });
function endFreePointer(e) { if (freePointer?.id === e.pointerId) freePointer = null; }
renderer.domElement.addEventListener('pointerup', endFreePointer);renderer.domElement.addEventListener('pointercancel', endFreePointer);
window.addEventListener('keydown', e => { if (!freeCamera || e.target.closest?.('input, textarea, select, button, dialog, [contenteditable]')) return; if (e.code === 'Escape') { setFreeCamera(false); return; } if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','ShiftLeft','ShiftRight'].includes(e.code)) { e.preventDefault();freeKeys.add(e.code); } });
window.addEventListener('keyup', e => freeKeys.delete(e.code));window.addEventListener('blur', () => freeKeys.clear());
$('free-camera').addEventListener('click', e => { setFreeCamera(!freeCamera); e.currentTarget.blur(); });
function moveFreeCamera(dt) {
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const delta = new THREE.Vector3();
  delta.addScaledVector(forward, Number(freeKeys.has('KeyW'))-Number(freeKeys.has('KeyS')));
  delta.addScaledVector(right, Number(freeKeys.has('KeyD'))-Number(freeKeys.has('KeyA')));
  delta.y += Number(freeKeys.has('KeyQ')||freeKeys.has('Space'))-Number(freeKeys.has('KeyE'));
  if (delta.lengthSq()) camera.position.addScaledVector(delta.normalize(), dt*(freeKeys.has('ShiftLeft') || freeKeys.has('ShiftRight') ? 1.5 : .4));
}


const views = {
  hero: { position: [5.2, 2.72, 6.32], target: [0, .45, 0] },
  side: { position: [8.5, .85, .2], target: [0, .46, 0] },
  drs: { position: [1.55, 1.65, -4.35], target: [0, .91, -2.40] },
  floor: { position: [0, -9, .18], target: [0, .15, 0] },
};
function applyFraming() {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  camera.aspect = width / height;camera.fov=width<=620?(state.environment==='wind'&&state.view==='side'?85:65):state.environment==='eau-rouge'&&state.view==='hero'?48:34;
  camera.clearViewOffset();
  // Leave room for the controls rather than covering the car with a panel.
  const horizontal = width > 620 ? (width > 900 ? 125 : 95) : 0;
  const vertical = width <= 620 ? 85 : -5;
  camera.setViewOffset(width, height, horizontal, vertical, width, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);worlds.resize(width, height);
  if ((width <= 620) !== wasNarrow) {
    wasNarrow = width <= 620;
    setView(state.view, true);
  }
}
function setView(name, instant = false) {
  if (freeCamera) setFreeCamera(false);
  state.view = name;
  document.getElementById('app').classList.toggle('detail-view', name === 'drs' || name === 'floor');
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  floor.visible = name !== 'floor';
  floorInspectionLight.visible = name === 'floor';
  camera.fov=viewport.clientWidth<=620?(state.environment==='wind'&&name==='side'?85:65):state.environment==='eau-rouge'&&name==='hero'?48:34;camera.updateProjectionMatrix();
  const view = name === 'hero' && state.environment === 'wind' ? {position:[-5.2,2.72,-8.2],target:[0,1,0]} : name === 'hero' && state.environment === 'eau-rouge' ? { position: [3.5, 2.3, -11], target: [-4,4.6,22] } : views[name];
  const pos = new THREE.Vector3(...view.position);
  const target = new THREE.Vector3(...view.target);
  if (viewport.clientWidth <= 620) {
    const distanceFactor = { hero: 1.1, side: state.environment==='wind'?.68:1.15, drs: 1.05, floor: .95 }[name];
    pos.sub(target).multiplyScalar(distanceFactor).add(target);
  }
  if (instant || reducedMotion) {
    camera.position.copy(pos);orbit.target.copy(target);orbit.update();
  } else {
    transition = { start: performance.now(), position: camera.position.clone(), target: orbit.target.clone(), endPosition: pos, endTarget: target };
  }
}

function setEnvironment(name) {
  if (!['studio','wind','eau-rouge'].includes(name)) return;
  state.environment = name;
  document.getElementById('app').dataset.environment=name;
  document.querySelectorAll('[data-environment]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.environment === name)));
  worlds.set(name,rig?.config.year || 2023);
  $('scene-label').textContent = {studio:'纯空白场景',wind:'风洞试验段','eau-rouge':'Eau Rouge · 坡底望向 Raidillon'}[name];
  $('scene-detail').textContent = name==='eau-rouge'?'斯帕 · 谷底仰视上坡与盲顶':name==='wind'?'原创全尺寸风洞场景 · 气流来自自由外流算例':'纯色背景 · 赛车与机构';
  orbit.maxDistance=name==='eau-rouge'?120:18;
  floor.position.y=name==='studio'?-.035:-.003;floor.material.opacity=name==='eau-rouge'?.38:.2;key.position.set(...(name==='wind'||name==='studio'?[3,6,4]:[-2,7,-3]));
  scene.environmentIntensity = name === 'wind' || name === 'studio' ? .65 : .9;
  key.intensity = name === 'wind' || name === 'studio' ? 3.2 : 2.2;
  fill.intensity = name === 'wind' || name === 'studio' ? 1.2 : .8;
  setView(state.view,true);
}

function showState() {
  $('flow-density').value = state.flowDensity; $('flow-density-value').textContent = `${state.flowDensity}%`;
  $('drs').value = Math.round(state.drs * 100);
  $('steer').value = state.steer;
  $('speed').value = state.speed;
  $('drs-value').textContent = `${Math.round(state.drs * 100)}%`;
  $('speed-value').textContent = `${state.speed} km/h`;
  const radius = rig?.config.wheels.FL.radius || .369;
  $('ground-speed').value = state.groundSpeed;
  $('ground-speed-value').textContent = `${state.groundSpeed} km/h`;
  state.wheelSpeedMps = state.groundSpeed / 3.6;
  state.wheelRpm = state.wheelSpeedMps / radius / (Math.PI * 2) * 60;
  $('wheel-value').textContent = `${Math.round(state.wheelRpm)} rpm`;
  $('wind-speed').textContent = `${(state.speed/3.6).toFixed(1)} m/s`;
  $('flow-toggle').setAttribute('aria-pressed', String(state.flow));$('flow-toggle').textContent=state.flow?'隐藏气流':'显示气流';
  $('steer-value').textContent = `${state.steer > 0 ? '+' : ''}${state.steer}°`;
  $('drs-toggle').innerHTML = state.drs > .5 ? '关闭 '+icons.down : '打开 '+icons.up;
  $('drs-toggle').setAttribute('aria-pressed', String(state.drs > .5));
}
function disposeModel(model) {
  const materials = new Set(), textures = new Set();
  model.traverse(o => {
    o.geometry?.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    m.dispose();
  }
  textures.forEach(t => t.dispose());
}
async function loadModel(id) {
  if (!configs?.[id]) throw new Error('找不到车型资料');
  const serial = ++loadSerial;
  const config = configs[id];
  $('error').hidden = true;
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = `正在加载 ${config.name}…`;
  document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === id)));
  state.model = id;
  try {
    const loaded = await loader.loadAsync(`${config.file}?v=${config.revision || config.glb_bytes}`, progress => {
      if (serial === loadSerial && progress.total) $('loading-text').textContent = `${config.name} / ${Math.round(progress.loaded / progress.total * 100)}%`;
    });
    if (serial !== loadSerial) { disposeModel(loaded.scene);return; }
    const nextRig = bindRig(loaded.scene, config);
    loaded.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;o.receiveShadow = true;
        if (o.geometry.attributes.position.count > 30) o.geometry.computeBoundsTree();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(m)) if (value?.isTexture) value.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        }
      }
    });
    if (currentModel) { scene.remove(currentModel);disposeModel(currentModel); }
    currentModel = loaded.scene;rig = nextRig;
    scene.add(currentModel);
    setEnvironment(state.environment);
    airflow.load(id);underbody.load(id);sidepod.load(id);
    showState();
    state.spin = 0;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    $('model-name').innerHTML = `${config.name}<span>.</span>`;
    $('era').textContent = `${config.year} / ${id === 'rb19' ? 'GROUND EFFECT' : 'HYBRID ERA'}`;
    $('loading').classList.add('hidden');
    window.dispatchEvent(new CustomEvent('aero:modelready', { detail: id }));
  } catch (error) {
    if (serial !== loadSerial) return;
    $('loading').classList.add('hidden');
    $('error').hidden = false;
    $('error-message').textContent = `模型暂时未能打开：${error.message}`;
    console.error(error);
    throw error;
  }
}
document.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', () => loadModel(b.dataset.model).catch(() => {})));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('interface-toggle').addEventListener('click', e => {
  const hidden = document.getElementById('app').classList.toggle('interface-hidden');
  document.querySelectorAll('.masthead, .model-intro, .controls, .environment-switch, .scene-caption, .bottom-bar').forEach(el => { el.hidden = hidden; });
  e.currentTarget.textContent = hidden ? '显示界面' : '隐藏界面';
  e.currentTarget.setAttribute('aria-pressed', String(hidden));
});
$('flow-density').addEventListener('input', e => { state.flowDensity = Number(e.target.value); showState(); });
$('drs').addEventListener('input', e => { state.drs = Number(e.target.value) / 100;showState(); });
$('steer').addEventListener('input', e => { state.steer = Number(e.target.value);showState(); });
$('speed').addEventListener('input', e => { state.speed = Number(e.target.value);showState(); });
$('drs-toggle').addEventListener('click', () => { state.drs = state.drs > .5 ? 0 : 1;showState(); });
$('center-steering').addEventListener('click', () => { state.steer = 0;showState(); });
$('reset').addEventListener('click', () => { Object.assign(state, { drs: 0, steer: 0, speed: 180, spin: 0, groundSpeed: 180, wheelRpm: 0, flowDensity: 100 });showState(); });
document.querySelectorAll('[data-environment]').forEach(b => b.addEventListener('click', () => setEnvironment(b.dataset.environment)));
$('ground-speed').addEventListener('input', e => { state.groundSpeed = Number(e.target.value);showState(); });
$('flow-toggle').addEventListener('click', () => { state.flow = !state.flow;airflow.setEnabled(state.flow);showState(); });
$('flow-retry').addEventListener('click', () => airflow.load(state.model));
$('retry').addEventListener('click', () => loadModel(state.model).catch(() => {}));
$('credits-button').addEventListener('click', () => $('credits').showModal());
$('close-credits').addEventListener('click', () => $('credits').close());
$('credits').addEventListener('click', e => { if (e.target === $('credits')) { const r = $('credits').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('credits').close(); } });
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault();$('error').hidden = false;$('error-message').textContent = '图形上下文已中断，请刷新页面重新打开模型。'; });
new ResizeObserver(entries => { document.documentElement.style.setProperty('--controls-height', `${entries[0].target.getBoundingClientRect().height}px`); }).observe(document.querySelector('.controls'));
window.addEventListener('resize', applyFraming);
applyFraming();setEnvironment(state.environment);setView('hero', true);showState();

renderer.setAnimationLoop(now => {
  const elapsed = Math.max(0, (now - lastTime) / 1000), dt = Math.min(elapsed, .05);lastTime = now;
  if (transition) {
    const t = Math.min((now - transition.start) / 900, 1);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.position, transition.endPosition, ease);
    orbit.target.lerpVectors(transition.target, transition.endTarget, ease);
    if (t === 1) transition = null;
  }
  state.drsCurrent = reducedMotion ? state.drs : THREE.MathUtils.damp(state.drsCurrent, state.drs, 9, Math.min(elapsed, .5));
  if (Math.abs(state.drsCurrent-state.drs)<.001) state.drsCurrent=state.drs;
  state.spin += state.wheelSpeedMps * dt;
  if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
  if (freeCamera) moveFreeCamera(dt); else orbit.update();
  flowJobs.update(state, rig, dt, now);
  const coverage=airflow.stats.sweepCoverage;
  const coverageText=coverage?`逐档 ${coverage.completed}/${coverage.planned} · ${coverage.queueState==='failed'?'计算中断':coverage.queueState==='complete'?'已完成':coverage.complete?'校验中':'计算中'}`:'';
  if($('sweep-status').textContent!==coverageText)$('sweep-status').textContent=coverageText;
  const underbodyVisible=underbody.group.visible;
  const underbodyMessage=!state.flow||state.flowDensity===0?'':underbody.status==='loading'?'正在加载底盘流场…':underbody.status==='unavailable'?'底盘流场暂不可用':state.speed===0&&state.wheelSpeedMps<.001?'静止：来流与车轮均为零':underbodyVisible?(underbody.mode==='baseline'?'底盘加密基线 · 仍有网格差异，未充分收敛':'底盘：加密基线叠加粗网格工况变化 · 近似预览'):'正在准备底盘气流…';
  if ($('underbody-status').textContent!==underbodyMessage) $('underbody-status').textContent=underbodyMessage;
  const sidepodVisible=sidepod.group.visible;
  const sidepodMessage=!state.flow||state.flowDensity===0?'':sidepod.status==='loading'?'正在加载侧箱及悬挂流场…':sidepod.status==='unavailable'?'侧箱及悬挂加密流场暂不可用':state.speed===0&&state.wheelSpeedMps<.001?'':sidepodVisible?(sidepod.mode==='baseline'?'侧箱及悬挂：探索性加密基线，未充分收敛':'侧箱及悬挂：近似预览，缺失处沿用缩放基线'):'正在准备侧箱及悬挂气流…';
  if ($('sidepod-status').textContent!==sidepodMessage) $('sidepod-status').textContent=sidepodMessage;
  worlds.update(dt,state.speed,state.groundSpeed);
  // Preserve close inspection while avoiding centimetre-sized depth steps
  // when orbiting far above the track.
  const near=THREE.MathUtils.clamp(camera.position.distanceTo(orbit.target)*.004,.025,.5);
  if(Math.abs(camera.near-near)>.001){camera.near=near;camera.updateProjectionMatrix();}
  worlds.render(camera, scene,state.view!=='floor');
  renderer.render(scene, camera);
  frameCount++;
  if (now - statsTime > 1000) { fps = frameCount * 1000 / (now - statsTime);frameCount = 0;statsTime = now; }
});

// Read-only diagnostics plus explicit controls for reproducible browser QA.
window.aeroStudio = {
  get ready() { return Boolean(rig); },
  get airflow() { return { ...airflow.stats, visible:airflow.group.visible, state: {...state} }; },
  get sidepod() { return { available: Boolean(sidepod.data), visible: sidepod.group.visible, mode: sidepod.mode, lines: sidepod.count, regions: sidepod.regions, layers: sidepod.layers, fallbackSamples: sidepod.fallbackSamples, blockedSeeds: sidepod.blockedSeeds, case: sidepod.meta?.case, time: sidepod.meta?.time }; },
  get underbody() { return { available: Boolean(underbody.data), visible: underbody.group.visible, mode: underbody.mode, lines: underbody.count, stops: underbody.stops, boundaryAxes: underbody.boundaryAxes, case: underbody.meta?.case, time: underbody.meta?.time }; },
  setEnvironment,
  get environment() { return {name:worlds.kind,metadata:worlds.root?.userData.metadata,forestReady:worlds.root?.userData.forestReady,forestError:worlds.root?.userData.forestError,treeCount:worlds.root?.userData.treeCount,forestTriangles:worlds.root?.userData.forestTriangles}; },
  get modelId() { return rig?.config.id; },
  get metrics() { return { fps, environmentTriangles:worlds.environmentTriangles,environmentCalls:worlds.environmentCalls, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
    textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio(), width: viewport.clientWidth, height: viewport.clientHeight }; },
  get inspection() { return rig ? inspectRig(rig) : null; },
  get bounds() { return currentModel ? new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).toArray() : null; },
  async selectModel(id) { await loadModel(id); },
  setView,
  frameCamera(position, target, fov) {
    transition = null;
    if(fov!==undefined){camera.fov=fov;camera.updateProjectionMatrix();}
    camera.position.set(...position);orbit.target.set(...target);orbit.update();
  },
  pickAt(x, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / viewport.clientWidth * 2 - 1, 1 - y / viewport.clientHeight * 2), camera);
    return ray.intersectObject(currentModel, true).slice(0, 8).map(hit => ({
      mesh: hit.object.name,
      material: (Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material).name,
      point: hit.point.toArray(), uv: hit.uv?.toArray(),
    }));
  },
  setPose(pose) {
    if (pose.drs !== undefined) state.drs = THREE.MathUtils.clamp(pose.drs, 0, 1);
    if (pose.steer !== undefined) state.steer = THREE.MathUtils.clamp(pose.steer, -18, 18);
    if (pose.speed !== undefined) state.speed = THREE.MathUtils.clamp(pose.speed, 0, 350);
    if (pose.spin !== undefined) state.spin = pose.spin;
    if (pose.groundSpeed !== undefined) state.groundSpeed = THREE.MathUtils.clamp(pose.groundSpeed, 0, 350);
    state.drsCurrent = state.drs;showState();
    if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
  },
  runKinematicChecks() {
    const saved = { ...state }, results = [];
    for (const drs of [0, .25, .5, .75, 1]) for (const steer of [-18, 0, 18]) {
      applyRig(rig, { drs, steer, spin: .8 });
      const snapshot = inspectRig(rig);
      const rearFixed = snapshot.wheels.RL.steer === 0 && snapshot.wheels.RR.steer === 0;
      results.push({ drs, steer, rodError: snapshot.rodError, rearFixed, wheels: snapshot.wheels });
      if (snapshot.rodError > 1e-5 || !rearFixed) throw new Error('机构验收失败');
    }
    applyRig(rig, { drs: saved.drsCurrent, steer: saved.steer, spin: saved.spin });
    return results;
  },
};

try {
  const response = await fetch('/models/manifest.json');
  if (!response.ok) throw new Error('模型清单尚未生成');
  const manifest = await response.json();
  configs = Object.fromEntries(manifest.map(c => [c.id, c]));
  await loadModel('rb19');
} catch (error) {
  $('loading').classList.add('hidden');$('error').hidden = false;
  $('error-message').textContent = `无法准备模型：${error.message}`;
}

// Development-only comparison of the same tracing code on the UI thread.
if (import.meta.env.DEV) window.aeroStudio.profileSynchronousFlow = () => {
  const start=performance.now(),now=start+1000;
  airflow.lastKey='';airflow.lastBuild=0;underbody.key='';sidepod.key='';sidepod.pendingKey='';
  airflow.update(state,rig,0,now);const coarse=performance.now();
  underbody.update(state,rig,airflow);const bottom=performance.now();
  sidepod.update(state,rig,airflow,now);sidepod.update(state,rig,airflow,now+200);const end=performance.now();
  return {coarseMs:coarse-start,underbodyMs:bottom-coarse,sidepodMs:end-bottom,totalMs:end-start};
};
