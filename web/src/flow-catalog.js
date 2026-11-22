import { cachedArrayBuffer, deleteCachedAsset } from './asset-cache.js';

const NEAR = 1e-7;
const REQUEST_TIMEOUT_MS = 5500;
const matches = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < NEAR);
const findExact = (catalog, at) => catalog.nodes.find(node => matches(node.at, at));

export function selectCoverage(catalog, coordinates) {
  const exact = findExact(catalog, coordinates);
  if (exact) return { mode: 'exact', sources: [{ node: exact, weight: 1 }], grid: catalog.grids[exact.grid] };
  for (const [a, b] of catalog.segments) {
    const lo = catalog.byId.get(a), hi = catalog.byId.get(b);
    const axis = lo.at.findIndex((value, i) => Math.abs(hi.at[i] - value) >= NEAR);
    const t = (coordinates[axis] - lo.at[axis]) / (hi.at[axis] - lo.at[axis]);
    if (t <= 0 || t >= 1 || !matches(coordinates, lo.at.map((value, i) => value + t * (hi.at[i] - value)))) continue;
    return { mode: 'interpolated', sources: [{ node: lo, weight: 1 - t }, { node: hi, weight: t }], grid: catalog.grids[lo.grid] };
  }
  return { mode: 'unsupported' };
}

export function readCatalog(data, car) {
  if (data.version !== 1 || data.car !== car || !data.nodes?.length || !Array.isArray(data.segments)) throw new Error('Invalid field catalog');
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  if (byId.size !== data.nodes.length) throw new Error('Duplicate flow node');
  const hash = /^[a-f0-9]{64}$/;
  const path = new RegExp(`^/flow/${car}/(?:[a-z0-9-]+/)?[a-z0-9-]+\\.(?:bin|mask)$`);
  for (const node of data.nodes) {
    const grid = data.grids[node.grid];
    if (!grid || !['shape', 'min', 'max'].every(key => grid[key]?.length === 3 && grid[key].every(Number.isFinite))
        || !grid.shape.every(n => Number.isInteger(n) && n > 1)
        || !grid.max.every((value, i) => value > grid.min[i])
        || node.at?.length !== 5 || !node.at.every(Number.isFinite)
        || !Number.isFinite(node.scale) || node.scale <= 0
        || !path.test(node.file) || !path.test(node.mask) || !hash.test(node.sha256) || !hash.test(node.maskSha256)) {
      throw new Error('Invalid flow node');
    }
  }
  const forceSegments = new Set((data.forceSegments ?? []).map(bounds => bounds.join(':')));
  const visualSegments = new Set(data.segments.map(bounds => bounds.join(':')));
  if ([...forceSegments].some(key => !visualSegments.has(key))) throw new Error('Invalid force interpolation segment');
  for (const [a, b] of data.segments) {
    if (!byId.has(a) || !byId.has(b) || byId.get(a).grid !== byId.get(b).grid || matches(byId.get(a).at, byId.get(b).at)) {
      throw new Error('Invalid interpolation segment');
    }
  }
  return { ...data, byId, forceSegments };
}

async function readAsset(file, sha256, size, signal) {
  const url = `${file}?v=${sha256}`;
  const bytes = await cachedArrayBuffer(url, { signal });
  const digest = globalThis.crypto?.subtle && await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = digest && Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== size || (actual && actual !== sha256)) {
    await deleteCachedAsset(url);
    throw new Error(`Invalid flow asset ${file}`);
  }
  return bytes;
}

export class FlowCatalog {
  load(car) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.car = car;
    this.cache = new Map();
    this.pending = new Map();
    this.failures = new Set();
    this.catalog = null;
    const generation = this.controller.signal;
    const signal = AbortSignal.any([generation, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    this.loadingCatalog = true;
    fetch(`/flow/${car}/display/manifest.json`, { cache: 'no-cache', signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = readCatalog(await response.json(), car);
      if (!signal.aborted) this.catalog = catalog;
    }).catch(() => {}).finally(() => {
      if (this.controller.signal === generation) this.loadingCatalog = false;
    });
  }

  retry() {
    if (!this.catalog) this.load(this.car);
    else this.failures.clear();
  }

  request(node) {
    if (this.pending.has(node.id) || this.failures.has(node.id) || this.cache.has(node.id)) return;
    const generation = this.controller.signal;
    const cells = this.catalog.grids[node.grid].shape.reduce((a, b) => a * b, 1);
    const attempt = async () => {
      const signal = AbortSignal.any([generation, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const [data, validity] = await Promise.all([
        readAsset(node.file, node.sha256, cells * 6, signal),
        readAsset(node.mask, node.maskSha256, Math.ceil(cells / 8), signal),
      ]);
      const view = new DataView(data);
      const velocity = new Float32Array(cells * 3);
      for (let i = 0; i < velocity.length; i++) velocity[i] = view.getInt16(i * 2, true) * node.scale;
      if (generation.aborted) return;
      this.cache.set(node.id, { id: node.id, velocity, mask: new Uint8Array(validity) });
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    };
    this.pending.set(node.id, attempt().catch(() => generation.aborted || attempt()).catch(() => {
      if (!generation.aborted) this.failures.add(node.id);
    }).finally(() => {
      if (!generation.aborted) this.pending.delete(node.id);
    }));
  }

  forcesAt(condition) {
    if (this.catalog?.car !== condition.model) return undefined;
    const { mode, sources } = selectCoverage(this.catalog, condition.coordinates);
    if (!sources?.every(({ node }) => node.forces)) return undefined;
    if (mode === 'exact') return { ...sources[0].node.forces, mode };
    if (!this.catalog.forceSegments.has(sources.map(source => source.node.id).join(':'))) return undefined;
    return Object.fromEntries([['mode', mode], ...['drag', 'side', 'downforce'].map(key => [key,
      sources.reduce((sum, { node, weight }) => sum + weight * node.forces[key], 0)])]);
  }

  select(condition) {
    if (!this.catalog) return { mode: this.loadingCatalog ? 'loading' : 'error' };
    if (this.catalog.car !== condition.model) return { mode: 'unsupported' };
    const selection = selectCoverage(this.catalog, condition.coordinates);
    if (!selection.sources) return selection;
    const missing = selection.sources.map(source => source.node).filter(node => !this.cache.has(node.id));
    if (missing.some(node => this.failures.has(node.id))) return { mode: 'error' };
    missing.forEach(node => this.request(node));
    if (missing.length) return { mode: 'loading' };
    const fields = selection.sources.map(({ node }) => {
      const field = this.cache.get(node.id);
      this.cache.delete(node.id);
      this.cache.set(node.id, field);
      return field;
    });
    return { ...selection, fields };
  }
}
