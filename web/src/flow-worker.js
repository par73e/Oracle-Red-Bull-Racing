import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { FlowSampler } from './flow-tracing.js';
import { traceLayers, traceSmoke } from './flow-integrator.js';

T.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
T.Mesh.prototype.raycast = acceleratedRaycast;
let rig, meshes, sampler;
const fields = new Map();
const _v0 = new T.Vector3(), _v1 = new T.Vector3(), _v2 = new T.Vector3();

function colorSpeed(ratio, out, offset) {
  // Turbo-inspired PIV speed colormap: 0 (deep navy) -> 0.5 (cyan) -> 1.0 (emerald/gold) -> 1.45+ (red/magenta)
  const t = Math.max(0, Math.min(1, ratio / 1.55));
  let r, g, b;
  if (t < 0.25) {
    const k = t / 0.25;
    r = 18 + 12 * k; g = 34 + 135 * k; b = 128 + 115 * k;
  } else if (t < 0.55) {
    const k = (t - 0.25) / 0.30;
    r = 30 + 75 * k; g = 169 + 66 * k; b = 243 - 135 * k;
  } else if (t < 0.80) {
    const k = (t - 0.55) / 0.25;
    r = 105 + 145 * k; g = 235 - 50 * k; b = 108 - 76 * k;
  } else {
    const k = (t - 0.80) / 0.20;
    r = 250 - 8 * k; g = 185 - 140 * k; b = 32 + 128 * k;
  }
  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = Math.round(165 + 65 * Math.min(1, t * 1.15));
}

function colorVorticity(val, out, offset) {
  const t = Math.max(0, Math.min(1, val));
  const a = t < 0.08 ? 0 : Math.min(1, (t - 0.08) / 0.32);
  let r, g, b;
  if (t < 0.45) {
    const k = t / 0.45;
    r = 20 + 40 * k; g = 190 + 55 * k; b = 255;
  } else if (t < 0.78) {
    const k = (t - 0.45) / 0.33;
    r = 60 + 195 * k; g = 245 - 85 * k; b = 255 - 210 * k;
  } else {
    const k = (t - 0.78) / 0.22;
    r = 255; g = 160 + 95 * k; b = 45 + 210 * k;
  }
  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = Math.round(a * 230);
}

