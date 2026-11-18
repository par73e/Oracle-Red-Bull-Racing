import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cachedArrayBuffer, hasCachedAsset } from './asset-cache.js';
import { bindRig, applyRig, inspectRig } from './rig.js';
import { Airflow } from './airflow.js';
import { AeroForces, resolveRelativeWind } from './aero-forces.js';
import { FlowJobs } from './flow-jobs.js';
import { UnderbodyFlow } from './underbody.js';
import { SidepodFlow } from './sidepod.js';
import { Environments } from './environments.js';
import { createSpaShadowGeometry } from './spa-scene.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_CONFIG = Object.freeze({
  model: 'rb16b',
  environment: 'wind',
  view: 'hero',
  freeMode: false,
  drs: 0,
  drsCurrent: 0,
  steer: 0,
  ambientWindMps: 5,
  speed: 198,
  windAngle: 0,
  effWindAngle: 0,
  spin: 0,
  groundSpeed: 180,
  wheelRpm: 0,
  wheelSpeedMps: 50,
  flow: true,
  flowDensity: 100,
  autoHide: false,
});

const state = {
  ...DEFAULT_CONFIG,
  panel: null,
  autoHidden: false,
  manualHidden: false,
};

function applyOperatingDefaults({ includeFlow = false } = {}) {
  Object.assign(state, {
    drs: DEFAULT_CONFIG.drs,
    drsCurrent: DEFAULT_CONFIG.drsCurrent,
    steer: DEFAULT_CONFIG.steer,
    ambientWindMps: DEFAULT_CONFIG.ambientWindMps,
    speed: DEFAULT_CONFIG.speed,
    windAngle: DEFAULT_CONFIG.windAngle,
    effWindAngle: DEFAULT_CONFIG.effWindAngle,
    spin: DEFAULT_CONFIG.spin,
    groundSpeed: DEFAULT_CONFIG.groundSpeed,
    wheelRpm: DEFAULT_CONFIG.wheelRpm,
    wheelSpeedMps: DEFAULT_CONFIG.wheelSpeedMps,
    flowDensity: DEFAULT_CONFIG.flowDensity,
    ...(includeFlow ? { flow: DEFAULT_CONFIG.flow } : {}),
  });
}

const STORAGE_KEY = 'aero-studio:config:v2';
const VALID_ENVS = new Set(['studio', 'wind', 'eau-rouge']);
const VALID_VIEWS = new Set(['hero', 'front', 'side', 'drs', 'floor']);
let persistenceReady = false;
let savedCameraPose = null;
let cameraSaveTimer = 0;

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
}

function hydrateSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;
    if (typeof saved.model === 'string' && saved.model) state.model = saved.model;
    if (VALID_ENVS.has(saved.environment)) state.environment = saved.environment;
    if (VALID_VIEWS.has(saved.view)) state.view = saved.view;
    if (typeof saved.freeMode === 'boolean') state.freeMode = saved.freeMode;
    if (Number.isFinite(saved.ambientWindMps)) state.ambientWindMps = THREE.MathUtils.clamp(saved.ambientWindMps, 0, 15);
    if (Number.isFinite(saved.windAngle)) state.windAngle = THREE.MathUtils.clamp(saved.windAngle, -90, 90);
    if (Number.isFinite(saved.groundSpeed)) state.groundSpeed = THREE.MathUtils.clamp(saved.groundSpeed, 0, 350);
    if (Number.isFinite(saved.drs)) state.drs = THREE.MathUtils.clamp(saved.drs, 0, 1);
    if (Number.isFinite(saved.steer)) state.steer = THREE.MathUtils.clamp(saved.steer, -18, 18);
    if (typeof saved.flow === 'boolean') state.flow = saved.flow;
    if (Number.isFinite(saved.flowDensity)) state.flowDensity = THREE.MathUtils.clamp(saved.flowDensity, 0, 150);
    if (typeof saved.autoHide === 'boolean') state.autoHide = saved.autoHide;
    state.drsCurrent = state.drs;
    state.wheelSpeedMps = state.groundSpeed / 3.6;
    const cp = saved.cameraPose;
    if (cp && cp.environment === state.environment && isVec3(cp.position) && isVec3(cp.target)) {
      const dist = Math.hypot(cp.position[0] - cp.target[0], cp.position[1] - cp.target[1], cp.position[2] - cp.target[2]);
      if (dist > 0.25 && dist < 200) {
        savedCameraPose = {
          environment: cp.environment,
          position: cp.position.slice(),
          target: cp.target.slice(),
        };
      }
    }
  } catch {}
}

function saveState() {
  if (!persistenceReady) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      model: state.model,
      environment: state.environment,
      view: state.view,
      freeMode: state.freeMode,
      ambientWindMps: state.ambientWindMps,
      windAngle: state.windAngle,
      groundSpeed: state.groundSpeed,
      drs: state.drs,
      steer: state.steer,
      flow: state.flow,
      flowDensity: state.flowDensity,
      autoHide: state.autoHide,
      cameraPose: savedCameraPose && savedCameraPose.environment === state.environment ? savedCameraPose : null,
    }));
  } catch {}
}

function captureCameraPose() {
  savedCameraPose = {
    environment: state.environment,
    position: camera.position.toArray(),
    target: orbit.target.toArray(),
  };
}

function clearSavedCameraPose() {
  savedCameraPose = null;
  clearTimeout(cameraSaveTimer);
  cameraSaveTimer = 0;
}

function scheduleCameraPoseSave() {
  if (!persistenceReady) return;
  clearTimeout(cameraSaveTimer);
  cameraSaveTimer = setTimeout(() => {
    cameraSaveTimer = 0;
    captureCameraPose();
    saveState();
  }, 220);
}

hydrateSavedState();

let rig, currentModel, configs, loadSerial = 0, transition = null;
let lastTime = performance.now(), statsTime = lastTime, frameCount = 0, fps = 0;
let wasNarrow = innerWidth <= 620;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#11161d');
const camera = new THREE.PerspectiveCamera(34, 1, .025, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 620 ? 1.25 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '赛车三维自由观察视图：拖动以自身视角转向，右键平移，滚轮进退，WASD与QE移动，双击车身聚焦');

const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment();
const envTarget = pmrem.fromScene(environment, .04);
scene.environment = envTarget.texture;
scene.environmentIntensity = .75;
environment.dispose();
pmrem.dispose();

const worlds = new Environments(renderer, envTarget.texture);
function updateFlowStatus(message) {
  const statusEl = $('flow-status');
  if (statusEl && statusEl.textContent !== message) statusEl.textContent = message;
  const retryEl = $('flow-retry');
  if (retryEl) {
    const showRetry = message.includes('暂不可用');
    if (retryEl.hidden === showRetry) retryEl.hidden = !showRetry;
  }
  const dotEl = $('flow-dot');
  if (dotEl) {
    const tone = message.includes('暂不可用') || message.includes('失败')
      ? 'error'
      : message.includes('正在')
        ? 'loading'
        : !state.flow || message.includes('静止')
          ? 'idle'
          : 'ready';
    if (dotEl.dataset.tone !== tone) dotEl.dataset.tone = tone;
  }
}

const carTurntable = new THREE.Group();
carTurntable.name = 'CAR_TURNTABLE';
scene.add(carTurntable);

const airflow = new Airflow(carTurntable, { onStatus: updateFlowStatus });
const aeroForces = new AeroForces();
const underbody = new UnderbodyFlow(carTurntable, airflow.material);
const sidepod = new SidepodFlow(carTurntable, airflow.material);
let secondaryStartedFor = 0;
function startSecondaryLayers(serial, carId) {
  if (serial !== loadSerial || secondaryStartedFor === serial) return;
  secondaryStartedFor = serial;
  airflow.startSecondary();
  underbody.load(carId);
  sidepod.load(carId);
}
const flowJobs = new FlowJobs(airflow, underbody, sidepod, {
  onWorkerReady: carId => startSecondaryLayers(loadSerial, carId),
});
airflow.setEnabled(state.flow);
if (!state.flow) updateFlowStatus('流线已隐藏');
worlds.set(state.environment, state.model === 'rb19' ? 2023 : 2021);

