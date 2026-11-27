import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  addBox,
  buildAlignedRoad,
  createCircuitSurface,
  createSkyDome,
  makeBannerTexture,
  makeFacadeTexture,
  makePbrMat,
  makeRand,
  makeSignTexture,
  makeWeatheredPaint,
  solidMat,
} from './circuit-surface.js';

const SPA_ASSET = '/environments/spa/';
const textureLoader = new T.TextureLoader();

// Autodromo Nazionale Monza — Rettifilo Tribune (Main DRS Straight into Variante del Rettifilo)
// Car sits at s = 0 on the right-side overtaking line (lateralOffset = -1.6 m, straight +Z)
// matching 345 km/h, 0 deg steer, DRS OPEN.
const monzaAligned = buildAlignedRoad({
  sMin: -210,
  sMax: 390,
  step: 5,
  anchorS: 0,
  lateralOffset: -1.6,
  headingBiasDeg: 0,
  widthFn: () => [5.75, 5.75], // 11.5 m wide main straight
  heightFn: () => 0,
  kappaFn: s => {
    // Straight main straight from -210 m to +285 m, then Variante del Rettifilo (Right-Left chicane)
    if (s < 285) return 0;
    if (s < 328) return -0.022 * Math.sin(((s - 285) / 43) * Math.PI); // T1 right turn (-X)
    if (s < 372) return 0.024 * Math.sin(((s - 328) / 44) * Math.PI);  // T2 left turn (+X)
    return 0;
  },
});

export const monzaSurface = createCircuitSurface(monzaAligned.road, { anchorT: monzaAligned.anchorT });
export function createMonzaShadowGeometry() {
  return monzaSurface.createShadowFloorGeometry(0.06);
}

function buildTribunaCentrale(root, surface) {
  // Iconic Monza Main Grandstand on the LEFT (+X) side of the main straight
  const g = new T.Group();
  const s = surface.sample(surface.anchorT);
  const centerX = s.p.x + s.leftWidth + 14.5;
  g.position.set(centerX, 0, 26);
  root.add(g);

  const concrete = solidMat('#c9ccc6', 0.86);
  const darkBase = solidMat('#23282e', 0.82, 0.16);
  const redTrim = solidMat('#c72520', 0.56);
  const greenTrim = solidMat('#147840', 0.62);
  const white = solidMat('#eef0eb', 0.58);
  const steel = solidMat('#424a52', 0.45, 0.72);
  const roofMat = solidMat('#dce2e6', 0.42, 0.36);
  const seatMat = solidMat('#c8342e', 0.72);

  const L = 190;
  addBox(g, 16, 4.2, L, 6.0, 2.1, 0, darkBase);
  // Italian tricolour grandstand fascia strip facing the straight
  addBox(g, 0.22, 0.7, L, -2.08, 3.85, 0, greenTrim);
  addBox(g, 0.22, 0.7, L, -2.08, 3.15, 0, white);
  addBox(g, 0.22, 0.7, L, -2.08, 2.45, 0, redTrim);

  // Raked concrete tiers
  const rows = 16, run = 0.82, rise = 0.42;
  for (let r = 0; r < rows; r++) {
    addBox(g, run + 0.08, rise + 0.2, L, -1.6 + r * run, 4.3 + r * rise, 0, concrete);
  }

  // Instanced spectator seats
  const cols = 160;
  const seatMesh = new T.InstancedMesh(new T.BoxGeometry(0.42, 0.38, 0.46), seatMat, rows * cols);
  const dummy = new T.Object3D();
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c % 20 === 10) continue;
      dummy.position.set(-1.55 + r * run, 4.58 + r * rise, -L / 2 + 2.2 + c * 1.16);
      dummy.updateMatrix();
      seatMesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  seatMesh.count = idx;
  seatMesh.receiveShadow = true;
  g.add(seatMesh);

  // Cantilevered steel roof canopy
  const topY = 4.3 + rows * rise;
  addBox(g, 20, 0.32, L + 4, 4.8, topY + 4.4, 0, roofMat);
  addBox(g, 0.4, 1.0, L + 4.2, -5.2, topY + 4.2, 0, white);
  addBox(g, 0.45, 0.32, L + 4.2, -5.28, topY + 4.55, 0, redTrim);
  for (let z = -L / 2; z <= L / 2; z += 15.8) {
    addBox(g, 0.48, topY + 4.8, 0.48, 13.8, (topY + 4.8) * 0.5, z, steel);
    addBox(g, 19.6, 0.65, 0.28, 4.8, topY + 3.9, z, steel);
  }
}