function computeSlice(req) {
  if (!sampler?.grid || !sampler?.spec) return null;
  const { axis = 'x', position = 0, metric = 'speed', refSpeedMps = 50 } = req;
  const { shape: [nx, ny, nz], min, max } = sampler.spec;
  const dx = (max[0] - min[0]) / (nx - 1);
  const dy = (max[1] - min[1]) / (ny - 1);
  const dz = (max[2] - min[2]) / (nz - 1);
  const ref = Math.max(1, refSpeedMps || 50);

  let width, height, bounds;
  if (axis === 'x') {
    width = nx; height = nz;
    bounds = { uMin: -max[0], uMax: -min[0], vMin: min[2] + 0.005, vMax: max[2] + 0.005 };
  } else if (axis === 'z') {
    width = ny; height = nz;
    bounds = { uMin: -max[1], uMax: -min[1], vMin: min[2] + 0.005, vMax: max[2] + 0.005 };
  } else {
    width = ny; height = nx;
    bounds = { uMin: -max[1], uMax: -min[1], vMin: -max[0], vMax: -min[0] };
  }
  const rgba = new Uint8Array(width * height * 4);
  const clampedPos = axis === 'x'
    ? Math.max(-max[1] + 1e-4, Math.min(-min[1] - 1e-4, position))
    : axis === 'z'
      ? Math.max(-max[0] + 1e-4, Math.min(-min[0] - 1e-4, position))
      : Math.max(min[2] + 0.006, Math.min(max[2] + 0.004, position));

  for (let iv = 0; iv < height; iv++) {
    const fv = iv / Math.max(1, height - 1);
    const vCoord = bounds.vMin + fv * (bounds.vMax - bounds.vMin);
    for (let iu = 0; iu < width; iu++) {
      const fu = iu / Math.max(1, width - 1);
      const uCoord = bounds.uMin + fu * (bounds.uMax - bounds.uMin);
      let dispX, dispY, dispZ;
      if (axis === 'x') { dispX = clampedPos; dispY = vCoord; dispZ = uCoord; }
      else if (axis === 'z') { dispX = uCoord; dispY = vCoord; dispZ = clampedPos; }
      else { dispX = uCoord; dispY = clampedPos; dispZ = vCoord; }

      const sx = -dispZ, sy = -dispX, sz = dispY - 0.005;
      const off = (iv * width + iu) * 4;
      if (!sampler.sampleRaw(sx, sy, sz, _v0, sampler.grid, true)) {
        rgba[off + 3] = 0;
        continue;
      }
      if (metric === 'vorticity') {
        const okX = sampler.sampleRaw(sx + dx, sy, sz, _v1, sampler.grid, true)
          && sampler.sampleRaw(sx - dx, sy, sz, _v2, sampler.grid, true);
        const dvdx = okX ? (_v1.y - _v2.y) / (2 * dx) : 0;
        const dwdx = okX ? (_v1.z - _v2.z) / (2 * dx) : 0;
        const okY = sampler.sampleRaw(sx, sy + dy, sz, _v1, sampler.grid, true)
          && sampler.sampleRaw(sx, sy - dy, sz, _v2, sampler.grid, true);
        const dudy = okY ? (_v1.x - _v2.x) / (2 * dy) : 0;
        const dwdy = okY ? (_v1.z - _v2.z) / (2 * dy) : 0;
        const okZ = sampler.sampleRaw(sx, sy, sz + dz, _v1, sampler.grid, true)
          && sampler.sampleRaw(sx, sy, sz - dz, _v2, sampler.grid, true);
        const dudz = okZ ? (_v1.x - _v2.x) / (2 * dz) : 0;
        const dvdz = okZ ? (_v1.y - _v2.y) / (2 * dz) : 0;
        const ox = dwdy - dvdz, oy = dudz - dwdx, oz = dvdx - dudy;
        const mag = Math.hypot(ox, oy, oz);
        colorVorticity((mag * 0.36) / ref, rgba, off);
      } else {
        colorSpeed(_v0.length() / ref, rgba, off);
      }
    }
  }
  return { axis, position: clampedPos, metric, width, height, bounds, rgba };
}

function sampleNearWallDisplay(dispX, dispY, dispZ, out) {
  if (!sampler?.grid || !sampler?.spec || !sampler?.mask) return false;
  // Convert display (x, y, z) -> solver (-z, -x, y - 0.005)
  const sx = -dispZ, sy = -dispX, sz = dispY - 0.005;
  if (sampler.sample(sx, sy, sz, out, sampler.grid, true)) return true;
  // Partial-valid trilinear boundary cell fallback: if >= 1 of 8 corners is valid fluid,
  // compute weighted average of valid corners so near-wall points never flicker dead.
  const spec = sampler.spec;
  const [nx, ny, nz] = spec.shape;
  const gx = ((sx - spec.min[0]) / (spec.max[0] - spec.min[0])) * (nx - 1);
  const gy = ((sy - spec.min[1]) / (spec.max[1] - spec.min[1])) * (ny - 1);
  const gz = ((sz - spec.min[2]) / (spec.max[2] - spec.min[2])) * (nz - 1);
  if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1 || gy > ny - 1 || gz > nz - 1) return false;
  const ix = Math.min(nx - 2, Math.floor(gx));
  const iy = Math.min(ny - 2, Math.floor(gy));
  const iz = Math.min(nz - 2, Math.floor(gz));
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  const sxy = nx * ny, i000 = iz * sxy + iy * nx + ix;
  const ids = [
    i000, i000 + 1, i000 + nx, i000 + nx + 1,
    i000 + sxy, i000 + sxy + 1, i000 + sxy + nx, i000 + sxy + nx + 1,
  ];
  const omx = 1 - fx, omy = 1 - fy, omz = 1 - fz;
  const ws = [
    omx * omy * omz, fx * omy * omz, omx * fy * omz, fx * fy * omz,
    omx * omy * fz, fx * omy * fz, omx * fy * fz, fx * fy * fz,
  ];
  let wSum = 0, svx = 0, svy = 0, svz = 0;
  for (let k = 0; k < 8; k++) {
    if (!isValidBit(sampler.mask, ids[k])) continue;
    const wk = ws[k] + 1e-4;
    const p = ids[k] * 3;
    svx += sampler.grid[p] * wk;
    svy += sampler.grid[p + 1] * wk;
    svz += sampler.grid[p + 2] * wk;
    wSum += wk;
  }
  if (wSum <= 0) return false;
  // Convert solver velocity (svx, svy, svz) -> display (-svy, svz, -svx)
  out.set(-svy / wSum, svz / wSum, -svx / wSum);
  return true;
}