function syncTurntable() {
  const yawRad = state.environment === 'wind' ? THREE.MathUtils.degToRad(state.windAngle || 0) : 0;
  if (Math.abs(carTurntable.rotation.y - yawRad) > 1e-6) {
    carTurntable.rotation.y = yawRad;
    carTurntable.updateMatrixWorld(true);
    renderer.shadowMap.needsUpdate = true;
  }
  worlds.setYaw(yawRad);
}

const hemi = new THREE.HemisphereLight(0xdce8ff, 0x45505c, .95);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff8ee, 3.3);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .5, far: 18 });
key.shadow.bias = -.00015;
key.shadow.normalBias = .025;
key.shadow.radius = 4;
scene.add(key);

const fill = new THREE.DirectionalLight(0xdce9ff, 1.35);
fill.position.set(-4, 3, -2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 1.65);
rim.position.set(1, 4, -5);
scene.add(rim);

const floorInspectionLight = new THREE.DirectionalLight(0xe7efff, 2.4);
floorInspectionLight.position.set(2, -4, 1);
floorInspectionLight.visible = false;
scene.add(floorInspectionLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ color: '#05080c', opacity: .34 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.035;
floor.receiveShadow = true;
scene.add(floor);

const eauRougeFloor = new THREE.Mesh(
  createSpaShadowGeometry(),
  new THREE.ShadowMaterial({
    color: '#05080c',
    opacity: .38,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  })
);
eauRougeFloor.receiveShadow = true;
eauRougeFloor.visible = false;
scene.add(eauRougeFloor);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .07;
orbit.rotateSpeed = 1.65;
orbit.panSpeed = 1.25;
orbit.zoomSpeed = 1.2;
orbit.minDistance = .35;
orbit.maxDistance = 18;
orbit.maxPolarAngle = Math.PI * .995;
orbit.screenSpacePanning = true;
orbit.enabled = !state.freeMode;

const MAX_PITCH = Math.PI * .495;
const lookState = {
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  focusDistance: 6,
};

function syncLookFromTarget(pos = camera.position, target = orbit.target) {
  const dir = target.clone().sub(pos);
  const len = dir.length();
  if (len > 1e-5) {
    lookState.focusDistance = len;
    dir.divideScalar(len);
    lookState.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
    lookState.yaw = Math.atan2(dir.x, dir.z);
    lookState.targetYaw = lookState.yaw;
    lookState.targetPitch = lookState.pitch;
  }
  camera.lookAt(target);
}

function applyLookOrientation(dt = 0) {
  if (reducedMotion || dt <= 0) {
    lookState.yaw = lookState.targetYaw;
    lookState.pitch = lookState.targetPitch;
  } else {
    lookState.yaw = THREE.MathUtils.damp(lookState.yaw, lookState.targetYaw, 18, dt);
    lookState.pitch = THREE.MathUtils.damp(lookState.pitch, lookState.targetPitch, 18, dt);
  }
  const cosPitch = Math.cos(lookState.pitch);
  const fx = Math.sin(lookState.yaw) * cosPitch;
  const fy = Math.sin(lookState.pitch);
  const fz = Math.cos(lookState.yaw) * cosPitch;
  orbit.target.set(
    camera.position.x + fx * lookState.focusDistance,
    camera.position.y + fy * lookState.focusDistance,
    camera.position.z + fz * lookState.focusDistance
  );
  camera.lookAt(orbit.target);
}

function updateCameraHint() {
  const hint = $('camera-hint');
  if (!hint) return;
  if (state.freeMode) {
    hint.innerHTML = '自身视角转向 · 右键平移 · 滚轮进退 · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动 · <kbd>Q</kbd><kbd>E</kbd> 升降 · 双击车身聚焦';
  } else {
    const partLabel = { hero: '整车中心', front: '前翼侧箱', side: '车身侧面', drs: '尾翼机构', floor: '底板区域' }[state.view] || '当前部位';
    hint.innerHTML = `围绕${partLabel}旋转 · 右键平移 · 滚轮缩放 · 双击车身切换中心 · <kbd>0</kbd>/<kbd>WASD</kbd> 自由观察`;
  }
}

function setCameraMode(freeMode) {
  state.freeMode = Boolean(freeMode);
  orbit.enabled = !state.freeMode;
  const freeBtn = $('free-camera');
  if (freeBtn) freeBtn.setAttribute('aria-pressed', String(state.freeMode));
  if (state.freeMode) {
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    syncLookFromTarget(camera.position, orbit.target);
  }
  updateCameraHint();
  saveState();
}

function markFreeCameraActive() {
  setCameraMode(true);
}

orbit.addEventListener('start', () => {
  transition = null;
});
orbit.addEventListener('end', () => {
  scheduleCameraPoseSave();
});

function closeAllTelemetryPopovers() {
  document.querySelectorAll('.telemetry-item.is-open').forEach(item => {
    item.classList.remove('is-open', 'is-dragging');
    item.querySelector('.readout')?.setAttribute('aria-expanded', 'false');
  });
}

function setAutoHidden(hidden) {
  const next = Boolean(hidden && state.autoHide && !state.manualHidden);
  if (state.autoHidden === next) return;
  state.autoHidden = next;
  $('app').classList.toggle('auto-hidden', next);
  if (next) closeAllTelemetryPopovers();
}

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

let pointerTrack = null;
const EDGE_LOCK_MARGIN = 12;

function isCanvasPointerLocked() {
  return document.pointerLockElement === renderer.domElement;
}

function lockCanvasPointer() {
  if (isCanvasPointerLocked() || !renderer.domElement.requestPointerLock) return;
  try {
    const res = renderer.domElement.requestPointerLock({ unadjustedMovement: true });
    if (res && typeof res.catch === 'function') {
      res.catch(() => {
        try {
          const fallback = renderer.domElement.requestPointerLock();
          if (fallback && typeof fallback.catch === 'function') fallback.catch(() => {});
        } catch {}
      });
    }
  } catch {
    try {
      const fallback = renderer.domElement.requestPointerLock();
      if (fallback && typeof fallback.catch === 'function') fallback.catch(() => {});
    } catch {}
  }
}

function exitCanvasPointerLock() {
  if (isCanvasPointerLocked()) {
    try { document.exitPointerLock(); } catch {}
  }
}

function maybeLockPointerAtEdge(clientX, clientY, dx, dy) {
  if (!pointerTrack?.onCanvas || !pointerTrack.moved || pointerTrack.lockRequested || pointerTrack.pointerType !== 'mouse') return;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const atLeft = clientX <= EDGE_LOCK_MARGIN && clientX < pointerTrack.x && dx <= 0;
  const atRight = clientX >= w - 1 - EDGE_LOCK_MARGIN && clientX > pointerTrack.x && dx >= 0;
  const atTop = clientY <= EDGE_LOCK_MARGIN && clientY < pointerTrack.y && dy <= 0;
  const atBottom = clientY >= h - 1 - EDGE_LOCK_MARGIN && clientY > pointerTrack.y && dy >= 0;
  if (atLeft || atRight || atTop || atBottom) {
    pointerTrack.lockRequested = true;
    lockCanvasPointer();
  }
}

function applyPointerDelta(dx, dy, panMode) {
  if (!dx && !dy) return;
  if (state.freeMode) {
    if (panMode) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const refDist = THREE.MathUtils.clamp(camera.position.length(), 1.2, 16);
      const scale = 2 * refDist * Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) / Math.max(1, viewport.clientHeight);
      const panDelta = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
      camera.position.add(panDelta);
      orbit.target.add(panDelta);
    } else {
      const sensitivity = (THREE.MathUtils.degToRad(camera.fov) / Math.max(240, viewport.clientHeight)) * 2.05;
      lookState.targetYaw -= dx * sensitivity;
      lookState.targetPitch = THREE.MathUtils.clamp(lookState.targetPitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH);
    }
    return;
  }
  if (!isCanvasPointerLocked()) return;
  pointerTrack && (pointerTrack.lockedUsed = true);
  if (panMode) {
    orbit._pan(dx * orbit.panSpeed, dy * orbit.panSpeed);
  } else {
    const h = Math.max(1, renderer.domElement.clientHeight);
    orbit._rotateLeft(2 * Math.PI * (dx * orbit.rotateSpeed) / h);
    orbit._rotateUp(2 * Math.PI * (dy * orbit.rotateSpeed) / h);
  }
  orbit.update();
}

