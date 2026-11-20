import { cachedArrayBuffer, deleteCachedAsset } from './asset-cache.js';

const isStraightHeadwind = state => (state.effWindAngle ?? state.windAngle ?? 0) === 0
  && state.steer === 0 && state.drsCurrent === 0 && (state.drs ?? 0) === 0;

export const isStationaryHeadwind = state => state.wheelSpeedMps === 0 && isStraightHeadwind(state);
export const ROAD010_MPS = 10 / 3.6;
export const isRoad010Headwind = state => state.model === 'rb19' && Math.abs(state.wheelSpeedMps - ROAD010_MPS) < 1e-8
  && state.speed >= 10 - 1e-8 && state.speed <= 64 + 1e-8 && isStraightHeadwind(state);

// Zero wind and stationary walls have no driven flow. For an unsolved speed
// between two cases, use only those two same-boundary-condition vector fields.
export function stationaryWeights(records, speed) {
  if (speed <= 0) return {};
  const exact = records.find(record => Math.abs(record.speedMps - speed) <= 1e-8);
  if (exact) return { [exact.anchor]: 1 };
  const i = records.findIndex(record => record.speedMps > speed);
  if (i < 0) return null;
  const upper = records[i];
  const lower = records[i - 1];
  if (!lower) return { [upper.anchor]: speed / upper.speedMps };
  const fraction = (speed - lower.speedMps) / (upper.speedMps - lower.speedMps);
  return { [lower.anchor]: 1 - fraction, [upper.anchor]: fraction };
}

export class FixedRoadHeadwindFields {
  constructor(family, roadMps) {
    this.family = family;
    this.roadMps = roadMps;
    this.setCar(null);
  }

  setCar(car) {
    this.car = car;
    this.records = null;
    this.cache = new Map();
    this.pending = new Map();
    this.errors = new Set();
  }

  retry() { this.errors.clear(); }

  request(key, load) {
    if (this.pending.has(key) || this.errors.has(key)) return;
    const pending = this.pending;
    const run = async () => {
      try { return await load(); }
      catch (error) {
        if (pending !== this.pending) throw error;
        return load();
      }
    };
    pending.set(key, run().catch(() => {
      if (pending === this.pending) this.errors.add(key);
    }).finally(() => pending.delete(key)));
  }

  selection(speed, grid) {
    const prefix = `/flow/${this.car}/${this.family}/`;
    if (!this.records) {
      this.request('manifest', async () => {
        const pending = this.pending;
        const response = await fetch(`${prefix}manifest.json`, { cache: 'no-cache' });
        const manifest = response.ok && await response.json();
        if (pending !== this.pending) return;
        if (manifest?.car !== this.car || manifest.family !== this.family || !manifest.fields?.length) throw Error('fixed-road manifest');
        const matchesGrid = record => ['min', 'max', 'shape'].every(key =>
          record.grid?.[key]?.length === grid[key].length && grid[key].every((v, i) => v === record.grid[key][i]));
        const records = [...manifest.fields].sort((a, b) => a.speedMps - b.speedMps);
        if (!records.every((record, i) => record.car === this.car && record.family === this.family
          && record.groundSpeedMps === this.roadMps && record.wheelSpeedMps === this.roadMps && record.yawDeg === 0
          && record.steer === 0 && record.drs === 0 && Number.isFinite(record.speedMps)
          && record.speedMps > (records[i - 1]?.speedMps ?? 0) && Number.isFinite(record.scale) && record.scale > 0
          && /^[0-9a-f]{64}$/.test(record.sha256) && (this.family === 'stationary' ? /^wind-\d{5}$/ : /^road010-wind-\d{5}$/).test(record.anchor) && record.file === `${prefix}${record.anchor}.bin` && matchesGrid(record))) throw Error('fixed-road fields');
        this.records = records;
      });
      return this.errors.has('manifest') ? { error: true } : { loading: true };
    }
    if (this.roadMps > 0 && speed < this.records[0].speedMps - 1e-8) return { unsupported: true };
    const weights = stationaryWeights(this.records, speed);
    if (!weights) return { unsupported: true };
    const records = this.records.filter(record => Object.hasOwn(weights, record.anchor));
    const data = {};
    for (const record of records) {
      const key = record.anchor;
      const field = this.cache.get(key);
      if (field) { data[key] = field; continue; }
      this.request(key, async () => {
        const cache = this.cache;
        const url = `${record.file}?v=${record.sha256}`;
        const bytes = await cachedArrayBuffer(url);
        const digest = globalThis.crypto?.subtle && await globalThis.crypto.subtle.digest('SHA-256', bytes);
        const hash = digest && Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== grid.shape.reduce((n, v) => n * v, 1) * 6 || (hash && hash !== record.sha256)) {
          await deleteCachedAsset(url);
          throw Error('fixed-road field integrity');
        }
        if (cache === this.cache) cache.set(key, Float32Array.from(new Int16Array(bytes), value => value * record.scale));
      });
    }
    if (records.some(record => this.errors.has(record.anchor))) return { error: true };
    if (Object.keys(data).length !== records.length) return { loading: true };
    return { weights, data };
  }
}
