import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cachedArrayBuffer, hasCachedAsset } from './asset-cache.js';
import { bindRig, applyRig, inspectRig } from './rig.js';
import { FlowLayer, makeFlowMaterial } from './flow-tracing.js';
import { FlowCatalog, selectCoverage } from './flow-catalog.js';
import { captureCondition, resolveRelativeWind } from './flow-condition.js';
import { FlowJobs } from './flow-jobs.js';
import { FlowPreview } from './flow-preview.js';
import { FlowSlice } from './flow-slice.js';
import { FlowSmoke } from './flow-smoke.js';
import { FlowProbe } from './flow-probe.js';
import { computeCalibratedForces } from './aero-forces-calc.js';
import { AeroCompare, CurtainCompare } from './aero-compare.js';
import { F1_SCENARIOS } from './scenarios.js';
import { ShowroomTour } from './showroom-tour.js';
import { capturePhoto2K } from './photo-capture.js';
import { AeroAudio } from './aero-audio.js';
import { AeroHotspots } from './hotspots.js';
import { Environments, isTrackEnvironment } from './environments.js';
import { createSpaShadowGeometry } from './spa-scene.js';
import { createMonzaShadowGeometry } from './monza-scene.js';
import { createSilverstoneShadowGeometry } from './silverstone-scene.js';
import { createMonacoShadowGeometry } from './monaco-scene.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEFAULT_GROUND_SPEED = 180;
const drsEndpoint = value => Number.isFinite(value) && value >= .5 ? 1 : 0;
const DEFAULT_CONFIG = Object.freeze({
  model: 'rb16b',
  environment: 'wind',
  view: 'hero',
  freeMode: false,
  drs: 0,
  drsCurrent: 0,
  steer: 0,
  ambientWindMps: 0,
  speed: DEFAULT_GROUND_SPEED,
  windAngle: 0,
  effWindAngle: 0,
  spin: 0,
  groundSpeed: DEFAULT_GROUND_SPEED,
  wheelRpm: 0,
  wheelSpeedMps: DEFAULT_GROUND_SPEED / 3.6,
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
    ambientWindMps: 0,
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

const STORAGE_KEY = 'aero-studio:config:v3';
const VALID_ENVS = new Set(['studio', 'wind', 'eau-rouge', 'monza', 'silverstone', 'monaco']);
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
    state.ambientWindMps = 0;
    if (Number.isFinite(saved.windAngle)) state.windAngle = THREE.MathUtils.clamp(saved.windAngle, -90, 90);
    if (Number.isFinite(saved.groundSpeed)) state.groundSpeed = THREE.MathUtils.clamp(saved.groundSpeed, 0, 350);
    state.drs = drsEndpoint(saved.drs);
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
        : message.includes('组合近似')
          ? 'approx'
          : !state.flow || message.startsWith('静止 ·') || message.includes('暂无')
            ? 'idle'
            : 'ready';
    if (dotEl.dataset.tone !== tone) dotEl.dataset.tone = tone;
  }
}

const carTurntable = new THREE.Group();
carTurntable.name = 'CAR_TURNTABLE';
scene.add(carTurntable);

const flowMaterial = makeFlowMaterial();
const airflow = new FlowLayer(carTurntable, flowMaterial, 'CFD_FLOW');
const underbody = new FlowLayer(carTurntable, flowMaterial, 'UNDERBODY_FLOW');
const sidepod = new FlowLayer(carTurntable, flowMaterial, 'SIDEPOD_FLOW');
const flowPreview = new FlowPreview(carTurntable, flowMaterial);
const flowSlice = new FlowSlice(carTurntable);
const flowSmoke = new FlowSmoke(carTurntable);
const flowProbe = new FlowProbe(carTurntable, $('probe-readout'));
const aeroAudio = new AeroAudio();
const studioExt = {
  flowStyle: 'lines', // 'lines' | 'smoke'
  smokeRakeX: 0,
  sliceEnabled: false,
  sliceAxis: 'x',
  slicePosition: 0,
  sliceMetric: 'speed',
  photoWatermark: true,
};
const flowCatalog = new FlowCatalog(() => {
  updateCoverageGuidance();
  updateForcesDisplay();
  if (isForcesPopoverOpen()) aeroCompare.render(flowCatalog, state);
});
const flowJobs = new FlowJobs(flowCatalog, { whole: airflow, bottom: underbody, side: sidepod }, updateFlowStatus, flowPreview);
flowJobs.setExtras({
  smokeLayer: flowSmoke,
  getStyle: () => studioExt.flowStyle,
  getSmokeRakeX: () => studioExt.smokeRakeX,
  needsField: () => Boolean(studioExt.sliceEnabled || flowProbe.enabled),
  getSliceRequest: cond => studioExt.sliceEnabled ? {
    axis: studioExt.sliceAxis,
    position: studioExt.slicePosition,
    metric: studioExt.sliceMetric,
    refSpeedMps: Math.max(1, (cond?.speed ?? state.speed ?? 180) / 3.6),
  } : null,
  onSliceResult: res => {
    if (studioExt.sliceEnabled && (state.speed > 0 || state.wheelSpeedMps > 0)) flowSlice.applyResult(res);
    else flowSlice.setVisible(false);
  },
  onProbeResult: res => {
    const label = curtainCompare?.active ? state.model.toUpperCase() : null;
    flowProbe.applyResult(res, Math.max(1, (state.speed || 0) / 3.6), label);
  },
  onStill: () => {
    flowSlice.setVisible(false);
    flowProbe.clearResult();
  },
  onReset: () => {
    flowSlice.clear();
    flowProbe.clearResult();
  },
  onFieldUpdated: () => {
    if (flowProbe.enabled && flowProbe.pinned && flowProbe.pinnedRequest && !probePinnedIsPeer) {
      flowJobs.requestProbe(flowProbe.pinnedRequest);
    }
    if (studioExt.sliceEnabled && !flowSlice.hasData && (state.speed > 0 || state.wheelSpeedMps > 0)) {
      triggerSliceUpdate();
    }
  },
});
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

const trackShadowMat = new THREE.ShadowMaterial({
  color: '#05080c',
  opacity: .38,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  depthWrite: false,
});
const trackShadowFloors = {
  'eau-rouge': new THREE.Mesh(createSpaShadowGeometry(), trackShadowMat),
  monza: new THREE.Mesh(createMonzaShadowGeometry(), trackShadowMat),
  silverstone: new THREE.Mesh(createSilverstoneShadowGeometry(), trackShadowMat),
  monaco: new THREE.Mesh(createMonacoShadowGeometry(), trackShadowMat),
};
for (const mesh of Object.values(trackShadowFloors)) {
  mesh.receiveShadow = true;
  mesh.visible = false;
  scene.add(mesh);
}

const ORBIT_MAX_POLAR = Math.PI * .995;
const SPA_OVERVIEW_MAX_POLAR = THREE.MathUtils.degToRad(48);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .07;
orbit.rotateSpeed = 1.65;
orbit.panSpeed = 1.25;
orbit.zoomSpeed = 1.2;
orbit.minDistance = .35;
orbit.maxDistance = 18;
orbit.maxPolarAngle = ORBIT_MAX_POLAR;
orbit.screenSpacePanning = true;
orbit.enabled = !state.freeMode;