document.addEventListener('pointerlockchange', () => {
  const locked = isCanvasPointerLocked();
  orbit.enabled = !locked && !state.freeMode;
  if (pointerTrack) {
    pointerTrack.skipNextLockDelta = locked;
    if (!locked) {
      orbit._rotateStart?.set(pointerTrack.lastX, pointerTrack.lastY);
      orbit._panStart?.set(pointerTrack.lastX, pointerTrack.lastY);
    }
  }
});

window.addEventListener('pointerdown', e => {
  if ($('credits')?.open) return;
  const onCanvas = e.target === renderer.domElement;
  if (onCanvas && state.freeMode) {
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch {}
  }
  pointerTrack = {
    id: e.pointerId,
    pointerType: e.pointerType,
    x: e.clientX,
    y: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    button: e.button,
    panMode: e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey,
    onCanvas,
    startedOutsideDrawer: !e.target.closest?.('#drawer, .rail, .flow-state, #credits'),
    moved: false,
    lockRequested: false,
    skipNextLockDelta: false,
    lockedUsed: false,
  };
}, { passive: true });

window.addEventListener('pointermove', e => {
  if (!pointerTrack || e.pointerId !== pointerTrack.id) return;
  const locked = isCanvasPointerLocked();
  const dx = locked ? (e.movementX || 0) : (e.clientX - pointerTrack.lastX);
  const dy = locked ? (e.movementY || 0) : (e.clientY - pointerTrack.lastY);
  if (!locked) {
    pointerTrack.lastX = e.clientX;
    pointerTrack.lastY = e.clientY;
  }
  if (locked && pointerTrack.skipNextLockDelta) {
    pointerTrack.skipNextLockDelta = false;
    if (Math.hypot(dx, dy) > 80) return;
  }
  if (!pointerTrack.moved && (locked || Math.hypot(e.clientX - pointerTrack.x, e.clientY - pointerTrack.y) > 4)) {
    pointerTrack.moved = true;
    if (pointerTrack.onCanvas) {
      transition = null;
      if (state.autoHide && !state.manualHidden) {
        setAutoHidden(true);
      }
    }
  }
  if (!locked) maybeLockPointerAtEdge(e.clientX, e.clientY, dx, dy);
  if (pointerTrack.onCanvas && pointerTrack.moved) {
    applyPointerDelta(dx, dy, pointerTrack.panMode);
  }
}, { passive: true });

window.addEventListener('pointerup', e => {
  if (!pointerTrack || e.pointerId !== pointerTrack.id) return;
  const { moved: wasMoved, button, onCanvas, startedOutsideDrawer, lockedUsed } = pointerTrack;
  pointerTrack = null;
  exitCanvasPointerLock();
  try {
    if (renderer.domElement.hasPointerCapture?.(e.pointerId)) {
      renderer.domElement.releasePointerCapture(e.pointerId);
    }
  } catch {}
  if (wasMoved && onCanvas) {
    if (state.freeMode) {
      captureCameraPose();
      saveState();
    } else if (lockedUsed) {
      scheduleCameraPoseSave();
    }
  }
  if (!wasMoved && state.autoHidden) {
    setAutoHidden(false);
  }
  if (!wasMoved && button === 0 && state.panel && startedOutsideDrawer && !e.target.closest?.('#drawer, .rail, .flow-state, #credits, .telemetry-popover')) {
    setPanel(null);
  }
}, { passive: true });

window.addEventListener('pointercancel', e => {
  exitCanvasPointerLock();
  try {
    if (renderer.domElement.hasPointerCapture?.(e.pointerId)) {
      renderer.domElement.releasePointerCapture(e.pointerId);
    }
  } catch {}
  pointerTrack = null;
}, { passive: true });

renderer.domElement.addEventListener('wheel', e => {
  if (!state.freeMode) return;
  e.preventDefault();
  transition = null;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const refDist = THREE.MathUtils.clamp(camera.position.length(), .8, 24);
  const step = -THREE.MathUtils.clamp(e.deltaY, -120, 120) * .0025 * refDist;
  camera.position.addScaledVector(forward, step);
  orbit.target.addScaledVector(forward, step);
  scheduleCameraPoseSave();
}, { passive: false });

const FREE_MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const freeKeys = new Set();
window.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select, button, dialog, [contenteditable]')) {
    if (e.code === 'Escape' && state.panel) setPanel(null);
    return;
  }
  if (e.code === 'Escape') {
    if (state.panel) setPanel(null);
    closeAllTelemetryPopovers();
    return;
  }
  if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    $('interface-toggle')?.click();
    return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.code === 'Digit0') { activateFreeView(); return; }
    if (e.code === 'Digit1') { setView('hero'); return; }
    if (e.code === 'Digit2') { setView('front'); return; }
    if (e.code === 'Digit3') { setView('side'); return; }
    if (e.code === 'Digit4') { setView('drs'); return; }
    if (e.code === 'Digit5') { setView('floor'); return; }
  }
  if (FREE_MOVE_KEYS.has(e.code)) {
    e.preventDefault();
    transition = null;
    markFreeCameraActive();
    freeKeys.add(e.code);
    if (state.autoHide && !state.manualHidden) setAutoHidden(true);
  }
});
window.addEventListener('keyup', e => {
  if (freeKeys.delete(e.code) && state.freeMode) {
    captureCameraPose();
    saveState();
  }
});
window.addEventListener('blur', () => freeKeys.clear());
window.addEventListener('pagehide', () => {
  if (cameraSaveTimer) {
    clearTimeout(cameraSaveTimer);
    cameraSaveTimer = 0;
    captureCameraPose();
    saveState();
  }
});

function moveFreeCamera(dt) {
  if (!freeKeys.size) return;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const delta = new THREE.Vector3();
  const fwdInput = Number(freeKeys.has('KeyW') || freeKeys.has('ArrowUp')) - Number(freeKeys.has('KeyS') || freeKeys.has('ArrowDown'));
  const rightInput = Number(freeKeys.has('KeyD') || freeKeys.has('ArrowRight')) - Number(freeKeys.has('KeyA') || freeKeys.has('ArrowLeft'));
  const upInput = Number(freeKeys.has('KeyQ') || freeKeys.has('Space')) - Number(freeKeys.has('KeyE'));
  delta.addScaledVector(forward, fwdInput);
  delta.addScaledVector(right, rightInput);
  delta.y += upInput;
  if (delta.lengthSq() > 0) {
    const speed = (freeKeys.has('ShiftLeft') || freeKeys.has('ShiftRight')) ? 4.2 : 1.35;
    delta.normalize().multiplyScalar(dt * speed);
    camera.position.add(delta);
    orbit.target.add(delta);
  }
}

