import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bindRig, applyRig, inspectRig } from './rig.js';
import { Airflow } from './airflow.js';
import { AeroForces, resolveRelativeWind } from './aero-forces.js';
import { FlowJobs } from './flow-jobs.js';
import { UnderbodyFlow } from './underbody.js';
import { SidepodFlow } from './sidepod.js';
import { Environments } from './environments.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  drs: 0,
  steer: 0,
  ambientWindMps: 0,
  speed: 180,
  windAngle: 0,
  effWindAngle: 0,
  spin: 0,
  drsCurrent: 0,
  model: 'rb19',
  view: 'hero',
  freeMode: false,
  panel: null,
  environment: 'wind',
  groundSpeed: 180,
  wheelRpm: 0,
  wheelSpeedMps: 50,
  flow: true,
  flowDensity: 100,
  autoHide: false,
  autoHidden: false,
  manualHidden: false,
};
let rig, currentModel, configs, loadSerial = 0, transition = null;
let lastTime = performance.now(), statsTime = lastTime, frameCount = 0, fps = 0;
let wasNarrow = innerWidth <= 620;

const loader = new GLTFLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#11161d');
const camera = new THREE.PerspectiveCamera(34, 1, .025, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 620 ? 1.25 : 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  if (retryEl) retryEl.hidden = !message.includes('暂不可用');
  const dotEl = $('flow-dot');
  if (dotEl) {
    dotEl.dataset.tone = message.includes('暂不可用') || message.includes('失败')
      ? 'error'
      : message.includes('正在')
        ? 'loading'
        : !state.flow || message.includes('静止')
          ? 'idle'
          : 'ready';
  }
}

const carTurntable = new THREE.Group();
carTurntable.name = 'CAR_TURNTABLE';
scene.add(carTurntable);

const airflow = new Airflow(carTurntable, { onStatus: updateFlowStatus });
const aeroForces = new AeroForces();
const underbody = new UnderbodyFlow(carTurntable, airflow.material);
const sidepod = new SidepodFlow(carTurntable, airflow.material);
const flowJobs = new FlowJobs(airflow, underbody, sidepod);
worlds.set(state.environment, 2023);

function syncTurntable() {
  const yawRad = state.environment === 'wind' ? THREE.MathUtils.degToRad(state.windAngle || 0) : 0;
  carTurntable.rotation.y = yawRad;
  carTurntable.updateMatrixWorld(true);
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

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .07;
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
}

function markFreeCameraActive() {
  setCameraMode(true);
}

orbit.addEventListener('start', () => {
  transition = null;
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
window.addEventListener('pointerdown', e => {
  if ($('credits')?.open) return;
  const onCanvas = e.target === renderer.domElement;
  pointerTrack = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    button: e.button,
    panMode: e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey,
    onCanvas,
    startedOutsideDrawer: !e.target.closest?.('#drawer, .rail, .flow-state, #credits'),
    moved: false,
  };
}, { passive: true });

window.addEventListener('pointermove', e => {
  if (!pointerTrack || e.pointerId !== pointerTrack.id) return;
  const dx = e.clientX - pointerTrack.lastX;
  const dy = e.clientY - pointerTrack.lastY;
  pointerTrack.lastX = e.clientX;
  pointerTrack.lastY = e.clientY;
  if (!pointerTrack.moved && Math.hypot(e.clientX - pointerTrack.x, e.clientY - pointerTrack.y) > 4) {
    pointerTrack.moved = true;
    if (pointerTrack.onCanvas) {
      transition = null;
      if (state.autoHide && !state.manualHidden) {
        setAutoHidden(true);
      }
    }
  }
  if (state.freeMode && pointerTrack.onCanvas && pointerTrack.moved) {
    if (pointerTrack.panMode) {
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
      const sensitivity = (THREE.MathUtils.degToRad(camera.fov) / Math.max(240, viewport.clientHeight)) * 1.35;
      lookState.targetYaw -= dx * sensitivity;
      lookState.targetPitch = THREE.MathUtils.clamp(lookState.targetPitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH);
    }
  }
}, { passive: true });

window.addEventListener('pointerup', e => {
  if (!pointerTrack || e.pointerId !== pointerTrack.id) return;
  const { moved: wasMoved, button, startedOutsideDrawer } = pointerTrack;
  pointerTrack = null;
  if (!wasMoved && state.autoHidden) {
    setAutoHidden(false);
  }
  if (!wasMoved && button === 0 && state.panel && startedOutsideDrawer && !e.target.closest?.('#drawer, .rail, .flow-state, #credits, .telemetry-popover')) {
    setPanel(null);
  }
}, { passive: true });

window.addEventListener('pointercancel', () => { pointerTrack = null; }, { passive: true });

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
}, { passive: false });

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
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
    transition = null;
    markFreeCameraActive();
    freeKeys.add(e.code);
    if (state.autoHide && !state.manualHidden) setAutoHidden(true);
  }
});
window.addEventListener('keyup', e => freeKeys.delete(e.code));
window.addEventListener('blur', () => freeKeys.clear());

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
      return { position: [-5.0, 2.48, -7.8], target: [0, .62, 0] };
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

