import * as T from 'three';
import { describeModel, snapshotRig } from './flow-worker-protocol.js';
import { rollingWeights } from './airflow.js';
import { FlowPreview } from './flow-preview.js';

const SETTLE_MS = 140;
const BLEND_MS = 160;
const TRACE_TIMEOUT_MS = 5000;
const windAngleOf = state => state.effWindAngle ?? state.windAngle ?? 0;
const activeFlow = state => state.flow && state.flowDensity > 0 && (state.speed > 0 || state.wheelSpeedMps > 0);
const inputKey = state => [state.speed, state.wheelSpeedMps, state.steer, state.drsCurrent.toFixed(3), state.flowDensity, windAngleOf(state)].join(':');
const coverage = loader => loader?.manifest ? {
  completed: loader.manifest.completedUnique,
  planned: loader.manifest.plannedUnique,
  complete: loader.manifest.complete,
  queueState: loader.queue?.state,
} : null;

function applyLayer(layer, result) {
  layer.geometry.dispose();
  const geometry = new T.BufferGeometry();
  for (const [key, array] of Object.entries(result.attributes)) {
    geometry.setAttribute(key, new T.BufferAttribute(array, key === 'position' || key === 'color' ? 3 : 1));
  }
  layer.geometry = layer.lines.geometry = geometry;
  layer.group.visible = result.visible;
  for (const key of ['count', 'mode', 'stops', 'boundaryAxes', 'regions', 'layers', 'seedPoints', 'blockedSeeds', 'fallbackSamples']) {
    if (result[key] !== undefined) layer[key] = result[key];
  }
}

export class FlowJobs {
  constructor(flow, bottom, side, { onWorkerReady = null, reducedMotion = false } = {}) {
    Object.assign(this, { flow, bottom, side, onWorkerReady, reducedMotion, serial: 0, jobId: 0 });
    this.preview = new FlowPreview(flow);
  }

  hideLayers() {
    for (const layer of [this.flow, this.bottom, this.side]) layer.group.visible = false;
  }

  resetWorker() {
    clearTimeout(this.recoverTimer);
    clearTimeout(this.watchdog);
    this.serial++;
    this.worker?.terminate();
    this.worker = null;
    this.model = null;
    this.failed = false;
    this.failureStatus = null;
    this.ready = false;
    this.sent = this.result = null;
    this.nextSelectionAt = 0;
  }

  retry() {
    this.recoveries = 0;
    this.resetWorker();
  }

  recover(serial, timedOut = false) {
    if (serial !== this.serial || this.loadSerial !== this.flow.serial) return;
    this.resetWorker();
    this.failed = true;
    this.recoveries = (this.recoveries || 0) + 1;
    if (timedOut || this.recoveries > 2) {
      this.failureStatus = '精细流线暂不可用 · 当前为交互预览，请重试';
      this.flow.onStatus(this.failureStatus);
      return;
    }
    this.failureStatus = '正在恢复精细流线计算…';
    this.flow.onStatus(this.failureStatus);
    const generation = this.serial;
    this.recoverTimer = setTimeout(() => {
      if (generation === this.serial) this.failed = false;
    }, 500 * 2 ** (this.recoveries - 1));
  }

