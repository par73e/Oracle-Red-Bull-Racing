import * as T from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { FlowSampler } from './flow-tracing.js';
import { traceLayers } from './flow-integrator.js';

T.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
T.Mesh.prototype.raycast = acceleratedRaycast;
let rig, meshes, sampler;
const fields = new Map();

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
    const start = performance.now();
    for (const field of message.fields) fields.set(field.id, field);
    applySnapshot(message.rig);
    composeField(message);
    const layers = traceLayers(sampler, rig, message.condition, message.stepScale);
    const keep = new Set(message.sources.map(source => source.id));
    for (const delta of message.deltas ?? []) {
      keep.add(delta.posId);
      keep.add(delta.negId);
    }
    for (const id of fields.keys()) {
      if (fields.size <= 20) break;
      if (!keep.has(id)) fields.delete(id);
    }
    self.postMessage({ type: 'result', id: message.id, key: message.key, layers, cachedKeys: [...fields.keys()],
      workerMs: performance.now() - start }, Object.values(layers).flatMap(layer =>
      Object.values(layer.attributes).map(array => array.buffer)));
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error.message });
  }
};
