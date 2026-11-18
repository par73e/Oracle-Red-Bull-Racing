// ±90° crosswind/yaw CFD field loader (5° steps), loaded lazily with live queue polling.
export const YAW_STEP = 5;

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
  }

  async load(car) {
    this.serial++;
    this.revision++;
    this.car = car;
    this.cache.clear();
    this.pending.clear();
    this.manifest = null;
    this.records = new Map();
    await this.refresh();
    if (this.records.has('yaw-000')) {
      this.request('yaw-000');
    }
  }

  async refresh() {
    if (!this.car || this.refreshing) return;
    this.refreshing = true;
    const serial = this.serial;
    this.lastRefresh = performance.now();
    try {
      const [r, q] = await Promise.all([
        fetch(`/flow/${this.car}/yaw/manifest.json`, { cache: 'no-store' }),
        fetch('/flow/yaw-status.json', { cache: 'no-store' }),
      ]);
      if (!r.ok) return;
      const m = await r.json();
      const queue = q.ok ? await q.json() : null;
      if (serial !== this.serial) return;
      const changed =
        m.completedUnique !== this.manifest?.completedUnique ||
        queue?.state !== this.queue?.state;
      this.queue = queue;
      this.manifest = m;
      this.records = new Map(m.fields.map(a => [a.key, a]));
      if (changed) {
        this.revision++;
        this.onChange();
      }
    } catch {
      // Non-fatal while background solver writes manifest
    } finally {
      this.refreshing = false;
    }
  }

  selection(windAngleDeg = 0) {
    if (!this.manifest?.complete && performance.now() - this.lastRefresh > 10000) {
      this.refresh();
    }
    if (!this.manifest || !this.records.size) return null;
    const baseRecord = this.records.get('yaw-000');
    if (!baseRecord) return null;

    const clamped = Math.max(-90, Math.min(90, windAngleDeg));
    const solved = [...this.records.values()]
      .map(r => ({ deg: r.windAngleDeg ?? r.parameters?.windAngleDeg, record: r }))
      .filter(item => Number.isFinite(item.deg))
      .sort((a, b) => a.deg - b.deg);
    if (!solved.length) return null;

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

    const reqKeys = new Set(['yaw-000', ...needed.keys()]);
    const missing = [...reqKeys].filter(k => !this.cache.has(k));
    for (const k of missing) this.request(k);

    // Lightly warm immediate ±5° solved neighbors during drag without saturating fetch.
    if (this.pending.size < 2) {
      const idx = solved.findIndex(item => item.record.key === loItem.record.key);
      for (const adj of [solved[idx - 1], solved[idx + 1]]) {
        if (adj && !this.cache.has(adj.record.key) && this.pending.size < 2) {
          this.request(adj.record.key);
        }
      }
    }

    let provisional = false;
    if (missing.length) {
      if (!this.cache.has('yaw-000')) return { loading: true };
      const cachedSolved = solved.filter(item => this.cache.has(item.record.key));
      if (!cachedSolved.length) return { loading: true };
      let cLo = null;
      let cHi = null;
      let cMirror = false;
      for (const item of cachedSolved) {
        if (item.deg <= clamped + 1e-6) cLo = item;
        if (item.deg >= clamped - 1e-6 && !cHi) cHi = item;
      }
      if (!cLo && clamped < 0) {
        cMirror = true;
        const absDeg = Math.abs(clamped);
        for (const item of cachedSolved) {
          if (item.deg <= absDeg + 1e-6) cLo = item;
          if (item.deg >= absDeg - 1e-6 && !cHi) cHi = item;
        }
      }
      if (!cLo) cLo = cachedSolved[0];
      if (!cHi) cHi = cachedSolved[cachedSolved.length - 1];
      const cTarget = cMirror ? Math.abs(clamped) : clamped;
      const cT =
        cHi.deg === cLo.deg
          ? 0
          : Math.max(0, Math.min(1, (cTarget - cLo.deg) / (cHi.deg - cLo.deg)));
      needed.clear();
      addNeed(cLo.record.key, 1 - cT);
      addNeed(cHi.record.key, cT);
      mirror = cMirror;
      provisional = true;
    }

    const shape = baseRecord.grid.shape;
    const weights = {};
    const data = { 'yaw-000': this.cache.get('yaw-000') };
    for (const [k, w] of needed.entries()) {
      const cacheKey = mirror && k !== 'yaw-000' ? `${k}:mirror` : k;
      weights[cacheKey] = w;
      if (!data[cacheKey]) {
        const raw = this.cache.get(k);
        data[cacheKey] = mirror && k !== 'yaw-000' ? mirrorYawField(raw, shape) : raw;
      }
      // Touch LRU
      const v = this.cache.get(k);
      this.cache.delete(k);
      this.cache.set(k, v);
    }

    while (this.cache.size > 48) {
      const victim = [...this.cache.keys()].find(k => k !== 'yaw-000' && !reqKeys.has(k));
      if (!victim) break;
      this.cache.delete(victim);
    }

    const exact = !provisional && !mirror && exact5 && this.records.has(exactKey);
    const pendingAngle = provisional || (exact5 && !this.records.has(exactKey));
    return {
      weights,
      data,
      spec: baseRecord.grid,
      exact,
      mirror,
      pendingAngle,
    };
  }

  request(key) {
    if (this.pending.has(key)) return;
    const a = this.records.get(key);
    if (!a) return;
    const serial = this.serial;
    const p = (async () => {
      try {
        const r = await fetch(a.file);
        if (!r.ok) throw Error('missing');
        const b = await r.arrayBuffer();
        if (b.byteLength !== a.grid.shape.reduce((n, v) => n * v, 1) * 6) throw Error('size');
        const raw = new Int16Array(b);
        const field = new Float32Array(raw.length);
        const s = a.scale;
        for (let i = 0; i < raw.length; i++) field[i] = raw[i] * s;
        if (serial === this.serial) {
          this.cache.set(key, field);
          this.revision++;
          this.onChange();
        }
      } catch {
        this.lastRefresh = 0;
      } finally {
        if (serial === this.serial) this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
  }
}
