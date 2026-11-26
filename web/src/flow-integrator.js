import * as T from 'three';
import { TraceScratch, wholeCarSeeds } from './flow-tracing.js';
import { floorBoundary, floorSeeds, sideSeeds } from './flow-seeds.js';

export function traceLayers(sampler, rig, condition, stepScale = 1) {
  sampler._rayContext = null;
  const { speed, wheelSpeedMps, effWindAngle, flowDensity } = condition;
  const { seeds, wheels } = wholeCarSeeds(sampler.parent, rig, speed / 3.6, flowDensity, effWindAngle);
  const { nearby, all } = sampler.getRayContext(rig.model);
  const offset = new T.Vector3();
  const outsideWheels = point => !wheels.some(wheel => {
    offset.copy(point).sub(wheel.center);
    const along = offset.dot(wheel.axis);
    return Math.abs(along) < wheel.width / 2 + .012 && offset.lengthSq() - along ** 2 < (wheel.radius + .009) ** 2;
  });
  const speedFloor = Math.max(.001, Math.max(speed / 3.6, wheelSpeedMps) * .005);
  const sample = (point, velocity) => sampler.sample(-point.z, -point.x, point.y - .005, velocity, sampler.grid, true);
  const scratch = new TraceScratch(8192);
  const point = new T.Vector3(), midpoint = new T.Vector3(), next = new T.Vector3();
  const velocity = new T.Vector3(), middleVelocity = new T.Vector3(), direction = new T.Vector3();
  const color = new T.Color();

  function trace(candidates, windowContains = () => true, maxLength = 12.35, fadeLength = .22) {
    scratch.reset();
    const ds = .04 * stepScale;
    let lines = 0, peakMps = 0;
    const stops = { boundary: 0, masked: 0, slow: 0, collision: 0, limit: 0 };
    for (const { position, escape, name } of candidates) {
      if (name) {
        direction.copy(escape ?? offset.set(Math.sign(position.x), 0, 0));
        if (sampler.hasRayHit(position, direction, escape ? .04 : 3, all, .0001)) continue;
      }
      if (!outsideWheels(position)) continue;
      point.copy(position);
      const start = scratch.len;
      let travel = 0, segments = 0, reason = 'limit';
      const clearSegment = end => {
        if (!outsideWheels(end)) return false;
        direction.copy(end).sub(point).normalize();
        return !sampler.hasRayHit(point, direction, point.distanceTo(end), nearby(point), .00002);
      };
      for (let i = 0; i < Math.floor(maxLength / ds); i++) {
        if (!windowContains(point)) { reason = 'boundary'; break; }
        if (!sample(point, velocity)) { reason = 'masked'; break; }
        const speedHere = velocity.length();
        if (speedHere < speedFloor) { reason = 'slow'; break; }
        midpoint.copy(point).addScaledVector(velocity, ds / (2 * speedHere));
        if (!windowContains(midpoint)) { reason = 'boundary'; break; }
        if (!clearSegment(midpoint)) { reason = 'collision'; break; }
        if (!sample(midpoint, middleVelocity)) { reason = 'masked'; break; }
        const speedMid = middleVelocity.length();
        if (speedMid < speedFloor) { reason = 'slow'; break; }
        next.copy(point).addScaledVector(middleVelocity, ds / speedMid);
        if (!windowContains(next)) { reason = 'boundary'; break; }
        if (!clearSegment(next)) { reason = 'collision'; break; }
        if (!sample(next, velocity)) { reason = 'masked'; break; }
        const nextTime = travel + ds / speedMid;
        color.setHSL(.55 - .52 * Math.min(speedMid / 120, 1), .85, .65);
        scratch.pushSeg(...point, ...next, color.r, color.g, color.b, travel, nextTime);
        peakMps = Math.max(peakMps, speedMid);
        travel = nextTime;
        point.copy(next);
        segments++;
        if (i * ds > 2 && point.distanceTo(position) < ds) break;
      }
      stops[reason]++;
      if (segments * ds < .18) { scratch.len = start; continue; }
      const fade = vertex => Math.min(1, vertex * ds / fadeLength, (segments - vertex) * ds / fadeLength);
      for (let i = 0; i < segments; i++) {
        scratch.alp[start + 2 * i] = fade(i);
        scratch.alp[start + 2 * i + 1] = fade(i + 1);
      }
      lines++;
    }
    const n = scratch.len;
    return {
      attributes: { position: scratch.pos.slice(0, n * 3), color: scratch.col.slice(0, n * 3),
        flight: scratch.flt.slice(0, n), lineAlpha: scratch.alp.slice(0, n) },
      lines, peakMps, stops,
    };
  }
  const positions = points => points.map(position => ({ position }));
  return {
    whole: trace(positions(seeds)),
    bottom: trace(positions(floorSeeds(condition, rig, sampler)), point => floorBoundary(point) === null, 7, .14),
    side: trace(sideSeeds(condition, rig, sampler), undefined, 5.25, .16),
  };
}

