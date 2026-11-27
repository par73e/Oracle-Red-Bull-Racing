import * as T from 'three';
import {
  addBox,
  buildAlignedRoad,
  createCircuitSurface,
  createSkyDome,
  makeBannerTexture,
  makeFacadeTexture,
  makePbrMat,
  makeRand,
  solidMat,
} from './circuit-surface.js';

// Smooth plateau curvature for Monaco Fairmont Hairpin (Turn 6):
// 180-deg LEFT turn (+X), centreline R = 12.6 m.
// Car sits at apex s = 0 with lateralOffset = +1.8 m (inner left line -> actual path R = 10.8 m,
// matching F1 full-lock +18 deg Ackermann radius 10.83 m!), 50 km/h, +18 deg LEFT steer.
function monacoKappa(s) {
  const half = 22.8;
  const ramp = 6.5;
  const absS = Math.abs(s);
  if (absS >= half) return 0;
  const peak = 1 / 12.6; // integral over [-22.8, 22.8] with 6.5m cosine ramps = (45.6 - 6.5)/12.6 = 3.103 rad (~178 deg!)
  if (absS <= half - ramp) return peak;
  const u = (half - absS) / ramp;
  return peak * 0.5 * (1 - Math.cos(u * Math.PI));
}

// Mirabeau Haute downhill (-5.5%) -> smooth level contact patch across [-4.5, +4.5] m -> Portier downhill (-4.5%)
function monacoHeight(s) {
  const flat = 4.2;
  const blend = 10.0;
  if (Math.abs(s) <= flat) return 0;
  if (s < -flat) {
    const d = -s - flat;
    const t = Math.min(1, d / blend);
    const ramp = t * t * (3 - 2 * t);
    // Smoothly ramp slope from 0 to +0.055 uphill behind the car
    const integral = d < blend ? 0.055 * (d * ramp * 0.5) : 0.055 * (blend * 0.5 + (d - blend));
    return integral;
  }
  const d = s - flat;
  const t = Math.min(1, d / blend);
  const ramp = t * t * (3 - 2 * t);
  const integral = d < blend ? -0.045 * (d * ramp * 0.5) : -0.045 * (blend * 0.5 + (d - blend));
  return integral;
}

const monacoAligned = buildAlignedRoad({
  sMin: -116,
  sMax: 124,
  step: 2, // Fine 2m stations for ultra-smooth 12.6 m radius 180-deg street hairpin
  anchorS: 0,
  lateralOffset: 1.8, // Hug inner LEFT (+X) apex curb
  headingBiasDeg: 0,
  widthFn: s => {
    const widen = Math.exp(-(s * s) / 380) * 0.55;
    return [4.6 + widen, 4.6 + widen]; // 9.2 m street widening to 10.3 m through hairpin apex
  },
  heightFn: monacoHeight,
  kappaFn: monacoKappa,
});

export const monacoSurface = createCircuitSurface(monacoAligned.road, { anchorT: monacoAligned.anchorT });
export function createMonacoShadowGeometry() {
  return monacoSurface.createShadowFloorGeometry(0.05);
}

function addPalmTree(root, x, y, z, scale = 1, rotY = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  const trunkMat = solidMat('#7a6248', 0.92);
  const frondMat = solidMat('#3e7838', 0.82);
  frondMat.side = T.DoubleSide;

  // Gently curved segmented palm trunk
  let curX = 0, curY = 0;
  for (let i = 0; i < 6; i++) {
    const lean = 0.06 * i;
    const seg = new T.Mesh(new T.CylinderGeometry(0.18 - i * 0.014, 0.21 - i * 0.014, 0.92, 7), trunkMat);
    seg.position.set(curX + lean * 0.5, curY + 0.45, 0);
    seg.rotation.z = -lean * 0.55;
    seg.castShadow = true;
    g.add(seg);
    curX += lean * 0.45;
    curY += 0.88;
  }

  // Crown of 9 arching Mediterranean palm fronds
  const frondGeo = new T.PlaneGeometry(0.52, 2.55, 1, 5);
  const pos = frondGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i) + 1.275; // 0..2.55
    const f = py / 2.55;
    pos.setX(i, pos.getX(i) * Math.sin(f * Math.PI));
    pos.setY(i, py * 0.72 - f * f * 0.78);
    pos.setZ(i, f * 1.95);
  }
  frondGeo.computeVertexNormals();
  for (let i = 0; i < 9; i++) {
    const f = new T.Mesh(frondGeo, frondMat);
    f.position.set(curX, curY, 0);
    f.rotation.y = (i / 9) * Math.PI * 2;
    f.castShadow = true;
    g.add(f);
  }
  root.add(g);
}