function buildPitComplex(root, surface) {
  // Monza Pit Wall, Pit Lane, F1 Garage Complex & Race Control Tower on RIGHT (-X)
  const s = surface.sample(surface.anchorT);
  const pitWallX = s.p.x - s.rightWidth - 1.3;
  const pitLaneWidth = 11.5;
  const garageFrontX = pitWallX - pitLaneWidth - 1.0;

  const concrete = solidMat('#b9bec2', 0.85);
  const darkPanel = solidMat('#232a32', 0.65, 0.28);
  const redAccent = solidMat('#cc2420', 0.52);
  const white = solidMat('#edeff2', 0.55);
  const glass = solidMat('#1a3044', 0.14, 0.65);
  const steel = solidMat('#545d66', 0.45, 0.72);
  const facadeTex = makeFacadeTexture('#dce0e4', '#1f3548', '#b8bfc6', 10, 2);
  const facadeMat = new T.MeshStandardMaterial({ map: facadeTex, roughness: 0.62 });

  // Pit wall separating straight from pit lane
  addBox(root, 0.55, 1.05, 310, pitWallX, 0.52, 42, concrete);
  addBox(root, 0.62, 0.22, 310, pitWallX, 1.08, 42, redAccent);
  // Team pit-wall command stands (canopies along pit wall)
  for (let z = -40; z <= 135; z += 16) {
    addBox(root, 1.6, 0.12, 8.5, pitWallX - 0.9, 2.85, z, darkPanel);
    addBox(root, 0.1, 1.85, 0.1, pitWallX - 0.2, 1.95, z - 3.8, steel);
    addBox(root, 0.1, 1.85, 0.1, pitWallX - 0.2, 1.95, z + 3.8, steel);
  }

  // Pit lane asphalt apron
  const pitAsphalt = makePbrMat('asphalt_02', '#5b6166', 0.35);
  const pitPlane = new T.Mesh(new T.PlaneGeometry(pitLaneWidth + 1.5, 340), pitAsphalt);
  pitPlane.rotation.x = -Math.PI / 2;
  pitPlane.position.set(pitWallX - (pitLaneWidth + 1.5) * 0.5, -0.007, 42);
  pitPlane.receiveShadow = true;
  root.add(pitPlane);

  // Two-storey F1 Pit Building & Paddock Club overhang
  const bLen = 250;
  addBox(root, 18, 10.5, bLen, garageFrontX - 9, 5.25, 42, facadeMat);
  // Dark garage bays along ground floor
  for (let z = -72; z <= 152; z += 12) {
    addBox(root, 0.4, 3.6, 9.2, garageFrontX + 0.1, 1.8, z, darkPanel);
  }
  // Upper Paddock Club canopy & white parapet
  addBox(root, 22, 0.45, bLen + 2, garageFrontX - 8, 10.7, 42, white);
  addBox(root, 0.35, 1.1, bLen + 2, garageFrontX + 3.0, 10.35, 42, redAccent);
  addBox(root, 0.2, 2.6, bLen - 4, garageFrontX + 0.15, 7.2, 42, glass);

  // Race Control & Timing Tower near start/finish line (z = +42)
  addBox(root, 8.5, 19.5, 14, garageFrontX - 3.5, 9.75, 44, white);
  addBox(root, 9.0, 3.8, 14.4, garageFrontX - 3.5, 16.5, 44, glass);
  addBox(root, 9.4, 0.8, 14.8, garageFrontX - 3.5, 19.6, 44, redAccent);
}