function sampleProbe(req) {
  const isObj = req && !Array.isArray(req);
  const point = isObj ? req.point : req;
  const normal = isObj ? req.normal : null;
  const viewDir = isObj ? req.viewDir : null;
  const allowMarch = isObj ? Boolean(req.allowMarch) : false;

  if (!sampler?.grid || !sampler?.spec || !Array.isArray(point) || point.length !== 3) {
    return { valid: false, point };
  }
  let sx = point[0], sy = point[1], sz = point[2];
  let hit = allowMarch
    ? sampleNearWallDisplay(sx, sy, sz, _v0)
    : sampler.sample(-sz, -sx, sy - 0.005, _v0, sampler.grid, true);

  if (!hit && allowMarch) {
    const dirs = [];
    if (Array.isArray(normal) && normal.length === 3) dirs.push(normal);
    if (Array.isArray(viewDir) && viewDir.length === 3) dirs.push(viewDir);
    dirs.push([0, 1, 0]);
    const steps = [0.055, 0.11, 0.17, 0.24];
    outer: for (const step of steps) {
      for (const dir of dirs) {
        const tx = point[0] + dir[0] * step;
        const ty = Math.max(0.03, point[1] + dir[1] * step);
        const tz = point[2] + dir[2] * step;
        if (sampleNearWallDisplay(tx, ty, tz, _v0)) {
          sx = tx; sy = ty; sz = tz;
          hit = true;
          break outer;
        }
      }
    }
  }

  if (!hit) return { valid: false, point };
  const speedMps = _v0.length();
  const yawDeg = T.MathUtils.radToDeg(Math.atan2(_v0.x, -_v0.z));
  return {
    valid: true,
    point: [sx, sy, sz],
    velocity: [_v0.x, _v0.y, _v0.z],
    speedMps,
    speedKmh: speedMps * 3.6,
    yawDeg,
  };
}

function initialize(message) {
  const scene = new T.Scene(), model = new T.Group();
  scene.add(model);
  sampler = new FlowSampler(scene);
  rig = { model, config: { id: message.car }, wheels: {}, links: {} };
  const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
  meshes = message.meshes.map(item => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(item.position, 3));
    if (item.index) geometry.setIndex(new T.BufferAttribute(item.index, 1));
    geometry.computeBoundsTree();
    const mesh = new T.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    model.add(mesh);
    return mesh;
  });
  self.postMessage({ type: 'ready' });
}

