export function resolveRelativeWind(state) {
  const road = (state.groundSpeed ?? 0) / 3.6;
  const wind = state.ambientWindMps ?? 0;
  const angle = (state.windAngle ?? 0) * Math.PI / 180;
  const longitudinal = road + wind * Math.cos(angle);
  const lateral = wind * Math.sin(angle);
  const relSpeedMps = Math.hypot(longitudinal, lateral);
  return {
    longitudinal, lateral, relSpeedMps, relSpeedKmh: relSpeedMps * 3.6,
    effWindAngleDeg: relSpeedMps > 0 ? Math.atan2(lateral, longitudinal) * 180 / Math.PI : 0,
  };
}

export function captureCondition(state) {
  const wind = resolveRelativeWind(state);
  const road = state.groundSpeed / 3.6;
  // Sample the actual rig pose to the same precision as the animation settles.
  const drs = Math.round(state.drsCurrent * 1000) / 1000;
  return {
    model: state.model, speed: wind.relSpeedKmh, wheelSpeedMps: road,
    effWindAngle: wind.effWindAngleDeg, steer: state.steer, drs,
    flowDensity: state.flowDensity,
    coordinates: [wind.relSpeedMps, road, wind.effWindAngleDeg, state.steer, drs],
  };
}

export const conditionKey = condition => JSON.stringify([condition.model, ...condition.coordinates, condition.flowDensity]);
