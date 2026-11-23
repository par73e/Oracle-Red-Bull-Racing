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
  const windAngle = roundStep(yawDeg, 5);
  if (windAngle < -90 || windAngle > 90 || Math.abs(windAngle - yawDeg) > .25) return null;
  const rad = windAngle * Math.PI / 180;
  // Solve |road + w*cos(a), w*sin(a)| = relMps for w >= 0:
  // w^2 + 2*road*cos(a)*w + (road^2 - rel^2) = 0
  const b = roadMps * Math.cos(rad);
  const disc = b * b + (relMps * relMps - roadMps * roadMps);
  if (disc < -1e-6) return null;
  const rawWind = Math.max(0, -b + Math.sqrt(Math.max(0, disc)));
  const ambientWindMps = roundStep(rawWind, .5);
  if (ambientWindMps < 0 || ambientWindMps > 15 || Math.abs(ambientWindMps - rawWind) > .05) return null;
  return { groundSpeed, ambientWindMps, windAngle, steer: steerRounded, drs };
}

function buildSynthIndex(catalog) {
  const rollingMap = new Map(), stationaryMap = new Map(), yawMap = new Map();
  for (const node of catalog.nodes) {
    const [rel, road, yaw, steer, drs] = node.at;
    if (steer !== 0 || drs !== 0) continue;
    if (node.grid === 'headwind' && Math.abs(yaw) < 1e-4 && rel > 1e-4) {
      if (Math.abs(rel - road) < 1e-3) {
        const key = Math.round(rel * 100);
        if (!rollingMap.has(key) || (node.forces && !rollingMap.get(key).forces)) rollingMap.set(key, node);
      } else if (road <= 1e-6) {
        const key = Math.round(rel * 100);
        if (!stationaryMap.has(key) || (node.forces && !stationaryMap.get(key).forces)) stationaryMap.set(key, node);
      }
    } else if (node.grid === 'yaw' && Math.abs(rel - 50) < .1 && Math.abs(road - 50) < .1) {
      const key = Math.round(yaw);
      if (!yawMap.has(key) || (node.forces && !yawMap.get(key).forces)) yawMap.set(key, node);
    }
  }
  const rolling = [...rollingMap.values()].sort((a, b) => a.at[0] - b.at[0]);
  const stationary = [...stationaryMap.values()].sort((a, b) => a.at[0] - b.at[0]);
  const yaw = [...yawMap.values()].sort((a, b) => a.at[2] - b.at[2]);
  return {
    rolling,
    rollingWithForces: rolling.filter(n => n.forces),
    stationary,
    stationaryWithForces: stationary.filter(n => n.forces),
    yaw,
    yawWithForces: yaw.filter(n => n.forces),
    base: catalog.byId.get('base') ?? null,
    open: catalog.byId.get('open') ?? null,
    left: catalog.byId.get('left') ?? null,
    right: catalog.byId.get('right') ?? null,
  };
}

function bracketSpeedSources(nodes, targetMps) {
  if (!nodes.length) return [];
  if (targetMps <= nodes[0].at[0]) {
    return [{ node: nodes[0], weight: targetMps / nodes[0].at[0] }];
  }
  const last = nodes[nodes.length - 1];
  if (targetMps >= last.at[0]) {
    return [{ node: last, weight: targetMps / last.at[0] }];
  }
  for (let i = 1; i < nodes.length; i++) {
    const lo = nodes[i - 1], hi = nodes[i];
    if (targetMps <= hi.at[0]) {
      const t = (targetMps - lo.at[0]) / (hi.at[0] - lo.at[0]);
      if (t <= 1e-6) return [{ node: lo, weight: targetMps / lo.at[0] }];
      if (t >= 1 - 1e-6) return [{ node: hi, weight: targetMps / hi.at[0] }];
      return [
        { node: lo, weight: (1 - t) * targetMps / lo.at[0] },
        { node: hi, weight: t * targetMps / hi.at[0] },
      ];
    }
  }
  return [{ node: last, weight: targetMps / last.at[0] }];
}

