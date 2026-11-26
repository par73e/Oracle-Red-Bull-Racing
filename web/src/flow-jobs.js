import * as T from 'three';
import { describeModel, snapshotRig } from './flow-worker-protocol.js';
import { captureCondition, conditionKey } from './flow-condition.js';

const TRACE_TIMEOUT_MS = 12000;
const INIT_TIMEOUT_MS = 25000;
const PREVIOUS_RESULT_MS = 500;
const MAX_DRS_PREVIEW_DELTA = .05;
const YAW_FETCH_SETTLE_MS = 90;
const YAW_PREVIEW_THRESHOLD_DEG = 1.5;

function conditionDistance(condition, other) {
  if (!other || condition.model !== other.model) return Infinity;
  return Math.abs(condition.speed - other.speed) / 350
    + Math.abs(condition.wheelSpeedMps - other.wheelSpeedMps) / 100
    + Math.abs(condition.effWindAngle - other.effWindAngle) / 90
    + Math.abs(condition.steer - other.steer) / 18
    + Math.abs(condition.drs - other.drs)
    + Math.abs(condition.flowDensity - other.flowDensity) / 100;
}

export class FlowJobs {
  constructor(catalog, layers, onStatus, preview = null, extras = null) {
    Object.assign(this, { catalog, layers, onStatus, preview, extras, sequence: 0, generation: 0, sliceSeq: 0, probeSeq: 0 });
  }

  setExtras(extras) {
    this.extras = extras;
  }

  requestSlice(sliceReq) {
    if (!this.ready || !this.worker || !sliceReq) return false;
    const id = ++this.sliceSeq;
    this.latestSliceId = id;
    try {
      this.worker.postMessage({ type: 'slice', id, slice: sliceReq });
      return true;
    } catch { return false; }
  }

  requestProbe(point) {
    if (!this.ready || !this.worker || !point) return false;
    const id = ++this.probeSeq;
    this.latestProbeId = id;
    try {
      this.worker.postMessage({ type: 'probe', id, point });
      return true;
    } catch { return false; }
  }

  reset() {
    clearTimeout(this.watchdog);
    this.generation++;
    this.worker?.terminate();
    this.worker = this.sent = this.result = this.presented = this.failed = this.rig = null;
    this.ready = false;
    this.departedAt = null;
    this.lastYaw = null;
    this.yawChangedAt = null;
    this.setVisible(false);
    this.preview?.hide();
    this.extras?.smokeLayer?.setVisible(false);
  }

  setVisible(visible) {
    const useSmoke = this.extras?.getStyle?.() === 'smoke' && Boolean(this.extras?.smokeLayer?.count);
    for (const layer of Object.values(this.layers)) layer.group.visible = visible && !useSmoke && layer.count > 0;
    if (this.extras?.smokeLayer) this.extras.smokeLayer.setVisible(visible && useSmoke);
  }

