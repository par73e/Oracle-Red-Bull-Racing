import * as T from 'three';

const SEGMENTS = [
  {
    duration: 7.0,
    startPos: [5.3, 2.3, 6.4], endPos: [4.2, 1.45, 5.1],
    startTarget: [0, 0.56, 0], endTarget: [0, 0.48, 0.2],
    state: t => ({ groundSpeed: Math.round((180 + 100 * t) / 5) * 5, windAngle: 0, steer: 0, drs: 0 }),
  },
  {
    duration: 6.5,
    startPos: [4.2, 1.45, 5.1], endPos: [2.8, 0.98, 3.3],
    startTarget: [0, 0.48, 0.2], endTarget: [0.06, 0.38, 1.15],
    state: t => ({ groundSpeed: 240, windAngle: 0, steer: Math.round(Math.sin(t * Math.PI) * 14), drs: 0 }),
  },
  {
    duration: 6.5,
    startPos: [2.9, 1.55, -3.8], endPos: [1.85, 1.48, -4.35],
    startTarget: [0, 0.82, -1.9], endTarget: [0, 0.94, -2.4],
    state: t => ({ groundSpeed: 310, windAngle: 0, steer: 0, drs: t > 0.22 && t < 0.82 ? 1 : 0 }),
  },
  {
    duration: 7.5,
    startPos: [6.4, 2.5, 4.2], endPos: [6.0, 2.4, -3.4],
    startTarget: [0, 0.52, 0], endTarget: [0, 0.52, 0],
    state: t => ({
      groundSpeed: 180,
      windAngle: Math.round((Math.sin(t * Math.PI * 2) * 25) / 5) * 5,
      steer: 0,
      drs: 0,
    }),
  },
  {
    duration: 6.5,
    startPos: [6.8, 0.95, 1.2], endPos: [5.0, 2.45, 6.1],
    startTarget: [0, 0.42, 0], endTarget: [0, 0.56, 0],
    state: () => ({ groundSpeed: 180, windAngle: 0, steer: 0, drs: 0 }),
  },
];

const _a = new T.Vector3(), _b = new T.Vector3();
const _ta = new T.Vector3(), _tb = new T.Vector3();
const _yAxis = new T.Vector3(0, 1, 0);

export class ShowroomTour {
  constructor({ onPose, onState, onStop }) {
    this.onPose = onPose;
    this.onState = onState;
    this.onStop = onStop;
    this.active = false;
    this.elapsed = 0;
    this.totalDuration = SEGMENTS.reduce((sum, s) => sum + s.duration, 0);
    this.lastPatchKey = '';
  }

  start() {
    this.active = true;
    this.elapsed = 0;
    this.lastPatchKey = '';
  }

  stop(silent = false) {
    if (!this.active) return;
    this.active = false;
    if (!silent) this.onStop?.();
  }

  update(dt, turntableYawRad = 0) {
    if (!this.active) return;
    this.elapsed = (this.elapsed + dt) % this.totalDuration;
    let rem = this.elapsed;
    let seg = SEGMENTS[0];
    for (const s of SEGMENTS) {
      if (rem <= s.duration) { seg = s; break; }
      rem -= s.duration;
    }
    const raw = Math.max(0, Math.min(1, rem / seg.duration));
    const ease = raw * raw * (3 - 2 * raw);

    _a.set(...seg.startPos).lerp(_b.set(...seg.endPos), ease);
    _ta.set(...seg.startTarget).lerp(_tb.set(...seg.endTarget), ease);
    if (Math.abs(turntableYawRad) > 1e-6) {
      _a.applyAxisAngle(_yAxis, turntableYawRad);
      _ta.applyAxisAngle(_yAxis, turntableYawRad);
    }
    this.onPose?.(_a, _ta);

    const patch = seg.state(raw);
    const key = `${patch.groundSpeed}|${patch.windAngle}|${patch.steer}|${patch.drs}`;
    if (key !== this.lastPatchKey) {
      this.lastPatchKey = key;
      this.onState?.(patch);
    }
  }
}
