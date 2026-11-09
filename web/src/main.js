import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bindRig, applyRig, inspectRig } from './rig.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { drs: 0, steer: 0, speed: 0, spin: 0, drsCurrent: 0, model: 'rb19', view: 'hero' };
let rig, currentModel, configs, loadSerial = 0, transition = null;
let lastTime = performance.now(), statsTime = lastTime, frameCount = 0, fps = 0;
let wasNarrow = innerWidth <= 620;
const loader = new GLTFLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7e8e7');
const camera = new THREE.PerspectiveCamera(34, 1, .025, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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

const views = {
  hero: { position: [5.2, 2.72, 6.32], target: [0, .45, 0] },
  side: { position: [8.5, .85, .2], target: [0, .46, 0] },
  drs: { position: [1.55, 1.65, -4.35], target: [0, .91, -2.40] },
  floor: { position: [0, -9, .18], target: [0, .15, 0] },
};
function applyFraming() {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.clearViewOffset();
  // Leave room for the controls rather than covering the car with a panel.
  const horizontal = width > 620 ? (width > 900 ? 125 : 95) : 0;
  const vertical = width <= 620 ? 85 : -5;
  camera.setViewOffset(width, height, horizontal, vertical, width, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  if ((width <= 620) !== wasNarrow) {
    wasNarrow = width <= 620;
    setView(state.view, true);
  }
}
function setView(name, instant = false) {
  state.view = name;
  document.getElementById('app').classList.toggle('detail-view', name === 'drs' || name === 'floor');
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  floor.visible = name !== 'floor';
  floorInspectionLight.visible = name === 'floor';
  const view = views[name];
  const pos = new THREE.Vector3(...view.position);
  const target = new THREE.Vector3(...view.target);
  if (viewport.clientWidth <= 620) {
    const distanceFactor = { hero: 2.2, side: 2.3, drs: 2.1, floor: 1.9 }[name];
    pos.sub(target).multiplyScalar(distanceFactor).add(target);
  }
  if (instant || reducedMotion) {
    camera.position.copy(pos);orbit.target.copy(target);orbit.update();
  } else {
    transition = { start: performance.now(), position: camera.position.clone(), target: orbit.target.clone(), endPosition: pos, endTarget: target };
  }
}
function showState() {
  $('drs').value = Math.round(state.drs * 100);
  $('steer').value = state.steer;
  $('speed').value = state.speed;
  $('drs-value').textContent = `${Math.round(state.drs * 100)}%`;
  $('speed-value').textContent = state.speed ? `${state.speed} km/h` : '静止';
  $('steer-value').textContent = `${state.steer > 0 ? '+' : ''}${state.steer}°`;
  $('drs-toggle').innerHTML = state.drs > .5 ? '关闭 <span>↙</span>' : '打开 <span>↗</span>';
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
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(m)) if (value?.isTexture) value.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        }
      }
    });
    if (currentModel) { scene.remove(currentModel);disposeModel(currentModel); }
    currentModel = loaded.scene;rig = nextRig;
    scene.add(currentModel);
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
$('drs').addEventListener('input', e => { state.drs = Number(e.target.value) / 100;showState(); });
$('steer').addEventListener('input', e => { state.steer = Number(e.target.value);showState(); });
$('speed').addEventListener('input', e => { state.speed = Number(e.target.value);showState(); });
$('drs-toggle').addEventListener('click', () => { state.drs = state.drs > .5 ? 0 : 1;showState(); });
$('center-steering').addEventListener('click', () => { state.steer = 0;showState(); });
$('reset').addEventListener('click', () => { Object.assign(state, { drs: 0, steer: 0, speed: 0, spin: 0 });showState(); });
$('retry').addEventListener('click', () => loadModel(state.model).catch(() => {}));
$('credits-button').addEventListener('click', () => $('credits').showModal());
$('close-credits').addEventListener('click', () => $('credits').close());
$('credits').addEventListener('click', e => { if (e.target === $('credits')) { const r = $('credits').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('credits').close(); } });
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault();$('error').hidden = false;$('error-message').textContent = '图形上下文已中断，请刷新页面重新打开模型。'; });
window.addEventListener('resize', applyFraming);
applyFraming();setView('hero', true);showState();

renderer.setAnimationLoop(now => {
  const dt = Math.min((now - lastTime) / 1000, .05);lastTime = now;
  if (transition) {
    const t = Math.min((now - transition.start) / 900, 1);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.position, transition.endPosition, ease);
    orbit.target.lerpVectors(transition.target, transition.endTarget, ease);
    if (t === 1) transition = null;
  }
  state.drsCurrent = reducedMotion ? state.drs : THREE.MathUtils.damp(state.drsCurrent, state.drs, 9, dt);
  state.spin += state.speed / 3.6 * dt;
  if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
  orbit.update();renderer.render(scene, camera);
  frameCount++;
  if (now - statsTime > 1000) { fps = frameCount * 1000 / (now - statsTime);frameCount = 0;statsTime = now; }
});

// Read-only diagnostics plus explicit controls for reproducible browser QA.
window.aeroStudio = {
  get ready() { return Boolean(rig); },
  get modelId() { return rig?.config.id; },
  get metrics() { return { fps, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
    textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio(), width: viewport.clientWidth, height: viewport.clientHeight }; },
  get inspection() { return rig ? inspectRig(rig) : null; },
  get bounds() { return currentModel ? new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).toArray() : null; },
  async selectModel(id) { await loadModel(id); },
  setView,
  frameCamera(position, target) {
    transition = null;
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
    if (pose.speed !== undefined) state.speed = THREE.MathUtils.clamp(pose.speed, 0, 180);
    if (pose.spin !== undefined) state.spin = pose.spin;
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
