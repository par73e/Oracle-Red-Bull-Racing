import * as T from 'three';
import {
  addBox,
  buildAlignedRoad,
  createCircuitSurface,
  makeBannerTexture,
  makePbrMat,
  makeRand,
  makeWeatheredPaint,
  solidMat,
} from './circuit-surface.js';

function smoothBump(s, a, b) {
  if (s <= a || s >= b) return 0;
  const u = (s - a) / (b - a);
  return Math.sin(u * Math.PI) ** 1.4;
}

// Silverstone Circuit — Maggotts–Becketts–Chapel High-Speed S-Curves (T10–T13)
// Car sits at T11 Becketts RIGHT-hand apex (kappa < 0 -> bends toward -X),
// lateralOffset = -3.4 m hugging the right-hand black/white kerb,
// matching 260 km/h, -8 deg RIGHT steer, +15 deg crosswind from RIGHT (-X -> +X).
const silverstoneAligned = buildAlignedRoad({
  sMin: -220,
  sMax: 340,
  step: 5,
  anchorS: 0,
  lateralOffset: -3.4,
  headingBiasDeg: -1.5,
  widthFn: () => [6.5, 6.5], // Wide 13.0 m former-airfield F1 circuit
  heightFn: () => 0,
  kappaFn: s => (
    0.0072 * smoothBump(s, -150, -52)    // T10 Maggotts fast LEFT (+X)
    - 0.0080 * smoothBump(s, -58, 46)    // T11 Becketts fast RIGHT (-X) <- Car apex here!
    + 0.0138 * smoothBump(s, 42, 158)    // T12 Becketts tightening LEFT (+X)
    - 0.0092 * smoothBump(s, 154, 270)   // T13 Chapel fast RIGHT (-X) onto Hangar Straight
  ),
});

export const silverstoneSurface = createCircuitSurface(silverstoneAligned.road, { anchorT: silverstoneAligned.anchorT });
export function createSilverstoneShadowGeometry() {
  return silverstoneSurface.createShadowFloorGeometry(0.06);
}

function makeWindsockTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const c = canvas.getContext('2d');
  for (let i = 0; i < 5; i++) {
    c.fillStyle = i % 2 === 0 ? '#eb4c1e' : '#f4f5f2';
    c.fillRect(i * (256 / 5), 0, 256 / 5 + 1, 64);
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function createWindsock(root, pos, phase) {
  const group = new T.Group();
  group.position.copy(pos);
  group.userData.dynamic = true;

  const poleMat = solidMat('#cfd5da', 0.4, 0.72);
  const pole = new T.Mesh(new T.CylinderGeometry(0.045, 0.065, 5.2, 10), poleMat);
  pole.position.y = 2.6;
  pole.castShadow = true;
  pole.userData.dynamic = true;
  group.add(pole);

  const pivot = new T.Group();
  pivot.position.set(0, 5.05, 0);
  pivot.userData.dynamic = true;
  group.add(pivot);

  // Horizontal metal hoop & tapered cloth windsock extending along local +Z
  const hoop = new T.Mesh(new T.TorusGeometry(0.24, 0.018, 8, 16), poleMat);
  hoop.position.z = 0.24;
  hoop.userData.dynamic = true;
  pivot.add(hoop);

  const strut = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.24, 6), poleMat);
  strut.rotation.x = Math.PI / 2;
  strut.position.z = 0.12;
  strut.userData.dynamic = true;
  pivot.add(strut);

  // Tapered open cone oriented along +Z (mouth at z=0.24, tail at z=1.94)
  const coneGeo = new T.CylinderGeometry(0.11, 0.24, 1.7, 14, 4, true);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, 1.09);
  const sockMat = new T.MeshStandardMaterial({
    map: makeWindsockTexture(),
    roughness: 0.78,
    side: T.DoubleSide,
  });
  const sock = new T.Mesh(coneGeo, sockMat);
  sock.castShadow = true;
  sock.userData.dynamic = true;
  pivot.add(sock);

  root.add(group);
  return { pivot, sock, phase };
}