const views = {
  hero: { position: [5.0, 2.45, 6.1], target: [0, .56, 0] },
  front: { position: [3.05, 1.12, 3.85], target: [.06, .42, .94] },
  side: { position: [8.2, .85, .15], target: [0, .52, 0] },
  drs: { position: [1.55, 1.65, -4.35], target: [0, .94, -2.45] },
  floor: { position: [0, -8.6, .65], target: [0, .18, 0] },
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
function rotateViewByTurntable(view) {
  const angle = carTurntable.rotation.y;
  if (Math.abs(angle) < 1e-6) return view;
  const p = new THREE.Vector3(...view.position).applyAxisAngle(Y_AXIS, angle);
  const t = new THREE.Vector3(...view.target).applyAxisAngle(Y_AXIS, angle);
  return { position: p.toArray(), target: t.toArray() };
}

function resolveView(name, forFreeLanding = false) {
  const drsZ = rig?.config.drs ? (rig.config.drs.hinge[2] + rig.config.drs.base[2]) * .5 : -2.45;
  const drsY = rig?.config.drs ? (rig.config.drs.hinge[1] + rig.config.drs.base[1]) * .5 - .08 : .94;
  const frontZ = rig?.config.wheels?.FL?.center ? rig.config.wheels.FL.center[2] * .62 : .94;
  if (name === 'hero') {
    if (state.environment === 'wind') {
      return { position: [5.0, 2.42, 7.2], target: [0, .60, 0] };
    }
    if (state.environment === 'eau-rouge') {
      return forFreeLanding
        ? { position: [3.5, 2.3, -11], target: [-4, 4.6, 22] }
        : { position: [4.2, 2.15, -9.2], target: [0, .62, 0] };
    }
    return views.hero;
  }
  if (name === 'front') {
    return rotateViewByTurntable({ position: [3.05, 1.12, 3.85], target: [.06, .42, frontZ] });
  }
  if (name === 'drs') {
    return rotateViewByTurntable({ position: [1.55, 1.65, drsZ - 1.9], target: [0, drsY, drsZ] });
  }
  return rotateViewByTurntable(views[name] || views.hero);
}

function applyFraming() {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.fov = width <= 620
    ? (state.environment === 'wind' && state.view === 'side' ? 80 : 60)
    : state.environment === 'eau-rouge' && state.view === 'hero'
      ? 46
      : 34;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  worlds.resize(width, height);
  if ((width <= 620) !== wasNarrow) {
    wasNarrow = width <= 620;
    setView(state.view, true, state.freeMode);
  }
}

function applyInstantOrbitPose(pos, target) {
  const prevDamping = orbit.enableDamping;
  orbit.enableDamping = false;
  camera.position.copy(pos);
  orbit.target.copy(target);
  orbit.update();
  orbit.enableDamping = prevDamping;
  syncLookFromTarget(pos, target);
}

function setView(name, instant = false, keepFreeBadge = false, resetSavedPose = true) {
  if (!views[name]) name = 'hero';
  state.view = name;
  if (resetSavedPose) clearSavedCameraPose();
  $('app').classList.toggle('detail-view', name === 'drs' || name === 'floor' || name === 'front');
  setCameraMode(keepFreeBadge);
  document.querySelectorAll('[data-view]').forEach(b => {
    b.setAttribute('aria-pressed', String(!keepFreeBadge && b.dataset.view === name));
  });
  camera.fov = viewport.clientWidth <= 620
    ? (state.environment === 'wind' && name === 'side' ? 80 : 60)
    : state.environment === 'eau-rouge' && name === 'hero'
      ? 46
      : 34;
  camera.updateProjectionMatrix();

  const useSavedPose = !resetSavedPose && savedCameraPose && savedCameraPose.environment === state.environment;
  const view = useSavedPose ? savedCameraPose : resolveView(name, keepFreeBadge);
  const pos = new THREE.Vector3(...view.position);
  const target = new THREE.Vector3(...view.target);
  if (!useSavedPose && viewport.clientWidth <= 620) {
    const distanceFactor = { hero: 1.08, front: 1.12, side: state.environment === 'wind' ? .68 : 1.12, drs: 1.05, floor: .95 }[name] || 1.08;
    pos.sub(target).multiplyScalar(distanceFactor).add(target);
  }
  if (instant || reducedMotion) {
    transition = null;
    applyInstantOrbitPose(pos, target);
  } else {
    transition = {
      start: performance.now(),
      position: camera.position.clone(),
      target: orbit.target.clone(),
      endPosition: pos,
      endTarget: target,
    };
  }
}

function activateFreeView() {
  if (state.view === 'floor' || camera.position.y < 0) {
    setView('hero', false, true);
  } else {
    transition = null;
    captureCameraPose();
    markFreeCameraActive();
  }
}

$('free-camera')?.addEventListener('click', e => {
  activateFreeView();
  e.currentTarget.blur();
});

renderer.domElement.addEventListener('dblclick', e => {
  if (!currentModel) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const hits = ray.intersectObject(currentModel, true);
  if (!hits.length) return;
  const hitPoint = hits[0].point.clone();
  const currentDist = camera.position.distanceTo(hitPoint);
  const desiredDistance = THREE.MathUtils.clamp(currentDist * .65, .75, 4.2);
  let dir;
  if (state.freeMode) {
    dir = new THREE.Vector3();
    camera.getWorldDirection(dir).negate();
  } else {
    dir = camera.position.clone().sub(orbit.target);
    if (dir.lengthSq() < 1e-6) dir.copy(camera.position).sub(hitPoint);
    dir.normalize();
  }
  const endPos = hitPoint.clone().add(dir.multiplyScalar(desiredDistance));
  if (reducedMotion) {
    transition = null;
    applyInstantOrbitPose(endPos, hitPoint);
    captureCameraPose();
    saveState();
  } else {
    transition = {
      start: performance.now(),
      position: camera.position.clone(),
      target: orbit.target.clone(),
      endPosition: endPos,
      endTarget: hitPoint,
      savePose: true,
    };
  }
});

function setPanel(name) {
  const next = state.panel === name ? null : name;
  state.panel = next;
  const drawer = $('drawer');
  if (drawer) drawer.hidden = !next;
  document.querySelectorAll('.rail-button').forEach(btn => {
    btn.setAttribute('aria-expanded', String(btn.dataset.panel === next));
  });
  document.querySelectorAll('.drawer .panel').forEach(panel => {
    panel.hidden = panel.id !== `panel-${next}`;
  });
}

document.querySelectorAll('.rail-button').forEach(btn => {
  btn.addEventListener('click', () => setPanel(btn.dataset.panel));
});
document.querySelectorAll('[data-close-panel]').forEach(btn => {
  btn.addEventListener('click', () => setPanel(null));
});
function updatePopoverPosition(item) {
  const pop = item.querySelector('.telemetry-popover');
  if (!pop) return;
  const itemRect = item.getBoundingClientRect();
  const topDock = item.closest('.downforce-dock')?.getBoundingClientRect();
  const hudRect = topDock ? null : document.querySelector('.hud')?.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 224;
  const minLeft = hudRect ? hudRect.left : 16;
  const maxLeft = Math.max(minLeft, (hudRect ? hudRect.right : window.innerWidth - 16) - popWidth);
  const idealLeft = itemRect.left + itemRect.width / 2 - popWidth / 2;
  const clampedLeft = Math.min(maxLeft, Math.max(minLeft, idealLeft));
  pop.style.setProperty('--popover-shift', `${Math.round(clampedLeft - idealLeft)}px`);
  const lift = topDock
    ? Math.max(10, Math.round(topDock.bottom - itemRect.bottom + 10))
    : hudRect
      ? Math.max(10, Math.round(itemRect.top - hudRect.top + 10))
      : 10;
  pop.style.setProperty('--popover-lift', `${lift}px`);
}

document.querySelectorAll('.telemetry-item').forEach(item => {
  const btn = item.querySelector('.readout');
  const range = item.querySelector('input[type="range"]');
  const openItem = () => {
    document.querySelectorAll('.telemetry-item.is-open').forEach(other => {
      if (other !== item && !other.classList.contains('is-dragging')) {
        other.classList.remove('is-open');
        other.querySelector('.readout')?.setAttribute('aria-expanded', 'false');
      }
    });
    updatePopoverPosition(item);
    item.classList.add('is-open');
    btn?.setAttribute('aria-expanded', 'true');
  };
  const closeItem = () => {
    item.classList.remove('is-open', 'is-dragging');
    btn?.setAttribute('aria-expanded', 'false');
    if (item.contains(document.activeElement)) document.activeElement.blur();
  };
  item.addEventListener('pointerenter', () => {
    openItem();
  });
  item.addEventListener('pointerleave', () => {
    if (!item.classList.contains('is-dragging')) closeItem();
  });
  btn?.addEventListener('click', e => {
    e.stopPropagation();
    if (e.pointerType === 'touch') {
      if (item.classList.contains('is-open')) closeItem();
      else openItem();
    } else {
      openItem();
    }
  });
  range?.addEventListener('pointerdown', () => {
    item.classList.add('is-dragging');
    const onUp = () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      item.classList.remove('is-dragging');
      if (!item.matches(':hover')) closeItem();
    };
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
  });
});
document.querySelector('.flow-state')?.addEventListener('click', e => {
  if (e.target.closest('button')) return;
  setPanel('flow');
});