function buildHairpinIsland(root, surface) {
  // Iconic semicircular stone planter island on the INSIDE (+X) of Fairmont Hairpin
  const apex = surface.sample(surface.anchorT);
  // Hairpin centre sits ~12.6 m to the LEFT (+X) of the centreline at apex
  const center = surface.point(apex, 12.6, 0);
  const stoneMat = solidMat('#d8d2c3', 0.86);
  const curbTrim = solidMat('#eceae2', 0.82);
  const soilMat = solidMat('#504233', 0.95);
  const shrubMat = solidMat('#3d6f36', 0.88);
  const flowerMat = solidMat('#d64545', 0.78);

  // Raised semicircular island plinth neatly inside the R=6.8 m inner curb
  const base = new T.Mesh(new T.CylinderGeometry(5.6, 5.9, 0.72, 28), stoneMat);
  base.position.set(center.x, center.y + 0.3, center.z);
  base.receiveShadow = true;
  base.castShadow = true;
  root.add(base);

  const lip = new T.Mesh(new T.TorusGeometry(5.65, 0.14, 8, 28), curbTrim);
  lip.rotation.x = Math.PI / 2;
  lip.position.set(center.x, center.y + 0.68, center.z);
  root.add(lip);

  const bed = new T.Mesh(new T.CylinderGeometry(5.35, 5.35, 0.1, 24), soilMat);
  bed.position.set(center.x, center.y + 0.66, center.z);
  root.add(bed);

  // Elongated central island planter stretching back between Mirabeau entry & Portier exit
  addBox(root, 10.6, 0.78, 34, center.x, center.y + 0.25, center.z - 20, stoneMat);

  // Mediterranean palm trees & lush shrubs on the hairpin island
  addPalmTree(root, center.x - 1.4, center.y + 0.68, center.z + 1.2, 1.05, 0.4);
  addPalmTree(root, center.x + 1.8, center.y + 0.68, center.z - 0.8, 0.92, 2.3);
  addPalmTree(root, center.x - 0.4, center.y + 0.68, center.z - 5.5, 1.15, 4.1);
  addPalmTree(root, center.x + 0.8, center.y + 0.68, center.z - 14.0, 1.0, 1.2);

  const r = makeRand(40619);
  for (let i = 0; i < 22; i++) {
    const ang = r() * Math.PI * 2;
    const rad = 1.1 + r() * 3.7;
    const bush = new T.Mesh(new T.DodecahedronGeometry(0.45 + r() * 0.42, 1), i % 5 === 0 ? flowerMat : shrubMat);
    bush.position.set(center.x + Math.cos(ang) * rad, center.y + 0.86, center.z + Math.sin(ang) * rad);
    bush.scale.set(1.2, 0.75, 1.2);
    bush.castShadow = true;
    root.add(bush);
  }
}

