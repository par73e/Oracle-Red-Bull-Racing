import * as T from 'three';

const MAX_COLUMNS = 20;
const MAX_ROWS = 6;
const MAX_LINES = MAX_COLUMNS * MAX_ROWS;
const SEGMENTS = 36;

// A small, analytic stream ribbon for interaction. All vertices are in the
// car's frame, with the same local inflow direction as the CFD tracer.
export class FlowPreview {
  constructor(flow) {
    const geometry = new T.BufferGeometry();
    for (const [name, size] of [['position', 3], ['color', 3], ['flight', 1], ['lineAlpha', 1]]) {
      geometry.setAttribute(name, new T.BufferAttribute(new Float32Array(MAX_LINES * SEGMENTS * 2 * size), size).setUsage(T.DynamicDrawUsage));
    }
    this.material = flow.material.clone();
    this.lines = new T.LineSegments(geometry, this.material);
    this.lines.name = 'FLOW_INTERACTION_PREVIEW';
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    flow.parent?.add(this.lines);
  }

  update(state, angle, rig) {
    const beta = T.MathUtils.degToRad(angle);
    const dx = Math.sin(beta), dz = -Math.cos(beta);
    const tx = -dz, tz = dx;
    const air = state.speed / 3.6;
    const rolling = state.wheelSpeedMps;
    const strength = T.MathUtils.clamp(rolling / 75, 0, 1.5);
    const density = Math.sqrt(state.flowDensity / 100);
    const geometry = this.lines.geometry;
    const { position, color, flight, lineAlpha } = geometry.attributes;
    const tint = new T.Color(), a = new T.Vector3(), b = new T.Vector3();
    let vertex = 0;
    this.count = 0;

    const emitLine = (pointAt, speed, opacity) => {
      this.count++;
      tint.setHSL(.55 - .52 * Math.min(1, speed / 120), .85, .65);
      let time = 0;
      pointAt(0, a);
      for (let i = 1; i <= SEGMENTS; i++) {
        pointAt(i / SEGMENTS, b);
        const nextTime = time + a.distanceTo(b) / Math.max(1, speed);
        for (let end = 0; end < 2; end++) {
          const point = end ? b : a;
          const fade = Math.min(1, (i - 1 + end) / 3, (SEGMENTS - i + 1 - end) / 3);
          position.setXYZ(vertex, point.x, point.y, point.z);
          color.setXYZ(vertex, tint.r, tint.g, tint.b);
          flight.setX(vertex, end ? nextTime : time);
          lineAlpha.setX(vertex++, fade * opacity);
        }
        a.copy(b);
        time = nextTime;
      }
    };

    const halfLength = (rig.config?.wheelbase ?? 3.52) / 2 + 1.04;
    const halfWidth = (rig.config?.front_track ?? 1.65) / 2 + .27;
    const along = Math.hypot(dx * halfWidth, dz * halfLength);
    const across = Math.hypot(tx * halfWidth, tz * halfLength);
    if (air > 0) {
      const columns = T.MathUtils.clamp(Math.round(16 * density), 2, MAX_COLUMNS);
      const rows = T.MathUtils.clamp(Math.round(5 * density), 1, MAX_ROWS);
      for (let row = 0; row < rows; row++) {
        const height = .18 + (row + .5) * 1.26 / rows;
        for (let col = 0; col < columns; col++) {
          const offset = (2 * (col + .5) / columns - 1) * (across + .82);
          const outward = Math.sign(offset);
          const influence = Math.max(0, 1 - Math.abs(offset) / (across + .35));
          const lift = T.MathUtils.smoothstep(height, .34, .93);
          const steer = state.steer / 18;
          emitLine((t, point) => {
            const s = -along - 1.7 + t * (2 * along + 4.5);
            const envelope = 1 - T.MathUtils.smoothstep(Math.abs(s), .48 * along, along + 1.35);
            const wake = T.MathUtils.smoothstep(s, 0, along + .35) * (1 - T.MathUtils.smoothstep(t, .77, 1));
            const spread = (across + .16 - Math.abs(offset)) * influence;
            const lateral = offset + envelope * spread * outward * (1 - .84 * lift)
              + steer * .23 * envelope * (1 - lift) + strength * .14 * outward * wake * (1 - lift);
            const y = height + .53 * lift * influence * envelope
              - state.drsCurrent * .25 * wake * lift * influence;
            point.set(dx * s + tx * lateral, y, dz * s + tz * lateral);
          }, air, .57);
        }
      }
    } else {
      // With zero inflow, show only local circulation from wheel motion.
      const wheelbase = rig.config?.wheelbase ?? 3.52;
      for (const x of [-halfWidth + .25, halfWidth - .25]) {
        for (const z of [-wheelbase / 2, wheelbase / 2]) {
          for (let lane = 0; lane < Math.max(1, Math.round(4 * density)); lane++) {
            const radius = .36 + lane * .035 + strength * .035;
            const steer = z > 0 ? T.MathUtils.degToRad(state.steer) : 0;
            emitLine((t, point) => {
              const phase = Math.PI * (1.9 * t - .42);
              const offset = radius * Math.cos(phase);
              point.set(x + offset * Math.sin(steer), .49 + radius * Math.sin(phase), z + offset * Math.cos(steer));
            }, rolling, .52);
          }
        }
      }
    }
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
    geometry.setDrawRange(0, vertex);
    this.angle = angle;
  }

  show(opacity) {
    this.lines.visible = opacity > 0;
    this.material.uniforms.opacity.value = opacity;
  }
}