function setEnvironment(name) {
  if (!['studio', 'wind', 'eau-rouge'].includes(name)) return;
  const envChanged = state.environment !== name;
  state.environment = name;
  if (envChanged) clearSavedCameraPose();
  $('app').dataset.environment = name;
  document.querySelectorAll('[data-environment]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.environment === name)));
  worlds.set(name, rig?.config.year || (state.model === 'rb19' ? 2023 : 2021));
  $('scene-label').textContent = {
    studio: '纯白无缝影棚',
    wind: '风洞试验段',
    'eau-rouge': 'Eau Rouge · 坡底望向 Raidillon',
  }[name];
  $('scene-detail').textContent = name === 'eau-rouge'
    ? '斯帕 · 谷底仰视上坡与盲顶'
    : name === 'wind'
      ? '原创全尺寸风洞场景 · 气流来自自由外流算例'
      : '纯白影棚打光 · 聚焦赛车曲面与流线细节';
  orbit.maxDistance = name === 'eau-rouge' ? 120 : 18;
  floor.position.y = name === 'studio' ? -.035 : -.003;
  floor.material.opacity = name === 'studio' ? .42 : .24;
  floor.visible = name !== 'eau-rouge';
  eauRougeFloor.visible = name === 'eau-rouge';
  key.position.set(...(name === 'wind' || name === 'studio' ? [3, 6, 4] : [-4.5, 6.0, 2.0]));
  const shadowSpan = name === 'eau-rouge' ? 6 : 4;
  Object.assign(key.shadow.camera, {
    left: -shadowSpan,
    right: shadowSpan,
    top: shadowSpan,
    bottom: -shadowSpan,
    far: name === 'eau-rouge' ? 24 : 18,
  });
  key.shadow.camera.updateProjectionMatrix();
  scene.environmentIntensity = name === 'studio' ? .82 : name === 'wind' ? .68 : .9;
  key.intensity = name === 'studio' ? 3.5 : name === 'wind' ? 3.2 : 2.2;
  fill.intensity = name === 'studio' ? 1.45 : name === 'wind' ? 1.2 : .8;
  syncTurntable();
  setView(state.view, true, state.freeMode, false);
  renderer.shadowMap.needsUpdate = true;
  saveState();
}

function formatWindLabel(deg) {
  if (Math.abs(deg) < .5) return '正迎风 0°';
  return `${deg < 0 ? '左侧' : '右侧'} ${deg > 0 ? '+' : ''}${deg}°`;
}

function formatWindSide(deg) {
  if (Math.abs(deg) < .5) return '正迎风';
  if (deg <= -89.5) return '纯左侧风';
  if (deg >= 89.5) return '纯右侧风';
  return deg < 0 ? '左侧来流' : '右侧来流';
}

let lastForcesKey = '';
const forceNodes = {
  tDownforce: $('t-downforce'),
  tDrag: $('t-drag'),
  downVal: $('hud-downforce-value'),
  rel: $('hud-rel-airflow'),
  dfGrid: $('hud-downforce-pct'),
  dragVal: $('hud-drag-value'),
  sideVal: $('hud-side-value'),
  ldVal: $('hud-ld-ratio'),
  rawVal: $('hud-raw-downforce'),
  note: $('hud-force-note'),
};
const statusNodes = {
  sweep: $('sweep-status'),
  yaw: $('yaw-status'),
  underbody: $('underbody-status'),
  sidepod: $('sidepod-status'),
};

function updateForcesDisplay(force = false) {
  const yawLen = aeroForces.data?.axes?.yaw?.length || 0;
  const fKey = `${state.model}:${state.speed.toFixed(2)}:${state.groundSpeed}:${state.windAngle}:${state.drsCurrent.toFixed(3)}:${state.steer}:${aeroForces.car}:${yawLen}`;
  if (!force && fKey === lastForcesKey) return;
  lastForcesKey = fKey;
  const forces = aeroForces.estimate(state);
  const pctSign = forces.downforceDeltaPct > 0 ? '+' : '';
  const pctStr = `${pctSign}${forces.downforceDeltaPct}%`;
  const dragSign = forces.dragDeltaPct > 0 ? '+' : '';
  const dragPctStr = `${dragSign}${forces.dragDeltaPct}%`;
  if (forceNodes.tDownforce) {
    forceNodes.tDownforce.innerHTML = `${forces.downforceN}<small>N · ${pctStr}</small>`;
    forceNodes.tDownforce.classList.toggle('is-lift', forces.downforceN < 0);
  }
  if (forceNodes.tDrag) {
    forceNodes.tDrag.innerHTML = `${forces.dragN}<small>N · ${dragPctStr}</small>`;
  }
  if (forceNodes.downVal) forceNodes.downVal.textContent = `${forces.downforceN} N (${pctStr})`;
  if (forceNodes.rel) forceNodes.rel.textContent = `${forces.relSpeedKmh} km/h · ${forces.effWindAngleDeg > 0 ? '+' : ''}${forces.effWindAngleDeg.toFixed(1)}°`;
  if (forceNodes.dfGrid) forceNodes.dfGrid.textContent = `${forces.downforceN} N · ${pctStr}`;
  if (forceNodes.dragVal) forceNodes.dragVal.textContent = `${forces.dragN} N · ${dragPctStr}`;
  const sideDir = Math.abs(forces.sideN) < 5 ? '' : forces.sideN < 0 ? '（向车左）' : '（向车右）';
  if (forceNodes.sideVal) forceNodes.sideVal.textContent = `${forces.sideN > 0 ? '+' : ''}${forces.sideN} N${sideDir}`;
  if (forceNodes.ldVal) forceNodes.ldVal.textContent = forces.liftToDrag !== null ? `${forces.liftToDrag.toFixed(2)}` : '—';
  if (forceNodes.rawVal) forceNodes.rawVal.textContent = `${forces.rawCfdDownforceN} N`;
  if (forceNodes.note) {
    forceNodes.note.textContent = forces.mirroredYawForce
      ? '负向侧风暂用右侧对应实算镜像（完整 5° 队列后台求解中），基于 180 km/h F1 基准估算。'
      : forces.downforceN < 0
        ? '大侧风工况下纵向下压力大幅衰减并呈失速/微正升力趋势，基于 OpenFOAM 实算趋势估算。'
        : '基于 180 km/h F1 参考基准与 OpenFOAM 实算工况趋势连续估算，仅作直观量级参考。';
  }
}

function showState() {
  const rel = resolveRelativeWind(state);
  state.speed = rel.relSpeedKmh;
  state.effWindAngle = rel.effWindAngleDeg;
  const windMps = state.ambientWindMps;
  const windMpsText = windMps.toFixed(1);
  const drsPct = Math.round(state.drs * 100);
  const steerText = `${state.steer > 0 ? '+' : ''}${state.steer}`;
  const windDeg = Math.round(state.windAngle || 0);
  const windShort = `${windDeg > 0 ? '+' : ''}${windDeg}`;
  const effYawText = formatWindSide(windDeg);
  const radius = rig?.config.wheels.FL.radius || .369;
  state.wheelSpeedMps = state.groundSpeed / 3.6;
  state.wheelRpm = state.wheelSpeedMps / radius / (Math.PI * 2) * 60;
  const rpmRounded = Math.round(state.wheelRpm);

  $('flow-density').value = state.flowDensity;
  $('flow-density-value').textContent = `${state.flowDensity}%`;
  $('drs').value = drsPct;
  $('steer').value = state.steer;
  $('speed').value = windMps;
  if ($('wind-angle')) $('wind-angle').value = windDeg;
  $('ground-speed').value = state.groundSpeed;

  $('drs-value').textContent = `${drsPct}%`;
  $('speed-value').textContent = `${windMpsText} m/s`;
  if ($('wind-angle-value')) $('wind-angle-value').textContent = formatWindLabel(windDeg);
  if ($('wind-angle-side')) $('wind-angle-side').textContent = effYawText;
  $('ground-speed-value').textContent = `${state.groundSpeed} km/h`;
  $('wheel-value').textContent = `${rpmRounded} rpm`;
  $('wind-speed').textContent = `合成来流 ${Math.round(rel.relSpeedKmh)} km/h (${rel.relSpeedMps.toFixed(1)} m/s)`;
  $('steer-value').textContent = `${steerText}°`;

  const flowToggle = $('flow-toggle');
  if (flowToggle) {
    flowToggle.setAttribute('aria-checked', String(state.flow));
    flowToggle.setAttribute('aria-pressed', String(state.flow));
  }
  const drsToggle = $('drs-toggle');
  if (drsToggle) {
    drsToggle.textContent = state.drs > .5 ? '关闭' : '打开';
    drsToggle.setAttribute('aria-pressed', String(state.drs > .5));
  }

  const maxRpm = Math.round((350 / 3.6) / radius / (Math.PI * 2) * 60);
  if ($('hud-speed')) $('hud-speed').value = windMps;
  if ($('hud-wind-angle')) $('hud-wind-angle').value = windDeg;
  if ($('hud-ground-speed')) $('hud-ground-speed').value = state.groundSpeed;
  if ($('hud-drs')) $('hud-drs').value = drsPct;
  if ($('hud-steer')) $('hud-steer').value = state.steer;
  if ($('hud-rpm')) $('hud-rpm').value = state.groundSpeed;

  if ($('hud-speed-value')) $('hud-speed-value').textContent = `${windMpsText} m/s`;
  if ($('hud-wind-speed')) $('hud-wind-speed').textContent = `合成 ${Math.round(rel.relSpeedKmh)} km/h`;
  if ($('hud-wind-angle-value')) $('hud-wind-angle-value').textContent = formatWindLabel(windDeg);
  if ($('hud-wind-side')) $('hud-wind-side').textContent = effYawText;
  if ($('hud-ground-speed-value')) $('hud-ground-speed-value').textContent = `${state.groundSpeed} km/h`;
  if ($('hud-wheel-value')) $('hud-wheel-value').textContent = `纯滚动 · ${rpmRounded} rpm`;
  if ($('hud-drs-value')) $('hud-drs-value').textContent = `${drsPct}%`;
  if ($('hud-steer-value')) $('hud-steer-value').textContent = `${steerText}°`;
  if ($('hud-rpm-value')) $('hud-rpm-value').textContent = `${rpmRounded} rpm`;
  if ($('hud-rpm-ground')) $('hud-rpm-ground').textContent = `对地 ${state.groundSpeed} km/h`;
  if ($('hud-rpm-max')) $('hud-rpm-max').textContent = `${maxRpm} rpm`;

  const hudDrsToggle = $('hud-drs-toggle');
  if (hudDrsToggle) {
    hudDrsToggle.textContent = state.drs > .5 ? '关闭' : '打开';
    hudDrsToggle.setAttribute('aria-pressed', String(state.drs > .5));
  }

  if ($('t-speed')) $('t-speed').innerHTML = `${windMpsText}<small>m/s</small>`;
  if ($('t-wind-angle')) $('t-wind-angle').innerHTML = `${windShort}<small>°</small>`;
  if ($('t-ground')) $('t-ground').innerHTML = `${state.groundSpeed}<small>km/h</small>`;
  if ($('t-drs')) $('t-drs').innerHTML = `${drsPct}<small>%</small>`;
  if ($('t-steer')) $('t-steer').innerHTML = `${steerText}<small>°</small>`;
  if ($('t-rpm')) $('t-rpm').innerHTML = `${rpmRounded}<small>rpm</small>`;
  syncTurntable();
  updateForcesDisplay();
  saveState();
}

const loadedCarsInSession = new Set();

function setFirstLoadVeil(active, config = null) {
  const veil = $('first-load-veil');
  if (!veil) return;
  if (active && config) {
    const badge = $('first-load-model');
    if (badge) badge.textContent = `${config.name} ${config.year}`;
  }
  veil.classList.toggle('is-hidden', !active);
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
  let loadSettled = false;
  $('error').hidden = true;
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = `正在加载 ${config.name}…`;
  setFirstLoadVeil(false);
  document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === id)));
  state.model = id;
  saveState();
  try {
    const modelFile = config.web_file || config.file;
    const modelVersion = config.web_revision || config.revision || config.web_glb_bytes || config.glb_bytes;
    const modelUrl = `${modelFile}?v=${modelVersion}`;
    const expectedBytes = config.web_glb_bytes || config.glb_bytes || 0;
    if (!loadedCarsInSession.has(id)) {
      hasCachedAsset(modelUrl).then(cached => {
        if (serial === loadSerial && !loadSettled && !cached) setFirstLoadVeil(true, config);
      }).catch(() => {});
    }
    airflow.load(id, { autoSecondary: false });
    aeroForces.load(id).then(() => updateForcesDisplay(true)).catch(() => {});
    const [buffer] = await Promise.all([
      cachedArrayBuffer(modelUrl, {
        onProgress: (loadedBytes, headerTotal) => {
          if (serial !== loadSerial) return;
          const denom = expectedBytes || headerTotal;
          if (denom) $('loading-text').textContent = `${config.name} / ${Math.min(100, Math.round(loadedBytes / denom * 100))}%`;
        },
      }),
      MeshoptDecoder.ready,
    ]);
    if (serial !== loadSerial) return;
    const loaded = await loader.parseAsync(buffer, '/');
    if (serial !== loadSerial) { disposeModel(loaded.scene); return; }
    const nextRig = bindRig(loaded.scene, config);
    loaded.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.geometry.attributes.position.count > 30) o.geometry.computeBoundsTree();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(m)) if (value?.isTexture) value.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        }
      }
    });
    if (currentModel) { carTurntable.remove(currentModel); disposeModel(currentModel); }
    currentModel = loaded.scene;
    rig = nextRig;
    carTurntable.add(currentModel);
    setEnvironment(state.environment);
    // Fallback timer ensures secondary layers still load if flow is initially toggled off
    setTimeout(() => startSecondaryLayers(serial, id), 800);
    showState();
    state.spin = 0;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    renderer.shadowMap.needsUpdate = true;
    if ($('model-name')) $('model-name').innerHTML = `${config.name}<span>.</span>`;
    $('era').textContent = `${config.year} / ${id === 'rb19' ? 'GROUND EFFECT' : 'HYBRID ERA'}`;
    loadSettled = true;
    loadedCarsInSession.add(id);
    setFirstLoadVeil(false);
    $('loading').classList.add('hidden');
    window.dispatchEvent(new CustomEvent('aero:modelready', { detail: id }));
  } catch (error) {
    if (serial !== loadSerial) return;
    loadSettled = true;
    setFirstLoadVeil(false);
    $('loading').classList.add('hidden');
    $('error').hidden = false;
    $('error-message').textContent = `模型暂时未能打开：${error.message}`;
    console.error(error);
    throw error;
  }
}

