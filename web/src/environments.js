import * as T from 'three';
import { createSpaScene } from './spa-scene.js';
import { createMonzaScene } from './monza-scene.js';
import { createSilverstoneScene } from './silverstone-scene.js';
import { createMonacoScene } from './monaco-scene.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TRACK_ENVIRONMENTS = new Set(['eau-rouge', 'monza', 'silverstone', 'monaco']);
export const isTrackEnvironment = kind => TRACK_ENVIRONMENTS.has(kind);

// Site-inspired, metric 3D reconstruction. Terrain/architecture are documented
// visual approximations, never presented as surveyed Spa CAD.
const rand = seed => { let s = seed; return () => ((s = Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296; };
const mat = (color, roughness = .8, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
function box(group, w, h, d, x, y, z, material) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  group.add(m);
  return m;
}
function tube(group, a, b, r, material, segments = 6) {
  const d = b.clone().sub(a);
  const m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), segments), material);
  m.position.copy(a).add(b).multiplyScalar(.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  group.add(m);
  return m;
}

function createFanBladeGeometry() {
  const radialSteps = 18, profileSteps = 28;
  const rInner = .56, rOuter = 2.07;
  const ringStride = profileSteps + 1;
  const positions = [], uvs = [], indices = [];

  for (let j = 0; j <= radialSteps; j++) {
    const v = j / radialSteps;
    const r = rInner + v * (rOuter - rInner);
    const chord = .35 + .17 * Math.sin(v * Math.PI * .82) - .04 * v * v;
    const thickness = .066 * (1 - .68 * v);
    const twist = .68 - .41 * Math.pow(v, .85);
    const sweepX = -.055 * Math.sin(v * Math.PI);
    const leanZ = -.025 * v * v;
    const cosB = Math.cos(twist), sinB = Math.sin(twist);

    for (let i = 0; i <= profileSteps; i++) {
      const s = i / profileSteps;
      const angle = s * Math.PI * 2;
      const u = .5 * (1 - Math.cos(angle));
      const upper = angle <= Math.PI ? 1 : -1;
      const yt = 5 * thickness * (.2969 * Math.sqrt(u) - .126 * u - .3516 * u * u + .2843 * u * u * u - .1036 * u * u * u * u);
      const yc = .052 * chord * 4 * u * (1 - u);
      const xLocal = (u - .42) * chord;
      const zLocal = yc + upper * yt;

      const x = xLocal * cosB - zLocal * sinB + sweepX;
      const y = r;
      const z = -(xLocal * sinB + zLocal * cosB) + leanZ;
      positions.push(x, y, z);
      uvs.push(s, v);
    }
  }

  for (let j = 0; j < radialSteps; j++) {
    const rowA = j * ringStride, rowB = (j + 1) * ringStride;
    for (let i = 0; i < profileSteps; i++) {
      const a = rowA + i, b = rowA + i + 1, c = rowB + i, d = rowB + i + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const tipStart = radialSteps * ringStride;
  const tipCenterIdx = positions.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < profileSteps; i++) {
    cx += positions[(tipStart + i) * 3];
    cy += positions[(tipStart + i) * 3 + 1];
    cz += positions[(tipStart + i) * 3 + 2];
  }
  positions.push(cx / profileSteps, cy / profileSteps, cz / profileSteps);
  uvs.push(.5, 1);
  for (let i = 0; i < profileSteps; i++) {
    indices.push(tipStart + i, tipCenterIdx, tipStart + i + 1);
  }

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function windTunnel() {
  const root = new T.Group();
  root.name = 'ORIGINAL_WIND_TUNNEL';
  const concrete = mat('#161f26', .86, .05);
  const darkStructure = mat('#1c2730', .68, .35);
  const panel = mat('#23313b', .56, .28);
  const shroudMat = mat('#34444f', .38, .65);
  const metal = mat('#6f8590', .34, .76);
  const alloy = mat('#aebec6', .22, .88);
  const bladeMat = mat('#8799a3', .28, .80);
  const hubMat = mat('#28353e', .32, .74);
  const accentRingMat = mat('#d42b28', .34, .22);
  const brass = mat('#c8bc7e', .36, .68);
  const black = mat('#202a2e', .72);
  const darkRecess = mat('#0d1318', .92, .05);
  const glass = mat('#152634', .18, .85);
  const light = new T.MeshBasicMaterial({ color: '#f2f5ff' });
  const warmGlow = new T.MeshBasicMaterial({ color: '#dbe9ff' });

  // A wide enclosing shell stays beyond the orbit range. Its back-facing
  // surfaces form the room without putting nearby barriers across the car.
  const shell = new T.Mesh(
    new T.BoxGeometry(70, 55, 90),
    new T.MeshStandardMaterial({ color: '#151c22', roughness: .9, side: T.BackSide })
  );
  shell.position.set(0, 2, -3);
  root.add(shell);

  const deck = new T.Mesh(new T.PlaneGeometry(68, 88), new T.MeshBasicMaterial({ color: '#151f24' }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -.19;
  root.add(deck);

  // Keep the hall architecture outside the 18 m orbit around the car.
  const hallHalfWidth = 23.4;
  const hallBeamY = 22.35;
  for (let z = -22; z <= 18; z += 8) {
    for (const x of [-hallHalfWidth, hallHalfWidth]) {
      box(root, .42, 22.6, .48, x, 11.1, z, darkStructure);
      box(root, .85, 1.4, .44, x - Math.sign(x) * .28, hallBeamY - .75, z, darkStructure);
    }
    box(root, 2 * hallHalfWidth + .4, .46, .48, 0, hallBeamY, z, darkStructure);
  }
  const bankOffset = hallHalfWidth - 1.9;
  for (const x of [-bankOffset, bankOffset]) {
    box(root, .22, .26, 48, x, hallBeamY - .40, -2, darkStructure);
    for (let z = -24; z <= 16; z += 8) {
      box(root, 4.3, .16, .62, x, hallBeamY - .27, z, panel);
      box(root, 4.0, .06, .42, x, hallBeamY - .37, z, light);
    }
  }
  // Overhead centerline PIV / aero sensor gantry rail.
  for (const x of [-1.55, 1.55]) {
    box(root, .12, .18, 26, x, 21, 0, darkStructure);
  }
  for (let z = -10; z <= 10; z += 4) {
    box(root, 3.2, .1, .12, 0, 21, z, metal);
  }

  // Control room observation window on the left hall wall.
  const windowX = -hallHalfWidth;
  box(root, .32, 3.1, 10.6, windowX + .15, 2.35, 0, panel);
  box(root, .18, 2.3, 9.8, windowX + .25, 2.38, 0, glass);
  for (let z = -4.8; z <= 4.8; z += 2.4) {
    box(root, .28, 2.4, .1, windowX + .28, 2.38, z, darkStructure);
  }
  box(root, .06, .08, 9.6, windowX + .30, 1.22, 0, warmGlow);

  // Rolling road belt texture with realistic wear tracks and optical edge markers
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d'), random = rand(442);
  ctx.fillStyle = '#1f2629';
  ctx.fillRect(0, 0, 512, 512);
  for (const trackX of [118, 394]) {
    const grad = ctx.createLinearGradient(trackX - 52, 0, trackX + 52, 0);
    grad.addColorStop(0, 'rgba(12,16,18,0)');
    grad.addColorStop(.5, 'rgba(10,13,15,0.42)');
    grad.addColorStop(1, 'rgba(12,16,18,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(trackX - 52, 0, 104, 512);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(165,176,182,${random() * .055})`;
    ctx.fillRect(random() * 512, random() * 512, 1, 3);
  }
  ctx.fillStyle = '#394348';
  ctx.fillRect(0, 4, 512, 2);
  ctx.fillRect(0, 258, 512, 2);
  ctx.fillStyle = '#9aa6ab';
  for (let y = 0; y < 512; y += 32) {
    ctx.fillRect(6, y, 6, 10);
    ctx.fillRect(500, y, 6, 10);
  }
  const rubberMap = new T.CanvasTexture(canvas);
  rubberMap.wrapS = rubberMap.wrapT = T.RepeatWrapping;
  rubberMap.repeat.set(1, 4.6);
  rubberMap.colorSpace = T.SRGBColorSpace;
  black.color.set('#ffffff');
  black.map = rubberMap;
  root.userData.beltTexture = rubberMap;

  // Rotating yaw turntable carrying the rolling belt, calibration ring & tie-down rails
  const turntable = new T.Group();
  turntable.name = 'WIND_TURNTABLE';
  const platterMat = mat('#182228', .74, .22);
  const platter = new T.Mesh(new T.CylinderGeometry(5.18, 5.18, .022, 96), platterMat);
  platter.position.y = -.026;
  platter.receiveShadow = true;
  turntable.add(platter);

  // Rolling road belt & stainless-steel platen surround centered inside turntable
  box(turntable, 2.5, .028, 9.2, 0, -.012, 0, black);
  for (const x of [-1.31, 1.31]) {
    box(turntable, .11, .026, 9.44, x, -.011, 0, metal);
    box(turntable, .02, .028, 9.44, x - Math.sign(x) * .05, -.01, 0, alloy);
  }
  for (const z of [-4.66, 4.66]) {
    box(turntable, 2.74, .026, .12, 0, -.011, z, metal);
  }

  // Concentric turntable calibration seams, rotating 5° ticks & centerline pointer
  const yawInner = new T.Mesh(new T.RingGeometry(2.64, 2.68, 72), darkStructure);
  yawInner.rotation.x = -Math.PI / 2;
  yawInner.position.y = -.006;
  turntable.add(yawInner);

  const yawMiddle = new T.Mesh(new T.RingGeometry(3.42, 3.46, 84), darkStructure);
  yawMiddle.rotation.x = -Math.PI / 2;
  yawMiddle.position.y = -.006;
  turntable.add(yawMiddle);

  const yawOuter = new T.Mesh(new T.RingGeometry(5.10, 5.18, 96), metal);
  yawOuter.rotation.x = -Math.PI / 2;
  yawOuter.position.y = -.005;
  turntable.add(yawOuter);

  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 3 === 0;
    const r = major ? 4.98 : 5.02;
    const tick = new T.Mesh(new T.BoxGeometry(major ? .028 : .016, .004, major ? .14 : .08), major ? alloy : metal);
    tick.position.set(Math.sin(a) * r, -.005, Math.cos(a) * r);
    tick.rotation.y = a;
    turntable.add(tick);
  }

  const turntablePointer = new T.Mesh(new T.BoxGeometry(.045, .006, .24), accentRingMat);
  turntablePointer.position.set(0, -.004, 5.04);
  turntable.add(turntablePointer);

  // Floor guide rails and tie-down instrumentation brackets mounted on turntable
  for (const x of [-1.48, 1.48]) {
    box(turntable, .07, .01, 8.8, x, .003, 0, darkStructure);
    box(turntable, .028, .012, 8.6, x, .007, 0, brass);
    for (let z = -4; z <= 4; z += 1) {
      box(turntable, .22, .014, .036, x, .012, z, metal);
      box(turntable, .06, .02, .06, x + Math.sign(x) * .08, .014, z, alloy);
    }
  }

  mergeStatic(turntable);
  turntable.userData.dynamic = true;
  turntable.traverse(o => { o.userData.dynamic = true; });
  root.add(turntable);
  root.userData.turntable = turntable;

  // Stationary outer turntable pit collar & fixed wind-axis degree markers
  const pitRing = new T.Mesh(new T.RingGeometry(5.22, 5.38, 96), darkStructure);
  pitRing.rotation.x = -Math.PI / 2;
  pitRing.position.y = -.005;
  root.add(pitRing);

  const pitLip = new T.Mesh(new T.RingGeometry(5.20, 5.23, 96), alloy);
  pitLip.rotation.x = -Math.PI / 2;
  pitLip.position.y = -.004;
  root.add(pitLip);

  for (let deg = -90; deg <= 90; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const isZero = deg === 0;
    const isCardinal = Math.abs(deg) === 45 || Math.abs(deg) === 90;
    const r = isZero ? 5.36 : 5.33;
    const mark = new T.Mesh(
      new T.BoxGeometry(isZero ? .05 : isCardinal ? .032 : .02, .006, isZero ? .26 : isCardinal ? .18 : .11),
      isZero ? accentRingMat : alloy
    );
    mark.position.set(Math.sin(a) * r, -.003, Math.cos(a) * r);
    mark.rotation.y = a;
    root.add(mark);
  }

  // Stationary upstream boundary-layer suction scoop outside the turntable pit
  box(root, 2.96, .03, .42, 0, -.016, 5.85, darkRecess);
  box(root, 3.04, .014, .08, 0, -.001, 5.63, alloy);
  box(root, 3.04, .014, .08, 0, -.001, 6.07, metal);
  for (let x = -1.2; x <= 1.2; x += .4) {
    box(root, .025, .024, .36, x, -.011, 5.85, metal);
  }

  // Place the upstream plenum and fan beyond the orbit as one assembly.
  const plenum = new T.Group();
  plenum.position.z = 9;
  root.add(plenum);
  const fy = 2.4, fz = 13.85;
  box(plenum, 12.6, 1.25, .36, 0, 5.45, 14.22, concrete);
  box(plenum, 12.6, .34, .36, 0, -.02, 14.22, concrete);
  for (const s of [-1, 1]) {
    box(plenum, 3.9, 4.72, .36, s * 4.3, 2.49, 14.22, concrete);
    box(plenum, .28, 5.9, .54, s * 2.46, 2.75, 14.14, darkStructure);
    box(plenum, .28, 5.9, .54, s * 6.18, 2.75, 14.14, darkStructure);
    // Recessed acoustic splitter louvers proud of the bulkhead front face
    box(plenum, 3.15, 4.15, .12, s * 4.32, 2.48, 14.01, darkRecess);
    for (let ly = .65; ly <= 4.3; ly += .33) {
      const louver = box(plenum, 3.05, .07, .18, s * 4.32, ly, 13.96, panel);
      louver.rotation.x = .22;
    }
    for (const lx of [s * 3.3, s * 5.34]) {
      box(plenum, .06, 4.1, .2, lx, 2.48, 13.97, metal);
    }
  }
  // Corner gussets framing the circular bellmouth opening
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const gusset = new T.Mesh(new T.BoxGeometry(1.18, 1.18, .34), darkStructure);
      gusset.position.set(sx * 1.92, fy + sy * 1.92, 14.18);
      gusset.rotation.z = Math.PI / 4;
      plenum.add(gusset);
    }
  }

  // Deep recessed circular duct wall & dark settling chamber behind fan
  const ductWall = new T.Mesh(
    new T.CylinderGeometry(2.14, 2.26, 1.75, 64, 1, true),
    new T.MeshStandardMaterial({ color: '#11181e', roughness: .82, metalness: .22, side: T.BackSide })
  );
  ductWall.rotation.x = Math.PI / 2;
  ductWall.position.set(0, fy, 14.32);
  plenum.add(ductWall);

  const plenumBack = new T.Mesh(new T.CylinderGeometry(2.26, 2.26, .08, 64), darkRecess);
  plenumBack.rotation.x = Math.PI / 2;
  plenumBack.position.set(0, fy, 15.16);
  plenum.add(plenumBack);

  // Upstream axial fan assembly.
  const fan = new T.Group();
  fan.position.set(0, fy, fz);
  plenum.add(fan);
  root.userData.fan = fan;

  // Contoured aerodynamic bellmouth shroud (rotation.x = +PI/2 maps local +Y to +Z)
  const bellProfile = [
    new T.Vector2(2.12, .52),
    new T.Vector2(2.12, -.12),
    new T.Vector2(2.16, -.28),
    new T.Vector2(2.26, -.38),
    new T.Vector2(2.40, -.40),
    new T.Vector2(2.48, -.32),
    new T.Vector2(2.48, .52),
    new T.Vector2(2.12, .52),
  ];
  const bellmouth = new T.Mesh(new T.LatheGeometry(bellProfile, 64), shroudMat);
  bellmouth.rotation.x = Math.PI / 2;
  fan.add(bellmouth);

  // Machined stainless intake lip ring & outer flange
  const lipRing = new T.Mesh(new T.TorusGeometry(2.24, .055, 16, 72), alloy);
  lipRing.position.z = -.34;
  fan.add(lipRing);

  const outerFlange = new T.Mesh(new T.TorusGeometry(2.44, .038, 12, 72), metal);
  outerFlange.position.z = -.18;
  fan.add(outerFlange);

  const tipSeal = new T.Mesh(
    new T.CylinderGeometry(2.115, 2.115, .30, 64, 1, true),
    new T.MeshStandardMaterial({ color: '#10161b', roughness: .9, side: T.BackSide })
  );
  tipSeal.rotation.x = Math.PI / 2;
  fan.add(tipSeal);

  // 24 perimeter flange bolts on the shroud ring
  const shroudBoltGeo = new T.CylinderGeometry(.022, .022, .05, 8);
  shroudBoltGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const bolt = new T.Mesh(shroudBoltGeo, alloy);
    bolt.position.set(Math.cos(a) * 2.38, Math.sin(a) * 2.38, -.36);
    fan.add(bolt);
  }

  // Stationary downstream stator guide vanes & motor nacelle pod
  const statorPod = new T.Mesh(new T.CylinderGeometry(.56, .46, .88, 48), hubMat);
  statorPod.rotation.x = Math.PI / 2;
  statorPod.position.z = .52;
  fan.add(statorPod);

  const statorVaneGeo = new T.BoxGeometry(.045, 1.56, .28);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + .22;
    const vaneGroup = new T.Group();
    vaneGroup.rotation.z = a;
    const vane = new T.Mesh(statorVaneGeo, shroudMat);
    vane.position.set(0, 1.32, .42);
    vane.rotation.y = .28;
    vaneGroup.add(vane);
    fan.add(vaneGroup);
  }

  // Downstream concentric flow-conditioning rings inside the throat
  for (const r of [.95, 1.38, 1.78]) {
    const screenRing = new T.Mesh(new T.RingGeometry(r - .018, r + .018, 48), metal);
    screenRing.position.z = .86;
    fan.add(screenRing);
  }

  // Rotating turbine rotor: 11 sculpted twisted airfoil blades + 3D parabolic spinner cone
  const rotor = new T.Group();
  fan.add(rotor);
  root.userData.rotor = rotor;

  const bladeGeo = createFanBladeGeometry();
  const rootCollarGeo = new T.CylinderGeometry(.088, .108, .14, 20);
  const rootClampGeo = new T.TorusGeometry(.096, .016, 10, 20);
  rootClampGeo.rotateX(Math.PI / 2);

  const bladeCount = 11;
  for (let i = 0; i < bladeCount; i++) {
    const arm = new T.Group();
    arm.rotation.z = (i * Math.PI * 2) / bladeCount;

    const blade = new T.Mesh(bladeGeo, bladeMat);
    arm.add(blade);

    const collar = new T.Mesh(rootCollarGeo, hubMat);
    collar.position.y = .58;
    arm.add(collar);

    const clamp = new T.Mesh(rootClampGeo, alloy);
    clamp.position.y = .63;
    arm.add(clamp);

    rotor.add(arm);
  }

  // Rotor hub drum
  const hubDrum = new T.Mesh(new T.CylinderGeometry(.58, .58, .38, 48), hubMat);
  hubDrum.rotation.x = Math.PI / 2;
  rotor.add(hubDrum);

  const hubRearRing = new T.Mesh(new T.TorusGeometry(.57, .024, 12, 48), alloy);
  hubRearRing.position.z = .16;
  rotor.add(hubRearRing);

  // Parabolic aerodynamic spinner nose cone pointing -Z (toward the car: rotation.x = +PI/2)
  const spinnerPoints = [];
  const spinnerSteps = 20;
  for (let i = 0; i <= spinnerSteps; i++) {
    const t = i / spinnerSteps;
    const r = .58 * Math.sin(t * Math.PI * .5);
    const y = -.82 * (1 - Math.pow(t, 1.65));
    spinnerPoints.push(new T.Vector2(r, y));
  }
  const spinner = new T.Mesh(new T.LatheGeometry(spinnerPoints, 48), hubMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = -.18;
  rotor.add(spinner);

  // Polished alloy spinner tip cap & machined mid-cone balance ring
  const tipCapPoints = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * .28;
    tipCapPoints.push(new T.Vector2(.58 * Math.sin(t * Math.PI * .5), -.82 * (1 - Math.pow(t, 1.65))));
  }
  const spinnerTip = new T.Mesh(new T.LatheGeometry(tipCapPoints, 36), alloy);
  spinnerTip.rotation.x = Math.PI / 2;
  spinnerTip.position.z = -.183;
  rotor.add(spinnerTip);

  const midConeRing = new T.Mesh(new T.TorusGeometry(.425, .012, 10, 48), alloy);
  midConeRing.position.z = -.52;
  rotor.add(midConeRing);

  const accentCollar = new T.Mesh(new T.TorusGeometry(.568, .02, 12, 48), accentRingMat);
  accentCollar.position.z = -.19;
  rotor.add(accentCollar);

  // 11 machined spinner flange bolts + dynamic rotation index mark on spinner cone
  const hubBoltGeo = new T.CylinderGeometry(.018, .018, .04, 8);
  hubBoltGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < bladeCount; i++) {
    const a = ((i + .5) / bladeCount) * Math.PI * 2;
    const b = new T.Mesh(hubBoltGeo, alloy);
    b.position.set(Math.cos(a) * .51, Math.sin(a) * .51, -.26);
    rotor.add(b);
  }
  const indexMark = new T.Mesh(new T.BoxGeometry(.035, .22, .02), accentRingMat);
  indexMark.position.set(0, .31, -.66);
  indexMark.rotation.x = .52;
  rotor.add(indexMark);

  // Merge rotor meshes by material so the entire spinning turbine is 4 draw calls
  mergeStatic(rotor);
  rotor.userData.dynamic = true;
  rotor.traverse(o => { o.userData.dynamic = true; });

  // Dedicated tunnel accent lighting so the turbine blades & nose cone have crisp 3D shading
  const fanKeyLight = new T.DirectionalLight(0xe6f0ff, 1.45);
  fanKeyLight.position.set(-6, 7, 4 + plenum.position.z);
  fanKeyLight.target = fan;
  root.add(fanKeyLight);

  return root;
}
function mergeStatic(root){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),groups=new Map(),objects=[];
 root.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&!o.material.transparent&&!o.material.isShaderMaterial&&!o.parent?.parent?.parent?.userData?.fanMarker&&!o.userData.dynamic&&!o.parent?.userData.dynamic&&!o.parent?.parent?.userData.dynamic){const key=o.material.uuid;if(!groups.has(key))groups.set(key,{material:o.material,geometry:[]});const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld));groups.get(key).geometry.push(g);objects.push(o);}});
 for(const o of objects){o.parent.remove(o);o.geometry.dispose();}
 for(const {material,geometry} of groups.values()){const merged=mergeGeometries(geometry,false);geometry.forEach(g=>g.dispose());if(merged){const mesh=new T.Mesh(merged,material);mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);}}
}
const OUTDOOR_CONFIG = {
 'eau-rouge': { useCloudHdr: true, fogColor: '#c5cdd0', fogNear: 220, fogFar: 950, bgColor: '#c5cdd0', sunPos: [-45, 60, 20], sunColor: 0xfff4dd, sunIntensity: 1.35, envIntensity: 0.65 },
 monza: { useCloudHdr: false, fogColor: '#d2e0ea', fogNear: 260, fogFar: 1050, bgColor: '#8ebae3', sunPos: [65, 88, 95], sunColor: 0xfff3d4, sunIntensity: 1.55, envIntensity: 0.72 },
 silverstone: { useCloudHdr: true, fogColor: '#c4ccd1', fogNear: 210, fogFar: 920, bgColor: '#c4ccd1', sunPos: [-55, 62, 35], sunColor: 0xf6f3ea, sunIntensity: 1.25, envIntensity: 0.68 },
 monaco: { useCloudHdr: false, fogColor: '#bfd9ec', fogNear: 180, fogFar: 820, bgColor: '#5ea1de', sunPos: [50, 95, 72], sunColor: 0xfff8e2, sunIntensity: 1.65, envIntensity: 0.78 },
};
function createStudioBackdropTexture() {
  if (typeof document === 'undefined') return new T.Color('#eceef1');
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#f4f5f7');
  grad.addColorStop(0.58, '#eceef1');
  grad.addColorStop(1.0, '#dfe2e6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.magFilter = T.LinearFilter;
  tex.minFilter = T.LinearFilter;
  return tex;
}

 export class Environments {
 constructor(renderer,envTextures){this.renderer=renderer;const isMap=envTextures&&!envTextures.isTexture;this.studioEnvTexture=isMap?(envTextures.studio||envTextures.wind):envTextures;this.windEnvTexture=isMap?(envTextures.wind||envTextures.studio):envTextures;this.roomTexture=this.windEnvTexture;this.studioBackdrop=createStudioBackdropTexture();this.turntableYaw=0;this.scene=new T.Scene();this.scene.background=new T.Color('#bec9cb');this.scene.add(new T.HemisphereLight(0xdde7eb,0x6b7259,.75));const sun=new T.DirectionalLight(0xfff4dd,1.35);sun.position.set(-45,60,20);this.scene.add(sun);this.sun=sun;sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-180,right:180,top:180,bottom:-180,near:.5,far:450});sun.shadow.bias=-.00025;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;this.kind='studio';this.year=2023;
  this.target=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.target.depthTexture=new T.DepthTexture(640,360);
  this.output=new T.WebGLRenderTarget(640,360,{type:T.HalfFloatType});this.output.texture.colorSpace=T.SRGBColorSpace;this.quadScene=new T.Scene();this.quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  this.blur=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{map:{value:this.target.texture},depthMap:{value:this.target.depthTexture},pixel:{value:new T.Vector2(1/640,1/360)},near:{value:.025},far:{value:700},focusNear:{value:18},focusFar:{value:68},strength:{value:1}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D map,depthMap;uniform vec2 pixel;uniform float near,far,focusNear,focusFar,strength;varying vec2 uv0;void main(){float z=texture2D(depthMap,uv0).x;float d=(near*far)/(far-z*(far-near));float r=smoothstep(focusNear,focusFar,d)*strength*2.6;vec3 c=texture2D(map,uv0).rgb*.28;c+=texture2D(map,uv0+pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(r,0)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0-pixel*vec2(0,r)).rgb*.12;c+=texture2D(map,uv0+pixel*vec2(r,r)).rgb*.11;c+=texture2D(map,uv0-pixel*vec2(r,r)).rgb*.11;gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});this.quadScene.add(new T.Mesh(new T.PlaneGeometry(2,2),this.blur));
  this.depthScene=new T.Scene();this.depthScene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({colorWrite:false,depthWrite:true,depthTest:true,depthFunc:T.AlwaysDepth,uniforms:{depthMap:{value:this.target.depthTexture}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D depthMap;varying vec2 uv0;void main(){gl_FragDepth=texture2D(depthMap,uv0).r;gl_FragColor=vec4(0.);}' })));
  // Outdoor sky/ground radiance replaces indoor studio reflections on track.
  const pmrem=new T.PMREMGenerator(renderer);
  const sky=new T.Scene();sky.background=new T.Color('#b7c7cf');sky.add(new T.HemisphereLight(0xdce7ed,0x526044,2));const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshBasicMaterial({color:'#4a5942'}));ground.rotation.x=-Math.PI/2;ground.position.y=-5;sky.add(ground);this.skyTarget=pmrem.fromScene(sky,.08);
  const sunny=new T.Scene();sunny.background=new T.Color('#7db5e8');sunny.add(new T.HemisphereLight(0xf6f9ff,0x706c58,2.4));const sunG=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshBasicMaterial({color:'#6e6a5a'}));sunG.rotation.x=-Math.PI/2;sunG.position.y=-5;sunny.add(sunG);this.sunnyTarget=pmrem.fromScene(sunny,.06);
  pmrem.dispose();
  this.skyLoaded=false;this.skyLoading=false;
 }
 ensureSkyHdr(){if(this.skyLoaded||this.skyLoading)return;this.skyLoading=true;
  new RGBELoader().load('/environments/spa/cloud-sky.hdr',texture=>{texture.mapping=T.EquirectangularReflectionMapping;this.skyPhoto=texture;const generator=new T.PMREMGenerator(this.renderer),target=generator.fromEquirectangular(texture);generator.dispose();this.skyTarget.dispose();this.skyTarget=target;this.skyLoaded=true;this.skyLoading=false;if(OUTDOOR_CONFIG[this.kind]?.useCloudHdr){this.scene.background=texture;this.scene.environment=target.texture;}},undefined,()=>{this.skyLoading=false;});
 }
 set(kind,year=2023){if(this.kind===kind&&this.root)return;this.kind=kind;this.year=year;const cfg=OUTDOOR_CONFIG[kind];if(cfg?.useCloudHdr)this.ensureSkyHdr();
  if(this.root){this.scene.remove(this.root);this.root.userData.dispose?.();const textures=new Set(),materials=new Set(),geometries=new Set();this.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());}
  this.root=kind==='studio'?new T.Group()
   :kind==='wind'?windTunnel()
   :kind==='monza'?createMonzaScene()
   :kind==='silverstone'?createSilverstoneScene()
   :kind==='monaco'?createMonacoScene()
   :createSpaScene();
  if(!this.root.userData.keepMeshes)mergeStatic(this.root);this.scene.add(this.root);
  if(kind==='wind'&&this.root.userData.turntable)this.root.userData.turntable.rotation.y=this.turntableYaw;
  const envTex=kind==='wind'?this.windEnvTexture:kind==='studio'?this.studioEnvTexture:(cfg&&!cfg.useCloudHdr?this.sunnyTarget.texture:this.skyTarget.texture);
  this.scene.environment=envTex;this.scene.environmentIntensity=kind==='wind'?.85:(cfg?.envIntensity??.65);
  this.scene.fog=kind==='wind'?new T.Fog('#0f151a',22,60):new T.Fog(cfg?.fogColor||'#c5cdd0',cfg?.fogNear||220,cfg?.fogFar||950);
  if(cfg){this.sun.position.set(...cfg.sunPos);this.sun.color.setHex(cfg.sunColor);this.sun.intensity=cfg.sunIntensity;}
  this.sun.castShadow=isTrackEnvironment(kind);this.sun.shadow.needsUpdate=true;this.lastForestReady=false;
  this.scene.background=cfg?.useCloudHdr&&this.skyPhoto?this.skyPhoto:kind==='studio'?this.studioBackdrop:new T.Color(kind==='wind'?'#0f151a':(cfg?.bgColor||'#c5cdd0'));
 }
 setYaw(rad){this.turntableYaw=rad;if(this.kind==='wind'&&this.root?.userData.turntable)this.root.userData.turntable.rotation.y=rad;}
 update(dt,speed,groundSpeed=speed,windAngleDeg=0){
  if(isTrackEnvironment(this.kind)&&this.root?.userData.forestReady&&!this.lastForestReady){this.sun.shadow.needsUpdate=true;this.lastForestReady=true;}
  if(this.kind==='wind'&&this.root?.userData.rotor)this.root.userData.rotor.rotation.z-=dt*speed/35;
  if(this.kind==='wind'&&this.root?.userData.beltTexture)this.root.userData.beltTexture.offset.y=(this.root.userData.beltTexture.offset.y+groundSpeed/3.6*dt/2)%1;
  this.root?.userData.updateDynamic?.(dt,speed,windAngleDeg);
 }
 resize(w,h){const scale=(innerWidth<620?.68:.8)*this.renderer.getPixelRatio();this.target.setSize(Math.round(w*scale),Math.round(h*scale));this.output.setSize(Math.round(w*scale),Math.round(h*scale));this.blur.uniforms.pixel.value.set(1/this.target.width,1/this.target.height);}
 render(camera,main,occlude=true){this.renderer.autoClear=true;if(this.kind==='studio'){main.background=this.studioBackdrop;main.environment=this.studioEnvTexture;return;}const r=this.renderer;const cfg=OUTDOOR_CONFIG[this.kind];r.setRenderTarget(this.target);r.render(this.scene,camera);this.environmentTriangles=r.info.render.triangles;this.environmentCalls=r.info.render.calls;this.blur.uniforms.near.value=camera.near;this.blur.uniforms.far.value=camera.far;this.blur.uniforms.focusNear.value=this.kind==='wind'?18:190;this.blur.uniforms.focusFar.value=this.kind==='wind'?68:440;this.blur.uniforms.strength.value=this.kind==='wind'?.10:.09;r.setRenderTarget(this.output);r.render(this.quadScene,this.quadCamera);r.setRenderTarget(null);if(occlude&&this.kind!=='wind'){r.clear();r.render(this.depthScene,this.quadCamera);r.autoClear=false;}main.background=this.output.texture;main.environment=this.kind==='wind'?this.windEnvTexture:(cfg&&!cfg.useCloudHdr?this.sunnyTarget.texture:this.skyTarget.texture);}
}