function buildGantriesAndMarkers(root, surface) {
  const s0 = surface.sample(surface.anchorT);
  const cx = s0.p.x; // centreline X in aligned coords (+1.6 m)
  const span = s0.leftWidth + s0.rightWidth + 5.6;

  const steel = solidMat('#394148', 0.42, 0.78);
  const lightSteel = solidMat('#c9d0d6', 0.45, 0.55);
  const boxBlack = solidMat('#14181e', 0.55, 0.25);
  const redLens = new T.MeshBasicMaterial({ color: '#e62c28' });
  const whitePaint = solidMat('#eff1ed', 0.84);

  // 1. Start / Finish 5-Light Gantry at z = +44 m
  const gz = 44;
  for (const side of [-1, 1]) {
    const px = cx + side * (span * 0.5);
    addBox(root, 0.75, 8.4, 0.75, px, 4.2, gz, steel);
  }
  addBox(root, span + 1.2, 1.05, 0.9, cx, 7.6, gz, lightSteel);
  // 5 F1 start light pods suspended beneath the gantry
  for (let i = -2; i <= 2; i++) {
    const lx = cx + i * 1.45;
    addBox(root, 0.52, 1.05, 0.36, lx, 6.45, gz - 0.1, boxBlack);
    addBox(root, 0.18, 0.18, 0.08, lx, 6.65, gz - 0.3, redLens);
    addBox(root, 0.18, 0.18, 0.08, lx, 6.28, gz - 0.3, redLens);
  }

  // White Start/Finish checkered band & staggered F1 Grid Boxes on straight
  for (let i = 0; i < 16; i++) {
    const bw = (s0.leftWidth + s0.rightWidth) / 16;
    const x = cx - s0.rightWidth + (i + 0.5) * bw;
    addBox(root, bw, 0.012, 0.7, x, 0.002, gz - 2.0, i % 2 === 0 ? whitePaint : boxBlack);
    addBox(root, bw, 0.012, 0.7, x, 0.002, gz - 2.7, i % 2 === 1 ? whitePaint : boxBlack);
  }
  // Staggered starting grid boxes behind start line
  for (let row = 0; row < 8; row++) {
    const zBox = gz - 12 - row * 16;
    const side = row % 2 === 0 ? 1 : -1;
    const gx = cx + side * 2.55;
    addBox(root, 2.35, 0.012, 0.16, gx, 0.002, zBox, whitePaint);
    addBox(root, 0.16, 0.012, 1.35, gx - 1.1, 0.002, zBox - 0.65, whitePaint);
    addBox(root, 0.16, 0.012, 1.35, gx + 1.1, 0.002, zBox - 0.65, whitePaint);
  }

  // 2. Iconic Monza Overhead Bridge at z = +140 m
  const bz = 140;
  const bannerMat = new T.MeshStandardMaterial({ map: makeBannerTexture('monza'), roughness: 0.5 });
  for (const side of [-1, 1]) {
    addBox(root, 1.3, 9.2, 2.4, cx + side * (span * 0.5 + 1.2), 4.6, bz, steel);
  }
  addBox(root, span + 4.4, 2.45, 2.6, cx, 7.9, bz, bannerMat);

  // 3. Brake Distance Boards (150 / 100 / 50 m) before Variante del Rettifilo (+285 m)
  const poleMat = solidMat('#697178', 0.6, 0.5);
  for (const [dist, zPos] of [['150', 135], ['100', 185], ['50', 235]]) {
    const tex = makeSignTexture('#f4f5f2', '#13171d', dist, 'm');
    const signMat = new T.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    const bx = cx + s0.leftWidth + 2.4;
    addBox(root, 0.12, 1.5, 0.12, bx, 0.75, zPos, poleMat);
    addBox(root, 1.65, 0.95, 0.1, bx, 1.45, zPos, signMat);
  }
}