function buildBeckettsGrandstand(root, surface) {
  // Iconic Silverstone Becketts Grandstand overlooking T11/T12 from the LEFT (+X) outside
  const s = surface.sample(0.46);
  const g = new T.Group();
  const basePos = surface.point(s, s.leftWidth + 28, 0);
  g.position.copy(basePos);
  // Orient grandstand to face the S-curve apex
  const yaw = Math.atan2(s.v.x, s.v.z);
  g.rotation.y = yaw;
  root.add(g);

  const darkBlue = solidMat('#142a4f', 0.68, 0.22);
  const white = solidMat('#eceff2', 0.55);
  const concrete = solidMat('#c2c6ca', 0.85);
  const steel = solidMat('#3e4750', 0.45, 0.72);
  const redStrip = solidMat('#d42428', 0.55);
  const seatMat = solidMat('#1b4988', 0.72);

  const L = 96;
  addBox(g, 15, 3.6, L, 6.5, 1.8, 0, darkBlue);
  addBox(g, 0.25, 0.6, L, -1.1, 3.1, 0, redStrip);
  addBox(g, 0.25, 0.4, L, -1.1, 3.55, 0, white);

  const rows = 15, run = 0.8, rise = 0.42;
  for (let r = 0; r < rows; r++) {
    addBox(g, run + 0.08, rise + 0.18, L, -0.8 + r * run, 3.8 + r * rise, 0, concrete);
  }
  const cols = 80;
  const seatMesh = new T.InstancedMesh(new T.BoxGeometry(0.42, 0.36, 0.46), seatMat, rows * cols);
  const dummy = new T.Object3D();
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c % 16 === 8) continue;
      dummy.position.set(-0.75 + r * run, 4.06 + r * rise, -L / 2 + 2.4 + c * 1.16);
      dummy.updateMatrix();
      seatMesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  seatMesh.count = idx;
  g.add(seatMesh);

  const topY = 3.8 + rows * rise;
  addBox(g, 18.5, 0.28, L + 3, 5.2, topY + 4.1, 0, white);
  addBox(g, 0.38, 0.9, L + 3.2, -4.1, topY + 3.9, 0, darkBlue);
  for (let z = -L / 2; z <= L / 2; z += 12) {
    addBox(g, 0.44, topY + 4.4, 0.44, 13.6, (topY + 4.4) * 0.5, z, steel);
    addBox(g, 18.2, 0.58, 0.26, 5.2, topY + 3.65, z, steel);
  }
}

