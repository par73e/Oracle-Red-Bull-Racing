import assert from 'node:assert/strict';
import * as T from 'three';
import { loadGeometry } from './geometry-loader.mjs';
import { bindRig, applyRig } from '../src/rig.js';
import { monzaSurface } from '../src/monza-scene.js';
import { silverstoneSurface } from '../src/silverstone-scene.js';
import { monacoSurface } from '../src/monaco-scene.js';
import { F1_SCENARIOS } from '../src/scenarios.js';

const CIRCUITS = [
  {
    id: 'monza',
    scenarioId: 'monza-drs',
    surface: monzaSurface,
    expectedBendSign: 0, // straight
    maxWheelGapM: 0.025,
  },
  {
    id: 'silverstone',
    scenarioId: 'silverstone-crosswind',
    surface: silverstoneSurface,
    expectedBendSign: -1, // bends RIGHT (-X) at T11 apex, matching steer = -8 deg
    maxWheelGapM: 0.025,
  },
  {
    id: 'monaco',
    scenarioId: 'monaco-hairpin',
    surface: monacoSurface,
    expectedBendSign: 1, // bends LEFT (+X) at 180 deg hairpin apex, matching steer = +18 deg
    maxWheelGapM: 0.025,
  },
];

// Verify all 4 F1 scenarios bind to their own bespoke circuit environments
const envMap = Object.fromEntries(F1_SCENARIOS.map(s => [s.id, s]));
assert.equal(envMap['spa-eau-rouge'].environment, 'eau-rouge');
assert.equal(envMap['monza-drs'].environment, 'monza');
assert.equal(envMap['silverstone-crosswind'].environment, 'silverstone');
assert.equal(envMap['monaco-hairpin'].environment, 'monaco');
assert.equal(envMap['monaco-hairpin'].condition.groundSpeed, 50);

const cars = [];
for (const carId of ['rb19', 'rb16b']) {
  const { model, config } = await loadGeometry(carId);
  const rig = bindRig(model, config);
  cars.push({ carId, model, config, rig });
}

for (const circuit of CIRCUITS) {
  const sc = envMap[circuit.scenarioId];
  const { surface } = circuit;

  // 1. Check car origin sits strictly inside the paved track limits with safety margin
  const originSample = surface.roadHeightAt(0, 0);
  const halfCarWidth = 1.05;
  assert(
    originSample.lat - halfCarWidth > -originSample.station.rightWidth + 0.5,
    `${circuit.id}: car right edge too close to right limit (lat=${originSample.lat}, rw=${originSample.station.rightWidth})`,
  );
  assert(
    originSample.lat + halfCarWidth < originSample.station.leftWidth - 0.5,
    `${circuit.id}: car left edge too close to left limit (lat=${originSample.lat}, lw=${originSample.station.leftWidth})`,
  );

  // 2. Check road curvature bend direction ahead of car matches scenario steer sign
  const pBack = surface.curve.getPoint(Math.max(0, surface.anchorT - 0.025));
  const pMid = surface.curve.getPoint(surface.anchorT);
  const pAhead = surface.curve.getPoint(Math.min(1, surface.anchorT + 0.025));
  const bendX = (pAhead.x - pMid.x) - (pMid.x - pBack.x);
  if (circuit.expectedBendSign === 0) {
    assert(Math.abs(bendX) < 0.05, `${circuit.id}: expected straight road, got bendX=${bendX}`);
    assert.equal(sc.condition.steer, 0, `${circuit.id}: straight scenario must have steer=0`);
  } else {
    assert(
      Math.sign(bendX) === circuit.expectedBendSign,
      `${circuit.id}: bendX=${bendX.toFixed(4)} disagrees with expected sign ${circuit.expectedBendSign}`,
    );
    assert(
      Math.sign(sc.condition.steer) === circuit.expectedBendSign,
      `${circuit.id}: scenario steer=${sc.condition.steer} disagrees with track bend sign ${circuit.expectedBendSign}`,
    );
  }

  // 3. Check 4-wheel contact gap for BOTH RB16B and RB19 at scenario steering angle
  const report = {};
  for (const { carId, rig } of cars) {
    applyRig(rig, { drs: sc.condition.drs, steer: sc.condition.steer, spin: 0 });
    const contact = [];
    for (const [name, w] of Object.entries(rig.wheels)) {
      const c = w.spinNode.getWorldPosition(new T.Vector3());
      const roadH = surface.roadHeightAt(c.x, c.z).y;
      const gap = c.y - w.radius - roadH;
      assert(
        Math.abs(gap) < circuit.maxWheelGapM,
        `${circuit.id} ${carId} ${name} wheel contact gap=${gap.toFixed(4)}m exceeds ${circuit.maxWheelGapM}m`,
      );
      contact.push({ wheel: name, gapM: Number(gap.toFixed(4)) });
    }
    report[carId] = contact;
  }

  // 4. Verify road ribbon geometry has zero NaN vertices
  const ribbonGeo = surface.ribbonGeometry(s => -s.rightWidth, s => s.leftWidth, { segments: 120 });
  const pos = ribbonGeo.attributes.position.array;
  for (let i = 0; i < pos.length; i++) {
    assert(Number.isFinite(pos[i]), `${circuit.id}: NaN in road ribbon geometry`);
  }
  ribbonGeo.dispose();

  console.log(`circuit ${circuit.id} OK:`, {
    roadWidthM: Number((originSample.station.leftWidth + originSample.station.rightWidth).toFixed(2)),
    carLatOffsetM: Number(originSample.lat.toFixed(2)),
    bendX: Number(bendX.toFixed(4)),
    steerDeg: sc.condition.steer,
    speedKmh: sc.condition.groundSpeed,
    yawDeg: sc.condition.windAngle,
    drs: sc.condition.drs,
    contact: report,
  });
}
console.log('All 3 new F1 circuits (Monza, Silverstone, Monaco) passed geometry, curvature-steer sign, and 4-wheel contact checks.');