document.querySelectorAll('[data-model]').forEach(b => b.addEventListener('click', () => loadModel(b.dataset.model).catch(() => {})));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view, false, false)));
$('auto-hide-toggle')?.addEventListener('click', e => {
  state.autoHide = !state.autoHide;
  e.currentTarget.setAttribute('aria-pressed', String(state.autoHide));
  if (!state.autoHide) setAutoHidden(false);
  saveState();
});
$('interface-toggle').addEventListener('click', e => {
  const hidden = $('app').classList.toggle('interface-hidden');
  state.manualHidden = hidden;
  if (hidden) {
    setAutoHidden(false);
    closeAllTelemetryPopovers();
  }
  document.querySelectorAll('.chrome, .drawer').forEach(el => {
    if (el.id === 'drawer') el.hidden = hidden || !state.panel;
    else el.hidden = hidden;
  });
  const textEl = e.currentTarget.querySelector('.toggle-text');
  if (textEl) textEl.textContent = hidden ? '显示界面' : '手动隐藏';
  e.currentTarget.setAttribute('aria-pressed', String(hidden));
});

$('flow-density').addEventListener('input', e => { state.flowDensity = Number(e.target.value); showState(); });
$('drs').addEventListener('input', e => { state.drs = Number(e.target.value) / 100; showState(); });
$('steer').addEventListener('input', e => { state.steer = Number(e.target.value); showState(); });
$('speed').addEventListener('input', e => { state.ambientWindMps = Number(e.target.value); showState(); });
$('wind-angle')?.addEventListener('input', e => { state.windAngle = Number(e.target.value); showState(); });
$('center-wind')?.addEventListener('click', () => { state.windAngle = 0; showState(); });
$('drs-toggle').addEventListener('click', () => { state.drs = state.drs > .5 ? 0 : 1; showState(); });
$('center-steering').addEventListener('click', () => { state.steer = 0; showState(); });
$('hud-speed')?.addEventListener('input', e => { state.ambientWindMps = Number(e.target.value); showState(); });
$('hud-wind-angle')?.addEventListener('input', e => { state.windAngle = Number(e.target.value); showState(); });
$('hud-center-wind')?.addEventListener('click', () => { state.windAngle = 0; showState(); });
$('hud-ground-speed')?.addEventListener('input', e => { state.groundSpeed = Number(e.target.value); showState(); });
$('hud-drs')?.addEventListener('input', e => { state.drs = Number(e.target.value) / 100; showState(); });
$('hud-drs-toggle')?.addEventListener('click', () => { state.drs = state.drs > .5 ? 0 : 1; showState(); });
$('hud-steer')?.addEventListener('input', e => { state.steer = Number(e.target.value); showState(); });
$('hud-center-steering')?.addEventListener('click', () => { state.steer = 0; showState(); });
$('hud-rpm')?.addEventListener('input', e => { state.groundSpeed = Number(e.target.value); showState(); });
$('reset').addEventListener('click', () => {
  applyOperatingDefaults();
  showState();
});
document.querySelectorAll('[data-environment]').forEach(b => b.addEventListener('click', () => setEnvironment(b.dataset.environment)));
$('ground-speed').addEventListener('input', e => { state.groundSpeed = Number(e.target.value); showState(); });
$('flow-toggle').addEventListener('click', () => {
  state.flow = !state.flow;
  airflow.setEnabled(state.flow);
  if (!state.flow) updateFlowStatus('流线已隐藏');
  showState();
});

