import { interpolateForces, selectCoverage, synthesizeForces } from './flow-catalog.js';

export const F1_REF_180 = Object.freeze({
  rb19: { downforce: 6355, drag: 1920 },
  rb16b: { downforce: 5895, drag: 1860 },
});

export function rawForcesFromCatalog(catalog, condition) {
  if (!catalog || catalog.car !== condition.model) return undefined;
  const { mode, sources } = selectCoverage(catalog, condition.coordinates);
  if (mode === 'exact' && sources[0].node.forces) return { ...sources[0].node.forces, mode };
  if (mode === 'interpolated' && sources.every(({ node }) => node.forces)
      && catalog.forceSegments.has(sources.map(source => source.node.id).join(':'))) {
    return { mode, ...interpolateForces(sources, condition.coordinates[0]) };
  }
  return synthesizeForces(catalog, condition.coordinates);
}

export function computeCalibratedForces(catalog, condition, loadingCatalog = false) {
  if (condition.speed === 0 && condition.wheelSpeedMps === 0) {
    return {
      source: 'still', downforceN: 0, dragN: 0, sideN: 0, liftToDrag: null,
      rawDownforceN: 0, rawDragN: 0, calibrated: true,
    };
  }
  const raw = rawForcesFromCatalog(catalog, condition);
  if (!raw) {
    return {
      source: loadingCatalog ? 'loading' : 'unavailable',
      downforceN: null, dragN: null, sideN: null, liftToDrag: null,
      rawDownforceN: null, rawDragN: null, calibrated: false,
    };
  }
  const ref = F1_REF_180[condition.model] || F1_REF_180.rb16b;
  const baseRaw = catalog?.byId?.get('base')?.forces;
  const dfScale = baseRaw?.downforce > 1 ? ref.downforce / baseRaw.downforce : 1;
  const dragScale = baseRaw?.drag > 1 ? ref.drag / baseRaw.drag : 1;
  const downforceN = raw.downforce >= 0
    ? raw.downforce * dfScale
    : raw.downforce * Math.min(dfScale, 1.5);
  const dragN = raw.drag * dragScale;
  const sideN = raw.side * dragScale;
  return {
    source: raw.mode,
    downforceN,
    dragN,
    sideN,
    liftToDrag: dragN > 1e-3 ? downforceN / dragN : null,
    rawDownforceN: raw.downforce,
    rawDragN: raw.drag,
    calibrated: true,
  };
}