  initialize(rig, car) {
    this.reset();
    this.rig = rig;
    const generation = this.generation;
    const fail = () => {
      if (generation !== this.generation) return;
      this.reset();
      this.failed = true;
    };
    try {
      const { meshes, description } = describeModel(rig);
      this.meshes = meshes;
      this.versions = meshes.map(mesh => mesh.geometry.attributes.position.version);
      this.known = new Set();
      this.worker = new Worker(new URL('./flow-worker.js', import.meta.url), { type: 'module' });
      this.worker.onerror = event => { event.preventDefault?.(); fail(); };
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'error') { fail(); return; }
        if (data.type === 'ready') {
          clearTimeout(this.watchdog);
          this.ready = true;
        } else if (data.type === 'sliceResult') {
          if (data.id === this.latestSliceId) this.extras?.onSliceResult?.(data.slice);
        } else if (data.type === 'probeResult') {
          if (data.id === this.latestProbeId) this.extras?.onProbeResult?.(data.probe);
        } else if (data.type === 'result' && data.id === this.sent?.id && data.key === this.sent.key) {
          clearTimeout(this.watchdog);
          this.known = new Set(data.cachedKeys);
          this.result = { data, job: this.sent };
          this.sent = null;
        }
      };
      this.watchdog = setTimeout(fail, INIT_TIMEOUT_MS);
      this.worker.postMessage({ type: 'init', car, meshes: description }, description.flatMap(mesh =>
        mesh.index ? [mesh.position.buffer, mesh.index.buffer] : [mesh.position.buffer]));
      this.fail = fail;
    } catch { fail(); }
  }

  publish(result) {
    for (const [name, layer] of Object.entries(this.layers)) {
      const next = result.data.layers[name];
      const geometry = new T.BufferGeometry();
      for (const [key, array] of Object.entries(next.attributes)) {
        geometry.setAttribute(key, new T.BufferAttribute(array, key === 'position' || key === 'color' ? 3 : 1));
      }
      layer.geometry.dispose();
      layer.geometry = layer.lines.geometry = geometry;
      layer.count = next.lines;
      layer.stops = next.stops;
    }
    if (result.data.smoke && this.extras?.smokeLayer) {
      this.extras.smokeLayer.applyResult(result.data.smoke);
    }
    if (result.data.slice) {
      this.extras?.onSliceResult?.(result.data.slice);
    }
    this.extras?.onFieldUpdated?.(result.job.condition);
    this.presented = { ...result.job, workerMs: result.data.workerMs, peakMps: result.data.layers.whole.peakMps,
      lines: result.data.layers.whole.lines };
  }

  update(state, rig, now) {
    const condition = captureCondition(state);
    const style = this.extras?.getStyle?.() ?? 'lines';
    const smokeRakeX = style === 'smoke' ? (this.extras?.getSmokeRakeX?.() ?? 0) : 0;
    const key = style === 'smoke'
      ? `${conditionKey(condition)}|smoke:${smokeRakeX.toFixed(2)}`
      : conditionKey(condition);
    this.key = key;
    if (!state.flow || !state.flowDensity) return this.hide('流线已隐藏');
    if (!condition.speed && !condition.wheelSpeedMps) return this.hide('静止 · 来流与车轮均为 0');
    if (!rig || rig.config.id !== condition.model || this.catalog.car !== condition.model) return this.hide('正在加载车辆气流…');
    if (this.lastYaw !== null && Math.abs(condition.effWindAngle - this.lastYaw) > 1e-4) {
      this.yawChangedAt = now;
    }
    this.lastYaw = condition.effWindAngle;
    const deferFetch = Boolean(this.preview)
      && this.yawChangedAt !== null
      && (now - this.yawChangedAt < YAW_FETCH_SETTLE_MS);
    const selection = this.catalog.select(condition, { deferFetch });
    if (this.result && selection.mode !== 'unsupported' && selection.mode !== 'error') {
      const { job } = this.result;
      if (job.key === key && selection.sources) this.publish(this.result);
      else if (job.condition.model === condition.model
          && Math.abs(condition.drs - job.condition.drs) <= MAX_DRS_PREVIEW_DELTA
          && conditionDistance(condition, job.condition) < conditionDistance(condition, this.presented?.condition)) {
        // Publish completed intermediate slider poses live so speed, yaw, steer,
        // and density drags update real CFD streamlines continuously at 30-50 FPS.
        this.publish(this.result);
        this.departedAt = now;
      }
    }
    this.result = null;
    if (this.presented?.key === key && selection.sources) {
      this.departedAt = null;
      this.preview?.hide();
      this.setVisible(true);
      this.onStatus(this.presented.mode === 'exact'
        ? '已求解 CFD 工况'
        : this.presented.mode === 'interpolated'
          ? '相邻 CFD 工况插值'
          : 'CFD 组合近似');
      this.catalog.prewarmCore?.();
      return;
    }
    if (this.failed) return this.hide('流线计算暂不可用 · 请重试');
    if (selection.mode === 'unsupported') return this.hide('当前组合暂无 CFD 覆盖');
    if (selection.mode === 'error') return this.hide('CFD 数据暂不可用 · 请重试');
    this.departedAt ??= now;
    const sameModel = this.presented?.condition.model === condition.model;
    const yawDiverged = !sameModel || Math.abs(this.presented.condition.effWindAngle - condition.effWindAngle) > YAW_PREVIEW_THRESHOLD_DEG;
    const keepCfd = sameModel && !yawDiverged && (Boolean(selection.sources) || now - this.departedAt <= PREVIOUS_RESULT_MS);
    if (this.preview && !keepCfd) {
      this.setVisible(false);
      this.preview.update(condition, rig);
      this.onStatus((selection.mode === 'loading' ? '正在加载侧风 CFD' : '正在计算流线') + ' · 实时方向预览');
    } else {
      this.preview?.hide();
      this.setVisible(keepCfd);
      this.onStatus((selection.mode === 'loading' ? '正在加载 CFD 数据' : '正在计算流线') + (keepCfd ? ' · 显示上一工况' : '…'));
    }
    if (!selection.sources) return;
    if (this.rig !== rig) this.initialize(rig, condition.model);
    if (!this.ready || this.sent) return;
    const id = ++this.sequence;
    // The rig has already been set to this condition by the animation loop.
    const sources = selection.sources.map(({ node, weight }) => ({ id: node.id, weight }));
    const deltas = (selection.deltas ?? []).map(({ posNode, negNode, weight, grid }) => ({
      posId: posNode.id, negId: negNode.id, weight, grid,
    }));
    const sliceReq = this.extras?.getSliceRequest?.(condition) ?? null;
    this.sent = { id, key, condition, mode: selection.mode, sources, deltas };
    this.watchdog = setTimeout(this.fail, TRACE_TIMEOUT_MS);
    try {
      this.worker.postMessage({ type: 'compute', id, key, condition, sources, deltas, grid: selection.grid,
        smoke: style === 'smoke', smokeRakeX, slice: sliceReq,
        fields: selection.fields.filter(field => !this.known.has(field.id)),
        rig: snapshotRig(rig, this.meshes, this.versions) });
    } catch { this.fail(); }
  }

  hide(status) {
    this.departedAt = -Infinity;
    this.setVisible(false);
    this.preview?.hide();
    this.onStatus(status);
  }

}
