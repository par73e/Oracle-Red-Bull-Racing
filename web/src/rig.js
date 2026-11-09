import { Vector3, MathUtils } from 'three';
import { trackRodAngle } from './mechanics.js';

const Y = new Vector3(0, 1, 0);

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
  return { model, config, wheels, links,rack:config.suspension?find(config.suspension.rack):null,
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
