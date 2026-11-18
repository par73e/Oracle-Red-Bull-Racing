// ±90° crosswind/yaw CFD field loader (5° steps), loaded lazily with live queue polling.
import { cachedArrayBuffer, deleteCachedAsset } from './asset-cache.js';
export const YAW_STEP = 5;
const YAW_FETCH_TIMEOUT_MS = 5000;
const YAW_CACHE_LIMIT = 12;
const YAW_WARM_NEIGHBORS = 4;

export function yawKeyFor(deg) {
  const rounded = Math.round(deg);
  if (rounded === 0) return 'yaw-000';
  return `yaw-${rounded < 0 ? 'm' : 'p'}${String(Math.abs(rounded)).padStart(3, '0')}`;
}

function mirrorYawField(src, shape) {
  const [nx, ny, nz] = shape;
  const dst = new Float32Array(src.length);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const sy = ny - 1 - y;
      for (let x = 0; x < nx; x++) {
        const di = ((z * ny + y) * nx + x) * 3;
        const si = ((z * ny + sy) * nx + x) * 3;
        dst[di] = src[si];
        dst[di + 1] = -src[si + 1];
        dst[di + 2] = src[si + 2];
      }
    }
  }
  return dst;
}

export class YawFields {
  constructor(onChange) {
    this.onChange = onChange;
    this.serial = 0;
    this.revision = 0;
    this.cache = new Map();
    this.pending = new Map();
    this.lastRefresh = 0;
    this.manifest = null;
    this.records = new Map();
    this.failures = new Set();
    this.warmAttempts = new Set();
  }

  setCar(car) {
    if (this.car === car) return;
    this.cancelRequestsExcept(new Set());
    this.serial++;
    this.revision++;
    this.car = car;
    this.cache.clear();
    this.failures.clear();
    this.warmAttempts.clear();
    this.manifest = null;
    this.manifestFailed = false;
    this.refreshing = false;
    this.lastRefresh = 0;
    this.records.clear();
    this.queue = null;
  }

