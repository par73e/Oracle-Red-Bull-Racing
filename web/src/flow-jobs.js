import * as T from 'three';
import { describeModel, snapshotRig } from './flow-worker-protocol.js';
import { captureCondition, conditionKey } from './flow-condition.js';

const TRACE_TIMEOUT_MS = 5000;
const INIT_TIMEOUT_MS = 15000;
const PREVIOUS_RESULT_MS = 500;
const MAX_DRS_PREVIEW_DELTA = .05;

function drsPoseDistance(condition, other) {
  if (!other || condition.model !== other.model || condition.flowDensity !== other.flowDensity) return Infinity;
  if (!condition.coordinates.slice(0, -1).every((value, i) => value === other.coordinates[i])) return Infinity;
  return Math.abs(condition.drs - other.drs);
}

export class FlowJobs {
  constructor(catalog, layers, onStatus) {
    Object.assign(this, { catalog, layers, onStatus, sequence: 0, generation: 0 });
  }

  reset() {
    clearTimeout(this.watchdog);
    this.generation++;
    this.worker?.terminate();
    this.worker = this.sent = this.result = this.presented = this.failed = this.rig = null;
    this.ready = false;
    this.departedAt = null;
    this.setVisible(false);
  }

  setVisible(visible) {
    for (const layer of Object.values(this.layers)) layer.group.visible = visible && layer.count > 0;
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
    this.presented = { ...result.job, workerMs: result.data.workerMs, peakMps: result.data.layers.whole.peakMps,
      lines: result.data.layers.whole.lines };
  }

  update(state, rig, now) {
    const condition = captureCondition(state);
    const key = conditionKey(condition);
    this.key = key;
    if (!state.flow || !state.flowDensity) return this.hide('流线已隐藏');
    if (!condition.speed && !condition.wheelSpeedMps) return this.hide('静止 · 来流与车轮均为 0');
    if (!rig || rig.config.id !== condition.model || this.catalog.car !== condition.model) return this.hide('正在加载车辆气流…');
    const selection = this.catalog.select(condition);
    if (this.result && selection.sources) {
      const { job } = this.result;
      if (job.key === key) this.publish(this.result);
      else {
        const distance = drsPoseDistance(condition, job.condition);
        // A completed trace can follow the moving wing if it improves the currently displayed pose.
        if (distance <= MAX_DRS_PREVIEW_DELTA && distance < drsPoseDistance(condition, this.presented?.condition)) {
          this.publish(this.result);
          this.departedAt = now;
        }
      }
    }
    this.result = null;
    if (this.presented?.key === key && selection.sources) {
      this.departedAt = null;
      this.setVisible(true);
      this.onStatus(this.presented.mode === 'exact' ? '已求解 CFD 工况' : '相邻 CFD 工况插值');
      return;
    }
    if (this.failed) return this.hide('流线计算暂不可用 · 请重试');
    if (selection.mode === 'unsupported') return this.hide('当前组合暂无 CFD 覆盖');
    if (selection.mode === 'error') return this.hide('CFD 数据暂不可用 · 请重试');
    this.departedAt ??= now;
    const keep = this.presented?.condition.model === condition.model && now - this.departedAt <= PREVIOUS_RESULT_MS;
    this.setVisible(keep);
    this.onStatus((selection.mode === 'loading' ? '正在加载 CFD 数据' : '正在计算流线') + (keep ? ' · 显示上一工况' : '…'));
    if (!selection.sources) return;
    if (this.rig !== rig) this.initialize(rig, condition.model);
    if (!this.ready || this.sent) return;
    const id = ++this.sequence;
    // The rig has already been set to this condition by the animation loop.
    const sources = selection.sources.map(({ node, weight }) => ({ id: node.id, weight }));
    this.sent = { id, key, condition, mode: selection.mode, sources };
    this.watchdog = setTimeout(this.fail, TRACE_TIMEOUT_MS);
    try {
      this.worker.postMessage({ type: 'compute', id, key, condition, sources, grid: selection.grid,
        fields: selection.fields.filter(field => !this.known.has(field.id)),
        rig: snapshotRig(rig, this.meshes, this.versions) });
    } catch { this.fail(); }
  }

  hide(status) {
    this.departedAt = -Infinity;
    this.setVisible(false);
    this.onStatus(status);
  }

}