export function traceSmoke(sampler, rig, condition, { rakeX = 0, stepScale = 1 } = {}) {
  sampler._rayContext = null;
  const { speed, wheelSpeedMps, effWindAngle, flowDensity } = condition;
  const airMps = speed / 3.6;
  const { wheels } = wholeCarSeeds(sampler.parent, rig, airMps, Math.max(20, flowDensity), effWindAngle);
  const { nearby } = sampler.getRayContext(rig.model);
  const offset = new T.Vector3();
  const outsideWheels = point => !wheels.some(wheel => {
    offset.copy(point).sub(wheel.center);
    const along = offset.dot(wheel.axis);
    return Math.abs(along) < wheel.width / 2 + .014 && offset.lengthSq() - along ** 2 < (wheel.radius + .011) ** 2;
  });
  const speedFloor = Math.max(.001, Math.max(airMps, wheelSpeedMps) * .005);
  const sample = (point, velocity) => sampler.sample(-point.z, -point.x, point.y - .005, velocity, sampler.grid, true);

  const beta = T.MathUtils.degToRad(effWindAngle ?? 0);
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const ux = -sb, uz = cb, tx = cb, tz = sb;
  const upDist = 3.55 * Math.abs(cb) + 3.15 * Math.abs(sb);
  const ribbonCount = T.MathUtils.clamp(Math.round(11 * Math.sqrt(Math.max(15, flowDensity) / 100)), 5, 15);
  const yMin = .11, yMax = 1.08;
  const rx = ux * upDist + tx * rakeX;
  const rz = uz * upDist + tz * rakeX;

  const ds = .045 * stepScale;
  const maxSteps = Math.floor(12.2 / ds);
  const point = new T.Vector3(), midpoint = new T.Vector3(), next = new T.Vector3();
  const velocity = new T.Vector3(), middleVelocity = new T.Vector3(), direction = new T.Vector3();
  const tangent = new T.Vector3(), sideA = new T.Vector3(), sideB = new T.Vector3();
  const upRef = new T.Vector3(0, 1, 0), altRef = new T.Vector3(1, 0, 0);

  const posOut = [], sideOut = [], uvOut = [], alpOut = [];
  let lines = 0, peakMps = 0;

  for (let r = 0; r < ribbonCount; r++) {
    const startY = ribbonCount === 1 ? 0.55 : yMin + (yMax - yMin) * (r / (ribbonCount - 1));
    point.set(rx, startY, rz);
    if (!outsideWheels(point)) continue;
    const pts = [point.clone()];
    const times = [0];
    let travel = 0;
    const clearSegment = end => {
      if (!outsideWheels(end)) return false;
      direction.copy(end).sub(point).normalize();
      return !sampler.hasRayHit(point, direction, point.distanceTo(end), nearby(point), .00002);
    };
    for (let i = 0; i < maxSteps; i++) {
      if (!sample(point, velocity)) break;
      const speedHere = velocity.length();
      if (speedHere < speedFloor) break;
      midpoint.copy(point).addScaledVector(velocity, ds / (2 * speedHere));
      if (!clearSegment(midpoint)) break;
      if (!sample(midpoint, middleVelocity)) break;
      const speedMid = middleVelocity.length();
      if (speedMid < speedFloor) break;
      next.copy(point).addScaledVector(middleVelocity, ds / speedMid);
      if (!clearSegment(next)) break;
      if (!sample(next, velocity)) break;
      travel += ds / speedMid;
      peakMps = Math.max(peakMps, speedMid);
      point.copy(next);
      pts.push(point.clone());
      times.push(travel);
      if (i * ds > 2 && point.distanceTo(pts[0]) < ds) break;
    }
    if (pts.length < 6) continue;
    lines++;
    const segCount = pts.length - 1;
    // Build twin orthogonal crossed ribbons per smoke stream so it looks plush from every angle
    for (const roll of [0, Math.PI * 0.5]) {
      const cosR = Math.cos(roll), sinR = Math.sin(roll);
      for (let i = 0; i < segCount; i++) {
        const a = pts[i], b = pts[i + 1];
        const tA = times[i], tB = times[i + 1];
        tangent.copy(b).sub(a).normalize();
        const ref = Math.abs(tangent.y) > 0.9 ? altRef : upRef;
        sideA.crossVectors(tangent, ref).normalize();
        sideB.crossVectors(tangent, sideA).normalize();
        const sx = sideA.x * cosR + sideB.x * sinR;
        const sy = sideA.y * cosR + sideB.y * sinR;
        const sz = sideA.z * cosR + sideB.z * sinR;
        const distA = i * ds, distB = (i + 1) * ds;
        const wA = 0.017 + 0.036 * Math.min(1, distA / 9.5);
        const wB = 0.017 + 0.036 * Math.min(1, distB / 9.5);
        const fadeA = Math.min(1, distA / 0.35, (segCount - i) * ds / 0.85);
        const fadeB = Math.min(1, distB / 0.35, (segCount - i - 1) * ds / 0.85);

        // Two triangles: (a-, a+, b+), (a-, b+, b-)
        const verts = [
          [a, -wA, -1, tA, fadeA],
          [a, wA, 1, tA, fadeA],
          [b, wB, 1, tB, fadeB],
          [a, -wA, -1, tA, fadeA],
          [b, wB, 1, tB, fadeB],
          [b, -wB, -1, tB, fadeB],
        ];
        for (const [p, w, u, tv, al] of verts) {
          posOut.push(p.x, p.y, p.z);
          sideOut.push(sx * w, sy * w, sz * w);
          uvOut.push(u, tv);
          alpOut.push(al);
        }
      }
    }
  }
  return {
    attributes: {
      position: new Float32Array(posOut),
      sideDir: new Float32Array(sideOut),
      uv: new Float32Array(uvOut),
      lineAlpha: new Float32Array(alpOut),
    },
    lines,
    peakMps,
    rakeOrigin: [rx, yMin, yMax, rz],
  };
}