function bracketYawNodes(nodes, yawDeg) {
  const y = Math.max(-90, Math.min(90, yawDeg));
  if (!nodes.length) return [];
  if (y <= nodes[0].at[2]) return [{ node: nodes[0], weight: 1 }];
  const last = nodes[nodes.length - 1];
  if (y >= last.at[2]) return [{ node: last, weight: 1 }];
  for (let i = 1; i < nodes.length; i++) {
    const lo = nodes[i - 1], hi = nodes[i];
    if (y <= hi.at[2]) {
      const span = hi.at[2] - lo.at[2];
      const t = span > 1e-6 ? (y - lo.at[2]) / span : 0;
      if (t <= 1e-6) return [{ node: lo, weight: 1 }];
      if (t >= 1 - 1e-6) return [{ node: hi, weight: 1 }];
      return [{ node: lo, weight: 1 - t }, { node: hi, weight: t }];
    }
  }
  return [{ node: last, weight: 1 }];
}

export function synthesizeCoverage(catalog, coordinates) {
  const [relMps, roadMps, yawDeg, steer, drs] = coordinates;
  if (relMps <= 1e-8 && roadMps <= 1e-8) return { mode: 'unsupported' };
  const synth = catalog._synth ??= buildSynthIndex(catalog);
  const speedRef = Math.max(relMps, roadMps);
  let sources, grid;
  if (Math.abs(yawDeg) >= 1e-4 && synth.yaw.length) {
    const scaleV = speedRef / 50;
    sources = bracketYawNodes(synth.yaw, yawDeg).map(({ node, weight }) => ({ node, weight: weight * scaleV }));
    grid = catalog.grids[sources[0].node.grid];
  } else {
    const curve = roadMps <= 1e-6 && synth.stationary.length ? synth.stationary : synth.rolling;
    sources = bracketSpeedSources(curve, speedRef);
    if (!sources.length) return { mode: 'unsupported' };
    grid = catalog.grids[sources[0].node.grid];
  }
  const deltas = [];
  if (synth.base) {
    const scaleV = speedRef / 50;
    if (Math.abs(steer) > 1e-4) {
      const steerNode = steer < 0 ? synth.left : synth.right;
      if (steerNode) {
        deltas.push({ posNode: steerNode, negNode: synth.base, weight: (Math.abs(steer) / 18) * scaleV, grid: catalog.grids[steerNode.grid] });
      }
    }
    if (drs > 1e-4 && synth.open) {
      deltas.push({ posNode: synth.open, negNode: synth.base, weight: drs * scaleV, grid: catalog.grids[synth.open.grid] });
    }
  }
  return { mode: 'synthesized', sources, deltas, grid };
}

export function resolveCoverage(catalog, coordinates) {
  const strict = selectCoverage(catalog, coordinates);
  if (strict.mode !== 'unsupported') return strict;
  return synthesizeCoverage(catalog, coordinates);
}

