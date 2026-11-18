// Real-time aerodynamic load estimator: reference 180 km/h F1 scale modulated
// continuously by actual OpenFOAM force trends across all controls.
const REF_DOWNFORCE_180_N = {
  rb19: 6355,
  rb16b: 5895,
};

// Vector-compose vehicle forward speed (groundSpeed km/h) with ground-relative
// ambient wind (ambientWindMps m/s at windAngle deg: -90 left .. +90 right).
export function resolveRelativeWind(state) {
  const windAngle = state.windAngle || 0;
  if (state.ambientWindMps === undefined) {
    const relSpeedKmh = Math.max(0, state.speed ?? 180);
    return {
      relSpeedKmh,
      relSpeedMps: relSpeedKmh / 3.6,
      effWindAngleDeg: windAngle,
    };
  }
  const g = Math.max(0, (state.groundSpeed ?? 180) / 3.6);
  const w = Math.max(0, state.ambientWindMps ?? 0);
  const rad = (windAngle * Math.PI) / 180;
  // Combine vehicle forward speed with ground-relative wind to get total relative
  // airspeed, while turntable / CFD yaw angle stays locked to the user's windAngle.
  const relSpeedMps = Math.hypot(g + w * Math.cos(rad), w * Math.sin(rad));
  return {
    relSpeedMps,
    relSpeedKmh: relSpeedMps * 3.6,
    effWindAngleDeg: windAngle,
  };
}

function cleanAxisPoints(points) {
  if (!Array.isArray(points)) return points;
  const filtered = points.filter(
    p =>
      p &&
      Number.isFinite(p.value) &&
      Number.isFinite(p.drag) &&
      Number.isFinite(p.downforce) &&
      Number.isFinite(p.side) &&
      (p.downforcePtp ?? 0) <= 500 &&
      p.drag >= -50 &&
      p.drag <= 30000 &&
      Math.abs(p.downforce) <= 15000 &&
      Math.abs(p.side) <= 20000,
  );
  return filtered.length ? filtered : points;
}

function interpAxis(points, value, field) {
  if (!points?.length) return null;
  if (value <= points[0].value) return points[0][field];
  const last = points[points.length - 1];
  if (value >= last.value) return last[field];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (value <= b.value) {
      const t = b.value === a.value ? 0 : (value - a.value) / (b.value - a.value);
      return a[field] * (1 - t) + b[field] * t;
    }
  }
  return last[field];
}

function interpYawAxis(points, deg, field) {
  if (!points?.length) return { value: null, mirrored: false };
  const exactNeg = points.find(p => p.value <= deg + 1e-6);
  const exactPos = points.find(p => p.value >= deg - 1e-6);
  if (deg < 0 && !exactNeg) {
    // Until negative angles finish solving, mirror |deg| from positive half.
    const raw = interpAxis(points, Math.abs(deg), field);
    return {
      value: field === 'side' && raw !== null ? -raw : raw,
      mirrored: true,
    };
  }
  if (!exactPos && deg > 0) {
    return { value: points[points.length - 1][field], mirrored: false };
  }
  return { value: interpAxis(points, deg, field), mirrored: false };
}

export class AeroForces {
  constructor() {
    this.serial = 0;
    this.car = 'rb16b';
    this.data = null;
    this.lastRefresh = 0;
  }

  async load(car) {
    const serial = ++this.serial;
    this.car = car;
    this.data = null;
    await this.refresh(serial);
  }

  async refresh(serial = this.serial) {
    this.lastRefresh = performance.now();
    try {
      const r = await fetch(`/flow/${this.car}/forces.json`, { cache: 'no-store' });
      if (!r.ok) return;
      const payload = await r.json();
      if (payload?.axes) {
        for (const k of Object.keys(payload.axes)) {
          payload.axes[k] = cleanAxisPoints(payload.axes[k]);
        }
      }
      if (serial === this.serial) this.data = payload;
    } catch {
      // Optional telemetry
    }
  }