function applySnapshot(snapshot) {
  meshes.forEach((mesh, index) => {
    mesh.matrix.fromArray(snapshot.matrices, index * 16);
    mesh.visible = snapshot.visible[index];
  });
  for (const item of snapshot.changed) {
    const geometry = meshes[item.index].geometry;
    geometry.attributes.position.array.set(item.position);
    geometry.computeBoundingBox();
    geometry.boundsTree.refit();
  }
  for (const [key, wheel] of Object.entries(snapshot.wheels)) {
    const slot = rig.wheels[key] ??= { spinNode: new T.Object3D() };
    slot.spinNode.position.fromArray(wheel.position);
    slot.spinNode.quaternion.fromArray(wheel.quaternion);
    slot.radius = wheel.radius;
  }
  for (const [key, link] of Object.entries(snapshot.links)) {
    const slot = rig.links[key] ??= { innerNode: new T.Object3D(), outerNode: new T.Object3D() };
    slot.innerNode.position.fromArray(link.inner);
    slot.outerNode.position.fromArray(link.outer);
  }
  rig.model.updateMatrixWorld(true);
}

function isValidBit(mask, index) {
  return Boolean((mask[index >> 3] >> (index & 7)) & 1);
}

function sameGrid(a, b) {
  return a && b
    && a.shape.every((n, i) => n === b.shape[i])
    && a.min.every((v, i) => Math.abs(v - b.min[i]) < 1e-6)
    && a.max.every((v, i) => Math.abs(v - b.max[i]) < 1e-6);
}

function sampleDeltaAt(pos, neg, spec, x, y, z, out) {
  const [nx, ny, nz] = spec.shape;
  const gx = (x - spec.min[0]) / (spec.max[0] - spec.min[0]) * (nx - 1);
  const gy = (y - spec.min[1]) / (spec.max[1] - spec.min[1]) * (ny - 1);
  const gz = (z - spec.min[2]) / (spec.max[2] - spec.min[2]) * (nz - 1);
  if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1 || gy > ny - 1 || gz > nz - 1) return false;
  const ix = Math.min(nx - 2, Math.floor(gx)), iy = Math.min(ny - 2, Math.floor(gy)), iz = Math.min(nz - 2, Math.floor(gz));
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  const sxy = nx * ny, i000 = iz * sxy + iy * nx + ix;
  const ids = [i000, i000 + 1, i000 + nx, i000 + nx + 1, i000 + sxy, i000 + sxy + 1, i000 + sxy + nx, i000 + sxy + nx + 1];
  for (let k = 0; k < 8; k++) {
    if (!isValidBit(pos.mask, ids[k]) || !isValidBit(neg.mask, ids[k])) return false;
  }
  const omx = 1 - fx, omy = 1 - fy, omz = 1 - fz;
  const w = [omx * omy * omz, fx * omy * omz, omx * fy * omz, fx * fy * omz, omx * omy * fz, fx * omy * fz, omx * fy * fz, fx * fy * fz];
  let vx = 0, vy = 0, vz = 0;
  for (let k = 0; k < 8; k++) {
    const p = ids[k] * 3, wk = w[k];
    vx += (pos.velocity[p] - neg.velocity[p]) * wk;
    vy += (pos.velocity[p + 1] - neg.velocity[p + 1]) * wk;
    vz += (pos.velocity[p + 2] - neg.velocity[p + 2]) * wk;
  }
  out[0] = vx; out[1] = vy; out[2] = vz;
  return true;
}