export function synthesizeForces(catalog, coordinates) {
  const [relMps, roadMps, yawDeg, steer, drs] = coordinates;
  if (relMps <= 1e-8 && roadMps <= 1e-8) return undefined;
  const synth = catalog._synth ??= buildSynthIndex(catalog);
  const speedRef = Math.max(relMps, roadMps);
  let baseForces;
  if (Math.abs(yawDeg) >= 1e-4 && synth.yawWithForces.length) {
    const pair = bracketYawNodes(synth.yawWithForces, yawDeg);
    const qScale = (speedRef / 50) ** 2;
    baseForces = Object.fromEntries(['drag', 'side', 'downforce'].map(key => [
      key,
      pair.reduce((sum, { node, weight }) => sum + weight * node.forces[key], 0) * qScale,
    ]));
  } else {
    const curve = roadMps <= 1e-6 && synth.stationaryWithForces.length ? synth.stationaryWithForces : synth.rollingWithForces;
    if (!curve.length) return undefined;
    if (speedRef <= curve[0].at[0]) {
      const qScale = (speedRef / curve[0].at[0]) ** 2;
      baseForces = Object.fromEntries(['drag', 'side', 'downforce'].map(k => [k, curve[0].forces[k] * qScale]));
    } else if (speedRef >= curve[curve.length - 1].at[0]) {
      const last = curve[curve.length - 1];
      const qScale = (speedRef / last.at[0]) ** 2;
      baseForces = Object.fromEntries(['drag', 'side', 'downforce'].map(k => [k, last.forces[k] * qScale]));
    } else {
      for (let i = 1; i < curve.length; i++) {
        const lo = curve[i - 1], hi = curve[i];
        if (speedRef <= hi.at[0]) {
          const t = (speedRef - lo.at[0]) / (hi.at[0] - lo.at[0]);
          baseForces = interpolateForces([{ node: lo, weight: 1 - t }, { node: hi, weight: t }], speedRef);
          break;
        }
      }
    }
  }
  if (!baseForces) return undefined;
  const q50 = (speedRef / 50) ** 2;
  if (synth.base?.forces) {
    if (Math.abs(steer) > 1e-4) {
      const steerNode = steer < 0 ? synth.left : synth.right;
      if (steerNode?.forces) {
        const w = (Math.abs(steer) / 18) * q50;
        for (const key of ['drag', 'side', 'downforce']) {
          baseForces[key] += w * (steerNode.forces[key] - synth.base.forces[key]);
        }
      }
    }
    if (drs > 1e-4 && synth.open?.forces) {
      const w = drs * q50;
      for (const key of ['drag', 'side', 'downforce']) {
        baseForces[key] += w * (synth.open.forces[key] - synth.base.forces[key]);
      }
    }
  }
  return { mode: 'approximated', ...baseForces };
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
  const curAngle = state.windAngle ?? 0;
  const curSteer = state.steer ?? 0;
  const curDrs = state.drs ? 1 : 0;
  let best = null, bestScore = Infinity;
  for (const item of candidates) {
    const itemAngle = item.windAngle;
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
  } else if (target.windAngle !== 0) {
    parts.push(`${target.windAngle > 0 ? '右侧来流 +' : '左侧来流 '}${target.windAngle}°`);
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
      if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value);
    };
    this.pending.set(node.id, attempt().catch(() => generation.aborted || attempt()).catch(() => {
      if (!generation.aborted) this.failures.add(node.id);
    }).finally(() => {
      if (!generation.aborted) this.pending.delete(node.id);
    }));
  }

  prewarmCore() {
    if (!this.catalog || this._prewarmedCar === this.car) return;
    this._prewarmedCar = this.car;
    const generation = this.controller?.signal;
    const ids = ['low', 'high', 'open', 'left', 'right'].filter(id => this.catalog.byId.has(id));
    (async () => {
      for (let i = 0; i < ids.length; i += 2) {
        if (generation?.aborted) return;
        const batch = ids.slice(i, i + 2);
        batch.forEach(id => this.request(this.catalog.byId.get(id)));
        await Promise.all(batch.map(id => this.pending.get(id)).filter(Boolean));
      }
    })();
  }

  forcesAt(condition) {
    if (this.catalog?.car !== condition.model) return undefined;
    const { mode, sources } = selectCoverage(this.catalog, condition.coordinates);
    if (mode === 'exact' && sources[0].node.forces) return { ...sources[0].node.forces, mode };
    if (mode === 'interpolated' && sources.every(({ node }) => node.forces)
        && this.catalog.forceSegments.has(sources.map(source => source.node.id).join(':'))) {
      return { mode, ...interpolateForces(sources, condition.coordinates[0]) };
    }
    return synthesizeForces(this.catalog, condition.coordinates);
  }

  axisCoverage(state, axis) {
    if (this.catalog?.car !== state.model) return [];
    return axisCoverage(this.catalog, state, axis);
  }

  nearestCovered(state) {
    if (this.catalog?.car !== state.model) return null;
    return nearestCoveredState(this.catalog, state);
  }

  select(condition, { deferFetch = false } = {}) {
    if (!this.catalog) return { mode: this.loadingCatalog ? 'loading' : 'error' };
    if (this.catalog.car !== condition.model) return { mode: 'unsupported' };
    const selection = resolveCoverage(this.catalog, condition.coordinates);
    if (!selection.sources) return selection;
    const requiredMap = new Map();
    for (const source of selection.sources) requiredMap.set(source.node.id, source.node);
    for (const delta of selection.deltas ?? []) {
      requiredMap.set(delta.posNode.id, delta.posNode);
      requiredMap.set(delta.negNode.id, delta.negNode);
    }
    const required = [...requiredMap.values()];
    const missing = required.filter(node => !this.cache.has(node.id));
    if (missing.some(node => this.failures.has(node.id))) return { mode: 'error' };
    if (!deferFetch) missing.forEach(node => this.request(node));
    if (missing.length) return { mode: 'loading' };
    const fields = required.map(node => {
      const field = this.cache.get(node.id);
      this.cache.delete(node.id);
      this.cache.set(node.id, field);
      return field;
    });
    return { ...selection, fields };
  }
}