function buildFairmontAndMonteCarlo(root, surface) {
  const apex = surface.sample(surface.anchorT);
  const center = surface.point(apex, 12.6, 0);

  const hotelCream = solidMat('#ece2ce', 0.78);
  const warmStone = solidMat('#dfd2b8', 0.82);
  const terracotta = solidMat('#c76e4a', 0.86);
  const glass = solidMat('#1b3346', 0.14, 0.6);
  const balconyRail = solidMat('#f3f1ea', 0.62);
  const colonnadeDark = solidMat('#292c30', 0.84);
  const lampPost = solidMat('#252d34', 0.45, 0.75);

  const hotelFacade = new T.MeshStandardMaterial({
    map: makeFacadeTexture('#ede3cf', '#233a4c', '#d7cbb4', 8, 5),
    roughness: 0.72,
  });
  const aptFacadeA = new T.MeshStandardMaterial({
    map: makeFacadeTexture('#e6cba8', '#263949', '#d2b48e', 6, 6),
    roughness: 0.76,
  });
  const aptFacadeB = new T.MeshStandardMaterial({
    map: makeFacadeTexture('#efe6d8', '#2a4152', '#d6ccbc', 7, 5),
    roughness: 0.74,
  });

  // 1. Iconic Fairmont Monte Carlo Hotel wrapping the OUTER hairpin arc (-X and +Z ahead of car!)
  // Built as 5 curved architectural bays with ground-floor arched colonnade + horizontal white balcony bands
  const outerRadius = 28.5;
  for (let i = -2; i <= 2; i++) {
    const theta = i * 0.42; // spans around the outer curve facing the apex
    const bx = center.x - Math.cos(theta) * outerRadius;
    const bz = center.z + Math.sin(theta) * outerRadius;
    const rotY = -theta;
    const bGroup = new T.Group();
    bGroup.position.set(bx, -1.5, bz);
    bGroup.rotation.y = rotY;

    // Main cream facade wing
    addBox(bGroup, 14, 24, 15.5, -4, 12, 0, hotelFacade);
    // Ground-floor dark portico / entrance arcade
    addBox(bGroup, 3.2, 4.4, 14.8, 2.2, 2.2, 0, colonnadeDark);
    for (let pz = -6; pz <= 6; pz += 3) {
      addBox(bGroup, 0.65, 4.6, 0.65, 3.6, 2.3, pz, warmStone);
    }
    // Signature Fairmont horizontal white cantilevered balcony slabs
    for (let floor = 1; floor <= 6; floor++) {
      addBox(bGroup, 2.6, 0.55, 15.8, 3.5, 4.5 + floor * 3.1, 0, balconyRail);
    }
    addBox(bGroup, 15.2, 1.1, 16.0, -3.5, 24.4, 0, hotelCream);
    root.add(bGroup);
  }

  // 2. Stepped Monte Carlo hillside apartments flanking the Mirabeau descent (-Z) and Portier exit
  const buildings = [
    // Right side of Mirabeau descent (-X, -Z)
    [-22, 1.5, -36, 16, 28, 26, aptFacadeA, 0, terracotta],
    [-23, 3.5, -68, 18, 32, 28, aptFacadeB, 0, terracotta],
    // Above the hairpin hillside (+X, -Z behind island)
    [36, 2.0, -42, 18, 34, 28, aptFacadeB, 0.08, terracotta],
    [38, 0.0, -8, 16, 26, 26, aptFacadeA, -0.05, warmStone],
    [34, -2.5, 28, 18, 22, 24, aptFacadeB, -0.15, terracotta],
    // Far Monte Carlo high-rise skyline behind hotel
    [-46, 2.0, -18, 22, 46, 24, aptFacadeB, 0.12, hotelCream],
    [-42, -1.0, 26, 20, 38, 22, aptFacadeA, -0.1, hotelCream],
  ];
  for (const [x, y, z, w, h, d, fMat, ry, roofMat] of buildings) {
    addBox(root, w, h, d, x, y + h * 0.5 - 3, z, fMat, ry);
    addBox(root, w + 0.6, 0.9, d + 0.6, x, y + h - 2.6, z, roofMat, ry);
    addBox(root, w * 0.65, 1.8, d * 0.65, x, y + h - 1.5, z, glass, ry);
  }

  // 3. Monaco street lamp posts & blue/gold trackside boards along the tight street walls
  const boardMat = new T.MeshStandardMaterial({ map: makeBannerTexture('monaco'), roughness: 0.52 });
  for (let i = 0; i < 8; i++) {
    const t = 0.28 + i * 0.062;
    const s = surface.sample(t);
    const p = surface.point(s, -s.rightWidth - 1.25, 0);
    const yaw = Math.atan2(s.v.x, s.v.z);
    addBox(root, 0.14, 1.15, 5.4, p.x, p.y + 1.45, p.z, boardMat, yaw);
    if (i % 2 === 0) {
      addBox(root, 0.12, 6.4, 0.12, p.x - s.left.x * 0.4, p.y + 3.2, p.z - s.left.z * 0.4, lampPost);
      addBox(root, 1.2, 0.14, 0.24, p.x + s.left.x * 0.2, p.y + 6.35, p.z + s.left.z * 0.2, balconyRail, yaw);
    }
  }

  // 4. Glimpse of sparkling Mediterranean Sea below the coastal promenade
  const seaMat = new T.MeshStandardMaterial({ color: '#1b6ca8', roughness: 0.22, metalness: 0.35 });
  const sea = new T.Mesh(new T.PlaneGeometry(700, 500), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-140, -14.5, 160);
  root.add(sea);
}

