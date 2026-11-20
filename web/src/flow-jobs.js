import * as T from 'three';
import { describeModel, snapshotRig } from './flow-worker-protocol.js';
import { rollingWeights } from './airflow.js';
import { isStationaryHeadwind, isRoad010Headwind } from './stationary-fields.js';

const DIRECTION_SETTLE_MS = 140;
const FIELD_POLL_MS = 75;
const FIELD_HANDOFF_MS = 220;
const INPUT_HANDOFF_MS = 95;
// Prefer the rolling/yaw estimates near still air or strong sidewind.
const SWEEP_BLEND_START_MPS = 30;
const SWEEP_BLEND_END_MPS = 50;
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

function applyLayer(layer, result, retainGeometry) {
  if (!retainGeometry) layer.geometry.dispose();
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
    this.layers = [flow, bottom, side];
    this.transitionMaterial = flow.material.clone();
    this.previousLines = this.layers.map(() => {
      const lines = new T.LineSegments(undefined, this.transitionMaterial);
      lines.frustumCulled = false;
      lines.visible = false;
      lines.geometry.dispose();
      lines.geometry = null;
      flow.parent?.add(lines);
      return lines;
    });
  }

  clearTransition() {
    for (const lines of this.previousLines) {
      lines.visible = false;
      lines.geometry?.dispose();
      lines.geometry = null;
    }
    this.transition = null;
  }

  updatePresentation(now) {
    let blend = 1;
    if (this.transition) {
      blend = T.MathUtils.smoothstep(now - this.transition.started, 0, this.transition.duration);
      if (blend === 1) this.clearTransition();
    }
    this.flow.material.uniforms.opacity.value = blend;
    this.transitionMaterial.uniforms.opacity.value = 1 - blend;
  }

  hideLayers() {
    for (const layer of this.layers) layer.group.visible = false;
    this.appliedKey = this.appliedJob = this.detailAngle = null;
    this.clearTransition();
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
    this.appliedSelection = null;
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
      this.failureStatus = this.appliedKey == null
        ? '精细流线暂不可用 · 请重试'
        : '流线更新暂不可用 · 保留最近一次结果，请重试';
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

  commitResult(now) {
    const pending = this.result;
    this.result = null;
    // Publish completed intermediate poses while sliders and the DRS animation
    // advance. A result from before a wind-direction change must never return.
    if (!pending || pending.job.directionVersion !== this.directionVersion) return false;
    const { message, job } = pending;
    const previous = this.appliedJob;
    const fieldChanged = previous && (job.angle !== previous.angle || job.fieldFamily !== previous.fieldFamily
      || job.usesDrsFallback !== previous.usesDrsFallback || job.layerMask !== previous.layerMask);
    const inputJump = previous && (job.density !== previous.density
      || Math.abs(job.airspeed - previous.airspeed) > 10
      || Math.abs(job.roadSpeed - previous.roadSpeed) > 4
      || Math.abs(job.steer - previous.steer) > 4
      || Math.abs(job.drs - previous.drs) > .35);
    const startTransition = !this.reducedMotion && this.appliedKey != null && !this.transition
      && (fieldChanged || inputJump);
    if (startTransition) {
      this.transition = { started: now, duration: fieldChanged ? FIELD_HANDOFF_MS : INPUT_HANDOFF_MS };
    }
    const results = [message.flow, message.bottom, message.side];
    this.layers.forEach((layer, index) => {
      const retain = startTransition && layer.group.visible;
      if (retain) {
        this.previousLines[index].geometry = layer.geometry;
        this.previousLines[index].visible = true;
      }
      applyLayer(layer, results[index], retain);
    });
    this.appliedJob = job;
    this.appliedKey = job.key;
    this.appliedSelection = job.selectionKey;
    this.detailAngle = job.angle;
    this.flow.stats = {
      ...this.flow.stats, ...message.flow.stats, worker: true, workerMs: message.workerMs,
      buildMs: message.workerMs, mainThreadMs: job.mainThreadMs,
    };
    this.detailStatus = job.fieldFamily === 'stationary'
      ? (message.flow.stats.sourceMode === 'anchor' ? '静止迎风 · 已求解 CFD 工况' : '静止迎风 · 相邻 CFD 工况插值')
      : job.fieldFamily === 'road010'
        ? (message.flow.stats.sourceMode === 'anchor' ? '10 km/h 直行 · 已求解 CFD 工况' : '10 km/h 直行 · 相邻 CFD 工况插值')
      : job.usesDrsFallback ? '粗网格 CFD · 当前档位尚在计算，暂用近似工况'
      : message.flow.stats.sourceMode === 'anchor' ? '粗网格 CFD · 已计算工况'
      : message.flow.stats.yawMirror ? '粗网格 CFD · 侧风对称近似'
      : message.flow.stats.yawActive ? '粗网格 CFD · 侧风组合近似'
      : message.flow.stats.axisSweep ? '粗网格 CFD · 多参数组合近似'
      : '粗网格 CFD · 当前档位尚在计算，暂用近似工况';
    return true;
  }

  update(state, rig, dt, now) {
    const { flow, bottom, side } = this;
    const { sweep, yaw, stationary, road010 } = flow;
    flow.elapsed += dt;
    flow.material.uniforms.clock.value = flow.elapsed;
    this.transitionMaterial.uniforms.clock.value = flow.elapsed;
    if (this.transition && now - this.transition.started >= this.transition.duration) this.clearTransition();
    if (this.epoch !== flow.serial) {
      this.epoch = flow.serial;
      this.resetWorker();
      this.key = null;
      this.hideLayers();
    }
    const hasRig = rig && (!rig.config?.id || rig.config.id === state.model);
    if (!hasRig || !activeFlow(state)) {
      this.hideLayers();
      this.key = this.result = null;
      yaw?.cancelRequestsExcept(new Set());
      if (hasRig && state.flow && state.speed === 0 && state.wheelSpeedMps === 0) {
        flow.stats.lines = 0;
        flow.onStatus('静止 · 来流与车轮均为 0');
      }
      return;
    }

    const angle = windAngleOf(state);
    const key = inputKey(state);
    const directionChanged = this.key == null || angle !== this.angle;
    if (directionChanged) {
      this.angle = angle;
      this.directionChangedAt = now;
      this.directionVersion = (this.directionVersion ?? 0) + 1;
      yaw?.cancelRequestsExcept(new Set());
    }
    this.key = key;
    const committed = this.commitResult(now);
    const hasDetail = this.appliedKey != null;
    const detailIsCurrent = this.appliedKey === key;
    // Keep the last traced geometry until the next result can take its place.
    this.updatePresentation(now);
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

    if (now - this.directionChangedAt < DIRECTION_SETTLE_MS) {
      flow.onStatus('正在准备当前风向的流线…');
      return;
    }
    if (!this.ready) {
      flow.onStatus(hasDetail ? '正在准备流线更新…' : '正在准备精细流线…');
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
    const tracingStatus = hasDetail ? '正在更新精细流线…' : '正在计算当前工况的精细流线…';
    // Keep the same label when a trace is submitted and while it is in flight.
    if (this.sent) {
      flow.onStatus(tracingStatus);
      return;
    }
    // Throttle only asset polling for unchanged inputs. Keep loading or retry
    // text intact between polls, but show a newly completed current result now.
    if (key === this.lastSelectionInput && now < this.nextSelectionAt) {
      if (committed && detailIsCurrent) flow.onStatus(this.detailStatus);
      return;
    }
    this.lastSelectionInput = key;
    this.nextSelectionAt = now + FIELD_POLL_MS;
    const useYaw = Math.abs(angle) >= 1e-6 && state.speed > 0;
    const yawField = useYaw ? yaw?.selection(angle) : null;
    if (useYaw && (!yawField || yawField.loading || yawField.error)) {
      if (yawField?.error) {
        flow.onStatus(hasDetail ? '侧风数据暂不可用 · 保留最近一次结果，请重试' : '侧风数据暂不可用 · 请重试');
      } else {
        flow.onStatus('正在加载当前角度的侧风数据…');
      }
      return;
    }

    const U = state.speed / 3.6, W = state.wheelSpeedMps;
    const matchedFamily = stationary && isStationaryHeadwind(state) ? 'stationary'
      : road010 && isRoad010Headwind(state) ? 'road010' : null;
    const matchedField = matchedFamily ? flow[matchedFamily].selection(U, flow.baseSpec) : null;
    if (matchedField?.loading || matchedField?.error || matchedField?.unsupported) {
      if (!matchedField.loading) this.hideLayers();
      const label = matchedFamily === 'stationary' ? '静止迎风' : '10 km/h 直行';
      flow.onStatus(matchedField.unsupported ? `此风速暂无${label} CFD 数据`
        : matchedField.error ? `${label}数据暂不可用 · 请重试`
        : hasDetail ? `正在加载${label}数据 · 显示上一工况` : `正在加载${label}数据…`);
      return;
    }
    const alignment = useYaw ? Math.abs(Math.cos(T.MathUtils.degToRad(angle))) : 1;
    const steer = state.steer * alignment, drs = state.drsCurrent * alignment;
    const drsEndpoints = state.drs === 0 || state.drs === 1;
    const highSpeedMix = T.MathUtils.smoothstep(U + W, SWEEP_BLEND_START_MPS, SWEEP_BLEND_END_MPS);
    // Retain changes in the solved fields at lower relative airspeeds. Fade
    // back to rolling as wheel motion dominates, and to yaw for strong crosswind.
    const incomingAir = T.MathUtils.smoothstep(U, .25, 1);
    const forwardFlow = W > 0 ? T.MathUtils.smoothstep(U / W, .25, .5) : 1;
    const headwindMix = 1 - T.MathUtils.smoothstep(Math.abs(angle), 0, 30);
    const lowSpeedMix = incomingAir * forwardFlow * headwindMix;
    const sweepMix = T.MathUtils.lerp(lowSpeedMix, 1, highSpeedMix);
    const inflowBlend = incomingAir * forwardFlow * (1 - highSpeedMix);
    const sweepField = !matchedField && sweepMix > 0 && (!sweep.car || sweep.car === state.model)
      ? sweep.selection(U, W, steer, drs, { drsEndpoints, inflowBlend }) : null;
    const sweepReady = Boolean(sweepField && !sweepField.loading);
    const rolling = matchedField || (sweepReady && sweepMix === 1) ? {} : rollingWeights(U, W, steer, drs);
    const missing = Object.keys(rolling).filter(name => Math.abs(rolling[name]) > 1e-7 && !flow.data[name]);
    missing.forEach(name => flow.ensureAnchor?.(name));
    const axisSweep = sweepReady;
    let weights = rolling;
    let source = flow.data;
    let fieldFamily = 'rolling';
    if (matchedField) {
      weights = matchedField.weights;
      source = matchedField.data;
      fieldFamily = matchedFamily;
    } else if (sweepReady) {
      weights = sweepField.weights;
      source = sweepField.data;
      fieldFamily = 'sweep';
      if (sweepMix < 1 && !missing.length) {
        weights = {};
        for (const [name, weight] of Object.entries(rolling)) weights[name] = (1 - sweepMix) * weight;
        for (const [name, weight] of Object.entries(sweepField.weights)) {
          weights[name] = (weights[name] ?? 0) + sweepMix * weight;
        }
        source = { ...flow.data, ...sweepField.data };
      }
    } else if (missing.length) {
      weights = { base: U / 50 };
      fieldFamily = 'baseline';
    }
    // At zero airspeed, the baseline scaled by U would erase wheel-only flow.
    // Wait for the required rolling field and leave any existing result visible.
    if (!U && !sweepReady && missing.length) {
      flow.onStatus('正在加载车轮气流数据…');
      return;
    }
    const yawSelection = yawField && {
      weights: Object.fromEntries(Object.entries(yawField.weights).map(([name, value]) => [`yaw:${name}`, value])),
      spec: yawField.spec, exact: yawField.exact, mirror: yawField.mirror,
    };
    const usesDrsFallback = axisSweep && sweepField.usesDrsFallback === true;
    const layerMask = Number(this.bottomSent) | (Number(this.sideSent) << 1);
    const selectionKey = JSON.stringify([weights, fieldFamily, usesDrsFallback, yawSelection?.weights, yawSelection?.exact, layerMask]);
    // Background warm-up should not cause a trace of an unchanged selection.
    if (detailIsCurrent && this.appliedSelection === selectionKey) {
      flow.onStatus(this.detailStatus);
      yaw?.warmNearby?.(angle);
      return;
    }
    flow.onStatus(tracingStatus);
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
    this.sent = { id, key, angle, selectionKey, usesDrsFallback, fieldFamily, layerMask,
      density: state.flowDensity, airspeed: state.speed, roadSpeed: W, steer: state.steer, drs: state.drsCurrent,
      directionVersion: this.directionVersion };
    this.watchdog = setTimeout(() => this.recover(serial, true), TRACE_TIMEOUT_MS);
    const selection = { weights, axisSweep, stationary: fieldFamily === 'stationary' };
    if (fieldFamily === 'road010') selection.matchedHeadwind = true;
    this.worker.postMessage({
      type: 'compute', id, key, state: { ...state }, rig: snapshotRig(rig, this.meshes, this.versions),
      selection, yawSelection, fields,
    });
    this.sent.mainThreadMs = performance.now() - started;
  }
}
