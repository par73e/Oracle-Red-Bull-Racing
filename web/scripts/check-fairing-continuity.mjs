import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Object3D, Mesh, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { bindRig, applyRig, inspectRig } from '../src/rig.js';

const root = new URL('../../', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('assets/exports/rb19/rb19.json', root)));
const bytes = await fs.readFile(new URL('web/public/models/rb19.glb', root));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const binary = bytes.subarray(28 + bytes.readUInt32LE(12));
function attribute(primitive, semantic, size) {
  const a = gltf.accessors[primitive.attributes[semantic]], view = gltf.bufferViews[a.bufferView];
  assert.equal(a.componentType, 5126);
  const data = [];
  for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++)
    data.push(binary.readFloatLE((view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || size * 4) + j * 4));
  return data;
}
const ties = Object.values(config.suspension.wheels).map(spec => spec.tie_mesh);
const nodes = gltf.nodes.map(n => {
  let obj = new Object3D();
  if (ties.includes(n.name)) {
    const geometry = new BufferGeometry();
    for (const [name, semantic, size] of [['position', 'POSITION', 3], ['normal', 'NORMAL', 3], ['tangent', 'TANGENT', 4]]) {
      const values = gltf.meshes[n.mesh].primitives.flatMap(p => attribute(p, semantic, size));
      geometry.setAttribute(name, new Float32BufferAttribute(values, size));
    }
    obj = new Mesh(geometry);
  }
  obj.name = n.name;
  if (n.matrix) new Matrix4().fromArray(n.matrix).decompose(obj.position, obj.quaternion, obj.scale);
  else { obj.position.fromArray(n.translation || [0, 0, 0]); obj.quaternion.fromArray(n.rotation || [0, 0, 0, 1]); obj.scale.fromArray(n.scale || [1, 1, 1]); }
  return obj;
});
gltf.nodes.forEach((n, i) => (n.children || []).forEach(c => nodes[i].add(nodes[c])));
const model = new Object3D();
gltf.scenes[gltf.scene || 0].nodes.forEach(i => model.add(nodes[i]));
const rig = bindRig(model, config);
assert.equal(rig.fairings.length, 2);
let maxSeamError = 0, maxAnchorError = 0, maxRigidError = 0, maxJointError = 0;
const seams = rig.fairings.map(patch => {
  const spec = Object.values(config.suspension.wheels).find(s => s.tie_mesh === patch.mesh.name);
  const fixed = model.getObjectByName(spec.fixed_fairing);
  const node = gltf.nodes.find(n => n.name === spec.fixed_fairing);
  const points = gltf.meshes[node.mesh].primitives.flatMap(p => {
    const values = attribute(p, 'POSITION', 3), result = [];
    for (let i = 0; i < values.length; i += 3) result.push(new Vector3(...values.slice(i, i + 3)).applyMatrix4(fixed.matrixWorld));
    return result;
  });
  const link = model.getObjectByName(spec.link);
  const seam = patch.vertices.filter(v => Math.abs(v.rest.clone().applyMatrix4(patch.mesh.matrixWorld).applyMatrix4(link.matrixWorld.clone().invert()).y - .13) < 1e-5);
  assert(seam.length > 10, 'Must sample the actual exported cut, not a virtual joint');
  for (const v of seam) assert(Math.min(...points.map(p => p.distanceTo(v.rest.clone().applyMatrix4(patch.mesh.matrixWorld)))) < 2e-6, 'Cut must coincide with fixed fairing at rest');
  const original = patch.mesh.geometry.attributes.position.array.slice();
  return { patch, seam, original };
});
for (const transformed of [false, true]) {
  model.position.set(transformed ? 2 : 0, .3, -1);
  model.rotation.set(.1, transformed ? .4 : 0, -.2);
  model.scale.setScalar(transformed ? 1.7 : 1);
  // Traverse both directions, repeat poses, and return to neutral to catch drift.
  for (const steer of [...Array.from({ length: 73 }, (_, i) => -18 + i * .5), 18, 0, -18, 0]) {
    applyRig(rig, { steer, drs: .5, spin: .8 });
    for (const { patch, seam, original } of seams) {
      const attr = patch.mesh.geometry.attributes.position;
      for (const v of patch.vertices.filter(v => v.anchorWeight === 1)) {
        const actual = new Vector3().fromBufferAttribute(attr, v.i).applyMatrix4(patch.mesh.matrixWorld);
        maxAnchorError = Math.max(maxAnchorError, actual.distanceTo(patch.root.localToWorld(v.anchor.clone())));
      }
      for (const v of seam) {
        const actual = new Vector3().fromBufferAttribute(attr, v.i).applyMatrix4(patch.mesh.matrixWorld);
        maxSeamError = Math.max(maxSeamError, actual.distanceTo(patch.root.localToWorld(v.anchor.clone())));
      }
      const affected = new Set(patch.vertices.map(v => v.i));
      for (let i = 0; i < attr.count; i++) if (!affected.has(i)) for (let j = 0; j < 3; j++)
        maxRigidError = Math.max(maxRigidError, Math.abs(attr.array[i * 3 + j] - original[i * 3 + j]));
      for (const name of ['position', 'normal', 'tangent']) assert([...patch.mesh.geometry.attributes[name].array].every(Number.isFinite));
    }
    for (const v of Object.values(inspectRig(rig).suspension)) maxJointError = Math.max(maxJointError, v.lengthError, v.endpointError);
  }
}
assert(maxSeamError < 2e-6, 'Visible seam opened');
assert(maxAnchorError < 2e-6, 'Fairing root moved away from chassis');
assert.equal(maxRigidError, 0, 'Outer rigid rod skin was changed');
assert(maxJointError < 2e-6, 'Rigid linkage constraint regressed');
console.log({ seamVertices: seams.map(s => s.seam.length), maxSeamError, maxAnchorError, maxRigidError, maxJointError, posesPerSide: 154 });