  estimate(state) {
    if (this.data && (this.data.axes?.yaw?.length || 0) < 37 && performance.now() - this.lastRefresh > 10000) {
      this.refresh();
    }
    const car = state.model || this.car || 'rb19';
    const refBase = REF_DOWNFORCE_180_N[car] || 6000;
    const { relSpeedMps: u, relSpeedKmh: airKmh, effWindAngleDeg: windAngleDeg } = resolveRelativeWind(state);
    const groundKmh = state.groundSpeed ?? 180;
    const drs = Math.max(0, Math.min(1, state.drsCurrent ?? state.drs ?? 0));
    const steerDeg = state.steer ?? 0;

    const g = groundKmh / 3.6;
    const beta = (windAngleDeg * Math.PI) / 180;
    const cosB = Math.cos(beta);
    const sinB = Math.sin(beta);
    const cos2B = cosB * cosB;

    if (u < 1e-3 && g < 1e-3) {
      return {
        downforceN: 0,
        downforceDeltaPct: -100,
        dragN: 0,
        dragDeltaPct: -100,
        liftToDrag: null,
        sideN: 0,
        rawCfdDownforceN: 0,
        refBaseN: refBase,
        relSpeedKmh: 0,
        relSpeedMps: 0,
        effWindAngleDeg: 0,
        calibrated: true,
      };
    }

    const axes = this.data?.axes;
    const baseRaw = this.data?.base || { drag: 2418, side: 0, downforce: 682 };
    const yawBaseRaw = this.data?.yawBase || baseRaw;

    // 1. Dynamic air-speed scaling from actual CFD air sweep (with still-air wheel offset separated, quadratic above 350 km/h)
    const cfdAir0 = interpAxis(axes?.air, 0, 'downforce') ?? 80;
    const cfdAir180 = interpAxis(axes?.air, 180, 'downforce') ?? baseRaw.downforce;
    const cfdAir350 = interpAxis(axes?.air, 350, 'downforce');
    const cfdAirU =
      airKmh > 350 && cfdAir350 !== null
        ? cfdAir0 + (cfdAir350 - cfdAir0) * ((airKmh / 350) ** 2)
        : interpAxis(axes?.air, airKmh, 'downforce');
    const qRatio =
      cfdAirU !== null && cfdAir180 > cfdAir0 + 1
        ? Math.max(0, (cfdAirU - cfdAir0) / (cfdAir180 - cfdAir0))
        : (u / 50) ** 2;

    // 2. Ground / rolling-wheel underfloor boost from actual CFD ground sweep
    const cfdGround180 = interpAxis(axes?.ground, 180, 'downforce') ?? baseRaw.downforce;
    const cfdGroundG = interpAxis(axes?.ground, groundKmh, 'downforce') ?? cfdGround180;
    const groundRel = cfdGround180 > 1 ? (cfdGroundG - cfdGround180) / cfdGround180 : 0;
    const groundFactor = Math.max(0.72, Math.min(1.28, 1 + 0.52 * groundRel));

    // 3. DRS reduction factor from actual CFD open vs closed case, attenuated at high yaw
    const cfdDrs0 = interpAxis(axes?.drs, 0, 'downforce') ?? baseRaw.downforce;
    const cfdDrs100 = interpAxis(axes?.drs, 100, 'downforce') ?? cfdDrs0 * 0.75;
    const drsRatio = cfdDrs0 > 1 ? Math.max(0.55, Math.min(1.0, cfdDrs100 / cfdDrs0)) : 0.75;
    const drsFactor = 1 - drs * (1 - drsRatio) * cos2B;

    // 4. Steering disturbance from actual CFD steer cases + mild induced loss
    const cfdSteer0 = interpAxis(axes?.steer, 0, 'downforce') ?? baseRaw.downforce;
    const cfdSteerS = interpAxis(axes?.steer, steerDeg, 'downforce') ?? cfdSteer0;
    const steerCfdRel = cfdSteer0 > 1 ? (cfdSteerS - cfdSteer0) / cfdSteer0 : 0;
    const steerWakeLoss = 1 - 0.025 * Math.pow(Math.abs(steerDeg) / 18, 1.5) * cos2B + 0.25 * steerCfdRel;
    const steerFactor = Math.max(0.9, Math.min(1.04, steerWakeLoss));

    // 5. Crosswind yaw stall: longitudinal venturi/wing suction drops as car turns sideways,
    // while raw CFD yaw body pressure response blends smoothly across -90°..+90°.
    const yawCfd = interpYawAxis(axes?.yaw, windAngleDeg, 'downforce');
    const cfdYawDown = yawCfd.value !== null ? yawCfd.value : yawBaseRaw.downforce * (cos2B - 0.8 * sinB * sinB);
    const lCfdBase = yawBaseRaw.downforce;
    const lSlotGap = Math.max(0, refBase - lCfdBase);
    const yawChordFactor = cos2B * Math.max(0, 1 - 0.55 * Math.abs(sinB));

    const airDownforce =
      (lSlotGap * yawChordFactor + lCfdBase) * qRatio * groundFactor * drsFactor * steerFactor +
      (cfdYawDown - lCfdBase) * ((u / 50) ** 2);

    // Pure wheel-pumping suction when air = 0 but ground/wheels roll
    const wheelOnlyDown = cfdAir0 * ((g / 50) ** 2) * (1 - Math.min(1, u / 8));
    const downforceN = airDownforce + wheelOnlyDown;

    // Drag & Side force directly from OpenFOAM forces scaled by speed² (quadratic above 350 km/h),
    // cleanly separating air-stream drag from still-air wheel pumping drag at low/zero speed.
    const cfdDrag0 = interpAxis(axes?.air, 0, 'drag') ?? 70;
    const cfdDrag350 = interpAxis(axes?.air, 350, 'drag');
    const cfdDragU =
      airKmh > 350 && cfdDrag350 !== null
        ? Math.max(0, cfdDrag350 - cfdDrag0) * ((airKmh / 350) ** 2)
        : Math.max(0, (interpAxis(axes?.air, airKmh, 'drag') ?? baseRaw.drag * ((u / 50) ** 2) + cfdDrag0) - cfdDrag0);
    const cfdDragYaw = interpYawAxis(axes?.yaw, windAngleDeg, 'drag').value ?? yawBaseRaw.drag * cos2B;
    const dragYawScale = yawBaseRaw.drag > 1 ? Math.max(0, cfdDragYaw / yawBaseRaw.drag) : cos2B;
    const cfdDrsDrag100 = interpAxis(axes?.drs, 100, 'drag') ?? baseRaw.drag * 0.95;
    const drsDragFactor = 1 - drs * (1 - cfdDrsDrag100 / Math.max(1, baseRaw.drag)) * cos2B;
    const wheelDrag = cfdDrag0 * ((g / 50) ** 2);
    const dragN = Math.max(0, (cfdDragU * dragYawScale + wheelDrag) * drsDragFactor);
    const dragDeltaPct = Math.round(((dragN - Math.max(1, baseRaw.drag)) / Math.max(1, baseRaw.drag)) * 100);
    const liftToDrag = dragN > 100 && Math.abs(windAngleDeg) <= 65 ? Number((downforceN / dragN).toFixed(2)) : null;

    const cfdSideYaw = interpYawAxis(axes?.yaw, windAngleDeg, 'side').value ?? -5600 * sinB;
    const cfdSideSteer = interpAxis(axes?.steer, steerDeg, 'side') ?? 0;
    const sideN = (cfdSideYaw + cfdSideSteer) * ((u / 50) ** 2);

    const rawCfdDownforceN = cfdYawDown * ((u / 50) ** 2) + wheelOnlyDown;

    return {
      downforceN: Math.round(downforceN),
      downforceDeltaPct: Math.round(((downforceN - refBase) / refBase) * 100),
      dragN: Math.round(dragN),
      dragDeltaPct,
      liftToDrag,
      sideN: Math.round(sideN),
      rawCfdDownforceN: Math.round(rawCfdDownforceN),
      refBaseN: refBase,
      relSpeedKmh: Math.round(airKmh),
      relSpeedMps: Number(u.toFixed(1)),
      effWindAngleDeg: Number(windAngleDeg.toFixed(1)),
      mirroredYawForce: yawCfd.mirrored,
      calibrated: true,
    };
  }
}
