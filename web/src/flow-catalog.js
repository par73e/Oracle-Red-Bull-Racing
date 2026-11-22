import { cachedArrayBuffer, deleteCachedAsset } from './asset-cache.js';
import { captureCondition } from './flow-condition.js';

const NEAR = 1e-7;
const REQUEST_TIMEOUT_MS = 12000;
const matches = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < NEAR);
const findExact = (catalog, at) => catalog.nodes.find(node => matches(node.at, at));

export function interpolateForces(sources, speedMps) {
  if (sources.length === 1) return { ...sources[0].node.forces };
  const [{ node: lo, weight: wa0 }, { node: hi, weight: wb0 }] = sources;
  const va = lo.at[0], vb = hi.at[0];
  let wa = wa0, wb = wb0;
  if (va > 0 && vb > 0) {
    const q = speedMps * speedMps;
    wa = wa0 * q / (va * va);
    wb = wb0 * q / (vb * vb);
  }
  return Object.fromEntries(['drag', 'side', 'downforce'].map(key => [
    key,
    wa * lo.forces[key] + wb * hi.forces[key],
  ]));
}

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

const AXIS_SPECS = {
  groundSpeed: { min: 0, max: 350, step: 5 },
  ambientWindMps: { min: 0, max: 15, step: .5 },
  windAngle: { min: -90, max: 90, step: 5 },
  steer: { min: -18, max: 18, step: 1 },
};

function roundStep(value, step) {
  return Math.round(value / step) * step;
}

function uiStateFromCoordinates(at) {
  const [relMps, roadMps, yawDeg, steer, drs] = at;
  if (drs !== 0 && drs !== 1) return null;
  const groundSpeed = roundStep(roadMps * 3.6, 5);
  if (groundSpeed < 0 || groundSpeed > 350 || Math.abs(groundSpeed / 3.6 - roadMps) > 1e-4) return null;
  const steerRounded = Math.round(steer);
  if (steerRounded < -18 || steerRounded > 18 || Math.abs(steerRounded - steer) > 1e-4) return null;
  const yawRad = yawDeg * Math.PI / 180;
  const wx = relMps * Math.cos(yawRad) - roadMps;
  const wy = relMps * Math.sin(yawRad);
  const rawWind = Math.hypot(wx, wy);
  const ambientWindMps = roundStep(rawWind, .5);
  if (ambientWindMps < 0 || ambientWindMps > 15 || Math.abs(ambientWindMps - rawWind) > .02) return null;
  let windAngle = 0;
  if (ambientWindMps > 0) {
    const rawAngle = Math.atan2(wy, wx) * 180 / Math.PI;
    windAngle = roundStep(rawAngle, 5);
    if (windAngle < -90 || windAngle > 90 || Math.abs(windAngle - rawAngle) > .25) return null;
  }
  return { groundSpeed, ambientWindMps, windAngle, steer: steerRounded, drs };
}

function collectUiCandidates(catalog) {
  const seen = new Map();
  const tryAdd = candidate => {
    if (!candidate) return;
    const key = `${candidate.groundSpeed}|${candidate.ambientWindMps}|${candidate.windAngle}|${candidate.steer}|${candidate.drs}`;
    if (seen.has(key)) return;
    const cond = captureCondition({ model: catalog.car, ...candidate, drsCurrent: candidate.drs, flowDensity: 100 });
    if (!cond.speed && !cond.wheelSpeedMps) return;
    const cov = selectCoverage(catalog, cond.coordinates);
    if (cov.mode !== 'unsupported') seen.set(key, { ...candidate, mode: cov.mode });
  };
  for (const node of catalog.nodes) tryAdd(uiStateFromCoordinates(node.at));
  for (const [a, b] of catalog.segments) {
    const lo = catalog.byId.get(a), hi = catalog.byId.get(b);
    const uiA = uiStateFromCoordinates(lo.at), uiB = uiStateFromCoordinates(hi.at);
    if (!uiA || !uiB) continue;
    if (uiA.groundSpeed !== uiB.groundSpeed && uiA.ambientWindMps === uiB.ambientWindMps && uiA.windAngle === uiB.windAngle && uiA.steer === uiB.steer && uiA.drs === uiB.drs) {
      const start = Math.min(uiA.groundSpeed, uiB.groundSpeed), end = Math.max(uiA.groundSpeed, uiB.groundSpeed);
      for (let g = start; g <= end; g += 5) tryAdd({ ...uiA, groundSpeed: g });
    } else if (uiA.ambientWindMps !== uiB.ambientWindMps && uiA.groundSpeed === uiB.groundSpeed && uiA.windAngle === uiB.windAngle && uiA.steer === uiB.steer && uiA.drs === uiB.drs) {
      const start = Math.min(uiA.ambientWindMps, uiB.ambientWindMps), end = Math.max(uiA.ambientWindMps, uiB.ambientWindMps);
      for (let w = start; w <= end + 1e-9; w = Math.round((w + .5) * 2) / 2) tryAdd({ ...uiA, ambientWindMps: w });
    }
  }
  return [...seen.values()];
}