function buildAirfieldBackground(root) {
  // Subtle Northamptonshire WWII airfield hangars & distant hedgerow silhouettes
  const hangarWall = solidMat('#69737b', 0.82, 0.18);
  const hangarRoof = solidMat('#4b545b', 0.72, 0.35);
  const hedgeMat = solidMat('#4a623c', 0.95);

  for (const [x, z, rot] of [[-140, 120, 0.15], [-165, 65, 0.15], [155, -80, -0.2]]) {
    addBox(root, 34, 9.5, 48, x, 4.75, z, hangarWall, rot);
    const roof = new T.Mesh(new T.CylinderGeometry(17, 17, 48.4, 18, 1, false, 0, Math.PI), hangarRoof);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = rot;
    roof.position.set(x, 9.5, z);
    root.add(roof);
  }

  // Distant sparse British tree clusters using real baked foliage textures (no primitive blob spheres!)
  const r = makeRand(91422);
  const placements = [];
  for (let i = 0; i < 180; i++) {
    const ang = r() * Math.PI * 2;
    const rad = 120 + r() * 185;
    const bx = Math.cos(ang) * rad;
    const bz = 55 + Math.sin(ang) * rad;
    const h = silverstoneSurface.roadHeightAt(bx, bz);
    if (h.dist < 52) continue;
    placements.push({ x: bx, z: bz, s: 0.75 + r() * 0.7, a: r() * Math.PI * 2 });
  }
  const texLoader = new T.TextureLoader();
  texLoader.loadAsync('/environments/spa/pine-branches.webp').then(map => {
    if (root.userData.disposed) { map.dispose(); return; }
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 4;
    const pos = [], uv = [], idx = [];
    const cards = [
      [0, 5.2, 0, 7.6, 0, 0],
      [0, 5.2, 0, 7.6, Math.PI / 2, 1],
      [1.8, 3.8, 1.2, 5.6, 0.6, 2],
      [-1.6, 4.1, -1.3, 5.4, 2.1, 0],
    ];
    for (const [cx, cy, cz, sz, ang, tile] of cards) {
      const dx = Math.cos(ang) * sz * 0.5, dz = Math.sin(ang) * sz * 0.5;
      const k = pos.length / 3;
      for (const [x, y, z] of [[-dx, -sz * 0.45, -dz], [dx, -sz * 0.45, dz], [-dx, sz * 0.55, -dz], [dx, sz * 0.55, dz]]) {
        pos.push(cx + x, cy + y, cz + z);
      }
      uv.push(tile / 3, 0, (tile + 1) / 3, 0, tile / 3, 1, (tile + 1) / 3, 1);
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({ map, alphaTest: 0.35, side: T.DoubleSide, roughness: 0.96, color: '#6b8554' });
    const mesh = new T.InstancedMesh(geo, mat, placements.length);
    const dummy = new T.Object3D();
    placements.forEach((p, i) => {
      dummy.position.set(p.x, -0.05, p.z);
      dummy.rotation.set(0, p.a, 0);
      dummy.scale.set(p.s * 1.2, p.s, p.s * 1.2);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    root.add(mesh);
  }).catch(() => {});
}

export function createSilverstoneScene() {
  const root = new T.Group();
  root.name = 'SILVERSTONE_MAGGOTTS_BECKETTS';
  root.userData.keepMeshes = false;

  // Vast flat Northamptonshire airfield grass expanse
  const grass = makePbrMat('leafy_grass', '#7b9950', 0.48);
  grass.map.repeat.set(95, 95);
  grass.normalMap.repeat.set(95, 95);
  const ground = new T.Mesh(new T.PlaneGeometry(920, 920), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.09, 60);
  ground.receiveShadow = true;
  root.add(ground);

  // Asphalt S-curve ribbon with sweeping rubbered F1 racing line across T10 -> T11 -> T12 -> T13
  const roadMat = makePbrMat('asphalt_02', '#5f666c', 0.45);
  roadMat.vertexColors = true;
  const baseCol = new T.Color('#ffffff');
  const rubberCol = new T.Color('#bfc5cb');
  const tmp = new T.Color();
  const roadMesh = new T.Mesh(
    silverstoneSurface.ribbonGeometry(s => -s.rightWidth, s => s.leftWidth, {
      segments: 340,
      uvScale: 3.2,
      colorFn: (s, offset) => {
        // Racing line swings: left apex T10 (+3.8) -> right apex T11 (-3.4) -> left apex T12 (+3.8) -> right apex T13 (-3.5)
        let targetOff = 0;
        if (s.s < -50) targetOff = 3.6 * smoothBump(s.s, -150, -45);
        else if (s.s < 46) targetOff = -3.4 * smoothBump(s.s, -60, 50);
        else if (s.s < 156) targetOff = 3.8 * smoothBump(s.s, 40, 160);
        else targetOff = -3.6 * smoothBump(s.s, 150, 275);
        const d = Math.abs(offset - targetOff);
        const rubber = Math.exp(-(d * d) / 3.2) * 0.85;
        tmp.copy(baseCol).lerp(rubberCol, rubber);
        return '#' + tmp.getHexString();
      },
    }),
    roadMat,
  );
  roadMesh.receiveShadow = true;
  root.add(roadMesh);

  // Crisp white track limit lines
  const whiteLine = solidMat('#ecebe3', 0.82);
  for (const [from, to] of [
    [s => s.leftWidth - 0.14, s => s.leftWidth + 0.02],
    [s => -s.rightWidth - 0.02, s => -s.rightWidth + 0.14],
  ]) {
    const m = new T.Mesh(silverstoneSurface.ribbonGeometry(from, to, { segments: 300, lift: 0.012 }), whiteLine);
    m.receiveShadow = true;
    root.add(m);
  }

  // Iconic Silverstone Black & White sawtooth kerbs on both sides through Maggotts-Becketts-Chapel
  const kerbMat = solidMat('#ffffff', 0.84);
  kerbMat.vertexColors = true;
  const bwKerb = (_s, _off, dist) => (Math.floor(dist / 1.15) % 2 === 0 ? '#1b1f24' : '#f1f2ee');
  for (const sign of [-1, 1]) {
    const m = new T.Mesh(
      silverstoneSurface.ribbonGeometry(
        s => sign * (sign > 0 ? s.leftWidth : s.rightWidth),
        s => sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + 1.15),
        { segments: 280, start: 0.12, end: 0.90, lift: 0.038, colorFn: bwKerb },
      ),
      kerbMat,
    );
    m.receiveShadow = true;
    root.add(m);
  }

  // Green astroturf verge outside kerbs
  const astroMat = solidMat('#168443', 0.9);
  for (const sign of [-1, 1]) {
    const m = new T.Mesh(
      silverstoneSurface.ribbonGeometry(
        s => sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + 1.15),
        s => sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + 2.55),
        { segments: 240, start: 0.14, end: 0.88, lift: 0.016 },
      ),
      astroMat,
    );
    m.receiveShadow = true;
    root.add(m);
  }

  // Silverstone British red/white/blue painted asphalt runoff outside T11/T12 (+X side)
  const runoffBase = makeWeatheredPaint(roadMat, '#373d44');
  const outerRunoff = new T.Mesh(
    silverstoneSurface.ribbonGeometry(s => s.leftWidth + 2.55, s => s.leftWidth + 13.5, { segments: 180, start: 0.25, end: 0.72, lift: 0.002 }),
    runoffBase,
  );
  outerRunoff.receiveShadow = true;
  root.add(outerRunoff);
  for (const [a, b, col] of [
    [3.1, 4.9, '#193b75'],
    [4.9, 5.4, '#f0f1ee'],
    [5.4, 7.2, '#cc2528'],
    [7.2, 7.7, '#f0f1ee'],
    [7.7, 9.5, '#193b75'],
  ]) {
    const stripe = new T.Mesh(
      silverstoneSurface.ribbonGeometry(s => s.leftWidth + a, s => s.leftWidth + b, { segments: 140, start: 0.28, end: 0.70, lift: 0.007 }),
      makeWeatheredPaint(roadMat, col),
    );
    stripe.receiveShadow = true;
    root.add(stripe);
  }

  // Gravel trap on right-side outer exit of T12
  const gravelMat = solidMat('#b5aa94', 0.96);
  const gravel = new T.Mesh(
    silverstoneSurface.ribbonGeometry(s => -s.rightWidth - 11.5, s => -s.rightWidth - 2.55, { segments: 120, start: 0.46, end: 0.78, lift: 0.002 }),
    gravelMat,
  );
  gravel.receiveShadow = true;
  root.add(gravel);

  // Guardrails, debris fences, Tecpro & Silverstone trackside sponsor boards
  silverstoneSurface.addGuardrail(root, 1, { start: 0.04, end: 0.95, extra: 15.0, withFence: true, fenceColor: '#4c5f56' });
  silverstoneSurface.addGuardrail(root, -1, { start: 0.04, end: 0.95, extra: 13.2, withFence: true, fenceColor: '#4c5f56' });
  silverstoneSurface.addTecproWall(root, 1, { start: 0.26, end: 0.72, extra: 13.8, colorA: '#193b75', colorB: '#eef0f3' });
  silverstoneSurface.addTecproWall(root, -1, { start: 0.46, end: 0.78, extra: 12.0, colorA: '#cc2528', colorB: '#eef0f3' });

  const boardMat = new T.MeshStandardMaterial({ map: makeBannerTexture('silverstone'), roughness: 0.56 });
  for (const t of [0.34, 0.42, 0.50, 0.58]) {
    const s = silverstoneSurface.sample(t);
    const p = silverstoneSurface.point(s, s.leftWidth + 14.3, 1.5);
    const yaw = Math.atan2(s.v.x, s.v.z);
    addBox(root, 0.14, 1.4, 8.2, p.x, p.y, p.z, boardMat, yaw);
  }

  buildBeckettsGrandstand(root, silverstoneSurface);
  buildAirfieldBackground(root);
  silverstoneSurface.addCarContactShadow(root);

  // 4 Live Crosswind-Linked Airfield Windsocks flanking T11 & T12!
  const windsocks = [];
  const sockSpecs = [
    [0.37, 1, 14.6, 0.0],
    [0.44, -1, 12.6, 1.7],
    [0.49, 1, 14.6, 3.1],
    [0.57, -1, 12.6, 4.4],
  ];
  for (const [t, sign, extra, phase] of sockSpecs) {
    const s = silverstoneSurface.sample(t);
    const off = sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + extra);
    windsocks.push(createWindsock(root, silverstoneSurface.point(s, off, 0), phase));
  }

  let windTime = 0;
  root.userData.updateDynamic = (dt, speedKmh = 260, windAngleDeg = 15) => {
    windTime += dt;
    const beta = T.MathUtils.degToRad(windAngleDeg || 0);
    const absYaw = Math.abs(windAngleDeg || 0);
    // For +15 deg crosswind (right -> left), sock blows strongly toward +X (car left) with slight -Z component
    const dirX = Math.sin(beta) * 2.4;
    const dirZ = -Math.cos(beta) * (absYaw > 2 ? 0.48 : 1.0);
    const targetYaw = Math.atan2(dirX, dirZ);
    const strength = T.MathUtils.clamp((speedKmh || 0) / 260 * 0.55 + (absYaw / 35) * 0.65, 0.12, 1.15);

    for (const ws of windsocks) {
      const gust = Math.sin(windTime * 4.8 + ws.phase) * 0.08 * strength;
      ws.pivot.rotation.y = targetYaw + gust;
      // Droop gently at low wind, stretch nearly horizontal in strong crosswind
      const droop = T.MathUtils.lerp(0.68, 0.08, Math.min(1, strength));
      ws.sock.rotation.x = droop + Math.sin(windTime * 8.5 + ws.phase * 1.4) * 0.06 * strength;
    }
  };
  // Initialize pose immediately for default Silverstone crosswind
  root.userData.updateDynamic(0, 260, 15);

  root.userData.dispose = () => { root.userData.disposed = true; };
  return root;
}
