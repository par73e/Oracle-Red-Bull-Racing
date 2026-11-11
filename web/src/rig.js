import { Matrix3, Matrix4, Vector3, MathUtils } from 'three';
import { trackRodAngle } from './mechanics.js';

const Y = new Vector3(0, 1, 0);

// The RB19 carbon fairing is a display skin, separate from the rigid track
// rod underneath. Its split at 0.13 m must stay registered to the fixed nose
// fairing; hidden overlap alone leaves a visible step as the rack translates.
function bindFairing(model, config, find) {
  if (config.id !== 'rb19') return [];
  model.updateMatrixWorld(true);
  return Object.values(config.suspension.wheels).flatMap(spec => {
    if (!spec.fixed_fairing) return [];
    const root = find('AERO_CAR'), link = find(spec.link), patches = [];
    find(spec.tie_mesh).traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
      const tangent = mesh.geometry.attributes.tangent;
      const toRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
      const toLink = new Matrix4().copy(link.matrixWorld).invert().multiply(mesh.matrixWorld);
      const rootNormal = new Matrix3().getNormalMatrix(toRoot), vertices = [];
      for (let i = 0; i < position.count; i++) {
        const rest = new Vector3().fromBufferAttribute(position, i);
        const along = rest.clone().applyMatrix4(toLink).y;
        const t = MathUtils.clamp((along - .13) / .13, 0, 1);
        const anchorWeight = 1 - t * t * (3 - 2 * t);
        if (anchorWeight === 0) continue;
        const restNormal = new Vector3().fromBufferAttribute(normal, i);
        const restTangent = tangent ? new Vector3().fromBufferAttribute(tangent, i) : null;
        vertices.push({ i, rest, restNormal, restTangent, anchorWeight,
          anchor: rest.clone().applyMatrix4(toRoot),
          anchorTangent: restTangent?.clone().transformDirection(toRoot),
          anchorNormal: restNormal.clone().applyNormalMatrix(rootNormal) });
      }
      patches.push({ root, mesh, vertices });
    });
    return patches;
  });
}