function loadParcoDiMonzaTrees(root, surface) {
  // Reuse already-shipped mature-pine-lods.glb & canopy textures for the lush Parco di Monza tree wall
  const r = makeRand(77213);
  const placements = [];
  const s0 = surface.sample(surface.anchorT);
  const cx = s0.p.x;
  for (let i = 0; i < (typeof innerWidth !== 'undefined' && innerWidth < 620 ? 320 : 620); i++) {
    const z = -220 + r() * 640;
    const leftSide = r() < 0.55;
    const x = leftSide
      ? cx + 38 + r() * 140
      : cx - 44 - r() * 140;
    placements.push({ x, y: -0.08, z, h: 16 + r() * 11, angle: r() * Math.PI * 2 });
  }
  // Trees framing Variante del Rettifilo ahead
  for (let i = 0; i < 160; i++) {
    const x = cx - 90 + r() * 180;
    const z = 345 + r() * 110;
    placements.push({ x, y: -0.08, z, h: 17 + r() * 9, angle: r() * Math.PI * 2 });
  }

  Promise.all([
    new GLTFLoader().loadAsync(`${SPA_ASSET}mature-pine-lods.glb`),
    fetch(`${SPA_ASSET}pine-branch-centres.json`).then(res => res.json()),
    textureLoader.loadAsync(`${SPA_ASSET}pine-branches.webp`),
  ]).then(([gltf, centres, map]) => {
    if (root.userData.disposed) {
      map.dispose();
      gltf.scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      return;
    }
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 4;
    const pos = [], uv = [], idx = [];
    const cr = makeRand(3104);
    for (const c of centres.far.slice(0, 48)) {
      const ang = cr() * Math.PI, tile = Math.floor(cr() * 3), size = 3.2;
      for (let side = 0; side < 2; side++) {
        const a = ang + side * Math.PI / 2;
        const dx = Math.cos(a) * size * 0.5, dz = Math.sin(a) * size * 0.5;
        const k = pos.length / 3;
        for (const [x, y, z] of [[-dx, -size * 0.5, -dz], [dx, -size * 0.5, dz], [-dx, size * 0.5, -dz], [dx, size * 0.5, dz]]) {
          pos.push(c[0] + x, c[1] + y, c[2] + z);
        }
        uv.push(tile / 3, 0, (tile + 1) / 3, 0, tile / 3, 1, (tile + 1) / 3, 1);
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const canopyGeo = new T.BufferGeometry();
    canopyGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    canopyGeo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    canopyGeo.setIndex(idx);
    canopyGeo.computeVertexNormals();
    const canopyMat = new T.MeshStandardMaterial({
      map,
      alphaTest: 0.35,
      side: T.DoubleSide,
      roughness: 0.96,
      color: '#7da162',
    });
    const trunkGeo = new T.CylinderGeometry(0.1, 0.24, 15, 5, 1);
    trunkGeo.translate(0, 7.5, 0);
    const trunkMat = solidMat('#4e4032', 0.95);

    const canopyMesh = new T.InstancedMesh(canopyGeo, canopyMat, placements.length);
    const trunkMesh = new T.InstancedMesh(trunkGeo, trunkMat, placements.length);
    const dummy = new T.Object3D();
    placements.forEach((p, i) => {
      const sc = p.h / 20.3;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.angle, 0);
      dummy.scale.set(sc * 1.15, sc, sc * 1.15);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);
      trunkMesh.setMatrixAt(i, dummy.matrix);
    });
    canopyMesh.receiveShadow = true;
    root.add(canopyMesh, trunkMesh);
    root.userData.forestReady = true;
  }).catch(() => {});
}