function setView(name, instant = false, keepFreeBadge = false) {
  if (!views[name]) name = 'hero';
  state.view = name;
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

  const view = resolveView(name, keepFreeBadge);
  const pos = new THREE.Vector3(...view.position);
  const target = new THREE.Vector3(...view.target);
  if (viewport.clientWidth <= 620) {
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
  } else {
    transition = {
      start: performance.now(),
      position: camera.position.clone(),
      target: orbit.target.clone(),
      endPosition: endPos,
      endTarget: hitPoint,
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
  state.environment = name;
  $('app').dataset.environment = name;
  document.querySelectorAll('[data-environment]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.environment === name)));
  worlds.set(name, rig?.config.year || 2023);
  $('scene-label').textContent = {
    studio: '深灰无缝影棚',
    wind: '风洞试验段',
    'eau-rouge': 'Eau Rouge · 坡底望向 Raidillon',
  }[name];
  $('scene-detail').textContent = name === 'eau-rouge'
    ? '斯帕 · 谷底仰视上坡与盲顶'
    : name === 'wind'
      ? '原创全尺寸风洞场景 · 气流来自自由外流算例'
      : '深色暗室影棚 · 聚焦赛车曲面与流线细节';
  orbit.maxDistance = name === 'eau-rouge' ? 120 : 18;
  floor.position.y = name === 'studio' ? -.035 : -.003;
  floor.material.opacity = name === 'eau-rouge' ? .38 : name === 'studio' ? .42 : .24;
  key.position.set(...(name === 'wind' || name === 'studio' ? [3, 6, 4] : [-2, 7, -3]));
  scene.environmentIntensity = name === 'studio' ? .82 : name === 'wind' ? .68 : .9;
  key.intensity = name === 'studio' ? 3.5 : name === 'wind' ? 3.2 : 2.2;
  fill.intensity = name === 'studio' ? 1.45 : name === 'wind' ? 1.2 : .8;
  syncTurntable();
  setView(state.view, true, state.freeMode);
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

function updateForcesDisplay() {
  const forces = aeroForces.estimate(state);
  const pctSign = forces.downforceDeltaPct > 0 ? '+' : '';
  const pctStr = `${pctSign}${forces.downforceDeltaPct}%`;
  const tDownforce = $('t-downforce');
  if (tDownforce) {
    const html = `${forces.downforceN}<small>N · ${pctStr}</small>`;
    if (tDownforce.innerHTML !== html) tDownforce.innerHTML = html;
    tDownforce.classList.toggle('is-lift', forces.downforceN < 0);
  }
  const downVal = `${forces.downforceN} N (${pctStr})`;
  if ($('hud-downforce-value') && $('hud-downforce-value').textContent !== downVal) $('hud-downforce-value').textContent = downVal;
  const relText = `${forces.relSpeedKmh} km/h · ${forces.effWindAngleDeg > 0 ? '+' : ''}${forces.effWindAngleDeg.toFixed(1)}°`;
  if ($('hud-rel-airflow') && $('hud-rel-airflow').textContent !== relText) $('hud-rel-airflow').textContent = relText;
  if ($('hud-downforce-pct') && $('hud-downforce-pct').textContent !== pctStr) $('hud-downforce-pct').textContent = pctStr;
  const dragVal = `${forces.dragN} N`;
  if ($('hud-drag-value') && $('hud-drag-value').textContent !== dragVal) $('hud-drag-value').textContent = dragVal;
  const sideDir = Math.abs(forces.sideN) < 5 ? '' : forces.sideN < 0 ? '（向车左）' : '（向车右）';
  const sideVal = `${forces.sideN > 0 ? '+' : ''}${forces.sideN} N${sideDir}`;
  if ($('hud-side-value') && $('hud-side-value').textContent !== sideVal) $('hud-side-value').textContent = sideVal;
  const rawVal = `${forces.rawCfdDownforceN} N`;
  if ($('hud-raw-downforce') && $('hud-raw-downforce').textContent !== rawVal) $('hud-raw-downforce').textContent = rawVal;
  const noteText = forces.mirroredYawForce
    ? '负向侧风暂用右侧对应实算镜像（完整 5° 队列后台求解中），基于 180 km/h F1 基准估算。'
    : forces.downforceN < 0
      ? '大侧风工况下纵向下压力大幅衰减并呈失速/微正升力趋势，基于 OpenFOAM 实算趋势估算。'
      : '基于 180 km/h F1 参考基准与 OpenFOAM 实算工况趋势连续估算，仅作直观量级参考。';
  if ($('hud-force-note') && $('hud-force-note').textContent !== noteText) $('hud-force-note').textContent = noteText;
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
    airflow.load(id);
    aeroForces.load(id).then(() => updateForcesDisplay()).catch(() => {});
    underbody.load(id);
    sidepod.load(id);
    showState();
    state.spin = 0;
    applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });
    if ($('model-name')) $('model-name').innerHTML = `${config.name}<span>.</span>`;
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
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view, false, false)));
$('auto-hide-toggle')?.addEventListener('click', e => {
  state.autoHide = !state.autoHide;
  e.currentTarget.setAttribute('aria-pressed', String(state.autoHide));
  if (!state.autoHide) setAutoHidden(false);
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
  Object.assign(state, { drs: 0, steer: 0, ambientWindMps: 0, speed: 180, windAngle: 0, effWindAngle: 0, spin: 0, groundSpeed: 180, wheelRpm: 0, flowDensity: 100 });
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
$('brand-home')?.addEventListener('click', e => {
  e.preventDefault();
  setPanel(null);
  closeAllTelemetryPopovers();
  setView('hero', false, false);
});
$('flow-retry').addEventListener('click', () => airflow.load(state.model));
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
applyFraming();
setEnvironment(state.environment);
setView('hero', true, false);
showState();

renderer.setAnimationLoop(now => {
  const elapsed = Math.max(0, (now - lastTime) / 1000), dt = Math.min(elapsed, .05);
  lastTime = now;
  if (transition) {
    const t = Math.min((now - transition.start) / 850, 1);
    const ease = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.position, transition.endPosition, ease);
    orbit.target.lerpVectors(transition.target, transition.endTarget, ease);
    if (t === 1) {
      transition = null;
      applyInstantOrbitPose(camera.position, orbit.target);
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
  if (rig) applyRig(rig, { drs: state.drsCurrent, steer: state.steer, spin: state.spin });

  flowJobs.update(state, rig, dt, now);
  updateForcesDisplay();
  const coverage = airflow.stats.sweepCoverage;
  const coverageText = coverage
    ? `逐档 ${coverage.completed}/${coverage.planned} · ${coverage.queueState === 'failed' ? '计算中断' : coverage.queueState === 'complete' ? '已完成' : coverage.complete ? '校验中' : '计算中'}`
    : '';
  if ($('sweep-status').textContent !== coverageText) $('sweep-status').textContent = coverageText;

  const yawCoverage = airflow.stats.yawCoverage;
  const yawText = yawCoverage
    ? `侧风 ±90°（5°）${yawCoverage.completed}/${yawCoverage.planned} · ${yawCoverage.complete ? '已全部完成' : yawCoverage.queueState === 'running' ? '后台求解中' : yawCoverage.queueState === 'failed' ? '计算中断' : '就绪'}`
    : '';
  if ($('yaw-status') && $('yaw-status').textContent !== yawText) $('yaw-status').textContent = yawText;

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
  if ($('underbody-status').textContent !== underbodyMessage) $('underbody-status').textContent = underbodyMessage;

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
  if ($('sidepod-status').textContent !== sidepodMessage) $('sidepod-status').textContent = sidepodMessage;

  worlds.update(dt, state.speed, state.groundSpeed);
  const underCar = (!state.freeMode && state.view === 'floor') || camera.position.y < -.05;
  floor.visible = !underCar;
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