  initialize(state, rig) {
    if (this.loadSerial !== this.flow.serial) this.recoveries = 0;
    this.resetWorker();
    this.model = rig;
    this.loadSerial = this.flow.serial;
    const serial = this.serial;
    const { meshes, description } = describeModel(rig);
    this.meshes = meshes;
    this.versions = meshes.map(mesh => mesh.geometry.attributes.position.version);
    this.known = new Set(['base']);
    this.bottomSent = this.bottom.status === 'ready' && Boolean(this.bottom.data);
    this.sideSent = this.side.status === 'ready' && Boolean(this.side.data);
    this.worker = new Worker(new URL('./flow-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data: message }) => {
      if (serial !== this.serial || this.loadSerial !== this.flow.serial) return;
      if (message.type === 'ready') {
        clearTimeout(this.watchdog);
        this.ready = true;
        this.onWorkerReady?.(state.model);
      } else if (message.type === 'error') {
        this.recover(serial);
      } else if (message.type === 'result' && message.id === this.sent?.id) {
        clearTimeout(this.watchdog);
        this.recoveries = 0;
        this.known = new Set(message.cachedKeys);
        // Commit during update(), against the exact state about to render.
        // Slider events and the animated rig may advance between animation frames.
        this.result = { message, job: this.sent };
        this.sent = null;
      }
    };
    this.worker.onerror = event => {
      event?.preventDefault?.();
      this.recover(serial);
    };
    this.watchdog = setTimeout(() => this.recover(serial, true), 15000);
    this.worker.postMessage({
      type: 'init', car: state.model, meshes: description, spec: this.flow.spec, baseline: this.flow.data.base,
      bottom: this.bottomSent ? { data: this.bottom.data, meta: this.bottom.meta } : { data: null, meta: null },
      side: this.sideSent ? { data: this.side.data, meta: this.side.meta } : { data: null, meta: null },
    }, description.flatMap(mesh => mesh.index ? [mesh.position.buffer, mesh.index.buffer] : [mesh.position.buffer]));
  }

  commitResult(key, now) {
    const pending = this.result;
    this.result = null;
    if (!pending || pending.job.key !== key || pending.job.poseVersion !== this.poseVersion) return;
    const { message, job } = pending;
    if (this.appliedKey !== key) this.blendStarted = now;
    applyLayer(this.flow, message.flow);
    applyLayer(this.bottom, message.bottom);
    applyLayer(this.side, message.side);
    this.appliedKey = key;
    this.appliedSelection = job.selectionKey;
    this.detailAngle = job.angle;
    this.flow.stats = {
      ...this.flow.stats, ...message.flow.stats, worker: true, workerMs: message.workerMs,
      buildMs: message.workerMs, mainThreadMs: job.mainThreadMs,
    };
    this.detailStatus = message.flow.stats.sourceMode === 'anchor' ? '粗网格 CFD · 已计算工况'
      : message.flow.stats.yawMirror ? '粗网格 CFD · 侧风对称近似'
      : message.flow.stats.yawActive ? '粗网格 CFD · 侧风组合近似'
      : message.flow.stats.axisSweep ? '粗网格 CFD · 多参数组合近似'
      : '粗网格 CFD · 当前档位尚在计算，暂用近似工况';
  }

  update(state, rig, dt, now) {
    const { flow, bottom, side } = this;
    const { sweep, yaw } = flow;
    flow.elapsed += dt;
    flow.material.uniforms.clock.value = this.preview.material.uniforms.clock.value = flow.elapsed;
    if (this.epoch !== flow.serial) {
      this.epoch = flow.serial;
      this.resetWorker();
      this.key = this.appliedKey = null;
      this.result = null;
    }
    const hasRig = rig && (!rig.config?.id || rig.config.id === state.model);
    if (!hasRig || !activeFlow(state)) {
      this.hideLayers();
      this.preview.show(0);
      this.key = this.appliedKey = this.result = null;
      yaw?.cancelRequestsExcept(new Set());
      if (hasRig && state.flow && state.speed === 0 && state.wheelSpeedMps === 0) {
        flow.stats.lines = 0;
        flow.onStatus('静止 · 来流与车轮均为 0');
      }
      return;
    }

    const angle = windAngleOf(state);
    const key = inputKey(state);
    if (key !== this.key) {
      this.key = key;
      this.changedAt = now;
      this.poseVersion = (this.poseVersion ?? 0) + 1;
      this.appliedKey = null;
      this.hideLayers();
      const started = performance.now();
      this.preview.update(state, angle, rig);
      this.previewMs = performance.now() - started;
      yaw?.cancelRequestsExcept(new Set());
    }
    this.commitResult(key, now);
    const hasDetail = this.appliedKey === key;
    const blend = !hasDetail ? 0 : this.reducedMotion ? 1 : Math.min(1, (now - this.blendStarted) / BLEND_MS);
    flow.material.uniforms.opacity.value = blend;
    this.preview.show(1 - blend);
    if (this.failed) {
      flow.onStatus(this.failureStatus);
      return;
    }
    if (!flow.stats.ready) return;
    if (this.model !== rig) this.initialize(state, rig);

    flow.stats.sweepCoverage = coverage(sweep);
    flow.stats.yawCoverage = coverage(yaw);
    if (now - sweep.lastRefresh > 30000 && !sweep.manifest?.complete) sweep.refresh();
    if (yaw && now - yaw.lastRefresh > 30000 && !yaw.manifest?.complete) yaw.refresh();

    if (now - this.changedAt < SETTLE_MS) {
      flow.onStatus(hasDetail ? this.detailStatus : '交互预览 · 随当前工况更新');
      return;
    }
    if (!this.ready) {
      flow.onStatus('交互预览 · 正在准备精细流线');
      return;
    }
    if (!this.bottomSent && bottom.status === 'ready' && bottom.data) {
      this.worker.postMessage({ type: 'layer', kind: 'bottom', data: bottom.data, meta: bottom.meta });
      this.bottomSent = true;
    }
    if (!this.sideSent && side.status === 'ready' && side.data) {
      this.worker.postMessage({ type: 'layer', kind: 'side', data: side.data, meta: side.meta });
      this.sideSent = true;
    }
    if (this.sent || now < (this.nextSelectionAt ?? 0)) return;
    this.nextSelectionAt = now + 75;
    const useYaw = Math.abs(angle) >= 1e-6 && state.speed > 0;
    const yawField = useYaw ? yaw?.selection(angle) : null;
    if (useYaw && (!yawField || yawField.loading || yawField.error)) {
      flow.onStatus(yawField?.error ? '精细侧风流线暂不可用 · 当前为交互预览，请重试' : '交互预览 · 正在加载当前角度的侧风数据');
      return;
    }

    const U = state.speed / 3.6, W = state.wheelSpeedMps;
    const alignment = useYaw ? Math.abs(Math.cos(T.MathUtils.degToRad(angle))) : 1;
    const steer = state.steer * alignment, drs = state.drsCurrent * alignment;
    const sweepField = sweep.car && sweep.car !== state.model ? null : sweep.selection(U, W, steer, drs);
    const axisSweep = Boolean(sweepField && !sweepField.loading);
    let weights = axisSweep ? sweepField.weights : rollingWeights(U, W, steer, drs);
    const source = axisSweep ? sweepField.data : flow.data;
    const missing = Object.keys(weights).filter(name => Math.abs(weights[name]) > 1e-7 && !source[name]);
    if (missing.length) {
      missing.forEach(name => flow.ensureAnchor?.(name));
      weights = { base: U / 50 };
    }
    // At zero airspeed, the baseline scaled by U would erase wheel-only flow.
    // Keep its local preview until the required rolling field arrives.
    if (!U && missing.length) {
      flow.onStatus('交互预览 · 正在加载车轮气流数据');
      return;
    }
    const yawSelection = yawField && {
      weights: Object.fromEntries(Object.entries(yawField.weights).map(([name, value]) => [`yaw:${name}`, value])),
      spec: yawField.spec, exact: yawField.exact, mirror: yawField.mirror,
    };
    const selectionKey = JSON.stringify([weights, axisSweep, yawSelection?.weights, yawSelection?.exact, this.bottomSent, this.sideSent]);
    // Background warm-up should not cause a trace of an unchanged selection.
    if (hasDetail && this.appliedSelection === selectionKey) {
      flow.onStatus(this.detailStatus);
      yaw?.warmNearby?.(angle);
      return;
    }
    flow.onStatus(hasDetail ? '正在更新精细流线…' : '交互预览 · 正在计算当前工况的精细流线');
    const started = performance.now();
    const fields = {};
    for (const name of Object.keys(weights)) {
      if (Math.abs(weights[name]) > 1e-7 && !this.known.has(name)) fields[name] = source[name];
    }
    for (const [name, value] of Object.entries(yawField?.weights ?? {})) {
      if (Math.abs(value) > 1e-7 && !this.known.has(`yaw:${name}`)) fields[`yaw:${name}`] = yawField.data[name];
    }
    const id = ++this.jobId;
    const serial = this.serial;
    this.sent = { id, key, angle, selectionKey, poseVersion: this.poseVersion };
    this.watchdog = setTimeout(() => this.recover(serial, true), TRACE_TIMEOUT_MS);
    this.worker.postMessage({
      type: 'compute', id, key, state: { ...state }, rig: snapshotRig(rig, this.meshes, this.versions),
      selection: { weights, axisSweep }, yawSelection, fields,
    });
    this.sent.mainThreadMs = performance.now() - started;
  }
}