// A sub-pixel residual at normal viewport sizes. Damping otherwise approaches
// its endpoint asymptotically, leaving a tiny camera drift after input stops.
const CAMERA_SETTLE_EPSILON = 5e-5;
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
  const settled = reducedMotion || dt <= 0 || (
    Math.abs(lookState.targetYaw - lookState.yaw) <= CAMERA_SETTLE_EPSILON &&
    Math.abs(lookState.targetPitch - lookState.pitch) <= CAMERA_SETTLE_EPSILON
  );
  if (settled) {
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
  return settled;
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

function closeAllTelemetryPopovers({ includePinned = false } = {}) {
  document.querySelectorAll('.telemetry-item.is-open').forEach(item => {
    if (!includePinned && item.classList.contains('is-pinned')) return;
    item.classList.remove('is-open', 'is-dragging', 'is-pinned');
    item.querySelector('.readout')?.setAttribute('aria-expanded', 'false');
    if (item.dataset.telemetry === 'downforce' && $('forces-close-btn')) $('forces-close-btn').hidden = true;
  });
}

const WHEEL_QUIET_MS = 180;
let lastCameraWheelAt = -Infinity;
let cameraStillLastFrame = false;

function setAutoHidden(hidden) {
  const next = Boolean(hidden && state.autoHide && !state.manualHidden);
  if (state.autoHidden === next) return;
  state.autoHidden = next;
  $('app').classList.toggle('auto-hidden', next);
  if (next) closeAllTelemetryPopovers();
}

function noteCameraActivity() {
  cameraStillLastFrame = false;
  setAutoHidden(true);
}

function updateAutoReveal(now, cameraSettled) {
  const still = cameraSettled && !pointerTrack?.onCanvas && !freeKeys.size &&
    now - lastCameraWheelAt >= WHEEL_QUIET_MS;
  if (state.autoHidden && still && cameraStillLastFrame) setAutoHidden(false);
  cameraStillLastFrame = still;
}

function settleOrbitDamping(distance) {
  const { _sphericalDelta: rotation, _panOffset: pan } = orbit;
  if (Math.abs(rotation.theta) > CAMERA_SETTLE_EPSILON ||
      Math.abs(rotation.phi) > CAMERA_SETTLE_EPSILON ||
      pan.lengthSq() > (distance * CAMERA_SETTLE_EPSILON) ** 2) return false;
  rotation.set(0, 0, 0);
  pan.set(0, 0, 0);
  return true;
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
    startedOutsideDrawer: !e.target.closest?.('#drawer, .rail, .flow-state, #credits, #hotspot-layer, #hotspot-card, #scenario-banner, #tour-badge, #compare-curtain, #active-pills, .topbar, .top-right'),
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
    if (pointerTrack.onCanvas) transition = null;
  }
  if (!locked) maybeLockPointerAtEdge(e.clientX, e.clientY, dx, dy);
  if (pointerTrack.onCanvas && pointerTrack.moved && (dx || dy)) {
    noteCameraActivity();
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
  if (!wasMoved && button === 0 && state.panel && startedOutsideDrawer && !e.target.closest?.('#drawer, .rail, .flow-state, #credits, .telemetry-popover, #hotspot-layer, #hotspot-card, #scenario-banner, #tour-badge, #compare-curtain, #active-pills, .topbar, .top-right')) {
    setPanel(null);
  }
  if (!wasMoved && button === 0 && !e.target.closest?.('.downforce-dock, .telemetry-popover, .hud')) {
    unpinForcesPopover();
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
  if (e.deltaY && !e.ctrlKey) {
    lastCameraWheelAt = performance.now();
    noteCameraActivity();
  }
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
    if (e.code === 'Escape' && state.panel) { setPanel(null); return; }
    // Curtain-bar buttons keep focus after a click; a second Esc must still close the curtain.
    if (e.code === 'Escape' && curtainCompare?.active && e.target.closest?.('button') && !e.target.closest?.('dialog')) curtainCompare.deactivate();
    return;
  }
  if (e.code === 'Escape') {
    if (curtainCompare?.active && state.panel) { setPanel(null); return; }
    if (curtainCompare?.active) { curtainCompare.deactivate(); return; }
    if (showroomTour?.active) { showroomTour.stop(); return; }
    if (aeroHotspots?.activeId) { aeroHotspots.clearSelection(); return; }
    if (flowProbe?.pinned) { flowProbe.unpin(); return; }
    if ($('scenario-banner') && !$('scenario-banner').hidden) { clearScenarioBanner(); return; }
    if (isForcesPopoverOpen()) { unpinForcesPopover(); return; }
    if (state.panel) setPanel(null);
    closeAllTelemetryPopovers();
    return;
  }
  if (curtainCompare?.active && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.code === 'BracketLeft') { e.preventDefault(); curtainCompare.nudge(-0.05); return; }
    if (e.code === 'BracketRight') { e.preventDefault(); curtainCompare.nudge(0.05); return; }
  }
  if (e.code === 'KeyH' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    $('interface-toggle')?.click();
    return;
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.code === 'Digit0') { showroomTour?.stop(); activateFreeView(); return; }
    if (e.code === 'Digit1') { showroomTour?.stop(); setView('hero'); return; }
    if (e.code === 'Digit2') { showroomTour?.stop(); setView('front'); return; }
    if (e.code === 'Digit3') { showroomTour?.stop(); setView('side'); return; }
    if (e.code === 'Digit4') { showroomTour?.stop(); setView('drs'); return; }
    if (e.code === 'Digit5') { showroomTour?.stop(); setView('floor'); return; }
  }
  if (FREE_MOVE_KEYS.has(e.code)) {
    e.preventDefault();
    showroomTour?.stop();
    transition = null;
    markFreeCameraActive();
    freeKeys.add(e.code);
    noteCameraActivity();
  }
});
window.addEventListener('keyup', e => {
  if (!freeKeys.delete(e.code)) return;
  if (state.freeMode) {
    captureCameraPose();
    saveState();
  }
});
window.addEventListener('blur', () => {
  freeKeys.clear();
  pointerTrack = null;
  exitCanvasPointerLock();
});
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
    if (state.environment === 'monza') {
      return { position: [4.2, 1.85, 6.8], target: [0.2, .72, 2.0] };
    }
    if (state.environment === 'silverstone') {
      return { position: [4.8, 2.25, 6.2], target: [-0.4, .48, -0.8] };
    }
    if (state.environment === 'monaco') {
      return { position: [3.25, 1.32, 4.15], target: [0.35, .44, 0.55] };
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, width < 620 ? 1.25 : 1.5));
  camera.aspect = width / height;
  camera.fov = width <= 620
    ? (state.environment === 'wind' && state.view === 'side' ? 80 : 60)
    : isTrackEnvironment(state.environment) && state.view === 'hero'
      ? (state.environment === 'eau-rouge' ? 46 : 40)
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

function orbitMaxPolarAt(distance) {
  if (!isTrackEnvironment(state.environment) || state.freeMode || state.view === 'floor') return ORBIT_MAX_POLAR;
  // Raise the distant orbit above wooded slopes, grandstands, and street walls.
  const overview = THREE.MathUtils.smoothstep(distance, 18, 80);
  return THREE.MathUtils.lerp(ORBIT_MAX_POLAR, SPA_OVERVIEW_MAX_POLAR, overview);
}

function applyInstantOrbitPose(pos, target) {
  const prevDamping = orbit.enableDamping;
  orbit.enableDamping = false;
  camera.position.copy(pos);
  orbit.target.copy(target);
  orbit.maxPolarAngle = orbitMaxPolarAt(pos.distanceTo(target));
  orbit.update();
  orbit.enableDamping = prevDamping;
  syncLookFromTarget();
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
    : isTrackEnvironment(state.environment) && name === 'hero'
      ? (state.environment === 'eau-rouge' ? 46 : 40)
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
  showroomTour?.stop();
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
  showroomTour?.stop();
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const targetModel = (curtainCompare.active && peerModel && (((e.clientX - rect.left) < rect.width * curtainCompare.ratio) !== curtainSwapped))
    ? peerModel
    : currentModel;
  const hits = ray.intersectObject(targetModel, true);
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
  $('app')?.classList.toggle('drawer-open', Boolean(next));
  document.querySelectorAll('.rail-button').forEach(btn => {
    btn.setAttribute('aria-expanded', String(btn.dataset.panel === next));
  });
  document.querySelectorAll('.drawer .panel').forEach(panel => {
    panel.hidden = panel.id !== `panel-${next}`;
  });
  updateActiveToolIndicators?.();
}

const forcesItem = document.querySelector('.downforce-dock .telemetry-item[data-telemetry="downforce"]');
function isForcesPopoverOpen() {
  return Boolean(forcesItem?.classList.contains('is-open'));
}
function ensureCompareManifestLoaded() {
  const peer = state.model === 'rb19' ? 'rb16b' : 'rb19';
  flowCatalog.loadPeerManifest(peer, () => aeroCompare?.render(flowCatalog, state));
  aeroCompare?.render(flowCatalog, state);
}
function setForcesPopoverPinned(pinned) {
  if (!forcesItem) return;
  const btn = forcesItem.querySelector('.readout');
  forcesItem.classList.toggle('is-pinned', pinned);
  if ($('forces-close-btn')) $('forces-close-btn').hidden = !pinned;
  if (pinned) {
    updatePopoverPosition(forcesItem);
    forcesItem.classList.add('is-open');
    btn?.setAttribute('aria-expanded', 'true');
    ensureCompareManifestLoaded();
  } else {
    forcesItem.classList.remove('is-open');
    btn?.setAttribute('aria-expanded', 'false');
  }
}
function unpinForcesPopover() {
  if (forcesItem?.classList.contains('is-pinned') || forcesItem?.classList.contains('is-open')) {
    setForcesPopoverPinned(false);
  }
}
function setForcesTab(tabName) {
  const next = tabName === 'compare' ? 'compare' : 'current';
  document.querySelectorAll('[data-forces-tab]').forEach(b => {
    const active = b.dataset.forcesTab === next;
    b.setAttribute('aria-pressed', String(active));
    b.setAttribute('aria-selected', String(active));
  });
  if ($('forces-tab-current')) $('forces-tab-current').hidden = next !== 'current';
  if ($('forces-tab-compare')) $('forces-tab-compare').hidden = next !== 'compare';
  ensureCompareManifestLoaded();
}
document.querySelectorAll('[data-forces-tab]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setForcesPopoverPinned(true);
    setForcesTab(btn.dataset.forcesTab);
  });
});
$('compare-summary-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  setForcesPopoverPinned(true);
  setForcesTab('compare');
});
$('forces-close-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  setForcesPopoverPinned(false);
});

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
  if (topDock) {
    const lift = Math.max(10, Math.round(topDock.bottom - itemRect.bottom + 10));
    pop.style.setProperty('--popover-lift', `${lift}px`);
    return;
  }
  const hudRect = document.querySelector('.hud')?.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 224;
  const minLeft = hudRect ? hudRect.left : 16;
  const maxLeft = Math.max(minLeft, (hudRect ? hudRect.right : window.innerWidth - 16) - popWidth);
  const idealLeft = itemRect.left + itemRect.width / 2 - popWidth / 2;
  const clampedLeft = Math.min(maxLeft, Math.max(minLeft, idealLeft));
  pop.style.setProperty('--popover-shift', `${Math.round(clampedLeft - idealLeft)}px`);
  const lift = hudRect ? Math.max(10, Math.round(itemRect.top - hudRect.top + 10)) : 10;
  pop.style.setProperty('--popover-lift', `${lift}px`);
}

const telemetrySteps = {
  'wind-angle': { key: 'windAngle', step: 15 },
  steer: { key: 'steer', cycle: [0, 18, -18] },
  'ground-speed': { key: 'groundSpeed', step: 20 },
};