function applyFairing(patches) {
  const toLocal = new Matrix4(), normalMatrix = new Matrix3();
  const point = new Vector3(), normal = new Vector3(), tangent = new Vector3();
  for (const { root, mesh, vertices } of patches) {
    toLocal.copy(mesh.matrixWorld).invert().multiply(root.matrixWorld);
    normalMatrix.getNormalMatrix(toLocal);
    for (const v of vertices) {
      point.copy(v.anchor).applyMatrix4(toLocal).lerp(v.rest, 1 - v.anchorWeight);
      normal.copy(v.anchorNormal).applyNormalMatrix(normalMatrix).lerp(v.restNormal, 1 - v.anchorWeight).normalize();
      mesh.geometry.attributes.position.setXYZ(v.i, point.x, point.y, point.z);
      mesh.geometry.attributes.normal.setXYZ(v.i, normal.x, normal.y, normal.z);
      if (v.restTangent) {
        tangent.copy(v.anchorTangent).transformDirection(toLocal).lerp(v.restTangent, 1 - v.anchorWeight);
        tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
        mesh.geometry.attributes.tangent.setXYZ(v.i, tangent.x, tangent.y, tangent.z);
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
    if (mesh.geometry.attributes.tangent) mesh.geometry.attributes.tangent.needsUpdate = true;
    mesh.geometry.boundsTree?.refit();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
}

export function bindRig(model, config) {
  const find = name => {
    const node = model.getObjectByName(name);
    if (!node) throw new Error(`模型缺少控制节点：${name}`);
    return node;
  };
  const wheels = Object.fromEntries(Object.entries(config.wheels).map(([key, value]) => [key, {
    ...value, steerNode: find(value.steer), spinNode: find(value.spin),
  }]));
  const links=config.suspension?Object.fromEntries(Object.entries(config.suspension.wheels).map(([key,spec])=>[key,{
    ...spec, linkNode:find(spec.link),innerNode:find(spec.inner_node),outerNode:find(spec.outer_node),
    restQuaternion:find(spec.link).quaternion.clone(),restDirection:Y.clone().applyQuaternion(find(spec.link).quaternion),
  }])):null;
  return { model, config, wheels, links, fairings:bindFairing(model, config, find),rack:config.suspension?find(config.suspension.rack):null,
    pistonFrame:config.drs.piston_frame?find(config.drs.piston_frame):null,pivot: find(config.drs.pivot),
    attachment: find(config.drs.attachment), base: find('DRS_BASE'),
    cylinder: find(config.drs.cylinder), rod: find(config.drs.rod) };
}

export function steeringAngles(degrees, wheelbase, track) {
  if (Math.abs(degrees) < 0.00001) return { FL: 0, FR: 0 };
  const sign = Math.sign(degrees);
  const radius = wheelbase / Math.tan(Math.abs(MathUtils.degToRad(degrees)));
  const inner = Math.atan(wheelbase / (radius - track / 2)) * sign;
  const outer = Math.atan(wheelbase / (radius + track / 2)) * sign;
  return sign > 0 ? { FL: inner, FR: outer } : { FL: outer, FR: inner };
}

export function applyRig(rig, { drs, steer, spin }) {
  const travel=steer*(rig.config.suspension?.travel_per_degree||0);
  const angles = rig.links?Object.fromEntries(Object.entries(rig.links).map(([key,spec])=>[key,trackRodAngle(spec,travel)])):
    steeringAngles(steer, rig.config.wheelbase, rig.config.front_track);
  if(rig.rack)rig.rack.position.x=travel;
  for (const [key, wheel] of Object.entries(rig.wheels)) {
    wheel.steerNode.rotation.y = angles[key] || 0;
    wheel.spinNode.rotation.x = spin / wheel.radius;
  }
  rig.pivot.rotation.x = -drs * rig.config.drs.max_angle_radians;
  rig.model.updateMatrixWorld(true);
  if(rig.links){
    for(const link of Object.values(rig.links)){
      const a=link.linkNode.parent.worldToLocal(link.innerNode.getWorldPosition(new Vector3()));
      const b=link.linkNode.parent.worldToLocal(link.outerNode.getWorldPosition(new Vector3()));
      link.linkNode.position.copy(a);
      link.linkNode.quaternion.setFromUnitVectors(link.restDirection,b.sub(a).normalize()).multiply(link.restQuaternion);
    }
    rig.model.updateMatrixWorld(true);
  }
  if (rig.fairingSteer !== steer) {
    applyFairing(rig.fairings);
    rig.fairingSteer = steer;
  }
  const a = rig.base.getWorldPosition(new Vector3());
  const b = rig.attachment.getWorldPosition(new Vector3());
  // Solve both ends in the cylinder parent's coordinate system. This survives
  // positioning/scaling the whole model in a larger scene.
  const localA = rig.cylinder.parent.worldToLocal(a.clone());
  const localB = rig.cylinder.parent.worldToLocal(b.clone());
  const direction = localB.clone().sub(localA);
  const distance = direction.length();
  direction.normalize();
  for (const node of [rig.cylinder, rig.pistonFrame||rig.rod]) {
    node.position.copy(localA);
    node.quaternion.setFromUnitVectors(Y, direction);
  }
  if(rig.pistonFrame){
    rig.cylinder.scale.set(1,1,1);
    rig.pistonFrame.position.copy(rig.pistonFrame.parent.worldToLocal(b.clone()));
    rig.rod.position.set(0,-rig.config.drs.rod_length,0);
    rig.rod.scale.set(1,1,1);
  }else{
    rig.cylinder.scale.set(1, rig.config.drs.cylinder_length, 1);
    rig.rod.scale.set(1, distance, 1);
  }
  rig.model.updateMatrixWorld(true);
}

export function inspectRig(rig) {
  const tip = rig.attachment.getWorldPosition(new Vector3());
  const rodTip = rig.rod.localToWorld(new Vector3(0, rig.pistonFrame?rig.config.drs.rod_length:1, 0));
  const distance=rig.cylinder.parent.worldToLocal(tip.clone()).distanceTo(
    rig.cylinder.parent.worldToLocal(rig.base.getWorldPosition(new Vector3())));
  return {
    rodError: tip.distanceTo(rodTip),
    drsAngle: rig.pivot.rotation.x,
    cylinderLength: rig.config.drs.cylinder_length,
    rodLength: rig.pistonFrame?rig.config.drs.rod_length:rig.rod.scale.y,
    pistonExposed:distance-rig.config.drs.cylinder_length,
    pistonInsertion:rig.pistonFrame?rig.config.drs.rod_length-(distance-rig.config.drs.cylinder_length):null,
    suspension:rig.links?Object.fromEntries(Object.entries(rig.links).map(([key,link])=>{
      const a=link.innerNode.getWorldPosition(new Vector3()),b=link.outerNode.getWorldPosition(new Vector3());
      const end=link.linkNode.localToWorld(new Vector3(0,link.length,0));
      const localA=link.linkNode.parent.worldToLocal(a.clone()),localB=link.linkNode.parent.worldToLocal(b.clone());
      return [key,{lengthError:Math.abs(localA.distanceTo(localB)-link.length),endpointError:end.distanceTo(b)}];
    })):null,
    wheels: Object.fromEntries(Object.entries(rig.wheels).map(([key, wheel]) => [key, {
      steer: wheel.steerNode.rotation.y, spin: wheel.spinNode.rotation.x,
      center: wheel.spinNode.getWorldPosition(new Vector3()).toArray(),
    }])),
    attachment: tip.toArray(), rodTip: rodTip.toArray(),
  };
}
