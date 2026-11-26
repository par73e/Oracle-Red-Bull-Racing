import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readCatalog } from '../src/flow-catalog.js';
import { captureCondition } from '../src/flow-condition.js';
import { computeCalibratedForces, F1_REF_180 } from '../src/aero-forces-calc.js';

const load = async car => readCatalog(
  JSON.parse(await fs.readFile(new URL(`../public/flow/${car}/display/manifest.json`, import.meta.url), 'utf8')),
  car,
);

const [c16, c19] = await Promise.all([load('rb16b'), load('rb19')]);

// 180 km/h exact anchors must match locked F1_REF_180 engineering calibration
const f16Base = computeCalibratedForces(c16, captureCondition({ model: 'rb16b', groundSpeed: 180, windAngle: 0, steer: 0, drs: 0, drsCurrent: 0 }));
const f19Base = computeCalibratedForces(c19, captureCondition({ model: 'rb19', groundSpeed: 180, windAngle: 0, steer: 0, drs: 0, drsCurrent: 0 }));
assert.equal(Math.round(f16Base.downforceN), F1_REF_180.rb16b.downforce);
assert.equal(Math.round(f16Base.dragN), F1_REF_180.rb16b.drag);
assert.equal(Math.round(f19Base.downforceN), F1_REF_180.rb19.downforce);
assert.equal(Math.round(f19Base.dragN), F1_REF_180.rb19.drag);

// DRS open reduces drag on both cars
const f16Open = computeCalibratedForces(c16, captureCondition({ model: 'rb16b', groundSpeed: 180, windAngle: 0, steer: 0, drs: 1, drsCurrent: 1 }));
const f19Open = computeCalibratedForces(c19, captureCondition({ model: 'rb19', groundSpeed: 180, windAngle: 0, steer: 0, drs: 1, drsCurrent: 1 }));
assert(f16Open.dragN < f16Base.dragN, 'RB16B DRS open must reduce drag');
assert(f19Open.dragN < f19Base.dragN, 'RB19 DRS open must reduce drag');

// Speed sweep & yaw sweep stay finite across entire range for both cars
for (const v of [0, 50, 120, 180, 260, 350]) {
  for (const [car, cat] of [['rb16b', c16], ['rb19', c19]]) {
    const f = computeCalibratedForces(cat, captureCondition({ model: car, groundSpeed: v, windAngle: 0, steer: 0, drs: 0, drsCurrent: 0 }));
    assert(Number.isFinite(f.downforceN) && Number.isFinite(f.dragN), `${car} speed ${v} forces finite`);
  }
}
for (const yaw of [-90, -45, -15, 0, 15, 45, 90]) {
  for (const [car, cat] of [['rb16b', c16], ['rb19', c19]]) {
    const f = computeCalibratedForces(cat, captureCondition({ model: car, groundSpeed: 180, windAngle: yaw, steer: 0, drs: 0, drsCurrent: 0 }));
    assert(Number.isFinite(f.downforceN) && Number.isFinite(f.dragN), `${car} yaw ${yaw} forces finite`);
  }
}
console.log('Dual-car calibrated comparison, DRS delta, speed polar, and yaw polar checks passed');