document.querySelectorAll('.telemetry-item').forEach(item => {
  const btn = item.querySelector('.readout');
  const range = item.querySelector('input[type="range"]');
  const shortcut = telemetrySteps[item.dataset.telemetry];
  const isForces = item.dataset.telemetry === 'downforce';
  if (!item.querySelector('.telemetry-popover')) return;
  const openItem = () => {
    document.querySelectorAll('.telemetry-item.is-open').forEach(other => {
      if (other !== item && !other.classList.contains('is-dragging') && !other.classList.contains('is-pinned')) {
        other.classList.remove('is-open');
        other.querySelector('.readout')?.setAttribute('aria-expanded', 'false');
      }
    });
    updatePopoverPosition(item);
    item.classList.add('is-open');
    btn?.setAttribute('aria-expanded', 'true');
    if (isForces) ensureCompareManifestLoaded();
  };
  const closeItem = () => {
    if (item.classList.contains('is-pinned')) return;
    item.classList.remove('is-open', 'is-dragging');
    btn?.setAttribute('aria-expanded', 'false');
  };
  item.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'touch') openItem();
  });
  item.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'touch' && !item.classList.contains('is-dragging') && !item.classList.contains('is-pinned') && !item.querySelector(':focus-visible')) closeItem();
  });
  item.addEventListener('focusout', e => {
    if (!item.contains(e.relatedTarget) && !item.matches(':hover') && !item.classList.contains('is-dragging') && !item.classList.contains('is-pinned')) closeItem();
  });
  item.addEventListener('keydown', e => {
    if (e.key === 'Escape' && item.classList.contains('is-open')) {
      e.stopPropagation();
      btn?.focus();
      if (isForces) setForcesPopoverPinned(false);
      else closeItem();
    } else if (e.key === 'ArrowDown' && e.target === btn && range) {
      e.preventDefault();
      openItem();
      range.focus();
    }
  });
  btn?.addEventListener('click', e => {
    e.stopPropagation();
    if (isForces) {
      setForcesPopoverPinned(!item.classList.contains('is-pinned'));
      return;
    }
    if (e.pointerType === 'touch') {
      if (item.classList.contains('is-open')) closeItem();
      else openItem();
      return;
    }
    if (shortcut) {
      const { key, step, cycle } = shortcut;
      if (cycle) {
        const idx = cycle.indexOf(state[key]);
        state[key] = idx >= 0 ? cycle[(idx + 1) % cycle.length] : (state[key] > 0 ? 18 : state[key] < 0 ? -18 : cycle[1]);
      } else {
        const max = Number(range.max);
        state[key] = state[key] >= max ? Number(range.min) : Math.min(max, state[key] + step);
      }
      showState();
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

const SCENE_META = {
  studio: {
    label: '纯白无缝影棚',
    detail: '纯白影棚打光 · 聚焦赛车曲面与流线细节',
    keyPos: [3, 6, 4], keyInt: 3.5, fillInt: 1.45, envInt: .82,
  },
  wind: {
    label: '风洞试验段',
    detail: '原创全尺寸风洞场景 · 气流来自自由外流算例',
    keyPos: [3, 6, 4], keyInt: 3.2, fillInt: 1.2, envInt: .68,
  },
  'eau-rouge': {
    label: '斯帕 · Eau Rouge 谷底望向 Raidillon',
    detail: '斯帕 LiDAR 地形 · 谷底左弯仰冲 +35 m 盲顶',
    keyPos: [-4.5, 6.0, 2.0], keyInt: 2.2, fillInt: .8, envInt: .9,
  },
  monza: {
    label: '蒙扎 · 主大直道（Rettifilo Tribune）',
    detail: '速度殿堂 520 m 主直道 · 起跑龙门架、主看台、维修区与一号减速弯',
    keyPos: [4.2, 6.6, 5.2], keyInt: 2.7, fillInt: 1.0, envInt: .85,
  },
  silverstone: {
    label: '银石 · Maggotts–Becketts 高速 S 弯',
    detail: 'T11 右弯弯心 · 开阔二战机场地貌与实时侧风联动风向袋',
    keyPos: [-4.8, 6.2, 3.2], keyInt: 2.25, fillInt: .88, envInt: .88,
  },
  monaco: {
    label: '摩纳哥 · 费尔蒙 180° 发卡弯',
    detail: 'Mirabeau 陡下坡 180° 左转发卡弯 · 棕榈岛台、贴墙护栏与费尔蒙酒店',
    keyPos: [3.8, 7.2, 4.5], keyInt: 2.85, fillInt: 1.05, envInt: .9,
  },
};

function setEnvironment(name, { preserveCamera = false, fromScenario = false } = {}) {
  if (!VALID_ENVS.has(name)) return;
  const envChanged = state.environment !== name;
  state.environment = name;
  if (envChanged && !preserveCamera) clearSavedCameraPose();
  if (envChanged && !fromScenario) clearScenarioBanner?.();
  $('app').dataset.environment = name;
  document.querySelectorAll('[data-environment]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.environment === name)));
  worlds.set(name, rig?.config.year || (state.model === 'rb19' ? 2023 : 2021));
  const meta = SCENE_META[name] || SCENE_META.wind;
  const isTrack = isTrackEnvironment(name);
  $('scene-label').textContent = meta.label;
  $('scene-detail').textContent = meta.detail;
  orbit.maxDistance = isTrack ? 120 : 18;
  orbit.maxPolarAngle = ORBIT_MAX_POLAR;
  floor.position.y = name === 'studio' ? -.035 : -.003;
  floor.material.opacity = name === 'studio' ? .42 : .24;
  floor.visible = !isTrack;
  for (const [k, mesh] of Object.entries(trackShadowFloors)) {
    mesh.visible = k === name;
  }
  key.position.set(...meta.keyPos);
  const shadowSpan = isTrack ? 6 : 4;
  Object.assign(key.shadow.camera, {
    left: -shadowSpan,
    right: shadowSpan,
    top: shadowSpan,
    bottom: -shadowSpan,
    far: isTrack ? 24 : 18,
  });
  key.shadow.camera.updateProjectionMatrix();
  scene.environmentIntensity = meta.envInt;
  key.intensity = meta.keyInt;
  fill.intensity = meta.fillInt;
  syncTurntable();
  if (!preserveCamera) setView(state.view, true, state.freeMode, false);
  renderer.shadowMap.needsUpdate = true;
  saveState();
}

function formatWindLabel(deg) {
  if (Math.abs(deg) < .5) return '正迎风 0°';
  return `${deg < 0 ? '左侧' : '右侧'} ${deg > 0 ? '+' : ''}${deg}°`;
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
  rawVal: $('hud-raw-forces'),
  source: $('hud-force-source'),
  note: $('hud-force-note'),
};
function readForces() {
  const condition = captureCondition(state);
  return computeCalibratedForces(flowCatalog.catalog, condition, flowCatalog.loadingCatalog);
}

const forceDescriptions = {
  exact: ['CFD', '按 180 km/h F1 基准锚定并由当前 OpenFOAM 实算工况趋势驱动；上方同步披露原始积分。'],
  interpolated: ['插值', '按 180 km/h F1 基准锚定并由相邻 OpenFOAM 动压归一插值趋势驱动；上方同步披露原始积分。'],
  approximated: ['近似', '按 180 km/h F1 基准锚定并由已求解 CFD 与 74 档侧风库实时合成趋势驱动。'],
  still: ['静止', '风洞风速与车轮转速均为零。'],
  loading: ['加载中', '正在加载气动力数据。'],
  unavailable: ['暂无数据', '当前工况暂无气动力数据。'],
};

function formatLoad(value) {
  if (value === null) return '—';
  if (value === 0) return '0';
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function updateForcesDisplay() {
  const { source, downforceN, dragN, sideN, liftToDrag, rawDownforceN, rawDragN } = readForces();
  const fKey = `${source}:${downforceN}:${dragN}:${sideN}:${rawDownforceN}:${rawDragN}:${state.speed}:${state.effWindAngle}`;
  if (fKey === lastForcesKey) return;
  lastForcesKey = fKey;

  const downforce = formatLoad(downforceN);
  const drag = formatLoad(dragN);
  const hasLoads = downforceN !== null;
  const [label, note] = forceDescriptions[source];
  forceNodes.source.textContent = label;
  forceNodes.note.textContent = note;
  forceNodes.tDownforce.innerHTML = hasLoads ? `${downforce}<small>N</small>` : downforce;
  forceNodes.tDownforce.classList.toggle('is-lift', downforceN < 0);
  forceNodes.tDrag.innerHTML = hasLoads ? `${drag}<small>N</small>` : drag;
  forceNodes.downVal.textContent = forceNodes.dfGrid.textContent = hasLoads ? `${downforce} N` : downforce;
  forceNodes.dragVal.textContent = hasLoads ? `${drag} N` : drag;
  forceNodes.rel.textContent = `${Math.round(state.speed)} km/h · ${state.effWindAngle > 0 ? '+' : ''}${state.effWindAngle.toFixed(1)}°`;
  const sideDir = Math.abs(sideN) < 5 ? '' : sideN < 0 ? '（向车左）' : '（向车右）';
  forceNodes.sideVal.textContent = hasLoads ? `${sideN > 0 ? '+' : ''}${formatLoad(sideN)} N${sideDir}` : '—';
  forceNodes.ldVal.textContent = liftToDrag === null ? '—' : liftToDrag.toFixed(2);
  if (forceNodes.rawVal) {
    forceNodes.rawVal.textContent = rawDownforceN !== null ? `Fz ${formatLoad(rawDownforceN)} / D ${formatLoad(rawDragN)} N` : '—';
  }
}

let lastDrsReadout;
function updateDrsReadout() {
  const percent = Math.round(state.drsCurrent * 100);
  const settled = state.drsCurrent === state.drs;
  const label = settled ? (state.drs ? '全开' : '关闭') : (state.drs ? '开启中' : '关闭中');
  const text = `${label} · ${percent}%`;
  if (text === lastDrsReadout) return;
  lastDrsReadout = text;
  $('drs-value').textContent = text;
  $('t-drs').innerHTML = `${percent}<small>%</small>`;
}

function showState() {
  const rel = resolveRelativeWind(state);
  state.speed = rel.relSpeedKmh;
  state.effWindAngle = rel.effWindAngleDeg;
  const drsOpen = state.drs === 1;
  const steerText = `${state.steer > 0 ? '+' : ''}${state.steer}`;
  const windDeg = Math.round(state.windAngle || 0);
  const windShort = `${windDeg > 0 ? '+' : ''}${windDeg}`;
  const effYawText = `偏航 ${rel.effWindAngleDeg.toFixed(1)}°`;
  const radius = rig?.config.wheels.FL.radius ?? configs?.[state.model]?.wheels.FL.radius ?? (state.model === 'rb16b' ? .3321 : .369);
  state.wheelSpeedMps = state.groundSpeed / 3.6;
  state.wheelRpm = state.wheelSpeedMps / radius / (Math.PI * 2) * 60;
  const rpmRounded = Math.round(state.wheelRpm);

  $('flow-density').value = state.flowDensity;
  $('flow-density-value').textContent = `${state.flowDensity}%`;
  $('steer').value = state.steer;
  if ($('wind-angle')) $('wind-angle').value = windDeg;
  $('ground-speed').value = state.groundSpeed;

  updateDrsReadout();
  $('drs-toggle').setAttribute('aria-checked', String(drsOpen));
  $('hud-drs-toggle').setAttribute('aria-pressed', String(drsOpen));
  if ($('wind-angle-value')) $('wind-angle-value').textContent = formatWindLabel(windDeg);
  if ($('wind-angle-side')) $('wind-angle-side').textContent = effYawText;
  $('ground-speed-value').textContent = `${state.groundSpeed} km/h`;
  $('wheel-value').textContent = `${rpmRounded} rpm`;
  if ($('wind-speed')) $('wind-speed').textContent = `${rel.relSpeedMps.toFixed(1)} m/s`;
  $('steer-value').textContent = `${steerText}°`;

  const flowToggle = $('flow-toggle');
  if (flowToggle) {
    flowToggle.setAttribute('aria-checked', String(state.flow));
    flowToggle.setAttribute('aria-pressed', String(state.flow));
  }
  if ($('hud-wind-angle')) $('hud-wind-angle').value = windDeg;
  if ($('hud-ground-speed')) $('hud-ground-speed').value = state.groundSpeed;
  if ($('hud-steer')) $('hud-steer').value = state.steer;

  if ($('hud-wind-speed')) $('hud-wind-speed').textContent = `${rel.relSpeedMps.toFixed(1)} m/s`;
  if ($('hud-wind-angle-value')) $('hud-wind-angle-value').textContent = formatWindLabel(windDeg);
  if ($('hud-wind-side')) $('hud-wind-side').textContent = effYawText;
  if ($('hud-ground-speed-value')) $('hud-ground-speed-value').textContent = `${state.groundSpeed} km/h`;
  if ($('hud-wheel-value')) $('hud-wheel-value').textContent = `${rpmRounded} rpm`;
  if ($('hud-steer-value')) $('hud-steer-value').textContent = `${steerText}°`;

  if ($('t-wind-angle')) $('t-wind-angle').innerHTML = `${windShort}<small>°</small>`;
  if ($('t-ground')) $('t-ground').innerHTML = `${state.groundSpeed}<small>km/h</small>`;
  if ($('t-steer')) $('t-steer').innerHTML = `${steerText}<small>°</small>`;
  if ($('t-rpm')) $('t-rpm').innerHTML = `${rpmRounded}<small>rpm</small>`;
  syncTurntable();
  updateForcesDisplay();
  updateCoverageGuidance();
  saveState();
}

const FLOW_PRESETS = {
  low50: { groundSpeed: 50, windAngle: 0, steer: 0, drs: 0 },
  cruise: { groundSpeed: 180, windAngle: 0, steer: 0, drs: 0 },
  high350: { groundSpeed: 350, windAngle: 0, steer: 0, drs: 0 },
  drs: { groundSpeed: 180, windAngle: 0, steer: 0, drs: 1 },
  steer: { groundSpeed: 180, windAngle: 0, steer: 18, drs: 0 },
  yaw45: { groundSpeed: 180, windAngle: 45, steer: 0, drs: 0 },
};

let lastCoverageKey = '';

function applyConditionTarget(target) {
  if (!target) return;
  state.groundSpeed = target.groundSpeed;
  state.ambientWindMps = 0;
  state.windAngle = target.windAngle;
  state.steer = target.steer;
  state.drs = target.drs ? 1 : 0;
  state.flow = true;
  showState();
}

function updateCoverageGuidance() {
  const ready = Boolean(flowCatalog.catalog && flowCatalog.catalog.car === state.model);
  const key = `${state.model}|${state.groundSpeed}|${state.ambientWindMps}|${state.windAngle}|${state.steer}|${state.drs}|${ready}`;
  if (key === lastCoverageKey) return;
  lastCoverageKey = key;

  document.querySelectorAll('[data-flow-preset]').forEach(btn => {
    const preset = FLOW_PRESETS[btn.dataset.flowPreset];
    const active = Boolean(preset &&
      state.groundSpeed === preset.groundSpeed &&
      state.ambientWindMps === 0 &&
      state.windAngle === preset.windAngle &&
      state.steer === preset.steer &&
      state.drs === preset.drs);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (!ready) return;
  const targetCondition = captureCondition({ ...state, drsCurrent: state.drs });
  const isRest = !targetCondition.speed && !targetCondition.wheelSpeedMps;
  const selection = isRest ? { mode: 'still' } : selectCoverage(flowCatalog.catalog, targetCondition.coordinates);
  const hintEl = $('flow-coverage-hint');
  if (hintEl) {
    hintEl.textContent = isRest
      ? '当前静止：调高风洞风速即可查看流线。'
      : selection.mode === 'exact'
        ? '当前工况命中已求解 CFD 节点。'
        : selection.mode === 'interpolated'
          ? '当前工况位于已校验 CFD 插值区间内。'
          : '当前工况由已求解 CFD 与 74 档侧风库实时合成。';
  }
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

async function parsePreparedCarModel(id, config, onProgress = null) {
  const modelFile = config.web_file || config.file;
  const modelVersion = config.web_revision || config.revision || config.web_glb_bytes || config.glb_bytes;
  const modelUrl = `${modelFile}?v=${modelVersion}`;
  const expectedBytes = config.web_glb_bytes || config.glb_bytes || 0;
  const [buffer] = await Promise.all([
    cachedArrayBuffer(modelUrl, {
      onProgress: (loadedBytes, headerTotal) => {
        onProgress?.(loadedBytes, expectedBytes || headerTotal);
      },
    }),
    MeshoptDecoder.ready,
  ]);
  const loaded = await loader.parseAsync(buffer, '/');
  if (id === 'rb16b') {
    const unfastenedHarness = [];
    loaded.scene.traverse(o => {
      if (o.isMesh && o.name.startsWith('CINTURE_OFF_')) unfastenedHarness.push(o);
    });
    unfastenedHarness.forEach(o => o.removeFromParent());
  }
  const nextRig = bindRig(loaded.scene, config);
  loaded.scene.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.geometry.attributes.position.count > 30) o.geometry.computeBoundsTree();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (id === 'rb16b' && (m.name === 'gp21_cinture.001' || m.name === 'chrome.001')) {
          m.transparent = false;
          m.depthWrite = true;
        }
        for (const value of Object.values(m)) if (value?.isTexture) value.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      }
    }
  });
  return { scene: loaded.scene, rig: nextRig, modelUrl };
}

async function loadModel(id, { preserveCamera = false } = {}) {
  if (!configs?.[id]) throw new Error('找不到车型资料');
  showroomTour?.stop();
  if (curtainCompare?.active) curtainCompare.deactivate();
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
    if (!loadedCarsInSession.has(id)) {
      hasCachedAsset(modelUrl).then(cached => {
        if (serial === loadSerial && !loadSettled && !cached) setFirstLoadVeil(true, config);
      }).catch(() => {});
    }
    flowJobs.reset();
    flowCatalog.load(id);
    const { scene: nextScene, rig: nextRig } = await parsePreparedCarModel(id, config, (loadedBytes, denom) => {
      if (serial !== loadSerial) return;
      if (denom) $('loading-text').textContent = `${config.name} / ${Math.min(100, Math.round(loadedBytes / denom * 100))}%`;
    });
    if (serial !== loadSerial) { disposeModel(nextScene); return; }
    if (currentModel) { carTurntable.remove(currentModel); disposeModel(currentModel); }
    currentModel = nextScene;
    rig = nextRig;
    carTurntable.add(currentModel);
    setEnvironment(state.environment, { preserveCamera, fromScenario: true });
    showState();
    state.spin = 0;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    renderer.shadowMap.needsUpdate = true;
    if ($('model-name')) $('model-name').innerHTML = `${config.name}<span>.</span>`;
    $('era').textContent = `${config.year} / ${id === 'rb19' ? 'GROUND EFFECT' : 'HYBRID ERA'}`;
    aeroHotspots?.refreshModel(id);
    if (isForcesPopoverOpen()) ensureCompareManifestLoaded();
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
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  showroomTour?.stop();
  setView(b.dataset.view, false, false);
}));
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
    unpinForcesPopover();
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
$('steer').addEventListener('input', e => { state.steer = Number(e.target.value); showState(); });
$('wind-angle')?.addEventListener('input', e => { state.windAngle = Number(e.target.value); showState(); });
$('center-wind')?.addEventListener('click', () => { state.windAngle = 0; showState(); });
function toggleDrs() {
  state.drs = state.drs === 1 ? 0 : 1;
  showState();
}
$('drs-toggle').addEventListener('click', toggleDrs);
$('center-steering').addEventListener('click', () => { state.steer = 0; showState(); });
$('hud-wind-angle')?.addEventListener('input', e => { state.windAngle = Number(e.target.value); showState(); });
$('hud-center-wind')?.addEventListener('click', () => { state.windAngle = 0; showState(); });
$('hud-ground-speed')?.addEventListener('input', e => { state.groundSpeed = Number(e.target.value); showState(); });
$('hud-drs-toggle').addEventListener('click', () => {
  closeAllTelemetryPopovers();
  toggleDrs();
});
$('hud-steer')?.addEventListener('input', e => { state.steer = Number(e.target.value); showState(); });
$('hud-center-steering')?.addEventListener('click', () => { state.steer = 0; showState(); });
$('reset').addEventListener('click', () => {
  clearScenarioBanner?.();
  applyOperatingDefaults();
  aeroAudio.syncDrs(state.drs);
  showState();
});
document.querySelectorAll('[data-environment]').forEach(b => b.addEventListener('click', () => setEnvironment(b.dataset.environment)));
$('ground-speed').addEventListener('input', e => { state.groundSpeed = Number(e.target.value); showState(); });
$('flow-toggle').addEventListener('click', () => {
  state.flow = !state.flow;
  if (!state.flow) updateFlowStatus('流线已隐藏');
  showState();
});

// === 8 Expansion Features Wiring + Real-Time Scissor Dual-Car Curtain ===
function flyCameraTo(pose) {
  const v = rotateViewByTurntable(pose);
  transition = {
    start: performance.now(),
    position: camera.position.clone(),
    target: orbit.target.clone(),
    endPosition: new THREE.Vector3(...v.position),
    endTarget: new THREE.Vector3(...v.target),
    savePose: false,
  };
}

let activeScenarioId = null;
function clearScenarioBanner() {
  activeScenarioId = null;
  if ($('scenario-banner')) $('scenario-banner').hidden = true;
  document.querySelectorAll('[data-scenario]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}

// Active rail dots & collapsed quick-close tool pills
function updateActiveToolIndicators() {
  const flowActive = studioExt.flowStyle === 'smoke';
  const analysisActive = Boolean(studioExt.sliceEnabled || flowProbe.enabled || aeroHotspots?.enabled || curtainCompare?.active);
  const exploreActive = Boolean(showroomTour?.active);
  document.querySelector('.rail-button[data-panel="flow"]')?.classList.toggle('has-active', flowActive);
  document.querySelector('.rail-button[data-panel="analysis"]')?.classList.toggle('has-active', analysisActive);
  document.querySelector('.rail-button[data-panel="explore"]')?.classList.toggle('has-active', exploreActive);

  const pillsEl = $('active-pills');
  if (!pillsEl) return;
  if (state.panel || curtainCompare?.active) {
    pillsEl.hidden = true;
    return;
  }
  const items = [];
  if (studioExt.flowStyle === 'smoke') items.push({ id: 'smoke', label: '风洞烟雾流', panel: 'flow', off: () => setFlowStyle('lines') });
  if (studioExt.sliceEnabled) items.push({ id: 'slice', label: `PIV ${studioExt.sliceAxis.toUpperCase()} 切面`, panel: 'analysis', off: () => setSliceEnabled(false) });
  if (flowProbe.enabled) items.push({ id: 'probe', label: flowProbe.pinned ? '皮托管探针 (已钉住)' : '皮托管探针', panel: 'analysis', off: () => setProbeEnabled(false) });
  if (aeroHotspots?.enabled) items.push({ id: 'hotspots', label: '气动热点', panel: 'analysis', off: () => setHotspotsEnabled(false) });
  if (!items.length) {
    pillsEl.hidden = true;
    pillsEl.innerHTML = '';
    return;
  }
  pillsEl.innerHTML = '';
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'active-pill';
    chip.dataset.activePill = item.id;
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'active-pill-open';
    openBtn.textContent = item.label;
    openBtn.title = '打开对应控制面板';
    openBtn.addEventListener('click', e => { e.stopPropagation(); setPanel(item.panel); });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'active-pill-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', `关闭${item.label}`);
    closeBtn.addEventListener('click', e => { e.stopPropagation(); item.off(); });
    chip.append(openBtn, closeBtn);
    pillsEl.appendChild(chip);
  }
  pillsEl.hidden = false;
}

// 1. Flow style (Fine CFD lines vs Wind Tunnel Smoke Rake)
function setFlowStyle(nextStyle) {
  const next = nextStyle === 'smoke' ? 'smoke' : 'lines';
  studioExt.flowStyle = next;
  document.querySelectorAll('[data-flow-style]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.flowStyle === next)));
  if ($('smoke-rake-group')) $('smoke-rake-group').hidden = next !== 'smoke';
  if (next === 'smoke') {
    flowSmoke.clear();
    peerFlowSmoke?.clear();
  }
  flowJobs.setVisible(state.flow && state.flowDensity > 0);
  peerFlowJobs?.setVisible(state.flow && state.flowDensity > 0);
  updateActiveToolIndicators();
}
document.querySelectorAll('[data-flow-style]').forEach(btn => {
  btn.addEventListener('click', () => setFlowStyle(btn.dataset.flowStyle));
});
$('smoke-rake-x')?.addEventListener('input', e => {
  studioExt.smokeRakeX = Number(e.target.value);
  if ($('smoke-rake-x-value')) $('smoke-rake-x-value').textContent = `${studioExt.smokeRakeX >= 0 ? '+' : ''}${studioExt.smokeRakeX.toFixed(2)} m`;
});

// 2. PIV Laser Slice
const SLICE_RANGES = {
  x: { min: -1.5, max: 1.5, step: 0.05, def: 0 },
  z: { min: -3.8, max: 2.8, step: 0.1, def: 0 },
  y: { min: 0.06, max: 1.45, step: 0.03, def: 0.18 },
};
function syncSliceSlider() {
  const cfg = SLICE_RANGES[studioExt.sliceAxis];
  const sl = $('slice-pos');
  if (sl) {
    sl.min = String(cfg.min);
    sl.max = String(cfg.max);
    sl.step = String(cfg.step);
    studioExt.slicePosition = THREE.MathUtils.clamp(studioExt.slicePosition, cfg.min, cfg.max);
    sl.value = String(studioExt.slicePosition);
  }
  if ($('slice-pos-value')) $('slice-pos-value').textContent = `${studioExt.slicePosition.toFixed(2)} m`;
}
function triggerSliceUpdate() {
  if (!studioExt.sliceEnabled || (state.speed <= 0 && state.wheelSpeedMps <= 0)) {
    flowSlice.setVisible(false);
    peerFlowSlice?.setVisible(false);
    return;
  }
  const req = {
    axis: studioExt.sliceAxis,
    position: studioExt.slicePosition,
    metric: studioExt.sliceMetric,
    refSpeedMps: Math.max(1, (state.speed || 180) / 3.6),
  };
  flowJobs.requestSlice(req);
  peerFlowJobs?.requestSlice(req);
}
function setSliceEnabled(enabled) {
  studioExt.sliceEnabled = Boolean(enabled);
  $('slice-toggle')?.setAttribute('aria-checked', String(studioExt.sliceEnabled));
  if ($('slice-controls')) $('slice-controls').hidden = !studioExt.sliceEnabled;
  if (studioExt.sliceEnabled) triggerSliceUpdate();
  else {
    flowSlice.setVisible(false);
    peerFlowSlice?.setVisible(false);
  }
  updateActiveToolIndicators();
}
$('slice-toggle')?.addEventListener('click', () => setSliceEnabled(!studioExt.sliceEnabled));
document.querySelectorAll('[data-slice-axis]').forEach(btn => {
  btn.addEventListener('click', () => {
    const axis = btn.dataset.sliceAxis;
    studioExt.sliceAxis = axis;
    studioExt.slicePosition = SLICE_RANGES[axis].def;
    document.querySelectorAll('[data-slice-axis]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sliceAxis === axis)));
    syncSliceSlider();
    triggerSliceUpdate();
    updateActiveToolIndicators();
  });
});
$('slice-pos')?.addEventListener('input', e => {
  studioExt.slicePosition = Number(e.target.value);
  if ($('slice-pos-value')) $('slice-pos-value').textContent = `${studioExt.slicePosition.toFixed(2)} m`;
  triggerSliceUpdate();
});
document.querySelectorAll('[data-slice-metric]').forEach(btn => {
  btn.addEventListener('click', () => {
    const metric = btn.dataset.sliceMetric;
    studioExt.sliceMetric = metric;
    document.querySelectorAll('[data-slice-metric]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sliceMetric === metric)));
    triggerSliceUpdate();
  });
});

// 3. Virtual Pitot Wind Probe (robust close-up near-wall sampling + screen-space sizing + direct re-pin)
let probeRafPending = false;
let probeDownPos = null;
let probePinnedIsPeer = false;
function resolveProbeTarget(clientX) {
  if (curtainCompare.active && peerModel && peerRig && peerFlowJobs) {
    const rect = renderer.domElement.getBoundingClientRect();
    const onLeft = (clientX - rect.left) < rect.width * curtainCompare.ratio;
    const targetIsPeer = onLeft !== curtainSwapped;
    if (targetIsPeer) {
      return { isPeer: true, rig: peerRig, slice: peerFlowSlice, jobs: peerFlowJobs };
    }
  }
  return { isPeer: false, rig, slice: flowSlice, jobs: flowJobs };
}
function setProbeEnabled(enabled, { autoCollapse = false } = {}) {
  const next = Boolean(enabled);
  flowProbe.setEnabled(next);
  if (!next) probePinnedIsPeer = false;
  $('probe-toggle')?.setAttribute('aria-checked', String(next));
  $('app')?.classList.toggle('is-probe-mode', next);
  if (next && autoCollapse) setPanel(null);
  updateActiveToolIndicators();
}
$('probe-toggle')?.addEventListener('click', () => setProbeEnabled(!flowProbe.enabled, { autoCollapse: true }));
viewport.addEventListener('pointerdown', e => {
  showroomTour.stop();
  if (flowProbe.enabled) probeDownPos = [e.clientX, e.clientY];
});
viewport.addEventListener('wheel', () => showroomTour.stop(), { passive: true });
viewport.addEventListener('pointermove', e => {
  if (!flowProbe.enabled || flowProbe.pinned || e.buttons !== 0 || probeRafPending) return;
  if (state.speed <= 0 && state.wheelSpeedMps <= 0) { flowProbe.clearResult(); return; }
  probeRafPending = true;
  requestAnimationFrame(() => {
    probeRafPending = false;
    const target = resolveProbeTarget(e.clientX);
    const req = flowProbe.pickPoint({ clientX: e.clientX, clientY: e.clientY, domElement: renderer.domElement, camera, rig: target.rig, slice: target.slice });
    if (req) target.jobs.requestProbe(req);
    else if (!flowProbe.pinned) flowProbe.clearResult();
  });
});
viewport.addEventListener('pointerup', e => {
  if (!flowProbe.enabled || !probeDownPos) return;
  const moved = Math.hypot(e.clientX - probeDownPos[0], e.clientY - probeDownPos[1]);
  probeDownPos = null;
  if (moved > 5 || e.button !== 0) return;
  // Click near currently pinned marker -> unpin; click elsewhere -> directly pin/re-pin new point!
  if (flowProbe.pinned && flowProbe.isNearPinnedScreen(e.clientX, e.clientY, camera, viewport, 28)) {
    flowProbe.unpin();
    probePinnedIsPeer = false;
    updateActiveToolIndicators();
    return;
  }
  const target = resolveProbeTarget(e.clientX);
  const req = flowProbe.pickPoint({ clientX: e.clientX, clientY: e.clientY, domElement: renderer.domElement, camera, rig: target.rig, slice: target.slice });
  if (req) {
    flowProbe.pinned = true;
    flowProbe.pinnedRequest = req;
    probePinnedIsPeer = target.isPeer;
    target.jobs.requestProbe(req);
    updateActiveToolIndicators();
  } else if (flowProbe.pinned) {
    flowProbe.unpin();
    probePinnedIsPeer = false;
    updateActiveToolIndicators();
  }
});

// 4. Dual-Car Comparison (Top-Right Popover) & Real-Time WebGL Scissor-Split Curtain
const aeroCompare = new AeroCompare({
  tableEl: $('compare-table'),
  chartEl: $('compare-chart'),
  summaryEl: $('compare-summary-text'),
});

let peerModel = null, peerRig = null, peerCarId = null, peerLoadSerial = 0;
let peerFlowCatalog = null, peerFlowJobs = null, peerFlowLayers = null;
let peerFlowPreview = null, peerFlowSmoke = null, peerFlowSlice = null;
let curtainSwapped = false;

function disposePeerSession() {
  peerLoadSerial++;
  curtainSwapped = false;
  if (peerFlowJobs) {
    peerFlowJobs.reset();
    peerFlowJobs = null;
  }
  peerFlowCatalog = null;
  if (peerFlowLayers) {
    for (const layer of Object.values(peerFlowLayers)) {
      carTurntable.remove(layer.group);
      layer.geometry?.dispose();
    }
    peerFlowLayers = null;
  }
  if (peerFlowPreview) {
    carTurntable.remove(peerFlowPreview.lines);
    peerFlowPreview.lines.geometry?.dispose();
    peerFlowPreview = null;
  }
  if (peerFlowSmoke) {
    carTurntable.remove(peerFlowSmoke.group);
    peerFlowSmoke.dispose();
    peerFlowSmoke = null;
  }
  if (peerFlowSlice) {
    carTurntable.remove(peerFlowSlice.group);
    peerFlowSlice.dispose();
    peerFlowSlice = null;
  }
  if (peerModel) {
    carTurntable.remove(peerModel);
    disposeModel(peerModel);
    peerModel = null;
    peerRig = null;
  }
  peerCarId = null;
}

function createPeerFlowStack(carId) {
  peerFlowLayers = {
    whole: new FlowLayer(carTurntable, flowMaterial, 'PEER_CFD_FLOW'),
    bottom: new FlowLayer(carTurntable, flowMaterial, 'PEER_UNDERBODY_FLOW'),
    side: new FlowLayer(carTurntable, flowMaterial, 'PEER_SIDEPOD_FLOW'),
  };
  peerFlowPreview = new FlowPreview(carTurntable, flowMaterial);
  peerFlowSmoke = new FlowSmoke(carTurntable);
  peerFlowSlice = new FlowSlice(carTurntable);
  peerFlowCatalog = new FlowCatalog();
  peerFlowJobs = new FlowJobs(peerFlowCatalog, peerFlowLayers, () => {}, peerFlowPreview);
  peerFlowJobs.setExtras({
    smokeLayer: peerFlowSmoke,
    getStyle: () => studioExt.flowStyle,
    getSmokeRakeX: () => studioExt.smokeRakeX,
    needsField: () => Boolean(studioExt.sliceEnabled || flowProbe.enabled),
    getSliceRequest: cond => studioExt.sliceEnabled ? {
      axis: studioExt.sliceAxis,
      position: studioExt.slicePosition,
      metric: studioExt.sliceMetric,
      refSpeedMps: Math.max(1, (cond?.speed ?? state.speed ?? 180) / 3.6),
    } : null,
    onSliceResult: res => {
      if (studioExt.sliceEnabled && (state.speed > 0 || state.wheelSpeedMps > 0)) peerFlowSlice?.applyResult(res);
      else peerFlowSlice?.setVisible(false);
    },
    onProbeResult: res => {
      if (curtainCompare.active) {
        flowProbe.applyResult(res, Math.max(1, (state.speed || 0) / 3.6), (peerCarId || '').toUpperCase());
      }
    },
    onStill: () => peerFlowSlice?.setVisible(false),
    onReset: () => peerFlowSlice?.clear(),
    onFieldUpdated: () => {
      if (flowProbe.enabled && flowProbe.pinned && flowProbe.pinnedRequest && probePinnedIsPeer) {
        peerFlowJobs?.requestProbe(flowProbe.pinnedRequest);
      }
      if (studioExt.sliceEnabled && peerFlowSlice && !peerFlowSlice.hasData && (state.speed > 0 || state.wheelSpeedMps > 0)) {
        peerFlowJobs?.requestSlice({
          axis: studioExt.sliceAxis,
          position: studioExt.slicePosition,
          metric: studioExt.sliceMetric,
          refSpeedMps: Math.max(1, (state.speed || 180) / 3.6),
        });
      }
    },
  });
  peerFlowCatalog.load(carId);
}

const curtainCompare = new CurtainCompare({
  overlayEl: $('compare-curtain'),
  handleEl: $('compare-curtain-handle'),
  leftLabelEl: $('compare-curtain-left'),
  rightLabelEl: $('compare-curtain-right'),
  statusEl: $('compare-curtain-status'),
  onSwap: () => {
    curtainSwapped = !curtainSwapped;
    const leftId = curtainSwapped ? state.model : (peerCarId || (state.model === 'rb19' ? 'rb16b' : 'rb19'));
    const rightId = curtainSwapped ? (peerCarId || (state.model === 'rb19' ? 'rb16b' : 'rb19')) : state.model;
    curtainCompare.setCars(leftId, rightId, state.model);
  },
  onExit: () => {
    $('app')?.classList.remove('is-curtain-mode', 'curtain-tools-open');
    $('compare-curtain-tools')?.setAttribute('aria-pressed', 'false');
    if (probePinnedIsPeer) {
      flowProbe.unpin();
      flowProbe.clearResult();
      probePinnedIsPeer = false;
    }
    disposePeerSession();
    if (currentModel) currentModel.visible = true;
    updateActiveToolIndicators();
  },
});

async function startCurtainSession() {
  if (curtainCompare.active) { curtainCompare.deactivate(); return; }
  if (!configs || !currentModel) return;
  showroomTour.stop();
  clearScenarioBanner();
  aeroHotspots?.clearSelection();
  unpinForcesPopover();
  closeAllTelemetryPopovers();
  setPanel(null);

  const mainId = state.model;
  const peerId = mainId === 'rb19' ? 'rb16b' : 'rb19';
  const peerCfg = configs[peerId];
  if (!peerCfg) return;

  disposePeerSession();
  curtainSwapped = false;
  $('app')?.classList.add('is-curtain-mode');
  // Right = current main car (zero reload!), Left = peer car
  curtainCompare.activate({ leftCar: peerId, rightCar: mainId });
  curtainCompare.setLoading(`正在加载对比车型 ${peerCfg.name}…`);
  updateActiveToolIndicators();

  const serial = ++peerLoadSerial;
  try {
    const { scene: pScene, rig: pRig } = await parsePreparedCarModel(peerId, peerCfg, (loadedBytes, denom) => {
      if (serial !== peerLoadSerial || !curtainCompare.active) return;
      if (denom) curtainCompare.setLoading(`正在加载对比车型 ${peerCfg.name} · ${Math.min(100, Math.round(loadedBytes / denom * 100))}%`);
    });
    if (serial !== peerLoadSerial || !curtainCompare.active) {
      disposeModel(pScene);
      return;
    }
    pScene.visible = false;
    peerModel = pScene;
    peerRig = pRig;
    peerCarId = peerId;
    carTurntable.add(peerModel);
    applyRig(peerRig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    createPeerFlowStack(peerId);
    curtainCompare.setLoading('');
    renderer.shadowMap.needsUpdate = true;
  } catch (err) {
    if (serial !== peerLoadSerial) return;
    curtainCompare.setLoading(`对比车型加载失败：${err?.message || '请重试'}`);
  }
}

document.querySelectorAll('[data-compare-axis]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const axis = btn.dataset.compareAxis;
    aeroCompare.setAxis(axis);
    document.querySelectorAll('[data-compare-axis]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.compareAxis === axis)));
    aeroCompare.render(flowCatalog, state);
  });
});
$('compare-swap-btn')?.addEventListener('click', async () => {
  const other = state.model === 'rb19' ? 'rb16b' : 'rb19';
  await loadModel(other, { preserveCamera: true });
});
$('compare-curtain-btn')?.addEventListener('click', () => { startCurtainSession().catch(() => {}); });
$('popover-curtain-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  startCurtainSession().catch(() => {});
});
function setCurtainToolsOpen(open) {
  const next = Boolean(open && curtainCompare.active);
  $('app')?.classList.toggle('curtain-tools-open', next);
  $('compare-curtain-tools')?.setAttribute('aria-pressed', String(next));
  if (next) {
    if (!state.panel) setPanel('analysis');
  } else if (curtainCompare.active && state.panel) {
    setPanel(null);
  }
}
$('compare-curtain-tools')?.addEventListener('click', e => {
  e.stopPropagation();
  setCurtainToolsOpen(!$('app')?.classList.contains('curtain-tools-open'));
});
$('compare-curtain-swap')?.addEventListener('click', e => {
  e.stopPropagation();
  curtainCompare.onSwap?.();
});
$('compare-curtain-center')?.addEventListener('click', e => {
  e.stopPropagation();
  curtainCompare.setRatio(0.5);
});
$('compare-curtain-exit')?.addEventListener('click', e => {
  e.stopPropagation();
  curtainCompare.deactivate();
});

// 5. Classic F1 Corner Scenarios (each bound to its bespoke 3D circuit!)
const scenarioListEl = $('scenario-list');
if (scenarioListEl) {
  scenarioListEl.innerHTML = '';
  for (const sc of F1_SCENARIOS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scenario-btn';
    btn.dataset.scenario = sc.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<b>${sc.title}</b><span>${sc.tag}</span>`;
    btn.addEventListener('click', () => {
      showroomTour.stop();
      if (curtainCompare.active) curtainCompare.deactivate();
      activeScenarioId = sc.id;
      document.querySelectorAll('[data-scenario]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scenario === sc.id)));
      if (state.environment !== sc.environment) {
        setEnvironment(sc.environment, { preserveCamera: true, fromScenario: true });
      }
      Object.assign(state, sc.condition);
      state.flow = true;
      aeroAudio.syncDrs(state.drs);
      showState();
      flyCameraTo(sc.camera);
      if ($('scenario-banner-title')) $('scenario-banner-title').textContent = sc.title;
      if ($('scenario-banner-text')) $('scenario-banner-text').textContent = sc.caption;
      if ($('scenario-banner')) $('scenario-banner').hidden = false;
      // Auto-collapse drawer so user gets full unobstructed view of the newly loaded F1 circuit!
      setPanel(null);
    });
    scenarioListEl.appendChild(btn);
  }
}
$('scenario-banner-close')?.addEventListener('click', () => clearScenarioBanner());

// 6. Showroom Tour
const showroomTour = new ShowroomTour({
  onPose: (pos, target) => {
    transition = null;
    applyInstantOrbitPose(pos, target);
  },
  onState: patch => {
    Object.assign(state, patch);
    showState();
  },
  onStop: () => {
    $('tour-toggle')?.setAttribute('aria-checked', 'false');
    if ($('tour-badge')) $('tour-badge').hidden = true;
    updateActiveToolIndicators();
  },
});
function setTourActive(active) {
  if (active) {
    if (curtainCompare.active) curtainCompare.deactivate();
    clearScenarioBanner();
    aeroHotspots?.clearSelection();
    unpinForcesPopover();
    setPanel(null);
    state.flow = true;
    showroomTour.start();
    $('tour-toggle')?.setAttribute('aria-checked', 'true');
    if ($('tour-badge')) $('tour-badge').hidden = false;
    updateActiveToolIndicators();
  } else {
    showroomTour.stop();
  }
}
$('tour-toggle')?.addEventListener('click', () => setTourActive(!showroomTour.active));
$('tour-stop-btn')?.addEventListener('click', () => setTourActive(false));

// 7. 2K Photo Mode (supports single-car AND live dual-car scissor curtain!)
let photoStatusTimer = 0;
$('photo-watermark')?.addEventListener('click', () => {
  studioExt.photoWatermark = !studioExt.photoWatermark;
  $('photo-watermark').setAttribute('aria-checked', String(studioExt.photoWatermark));
});
$('photo-capture-btn')?.addEventListener('click', async () => {
  const statusEl = $('photo-status');
  clearTimeout(photoStatusTimer);
  if (statusEl) statusEl.textContent = '正在渲染 2560×1440 高清 PNG…';
  try {
    const underCar = (!state.freeMode && state.view === 'floor') || camera.position.y < -.05;
    const isSplit = curtainCompare.active && Boolean(peerModel);
    const res = await capturePhoto2K({
      renderer, scene, camera, worlds, state, forces: readForces(),
      withWatermark: studioExt.photoWatermark,
      underCar,
      renderFrame: (w, h, u) => renderSceneFrame(w, h, u),
      splitLabel: isSplit ? `${curtainCompare.leftCar.toUpperCase()} vs ${curtainCompare.rightCar.toUpperCase()} · SPLIT COMPARE` : null,
      splitRatio: isSplit ? curtainCompare.ratio : null,
      onRestore: () => applyFraming(),
    });
    if (statusEl && res) {
      statusEl.textContent = `已导出 ${res.filename} (${Math.round(res.bytes / 1024)} KB)`;
      photoStatusTimer = setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 5000);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `导出失败：${err?.message || '未知错误'}`;
  }
});

// 8. Procedural Wind Tunnel Audio
$('audio-toggle')?.addEventListener('click', () => {
  const next = aeroAudio.setEnabled(!aeroAudio.enabled);
  $('audio-toggle').setAttribute('aria-pressed', String(next));
});

// 9. Aerodynamic Hotspots (live getModel() binding fixes active-car card mismatch!)
const aeroHotspots = new AeroHotspots(carTurntable, $('hotspot-layer'), $('hotspot-card'), {
  getModel: () => state.model,
  onSelect: spot => {
    showroomTour.stop();
    flyCameraTo(spot.camera);
  },
  onToggleDrs: () => toggleDrs(),
});
function setHotspotsEnabled(enabled, { autoCollapse = false } = {}) {
  const next = Boolean(enabled);
  aeroHotspots.setEnabled(next);
  $('hotspots-toggle')?.setAttribute('aria-checked', String(next));
  if (next && autoCollapse) setPanel(null);
  updateActiveToolIndicators();
}
$('hotspots-toggle')?.addEventListener('click', () => setHotspotsEnabled(!aeroHotspots.enabled, { autoCollapse: true }));

async function resetToInitialState() {
  showroomTour.stop();
  if (curtainCompare.active) curtainCompare.deactivate();
  setSliceEnabled(false);
  setProbeEnabled(false);
  setHotspotsEnabled(false);
  setFlowStyle('lines');
  clearScenarioBanner();
  unpinForcesPopover();
  setPanel(null);
  closeAllTelemetryPopovers();
  clearSavedCameraPose();
  const activeModel = state.model || DEFAULT_CONFIG.model;
  const envChanged = state.environment !== DEFAULT_CONFIG.environment;
  applyOperatingDefaults({ includeFlow: true });
  aeroAudio.syncDrs(state.drs);
  state.autoHide = DEFAULT_CONFIG.autoHide;
  $('auto-hide-toggle')?.setAttribute('aria-pressed', String(state.autoHide));
  setAutoHidden(false);
  state.environment = DEFAULT_CONFIG.environment;
  state.view = DEFAULT_CONFIG.view;
  state.freeMode = DEFAULT_CONFIG.freeMode;
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
$('flow-retry').addEventListener('click', () => {
  flowCatalog.retry();
  flowJobs.reset();
  if (curtainCompare.active) {
    peerFlowCatalog?.retry();
    peerFlowJobs?.reset();
  }
});
document.querySelectorAll('[data-flow-preset]').forEach(btn => {
  btn.addEventListener('click', () => applyConditionTarget(FLOW_PRESETS[btn.dataset.flowPreset]));
});
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

const app = $('app');
const hud = app.querySelector('.hud');
const controlDrawer = $('drawer');
const hudOverlayLayout = new ResizeObserver(entries => {
  for (const entry of entries) {
    const property = entry.target === hud ? '--hud-height' : '--drawer-height';
    app.style.setProperty(property, `${entry.borderBoxSize[0].blockSize}px`);
  }
});
hudOverlayLayout.observe(hud, { box: 'border-box' });
hudOverlayLayout.observe(controlDrawer, { box: 'border-box' });

window.addEventListener('resize', applyFraming);
document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === state.model)));
if ($('era')) $('era').textContent = state.model === 'rb19' ? '2023 / GROUND EFFECT' : '2021 / HYBRID ERA';
$('auto-hide-toggle')?.setAttribute('aria-pressed', String(state.autoHide));
applyFraming();
setEnvironment(state.environment);
showState();
persistenceReady = true;

function captureFlowVis(layers, preview, smoke, slice, sliceWant) {
  return {
    whole: Boolean(layers?.whole?.group?.visible),
    bottom: Boolean(layers?.bottom?.group?.visible),
    side: Boolean(layers?.side?.group?.visible),
    preview: Boolean(preview?.lines?.visible),
    smoke: Boolean(smoke?.group?.visible),
    slice: Boolean(sliceWant && slice?.hasData),
  };
}

function applyFlowVis(layers, preview, smoke, slice, vis, show) {
  if (layers?.whole) layers.whole.group.visible = show && vis.whole;
  if (layers?.bottom) layers.bottom.group.visible = show && vis.bottom;
  if (layers?.side) layers.side.group.visible = show && vis.side;
  if (preview) preview.lines.visible = show && vis.preview;
  if (smoke) smoke.group.visible = show && vis.smoke;
  if (slice) slice.group.visible = show && vis.slice;
}

function renderSceneFrame(w, h, underCar) {
  worlds.render(camera, scene, !underCar);
  const sliceWant = Boolean(studioExt.sliceEnabled && (state.speed > 0 || state.wheelSpeedMps > 0));
  if (curtainCompare.active && peerModel && currentModel) {
    const mainLayers = { whole: airflow, bottom: underbody, side: sidepod };
    const mainVis = captureFlowVis(mainLayers, flowPreview, flowSmoke, flowSlice, sliceWant);
    const peerVis = captureFlowVis(peerFlowLayers, peerFlowPreview, peerFlowSmoke, peerFlowSlice, sliceWant);
    const splitX = Math.max(1, Math.min(w - 1, Math.round(w * curtainCompare.ratio)));
    const leftIsMain = curtainSwapped;

    const showSide = isMain => {
      currentModel.visible = isMain;
      peerModel.visible = !isMain;
      applyFlowVis(mainLayers, flowPreview, flowSmoke, flowSlice, mainVis, isMain);
      applyFlowVis(peerFlowLayers, peerFlowPreview, peerFlowSmoke, peerFlowSlice, peerVis, !isMain);
    };

    renderer.setScissorTest(true);
    // Left half (0 .. splitX)
    showSide(leftIsMain);
    renderer.setScissor(0, 0, splitX, h);
    renderer.render(scene, camera);

    // Right half (splitX .. w)
    showSide(!leftIsMain);
    renderer.setScissor(splitX, 0, Math.max(1, w - splitX), h);
    renderer.render(scene, camera);

    renderer.setScissorTest(false);
    // Restore logical visibility for BOTH flow stacks (never corrupt peer slice/lines/smoke!)
    currentModel.visible = true;
    peerModel.visible = false;
    applyFlowVis(mainLayers, flowPreview, flowSmoke, flowSlice, mainVis, true);
    applyFlowVis(peerFlowLayers, peerFlowPreview, peerFlowSmoke, peerFlowSlice, peerVis, true);
  } else {
    if (peerModel) peerModel.visible = false;
    flowSlice.setVisible(sliceWant);
    renderer.render(scene, camera);
  }
}

renderer.setAnimationLoop(now => {
  const elapsed = Math.max(0, (now - lastTime) / 1000), dt = Math.min(elapsed, .05);
  lastTime = now;
  let cameraSettled = false;
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
    cameraSettled = applyLookOrientation(dt);
  } else {
    const distance = orbit.getDistance();
    orbit.maxPolarAngle = orbitMaxPolarAt(distance);
    cameraSettled = settleOrbitDamping(distance);
    orbit.update();
  }
  updateAutoReveal(now, cameraSettled);
  state.drsCurrent = reducedMotion ? state.drs : THREE.MathUtils.damp(state.drsCurrent, state.drs, 9, Math.min(elapsed, .5));
  if (Math.abs(state.drsCurrent - state.drs) < .001) state.drsCurrent = state.drs;
  updateDrsReadout();
  state.spin += state.wheelSpeedMps * dt;
  if (rig && (rig._lastDrs !== state.drsCurrent || rig._lastSteer !== state.steer || rig._lastSpin !== state.spin)) {
    const shadowDirty = rig._lastDrs !== state.drsCurrent || rig._lastSteer !== state.steer;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    if (shadowDirty) renderer.shadowMap.needsUpdate = true;
  }
  if (curtainCompare.active && peerRig && (peerRig._lastDrs !== state.drsCurrent || peerRig._lastSteer !== state.steer || peerRig._lastSpin !== state.spin)) {
    applyRig(peerRig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
  }

  flowMaterial.uniforms.clock.value += dt;
  flowSmoke.setClock(flowMaterial.uniforms.clock.value);
  peerFlowSmoke?.setClock(flowMaterial.uniforms.clock.value);
  showroomTour.update(dt, carTurntable.rotation.y);
  flowJobs.update(state, rig, now);
  if (curtainCompare.active && peerFlowJobs && peerRig && peerCarId) {
    peerFlowJobs.update({ ...state, model: peerCarId }, peerRig, now);
  }
  updateForcesDisplay();
  if (isForcesPopoverOpen()) aeroCompare.render(flowCatalog, state);
  aeroAudio.update(state.speed, state.effWindAngle, state.drs);
  flowProbe.updateOverlay(camera, viewport);
  aeroHotspots.update(camera, rig, viewport);

  const prevForestReady = worlds.lastForestReady;
  worlds.update(dt, state.speed, state.groundSpeed, state.effWindAngle);
  if (isTrackEnvironment(worlds.kind) && !prevForestReady && worlds.lastForestReady) renderer.shadowMap.needsUpdate = true;
  const underCar = (!state.freeMode && state.view === 'floor') || camera.position.y < -.05;
  const isTrack = isTrackEnvironment(state.environment);
  floor.visible = !underCar && !isTrack;
  for (const [k, mesh] of Object.entries(trackShadowFloors)) {
    mesh.visible = !underCar && k === state.environment;
  }
  floorInspectionLight.visible = underCar;

  const near = THREE.MathUtils.clamp((state.freeMode ? camera.position.length() : camera.position.distanceTo(orbit.target)) * .004, .025, .5);
  if (Math.abs(camera.near - near) > .001) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
  renderSceneFrame(viewport.clientWidth, viewport.clientHeight, underCar);
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
  get airflow() { return { ...flowJobs.presented, visible: airflow.group.visible,
    previewVisible: flowPreview.lines.visible, smokeVisible: flowSmoke.group.visible,
    smokeLines: flowSmoke.count, sliceVisible: flowSlice.group.visible,
    probeActive: flowProbe.enabled, probeResult: flowProbe.lastResult,
    probeMarkerScale: flowProbe.markerGroup.scale.x,
    workerPending: Boolean(flowJobs.sent), state: { ...state } }; },
  get extensions() {
    return {
      flowStyle: studioExt.flowStyle,
      sliceEnabled: studioExt.sliceEnabled,
      sliceAxis: studioExt.sliceAxis,
      sliceMetric: studioExt.sliceMetric,
      probeEnabled: flowProbe.enabled,
      probePinned: flowProbe.pinned,
      hotspotsEnabled: aeroHotspots.enabled,
      tourActive: showroomTour.active,
      audioEnabled: aeroAudio.enabled,
      curtainActive: curtainCompare.active,
      curtainLeft: curtainCompare.leftCar,
      curtainRight: curtainCompare.rightCar,
      curtainRatio: curtainCompare.ratio,
      curtainPeerReady: Boolean(peerModel),
      curtainPeerFlowReady: Boolean(peerFlowJobs?.presented),
      mainSliceHasData: Boolean(flowSlice.hasData),
      peerSliceHasData: Boolean(peerFlowSlice?.hasData),
      activeScenario: activeScenarioId,
    };
  },
  capturePhoto2K: (withWatermark = true) => {
    const underCar = (!state.freeMode && state.view === 'floor') || camera.position.y < -.05;
    const isSplit = curtainCompare.active && Boolean(peerModel);
    return capturePhoto2K({
      renderer, scene, camera, worlds, state, forces: readForces(), withWatermark,
      underCar,
      renderFrame: (w, h, u) => renderSceneFrame(w, h, u),
      splitLabel: isSplit ? `${curtainCompare.leftCar.toUpperCase()} vs ${curtainCompare.rightCar.toUpperCase()} · SPLIT COMPARE` : null,
      splitRatio: isSplit ? curtainCompare.ratio : null,
      onRestore: () => applyFraming(),
    });
  },
  get forces() { return readForces(); },
  get turntable() { return { carYawDeg: THREE.MathUtils.radToDeg(carTurntable.rotation.y), environmentYawDeg: THREE.MathUtils.radToDeg(worlds.turntableYaw), fanPosition: worlds.root?.userData.fan?.getWorldPosition(new THREE.Vector3()).toArray() || null }; },
  get sidepod() { return { visible: sidepod.group.visible, lines: sidepod.count, stops: sidepod.stops }; },
  get underbody() { return { visible: underbody.group.visible, lines: underbody.count, stops: underbody.stops }; },
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
    if (pose.drs !== undefined) state.drs = drsEndpoint(pose.drs);
    if (pose.steer !== undefined) state.steer = THREE.MathUtils.clamp(pose.steer, -18, 18);
    if (pose.ambientWindMps !== undefined) state.ambientWindMps = THREE.MathUtils.clamp(pose.ambientWindMps, 0, 15);
    if (pose.windAngle !== undefined) state.windAngle = THREE.MathUtils.clamp(pose.windAngle, -90, 90);
    if (pose.spin !== undefined) state.spin = pose.spin;
    if (pose.groundSpeed !== undefined) state.groundSpeed = THREE.MathUtils.clamp(pose.groundSpeed, 0, 350);
    state.drsCurrent = state.drs;
    showState();
    if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    if (curtainCompare.active && peerRig) applyRig(peerRig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
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