async function resetToInitialState() {
  setPanel(null);
  closeAllTelemetryPopovers();
  clearSavedCameraPose();
  const activeModel = state.model || DEFAULT_CONFIG.model;
  const envChanged = state.environment !== DEFAULT_CONFIG.environment;
  applyOperatingDefaults({ includeFlow: true });
  state.autoHide = DEFAULT_CONFIG.autoHide;
  $('auto-hide-toggle')?.setAttribute('aria-pressed', String(state.autoHide));
  setAutoHidden(false);
  state.environment = DEFAULT_CONFIG.environment;
  state.view = DEFAULT_CONFIG.view;
  state.freeMode = DEFAULT_CONFIG.freeMode;
  airflow.setEnabled(state.flow);
  showState();
  if (!currentModel) {
    await loadModel(activeModel);
    return;
  }
  if (rig) {
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    renderer.shadowMap.needsUpdate = true;
  }
  if (envChanged) {
    setEnvironment(DEFAULT_CONFIG.environment);
    return;
  }
  setView(DEFAULT_CONFIG.view, false, false);
}

$('brand-home')?.addEventListener('click', e => {
  e.preventDefault();
  resetToInitialState().catch(() => {});
});
$('flow-retry').addEventListener('click', () => airflow.load(state.model));
// Recover automatically when the network comes back instead of waiting for a manual retry.
window.addEventListener('online', () => { if (airflow.stats.error && !airflow.stats.ready) airflow.load(state.model); });
$('retry').addEventListener('click', () => loadModel(state.model).catch(() => {}));
$('credits-button').addEventListener('click', () => $('credits').showModal());
$('close-credits').addEventListener('click', () => $('credits').close());
$('credits').addEventListener('click', e => {
  if (e.target === $('credits')) {
    const r = $('credits').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('credits').close();
  }
});
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  $('error').hidden = false;
  $('error-message').textContent = '图形上下文已中断，请刷新页面重新打开模型。';
});

window.addEventListener('resize', applyFraming);
document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === state.model)));
if ($('era')) $('era').textContent = state.model === 'rb19' ? '2023 / GROUND EFFECT' : '2021 / HYBRID ERA';
$('auto-hide-toggle')?.setAttribute('aria-pressed', String(state.autoHide));
applyFraming();
setEnvironment(state.environment);
showState();
persistenceReady = true;

