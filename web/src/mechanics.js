import { Vector3 } from 'three';

const X = new Vector3(1, 0, 0);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// A fixed-length track rod joins a translating rack to a steering arm rotating
// around the upright's kingpin. Pick the continuous root near neutral steering.
export function trackRodAngle(spec, travel) {
  const lower = new Vector3(...spec.lower), axis = new Vector3(...spec.upper).sub(lower).normalize();
  const arm = new Vector3(...spec.outer).sub(lower);
  const center = lower.clone().addScaledVector(axis, axis.dot(arm));
  const c = arm.clone().add(lower).sub(center), s = axis.clone().cross(c);
  const w = center.sub(new Vector3(...spec.inner).addScaledVector(X, travel));
  const a = w.dot(c), b = w.dot(s);
  const k = (spec.length ** 2 - w.lengthSq() - c.lengthSq()) / 2;
  const ratio = k / Math.hypot(a, b);
  if (Math.abs(ratio) > 1 + 1e-8) throw new Error('转向拉杆超出几何行程');
  const phi = Math.atan2(b, a), spread = Math.acos(Math.max(-1, Math.min(1, ratio)));
  const options = [wrap(phi + spread), wrap(phi - spread)];
  return options.reduce((best, v) => Math.abs(v) < Math.abs(best) ? v : best);
}