function composeField(message) {
  const count = message.grid.shape.reduce((a, b) => a * b, 1);
  const velocity = new Float32Array(count * 3);
  const mask = new Uint8Array(Math.ceil(count / 8)).fill(255);
  for (const { id, weight } of message.sources) {
    const field = fields.get(id);
    if (!field || field.velocity.length !== velocity.length || field.mask.length !== mask.length) {
      throw new Error(`Missing or incompatible field ${id}`);
    }
    for (let i = 0; i < mask.length; i++) mask[i] &= field.mask[i];
    for (let i = 0; i < velocity.length; i++) velocity[i] += field.velocity[i] * weight;
  }
  const deltas = message.deltas ?? [];
  if (deltas.length) {
    const [nx, ny, nz] = message.grid.shape;
    const dx = (message.grid.max[0] - message.grid.min[0]) / (nx - 1);
    const dy = (message.grid.max[1] - message.grid.min[1]) / (ny - 1);
    const dz = (message.grid.max[2] - message.grid.min[2]) / (nz - 1);
    const tmp = [0, 0, 0];
    for (const delta of deltas) {
      const pos = fields.get(delta.posId), neg = fields.get(delta.negId);
      if (!pos || !neg) throw new Error(`Missing delta field ${delta.posId}/${delta.negId}`);
      const weight = delta.weight;
      if (Math.abs(weight) < 1e-8) continue;
      if (sameGrid(delta.grid, message.grid)) {
        for (let i = 0; i < count; i++) {
          if (!isValidBit(mask, i) || !isValidBit(pos.mask, i) || !isValidBit(neg.mask, i)) continue;
          const p = i * 3;
          velocity[p] += (pos.velocity[p] - neg.velocity[p]) * weight;
          velocity[p + 1] += (pos.velocity[p + 1] - neg.velocity[p + 1]) * weight;
          velocity[p + 2] += (pos.velocity[p + 2] - neg.velocity[p + 2]) * weight;
        }
      } else {
        let idx = 0;
        for (let iz = 0; iz < nz; iz++) {
          const pz = message.grid.min[2] + iz * dz;
          const zIn = pz >= delta.grid.min[2] && pz <= delta.grid.max[2];
          for (let iy = 0; iy < ny; iy++) {
            const py = message.grid.min[1] + iy * dy;
            const yzIn = zIn && py >= delta.grid.min[1] && py <= delta.grid.max[1];
            for (let ix = 0; ix < nx; ix++, idx++) {
              if (!yzIn || !isValidBit(mask, idx)) continue;
              const px = message.grid.min[0] + ix * dx;
              if (px < delta.grid.min[0] || px > delta.grid.max[0]) continue;
              if (!sampleDeltaAt(pos, neg, delta.grid, px, py, pz, tmp)) continue;
              const p = idx * 3;
              velocity[p] += tmp[0] * weight;
              velocity[p + 1] += tmp[1] * weight;
              velocity[p + 2] += tmp[2] * weight;
            }
          }
        }
      }
    }
  }
  Object.assign(sampler, { grid: velocity, mask, spec: message.grid });
}

self.onmessage = ({ data: message }) => {
  try {
    if (message.type === 'init') { initialize(message); return; }
    if (message.type === 'slice') {
      const slice = computeSlice(message.slice);
      self.postMessage(
        { type: 'sliceResult', id: message.id, slice },
        slice?.rgba ? [slice.rgba.buffer] : [],
      );
      return;
    }
    if (message.type === 'probe') {
      const probe = sampleProbe(message.point);
      self.postMessage({ type: 'probeResult', id: message.id, probe });
      return;
    }
    const start = performance.now();
    for (const field of message.fields) fields.set(field.id, field);
    applySnapshot(message.rig);
    composeField(message);
    const layers = traceLayers(sampler, rig, message.condition, message.stepScale);
    const smoke = message.smoke
      ? traceSmoke(sampler, rig, message.condition, { rakeX: message.smokeRakeX ?? 0, stepScale: message.stepScale })
      : null;
    const slice = message.slice ? computeSlice(message.slice) : null;
    const keep = new Set(message.sources.map(source => source.id));
    for (const delta of message.deltas ?? []) {
      keep.add(delta.posId);
      keep.add(delta.negId);
    }
    for (const id of fields.keys()) {
      if (fields.size <= 20) break;
      if (!keep.has(id)) fields.delete(id);
    }
    const transfers = Object.values(layers).flatMap(layer =>
      Object.values(layer.attributes).map(array => array.buffer));
    if (smoke) {
      for (const array of Object.values(smoke.attributes)) transfers.push(array.buffer);
    }
    if (slice?.rgba) transfers.push(slice.rgba.buffer);
    self.postMessage({ type: 'result', id: message.id, key: message.key, layers, smoke, slice, cachedKeys: [...fields.keys()],
      workerMs: performance.now() - start }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error.message });
  }
};