renderer.setAnimationLoop(now => {
  const elapsed = Math.max(0, (now - lastTime) / 1000), dt = Math.min(elapsed, .05);
  lastTime = now;
  if (transition) {
    const t = Math.min((now - transition.start) / 850, 1);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.position, transition.endPosition, ease);
    orbit.target.lerpVectors(transition.target, transition.endTarget, ease);
    if (t === 1) {
      const saveTransitionPose = Boolean(transition.savePose);
      transition = null;
      applyInstantOrbitPose(camera.position, orbit.target);
      if (saveTransitionPose) {
        captureCameraPose();
        saveState();
      }
    } else {
      syncLookFromTarget(camera.position, orbit.target);
    }
  } else if (state.freeMode) {
    moveFreeCamera(dt);
    applyLookOrientation(dt);
  } else {
    orbit.update();
  }
  state.drsCurrent = reducedMotion ? state.drs : THREE.MathUtils.damp(state.drsCurrent, state.drs, 9, Math.min(elapsed, .5));
  if (Math.abs(state.drsCurrent - state.drs) < .001) state.drsCurrent = state.drs;
  state.spin += state.wheelSpeedMps * dt;
  if (rig && (rig._lastDrs !== state.drsCurrent || rig._lastSteer !== state.steer || rig._lastSpin !== state.spin)) {
    const shadowDirty = rig._lastDrs !== state.drsCurrent || rig._lastSteer !== state.steer;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    if (shadowDirty) renderer.shadowMap.needsUpdate = true;
  }

  flowJobs.update(state, rig, dt, now);
  updateForcesDisplay();
  const coverage = airflow.stats.sweepCoverage;
  const coverageText = coverage
    ? `逐档 ${coverage.completed}/${coverage.planned} · ${coverage.queueState === 'failed' ? '计算中断' : coverage.queueState === 'complete' ? '已完成' : coverage.complete ? '校验中' : '计算中'}`
    : '';
  if (statusNodes.sweep && statusNodes.sweep.textContent !== coverageText) statusNodes.sweep.textContent = coverageText;

  const yawCoverage = airflow.stats.yawCoverage;
  const yawText = yawCoverage
    ? `侧风 ±90°（5°）${yawCoverage.completed}/${yawCoverage.planned} · ${yawCoverage.complete ? '已全部完成' : yawCoverage.queueState === 'running' ? '后台求解中' : yawCoverage.queueState === 'failed' ? '计算中断' : '就绪'}`
    : '';
  if (statusNodes.yaw && statusNodes.yaw.textContent !== yawText) statusNodes.yaw.textContent = yawText;

  const underbodyVisible = underbody.group.visible;
  const underbodyMessage = !state.flow || state.flowDensity === 0
    ? ''
    : underbody.status === 'loading'
      ? '正在加载底盘流场…'
      : underbody.status === 'unavailable'
        ? '底盘流场暂不可用'
        : state.speed === 0 && state.wheelSpeedMps < .001
          ? '静止：来流与车轮均为零'
          : underbodyVisible
            ? (underbody.mode === 'baseline' ? '底盘加密基线 · 仍有网格差异，未充分收敛' : '底盘：加密基线叠加粗网格工况变化 · 近似预览')
            : '正在准备底盘气流…';
  if (statusNodes.underbody && statusNodes.underbody.textContent !== underbodyMessage) statusNodes.underbody.textContent = underbodyMessage;

  const sidepodVisible = sidepod.group.visible;
  const sidepodMessage = !state.flow || state.flowDensity === 0
    ? ''
    : sidepod.status === 'loading'
      ? '正在加载侧箱及悬挂流场…'
      : sidepod.status === 'unavailable'
        ? '侧箱及悬挂加密流场暂不可用'
        : state.speed === 0 && state.wheelSpeedMps < .001
          ? ''
          : sidepodVisible
            ? (sidepod.mode === 'baseline' ? '侧箱及悬挂：探索性加密基线，未充分收敛' : '侧箱及悬挂：近似预览，缺失处沿用缩放基线')
            : '正在准备侧箱及悬挂气流…';
  if (statusNodes.sidepod && statusNodes.sidepod.textContent !== sidepodMessage) statusNodes.sidepod.textContent = sidepodMessage;

  const prevForestReady = worlds.lastForestReady;
  worlds.update(dt, state.speed, state.groundSpeed);
  if (worlds.kind === 'eau-rouge' && !prevForestReady && worlds.lastForestReady) renderer.shadowMap.needsUpdate = true;
  const underCar = (!state.freeMode && state.view === 'floor') || camera.position.y < -.05;
  floor.visible = !underCar && state.environment !== 'eau-rouge';
  eauRougeFloor.visible = !underCar && state.environment === 'eau-rouge';
  floorInspectionLight.visible = underCar;

  const near = THREE.MathUtils.clamp((state.freeMode ? camera.position.length() : camera.position.distanceTo(orbit.target)) * .004, .025, .5);
  if (Math.abs(camera.near - near) > .001) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  worlds.render(camera, scene, !underCar);
  renderer.render(scene, camera);
  frameCount++;
  if (now - statsTime > 1000) {
    fps = frameCount * 1000 / (now - statsTime);
    frameCount = 0;
    statsTime = now;
  }
});

// Read-only diagnostics plus explicit controls for reproducible browser QA.
window.aeroStudio = {
  get ready() { return Boolean(rig); },
  get airflow() { return { ...airflow.stats, visible: airflow.group.visible, state: { ...state } }; },
  get forces() { return aeroForces.estimate(state); },
  get turntable() { return { carYawDeg: THREE.MathUtils.radToDeg(carTurntable.rotation.y), environmentYawDeg: THREE.MathUtils.radToDeg(worlds.turntableYaw), fanPosition: worlds.root?.userData.fan?.position?.toArray() || null }; },
  get sidepod() { return { available: Boolean(sidepod.data), visible: sidepod.group.visible, mode: sidepod.mode, lines: sidepod.count, regions: sidepod.regions, layers: sidepod.layers, fallbackSamples: sidepod.fallbackSamples, blockedSeeds: sidepod.blockedSeeds, case: sidepod.meta?.case, time: sidepod.meta?.time }; },
  get underbody() { return { available: Boolean(underbody.data), visible: underbody.group.visible, mode: underbody.mode, lines: underbody.count, stops: underbody.stops, boundaryAxes: underbody.boundaryAxes, case: underbody.meta?.case, time: underbody.meta?.time }; },
  setEnvironment,
  setPanel,
  get environment() { return { name: worlds.kind, metadata: worlds.root?.userData.metadata, forestReady: worlds.root?.userData.forestReady, forestError: worlds.root?.userData.forestError, treeCount: worlds.root?.userData.treeCount, forestTriangles: worlds.root?.userData.forestTriangles }; },
  get modelId() { return rig?.config.id; },
  get metrics() {
    return {
      fps,
      environmentTriangles: worlds.environmentTriangles,
      environmentCalls: worlds.environmentCalls,
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      textures: renderer.info.memory.textures,
      pixelRatio: renderer.getPixelRatio(),
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
  },
  get inspection() { return rig ? inspectRig(rig) : null; },
  get bounds() { return currentModel ? new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).toArray() : null; },
  get camera() { return { position: camera.position.toArray(), target: orbit.target.toArray(), freeMode: state.freeMode, view: state.view, orbitEnabled: orbit.enabled }; },
  async selectModel(id) { await loadModel(id); },
  setView: (name, instant = false) => setView(name, instant, false),
  frameCamera(position, target, fov) {
    transition = null;
    if (fov !== undefined) { camera.fov = fov; camera.updateProjectionMatrix(); }
    applyInstantOrbitPose(new THREE.Vector3(...position), new THREE.Vector3(...target));
    markFreeCameraActive();
  },
  pickAt(x, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / viewport.clientWidth * 2 - 1, 1 - y / viewport.clientHeight * 2), camera);
    return ray.intersectObject(currentModel, true).slice(0, 8).map(hit => ({
      mesh: hit.object.name,
      material: (Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material).name,
      point: hit.point.toArray(),
      uv: hit.uv?.toArray(),
    }));
  },
  setPose(pose) {
    if (pose.drs !== undefined) state.drs = THREE.MathUtils.clamp(pose.drs, 0, 1);
    if (pose.steer !== undefined) state.steer = THREE.MathUtils.clamp(pose.steer, -18, 18);
    if (pose.ambientWindMps !== undefined) state.ambientWindMps = THREE.MathUtils.clamp(pose.ambientWindMps, 0, 15);
    if (pose.windAngle !== undefined) state.windAngle = THREE.MathUtils.clamp(pose.windAngle, -90, 90);
    if (pose.spin !== undefined) state.spin = pose.spin;
    if (pose.groundSpeed !== undefined) state.groundSpeed = THREE.MathUtils.clamp(pose.groundSpeed, 0, 350);
    state.drsCurrent = state.drs;
    showState();
    if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    renderer.shadowMap.needsUpdate = true;
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
  const response = await fetch('/models/manifest.json', { cache: import.meta.env.DEV ? 'no-store' : 'default' });
  if (!response.ok) throw new Error('模型清单尚未生成');
  const manifest = await response.json();
  configs = Object.fromEntries(manifest.map(c => [c.id, c]));
  const initialModel = configs[state.model] ? state.model : (configs.rb16b ? 'rb16b' : manifest[0]?.id);
  await loadModel(initialModel);
} catch (error) {
  $('loading').classList.add('hidden');
  $('error').hidden = false;
  $('error-message').textContent = `无法准备模型：${error.message}`;
}

if (import.meta.env.DEV) window.aeroStudio.profileSynchronousFlow = () => {
  const start = performance.now(), now = start + 1000;
  airflow.lastKey = ''; airflow.lastBuild = 0; underbody.key = ''; sidepod.key = ''; sidepod.pendingKey = '';
  airflow.update(state, rig, 0, now); const coarse = performance.now();
  underbody.update(state, rig, airflow); const bottom = performance.now();
  sidepod.update(state, rig, airflow, now); sidepod.update(state, rig, airflow, now + 200); const end = performance.now();
  return { coarseMs: coarse - start, underbodyMs: bottom - coarse, sidepodMs: end - bottom, totalMs: end - start };
};