  async refresh() {
    if (!this.car || this.refreshing || this.manifestFailed) return;
    this.refreshing = true;
    const serial = this.serial;
    this.lastRefresh = performance.now();
    const cache = import.meta.env?.DEV ? 'no-store' : 'default';
    try {
      const response = await fetch(`/flow/${this.car}/yaw/manifest.json`, {
        cache, signal: AbortSignal.timeout(YAW_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (serial !== this.serial) return;
      const changed = manifest.completedUnique !== this.manifest?.completedUnique;
      this.manifest = manifest;
      this.records = new Map(manifest.fields.map(record => [record.key, record]));
      if (!manifest.complete) void this.refreshQueue(serial, cache);
      if (changed) {
        this.revision++;
        this.onChange();
      }
    } catch {
      if (serial === this.serial && !this.manifest) this.manifestFailed = true;
    } finally {
      if (serial === this.serial) this.refreshing = false;
    }
  }

  async refreshQueue(serial, cache) {
    try {
      const response = await fetch('/flow/yaw-status.json', { cache, signal: AbortSignal.timeout(YAW_FETCH_TIMEOUT_MS) });
      const queue = response.ok ? await response.json() : null;
      if (serial === this.serial) this.queue = queue;
    } catch {
      // Optional queue telemetry must not delay a field selection.
    }
  }

  retry() {
    this.failures?.clear();
    this.manifestFailed = false;
    if (!this.manifest) void this.refresh();
  }

  cancelRequestsExcept(keys) {
    for (const [key, request] of this.pending) {
      if (keys.has(key)) continue;
      this.pending.delete(key);
      request.controller.abort();
    }
  }

  selection(windAngleDeg = 0) {
    if (!this.manifest || !this.manifest.complete && performance.now() - this.lastRefresh > 10000) {
      this.refresh();
    }
    if (this.manifestFailed) return { error: true };
    if (!this.manifest) return { loading: true };

    const clamped = Math.max(-90, Math.min(90, windAngleDeg));
    const solved = [...this.records.values()]
      .map(r => ({ deg: r.windAngleDeg ?? r.parameters?.windAngleDeg, record: r }))
      .filter(item => Number.isFinite(item.deg))
      .sort((a, b) => a.deg - b.deg);
    if (!solved.length) return { error: true };

    const exact5 = Math.abs(clamped - Math.round(clamped / YAW_STEP) * YAW_STEP) < 1e-6;
    const exactKey = yawKeyFor(clamped);

    // Build bracket among actually solved angles; if negative side hasn't solved yet,
    // allow temporary mirror fallback from positive angles and flag approxMirror.
    let loItem = null;
    let hiItem = null;
    let mirror = false;

    for (const item of solved) {
      if (item.deg <= clamped + 1e-6) loItem = item;
      if (item.deg >= clamped - 1e-6 && !hiItem) hiItem = item;
    }

    if (!loItem && clamped < 0) {
      // Negative angle not yet covered by negative solved cases; temporarily mirror |clamped|.
      mirror = true;
      const absDeg = Math.abs(clamped);
      for (const item of solved) {
        if (item.deg <= absDeg + 1e-6) loItem = item;
        if (item.deg >= absDeg - 1e-6 && !hiItem) hiItem = item;
      }
    }

    if (!loItem) loItem = solved[0];
    if (!hiItem) hiItem = solved[solved.length - 1];

    const targetDeg = mirror ? Math.abs(clamped) : clamped;
    const t =
      hiItem.deg === loItem.deg
        ? 0
        : Math.max(0, Math.min(1, (targetDeg - loItem.deg) / (hiItem.deg - loItem.deg)));

    const needed = new Map();
    const addNeed = (key, weight) => {
      if (Math.abs(weight) > 1e-8) {
        needed.set(key, (needed.get(key) || 0) + weight);
      }
    };
    addNeed(loItem.record.key, 1 - t);
    addNeed(hiItem.record.key, t);

    const reqKeys = new Set(needed.keys());
    this.cancelRequestsExcept(new Set([...reqKeys, ...[...this.pending].filter(([, request]) => request.warm).map(([key]) => key)]));
    const missing = [...reqKeys].filter(key => !this.cache.has(key));
    if (missing.some(key => this.failures.has(key))) return { error: true };
    for (const key of missing) this.request(key);
    if (missing.length) return { loading: true };

    const spec = loItem.record.grid;
    const weights = {};
    const data = {};
    for (const [k, w] of needed.entries()) {
      const cacheKey = mirror && k !== 'yaw-000' ? `${k}:mirror` : k;
      weights[cacheKey] = w;
      if (!data[cacheKey]) {
        const raw = this.cache.get(k);
        data[cacheKey] = mirror && k !== 'yaw-000' ? mirrorYawField(raw, spec.shape) : raw;
      }
      // Touch LRU
      const v = this.cache.get(k);
      this.cache.delete(k);
      this.cache.set(k, v);
    }

    const exact = !mirror && exact5 && this.records.has(exactKey);
    return {
      weights,
      data,
      spec,
      exact,
      mirror,
    };
  }

  // Warm one nearby field at a time, only after the foreground trace has settled.
  warmNearby(angle) {
    if (!this.manifest || this.pending.size) return;
    const nearby = [...this.records.values()]
      .map(record => ({ key: record.key, distance: Math.abs((record.windAngleDeg ?? record.parameters?.windAngleDeg) - angle) }))
      .filter(item => item.distance <= 10)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, YAW_WARM_NEIGHBORS);
    const next = nearby.find(item => !this.cache.has(item.key) && !this.warmAttempts.has(item.key) && !this.failures.has(item.key));
    if (next) {
      this.warmAttempts.add(next.key);
      this.request(next.key, { warm: true });
    }
  }

  request(key, { warm = false } = {}) {
    const existing = this.pending.get(key);
    if (existing) {
      if (!warm) existing.warm = false;
      return;
    }
    const record = this.records.get(key);
    if (!record) return;
    const controller = new AbortController();
    const request = { controller, warm };
    this.pending.set(key, request);
    void this.fetchField(key, record, request);
  }

  async fetchField(key, record, request) {
    const canceled = request.controller.signal;
    const expectedBytes = record.grid.shape.reduce((n, v) => n * v, 1) * 6;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const signal = AbortSignal.any([canceled, AbortSignal.timeout(YAW_FETCH_TIMEOUT_MS)]);
        try {
          const bytes = await cachedArrayBuffer(record.file, { signal });
          if (bytes.byteLength !== expectedBytes) {
            await deleteCachedAsset(record.file);
            throw Error('Invalid yaw field size');
          }
          if (this.pending.get(key) !== request) return;
          const raw = new Int16Array(bytes);
          this.cache.set(key, Float32Array.from(raw, value => value * record.scale));
          if (this.cache.size > YAW_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
          this.revision++;
          this.onChange();
          return;
        } catch {
          if (canceled.aborted || this.pending.get(key) !== request || request.warm) return;
          // Retry one foreground fetch while the same pose still needs it.
          if (attempt === 1) this.failures.add(key);
        }
      }
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
}