function buildContouredCityGround(root, surface) {
  // Contoured urban pavement/hillside mesh that stays strictly >= 0.12 m below the sloping road at every station
  const nx = 44, nz = 44;
  const xMin = -140, xMax = 140, zMin = -160, zMax = 120;
  const positions = [], colors = [], indices = [];
  const stoneCol = new T.Color('#8e8b82');
  const gardenCol = new T.Color('#5a7545');
  const tmp = new T.Color();

  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = T.MathUtils.lerp(xMin, xMax, i / nx);
      const z = T.MathUtils.lerp(zMin, zMax, j / nz);
      const h = surface.roadHeightAt(x, z);
      // Stay cleanly beneath paved street; slope down toward sea in far -X/+Z
      const seaSlope = T.MathUtils.smoothstep(z, 35, 110) * -9.0;
      const y = h.dist < 16 ? h.y - 0.16 : Math.min(h.y - 0.18, h.y - 0.2 + seaSlope);
      positions.push(x, y, z);
      tmp.copy(stoneCol).lerp(gardenCol, T.MathUtils.smoothstep(h.dist, 12, 34) * 0.45);
      colors.push(tmp.r, tmp.g, tmp.b);
      if (i < nx && j < nz) {
        const k = j * (nx + 1) + i;
        indices.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = solidMat('#ffffff', 0.92);
  m.vertexColors = true;
  const mesh = new T.Mesh(g, m);
  mesh.receiveShadow = true;
  root.add(mesh);
}

export function createMonacoScene() {
  const root = new T.Group();
  root.name = 'MONACO_FAIRMONT_HAIRPIN';
  root.userData.keepMeshes = false;

  // Bright Mediterranean blue sky dome & crisp sunlight
  root.add(createSkyDome({
    zenith: '#1e64ba',
    horizon: '#bdddf5',
    ground: '#4a6880',
    sunDir: new T.Vector3(0.35, 0.72, 0.58),
    sunColor: '#fff7e0',
  }));

  buildContouredCityGround(root, monacoSurface);

  // Street circuit asphalt ribbon with heavy braking/full-lock apex rubber mark
  const roadMat = makePbrMat('asphalt_02', '#5b6168', 0.44);
  roadMat.vertexColors = true;
  const baseCol = new T.Color('#ffffff');
  const rubberCol = new T.Color('#b6bcc2');
  const tmp = new T.Color();
  const roadMesh = new T.Mesh(
    monacoSurface.ribbonGeometry(s => -s.rightWidth, s => s.leftWidth, {
      segments: 300,
      uvScale: 2.8,
      colorFn: (s, offset) => {
        const apexBias = Math.exp(-(s.s * s.s) / 550) * 1.8;
        const d = Math.abs(offset - apexBias);
        const rubber = Math.exp(-(d * d) / 2.6) * 0.82;
        tmp.copy(baseCol).lerp(rubberCol, rubber);
        return '#' + tmp.getHexString();
      },
    }),
    roadMat,
  );
  roadMesh.receiveShadow = true;
  root.add(roadMesh);

  // Crisp street white limit lines
  const whiteLine = solidMat('#efeee6', 0.82);
  for (const [from, to] of [
    [s => s.leftWidth - 0.13, s => s.leftWidth + 0.02],
    [s => -s.rightWidth - 0.02, s => -s.rightWidth + 0.13],
  ]) {
    const m = new T.Mesh(monacoSurface.ribbonGeometry(from, to, { segments: 260, lift: 0.012 }), whiteLine);
    m.receiveShadow = true;
    root.add(m);
  }

  // Iconic Monaco Red & White low street kerbs around the inner hairpin & outer entry/exit
  const kerbMat = solidMat('#ffffff', 0.82);
  kerbMat.vertexColors = true;
  const rwKerb = (_s, _off, dist) => (Math.floor(dist / 0.95) % 2 === 0 ? '#d22420' : '#f4f3ee');
  const innerKerb = new T.Mesh(
    monacoSurface.ribbonGeometry(s => s.leftWidth, s => s.leftWidth + 0.78, { segments: 220, start: 0.25, end: 0.75, lift: 0.036, colorFn: rwKerb }),
    kerbMat,
  );
  innerKerb.receiveShadow = true;
  root.add(innerKerb);

  // Sidewalk pavement strip behind tight street barriers
  const sidewalkMat = solidMat('#cbc5b7', 0.88);
  const outerSidewalk = new T.Mesh(
    monacoSurface.ribbonGeometry(s => -s.rightWidth - 3.6, s => -s.rightWidth - 0.04, { segments: 220, start: 0.05, end: 0.95, lift: 0.04 }),
    sidewalkMat,
  );
  outerSidewalk.receiveShadow = true;
  root.add(outerSidewalk);

  // Zero-margin Monaco street circuit Armco + Tecpro + Catch Fence right along the road edge!
  monacoSurface.addGuardrail(root, -1, { start: 0.02, end: 0.98, extra: 0.65, withFence: true, fenceColor: '#4e5d66', fenceHeight: 2.8 });
  monacoSurface.addTecproWall(root, -1, { start: 0.34, end: 0.66, extra: 0.25, blockLen: 2.0, height: 0.96, depth: 0.55, colorA: '#1c4f9c', colorB: '#f2f4f7' });
  monacoSurface.addGuardrail(root, 1, { start: 0.02, end: 0.98, extra: 0.95, withFence: false });

  buildHairpinIsland(root, monacoSurface);
  buildFairmontAndMonteCarlo(root, monacoSurface);
  monacoSurface.addCarContactShadow(root);

  root.userData.dispose = () => { root.userData.disposed = true; };
  return root;
}