export function axisCoverage(catalog, state, axis) {
  const spec = AXIS_SPECS[axis];
  if (!catalog || !spec) return [];
  const base = {
    model: catalog.car,
    groundSpeed: state.groundSpeed ?? 0,
    ambientWindMps: state.ambientWindMps ?? 0,
    windAngle: state.windAngle ?? 0,
    steer: state.steer ?? 0,
    drs: state.drs ?? 0,
    drsCurrent: state.drs ?? 0,
    flowDensity: state.flowDensity ?? 100,
  };
  const covered = [];
  const count = Math.round((spec.max - spec.min) / spec.step);
  for (let i = 0; i <= count; i++) {
    const value = Math.round((spec.min + i * spec.step) * 1000) / 1000;
    const cond = captureCondition({ ...base, [axis]: value });
    if (!cond.speed && !cond.wheelSpeedMps) continue;
    if (selectCoverage(catalog, cond.coordinates).mode !== 'unsupported') covered.push(value);
  }
  return covered;
}

export function nearestCoveredState(catalog, state) {
  if (!catalog) return null;
  const candidates = catalog._uiCandidates ??= collectUiCandidates(catalog);
  if (!candidates.length) return null;
  const curGround = state.groundSpeed ?? 0;
  const curWind = state.ambientWindMps ?? 0;
  const curAngle = curWind > 0 ? (state.windAngle ?? 0) : 0;
  const curSteer = state.steer ?? 0;
  const curDrs = state.drs ? 1 : 0;
  let best = null, bestScore = Infinity;
  for (const item of candidates) {
    const itemAngle = item.ambientWindMps > 0 ? item.windAngle : 0;
    const dGround = Math.abs(item.groundSpeed - curGround) / 350;
    const dWind = Math.abs(item.ambientWindMps - curWind) / 15;
    const dAngle = Math.abs(itemAngle - curAngle) / 180;
    const dSteer = Math.abs(item.steer - curSteer) / 36;
    const dDrs = item.drs !== curDrs ? 1 : 0;
    const score = dGround * 1.1 + dWind * 1.1 + dAngle * 1.2 + dSteer * 1.4 + dDrs * 1.6 + (item.mode === 'exact' ? 0 : .001);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function formatConditionSummary(target) {
  if (!target) return '';
  const parts = [];
  parts.push(target.groundSpeed === 0 ? '静止' : `${target.groundSpeed} km/h`);
  if (target.ambientWindMps > 0) {
    const dir = target.windAngle === 0 ? '迎风' : `${target.windAngle > 0 ? '右侧风 +' : '左侧风 '}${target.windAngle}°`;
    parts.push(`${dir} ${target.ambientWindMps.toFixed(1)} m/s`);
  } else {
    parts.push('静风');
  }
  if (target.steer !== 0) parts.push(`转向 ${target.steer > 0 ? '+' : ''}${target.steer}°`);
  if (target.drs) parts.push('DRS 全开');
  return parts.join(' · ');
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
  constructor(onCatalogReady = null) {
    this.onCatalogReady = onCatalogReady;
  }

  load(car) {
    this.controller?.abort();
    this.controller = new AbortController();
    this.car = car;
    this.cache = new Map();
    this.pending = new Map();
    this.failures = new Set();
    this.catalog = null;
    const generation = this.controller.signal;
    this.loadingCatalog = true;
    const attempt = async () => {
      const signal = AbortSignal.any([generation, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const response = await fetch(`/flow/${car}/display/manifest.json`, { cache: 'no-cache', signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = readCatalog(await response.json(), car);
      if (!generation.aborted) {
        this.catalog = catalog;
        this.onCatalogReady?.(catalog);
      }
    };
    attempt().catch(() => generation.aborted || attempt()).catch(() => {}).finally(() => {
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
    return { mode, ...interpolateForces(sources, condition.coordinates[0]) };
  }

  axisCoverage(state, axis) {
    if (this.catalog?.car !== state.model) return [];
    return axisCoverage(this.catalog, state, axis);
  }

  nearestCovered(state) {
    if (this.catalog?.car !== state.model) return null;
    return nearestCoveredState(this.catalog, state);
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