export function createMonzaScene() {
  const root = new T.Group();
  root.name = 'MONZA_MAIN_STRAIGHT';
  root.userData.keepMeshes = false;

  // Warm Italian afternoon sky dome
  root.add(createSkyDome({
    zenith: '#3976c8',
    horizon: '#d8e5ee',
    ground: '#596b47',
    sunDir: new T.Vector3(0.42, 0.56, 0.71),
    sunColor: '#fff1d0',
  }));

  // Flat Parco di Monza parkland ground
  const grass = makePbrMat('leafy_grass', '#7ea352', 0.45);
  grass.map.repeat.set(80, 110);
  grass.normalMap.repeat.set(80, 110);
  const ground = new T.Mesh(new T.PlaneGeometry(760, 920), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.09, 90);
  ground.receiveShadow = true;
  root.add(ground);

  // Main straight + Variante del Rettifilo asphalt ribbon with dual rubbered racing lines
  const roadMat = makePbrMat('asphalt_02', '#646a70', 0.42);
  roadMat.vertexColors = true;
  const baseCol = new T.Color('#ffffff');
  const rubberCol = new T.Color('#c2c7cc');
  const tmp = new T.Color();
  const roadMesh = new T.Mesh(
    monzaSurface.ribbonGeometry(s => -s.rightWidth, s => s.leftWidth, {
      segments: 260,
      uvScale: 3.2,
      colorFn: (s, offset) => {
        // Primary left-hand racing line + secondary overtaking rubber groove
        const g1 = Math.exp(-Math.pow(offset - 1.8, 2) / 2.2) * 0.78;
        const g2 = Math.exp(-Math.pow(offset + 1.6, 2) / 2.5) * 0.55;
        tmp.copy(baseCol).lerp(rubberCol, Math.min(1, g1 + g2));
        return '#' + tmp.getHexString();
      },
    }),
    roadMat,
  );
  roadMesh.receiveShadow = true;
  root.add(roadMesh);

  // Crisp white track limit lines
  const whiteLine = solidMat('#ecebe2', 0.82);
  for (const [from, to] of [
    [s => s.leftWidth - 0.14, s => s.leftWidth + 0.02],
    [s => -s.rightWidth - 0.02, s => -s.rightWidth + 0.14],
  ]) {
    const m = new T.Mesh(monzaSurface.ribbonGeometry(from, to, { segments: 240, lift: 0.012 }), whiteLine);
    m.receiveShadow = true;
    root.add(m);
  }

  // Italian tricolour kerbs (Green / White / Red) into Variante del Rettifilo + left straight verge
  const kerbMat = solidMat('#ffffff', 0.84);
  kerbMat.vertexColors = true;
  const italianKerbColor = (_s, _off, dist) => {
    const phase = Math.floor(dist / 1.4) % 3;
    return phase === 0 ? '#188844' : phase === 1 ? '#f0efe8' : '#cc2420';
  };
  for (const sign of [-1, 1]) {
    const m = new T.Mesh(
      monzaSurface.ribbonGeometry(
        s => sign * (sign > 0 ? s.leftWidth : s.rightWidth),
        s => sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + 1.1),
        { segments: 120, start: 0.72, end: 1.0, lift: 0.038, colorFn: italianKerbColor },
      ),
      kerbMat,
    );
    m.receiveShadow = true;
    root.add(m);
  }

  // Asphalt & gravel runoff apron along left straight verge and chicane
  const runoff = makeWeatheredPaint(roadMat, '#3a4046');
  const leftVerge = new T.Mesh(
    monzaSurface.ribbonGeometry(s => s.leftWidth + 0.05, s => s.leftWidth + 5.2, { segments: 160, start: 0.05, end: 0.98, lift: -0.002 }),
    runoff,
  );
  leftVerge.receiveShadow = true;
  root.add(leftVerge);

  // Guardrails & catch fences
  monzaSurface.addGuardrail(root, 1, { start: 0.02, end: 0.98, extra: 5.3, withFence: true, fenceColor: '#485a50' });
  monzaSurface.addGuardrail(root, -1, { start: 0.78, end: 0.98, extra: 4.5, withFence: true, fenceColor: '#485a50' });
  monzaSurface.addTecproWall(root, 1, { start: 0.78, end: 0.99, extra: 4.3, colorA: '#cc2420', colorB: '#f0efe8' });

  // Iconic Monza structures
  buildTribunaCentrale(root, monzaSurface);
  buildPitComplex(root, monzaSurface);
  buildGantriesAndMarkers(root, monzaSurface);
  monzaSurface.addCarContactShadow(root);
  loadParcoDiMonzaTrees(root, monzaSurface);

  root.userData.dispose = () => { root.userData.disposed = true; };
  return root;
}
