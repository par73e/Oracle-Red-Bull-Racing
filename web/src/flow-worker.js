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
    for (const id of fields.keys()) {
      if (fields.size <= 12) break;
      if (!keep.has(id)) fields.delete(id);
    }
    self.postMessage({ type: 'result', id: message.id, key: message.key, layers, cachedKeys: [...fields.keys()],
      workerMs: performance.now() - start }, Object.values(layers).flatMap(layer =>
      Object.values(layer.attributes).map(array => array.buffer)));
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error.message });
  }
};
