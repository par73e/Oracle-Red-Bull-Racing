import * as T from 'three';

const SPA_ASSET = '/environments/spa/';
const textureLoader = new T.TextureLoader();

export function makeRand(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function solidMat(color, roughness = 0.8, metalness = 0) {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}

export function loadSpaTexture(id, role) {
  const t = textureLoader.load(`${SPA_ASSET}${id}-${role}.jpg`);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 4;
  if (role === 'diff') t.colorSpace = T.SRGBColorSpace;
  return t;
}

export function makePbrMat(id, color = '#ffffff', normalScale = 0.45, roughness = 0.92) {
  return new T.MeshStandardMaterial({
    map: loadSpaTexture(id, 'diff'),
    normalMap: loadSpaTexture(id, 'nor_gl'),
    normalScale: new T.Vector2(normalScale, normalScale),
    color,
    roughness,
  });
}

export function makeWeatheredPaint(baseRoadMat, color) {
  const m = baseRoadMat.clone();
  m.color.set(color);
  m.vertexColors = false;
  m.roughness = 0.94;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  return m;
}

let cachedFenceCanvas = null;
export function makeFenceTexture() {
  if (!cachedFenceCanvas && typeof document !== 'undefined') {
    cachedFenceCanvas = document.createElement('canvas');
    cachedFenceCanvas.width = cachedFenceCanvas.height = 64;
    const c = cachedFenceCanvas.getContext('2d');
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(64, 64);
    c.moveTo(64, 0); c.lineTo(0, 64);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(0, 0, 64, 2);
  }
  const t = new T.CanvasTexture(cachedFenceCanvas || { width: 1, height: 1 });
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeSignTexture(bg, fg, text, sub = '') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = bg;
  c.fillRect(0, 0, 256, 128);
  c.strokeStyle = fg;
  c.lineWidth = 6;
  c.strokeRect(5, 5, 246, 118);
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '800 68px "Helvetica Neue", Arial, sans-serif';
  c.fillText(text, 128, sub ? 54 : 66);
  if (sub) {
    c.font = '700 22px "Helvetica Neue", Arial, sans-serif';
    c.fillText(sub, 128, 102);
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeBannerTexture(palette = 'monza') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext('2d');
  if (palette === 'monza') {
    c.fillStyle = '#0f6b3a'; c.fillRect(0, 0, 170, 128);
    c.fillStyle = '#f2f3ee'; c.fillRect(170, 0, 172, 128);
    c.fillStyle = '#cc2420'; c.fillRect(342, 0, 170, 128);
    c.fillStyle = '#14181e';
    c.font = '800 40px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MONZA', 256, 66);
  } else if (palette === 'silverstone') {
    c.fillStyle = '#142c57'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#d42428'; c.fillRect(0, 96, 512, 32);
    c.fillStyle = '#f4f6f9'; c.fillRect(0, 88, 512, 8);
    c.fillStyle = '#ffffff';
    c.font = '800 38px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SILVERSTONE', 256, 48);
  } else if (palette === 'monaco') {
    c.fillStyle = '#14325c'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#e02826'; c.fillRect(0, 0, 512, 20);
    c.fillStyle = '#f2c144'; c.fillRect(0, 108, 512, 20);
    c.fillStyle = '#ffffff';
    c.font = '800 38px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MONTE-CARLO', 256, 65);
  } else {
    c.fillStyle = '#181e27'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = '#e8b923'; c.fillRect(28, 30, 110, 68);
    c.fillStyle = '#181e27';
    c.font = '900 42px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('F1', 83, 66);
    c.fillStyle = '#edf1f6';
    c.font = '700 34px "Helvetica Neue", Arial, sans-serif';
    c.fillText('GRAND PRIX', 316, 66);
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeFacadeTexture(baseHex, windowHex, trimHex, cols = 8, rows = 6) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d');
  c.fillStyle = baseHex;
  c.fillRect(0, 0, 512, 512);
  const cw = 512 / cols, rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    c.fillStyle = trimHex;
    c.fillRect(0, r * rh + rh - 10, 512, 10);
    for (let col = 0; col < cols; col++) {
      c.fillStyle = windowHex;
      c.fillRect(col * cw + 9, r * rh + 12, cw - 18, rh - 30);
      c.fillStyle = 'rgba(255,255,255,0.14)';
      c.fillRect(col * cw + 11, r * rh + 14, (cw - 22) * 0.35, rh - 34);
    }
  }
  const t = new T.CanvasTexture(canvas);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function addBox(root, w, h, d, x, y, z, material, rotY = 0) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  root.add(m);
  return m;
}

/**
 * Integrates a smooth 3D circuit centreline from curvature kappa(s) and grade(s),
 * then rigidly transforms it so that the car's racing-line point
 * (anchorS, lateralOffset, headingBiasDeg) sits at (0, 0, 0) facing +Z (+X left, +Y up).
 */
export function buildAlignedRoad({
  sMin,
  sMax,
  step = 4,
  kappaFn = () => 0,
  heightFn = () => 0,
  widthFn = () => [5.5, 5.5], // [rightWidth, leftWidth]
  anchorS = 0,
  lateralOffset = 0, // >0 car toward LEFT of centreline, <0 car toward RIGHT
  headingBiasDeg = 0,
}) {
  const count = Math.round((sMax - sMin) / step);
  const raw = [];
  // Integrate forward from s = anchorS and backward from s = anchorS for high numerical stability
  const anchorIdx = Math.max(0, Math.min(count, Math.round((anchorS - sMin) / step)));
  const xs = new Float64Array(count + 1);
  const zs = new Float64Array(count + 1);
  const ths = new Float64Array(count + 1);

  const subSteps = 10;
  for (let i = anchorIdx; i < count; i++) {
    let x = xs[i], z = zs[i], th = ths[i];
    const s0 = sMin + i * step;
    const ds = step / subSteps;
    for (let k = 0; k < subSteps; k++) {
      const sk = s0 + (k + 0.5) * ds;
      th += kappaFn(sk) * ds;
      x += Math.sin(th) * ds;
      z += Math.cos(th) * ds;
    }
    xs[i + 1] = x; zs[i + 1] = z; ths[i + 1] = th;
  }
  for (let i = anchorIdx; i > 0; i--) {
    let x = xs[i], z = zs[i], th = ths[i];
    const s0 = sMin + i * step;
    const ds = step / subSteps;
    for (let k = 0; k < subSteps; k++) {
      const sk = s0 - (k + 0.5) * ds;
      th -= kappaFn(sk) * ds;
      x -= Math.sin(th) * ds;
      z -= Math.cos(th) * ds;
    }
    xs[i - 1] = x; zs[i - 1] = z; ths[i - 1] = th;
  }

  // At anchorIdx: x=0, z=0, th=0 -> rawFwd=(0,0,1), rawLeft=(1,0,0)
  const y0 = heightFn(sMin + anchorIdx * step);
  const bias = T.MathUtils.degToRad(headingBiasDeg);
  const carFwdX = Math.sin(bias), carFwdZ = Math.cos(bias);
  const carLeftX = carFwdZ, carLeftZ = -carFwdX;
  const offX = lateralOffset; // since rawLeft=(1,0,0) at anchor

  for (let i = 0; i <= count; i++) {
    const s = sMin + i * step;
    const dx = xs[i] - offX;
    const dy = heightFn(s) - y0;
    const dz = zs[i];
    const wx = dx * carLeftX + dz * carLeftZ;
    const wz = dx * carFwdX + dz * carFwdZ;
    const [rw, lw] = widthFn(s);
    raw.push([wx, dy, wz, rw, lw, s]);
  }
  return { road: raw, anchorT: anchorIdx / count };
}

/**
 * Reusable metric circuit surface builder (same coordinate contract as spa-surface.js).
 */
export function createCircuitSurface(road, { anchorT = 0.5 } = {}) {
  const curve = new T.CatmullRomCurve3(
    road.map(p => new T.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
  curve.arcLengthDivisions = Math.max(800, road.length * 8);
  const totalLength = curve.getLength();

  function sample(t) {
    const tc = T.MathUtils.clamp(t, 0, 1);
    const p = curve.getPoint(tc);
    const v = curve.getTangent(tc).normalize();
    const left = new T.Vector3(v.z, 0, -v.x).normalize();
    const a = tc * (road.length - 1);
    const i = Math.min(road.length - 2, Math.floor(a));
    const f = a - i;
    return {
      p,
      v,
      left,
      t: tc,
      s: T.MathUtils.lerp(road[i][5] ?? 0, road[i + 1][5] ?? 0, f),
      rightWidth: T.MathUtils.lerp(road[i][3], road[i + 1][3], f),
      leftWidth: T.MathUtils.lerp(road[i][4], road[i + 1][4], f),
    };
  }

  function point(s, offset, lift = 0) {
    const p = s.p.clone().addScaledVector(s.left, offset);
    p.y = s.p.y + lift;
    return p;
  }

  function ribbonGeometry(from, to, {
    segments = Math.max(240, road.length * 3),
    lift = 0,
    start = 0,
    end = 1,
    uvScale = 3,
    colorFn = null,
    colsOverride = null,
  } = {}) {
    const positions = [], uv = [], colors = [], indices = [];
    const first = sample(start);
    const width = Math.abs(
      (typeof to === 'function' ? to(first, start) : to)
      - (typeof from === 'function' ? from(first, start) : from),
    );
    const cols = colsOverride ?? Math.max(1, Math.ceil(width / 1.4));
    let distance = 0, last = null;
    const tmpColor = new T.Color();

    for (let i = 0; i <= segments; i++) {
      const t = T.MathUtils.lerp(start, end, i / segments);
      const s = sample(t);
      if (last) distance += last.distanceTo(s.p);
      last = s.p;
      const a = typeof from === 'function' ? from(s, t) : from;
      const b = typeof to === 'function' ? to(s, t) : to;
      for (let j = 0; j <= cols; j++) {
        const uFrac = j / cols;
        const offset = T.MathUtils.lerp(a, b, uFrac);
        const p = point(s, offset, lift - 0.005);
        positions.push(p.x, p.y, p.z);
        uv.push(offset / uvScale, distance / uvScale);
        if (colorFn) {
          tmpColor.set(colorFn(s, offset, distance, uFrac));
        } else {
          tmpColor.set('#ffffff');
        }
        colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
        if (i < segments && j < cols) {
          const k = i * (cols + 1) + j;
          if (b >= a) {
            indices.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
          } else {
            indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
          }
        }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  /**
   * Computes local track road surface height at arbitrary (x, z) by nearest station projection.
   */
  const denseCount = Math.max(400, road.length * 4);
  const denseStations = Array.from({ length: denseCount }, (_, i) => sample(i / (denseCount - 1)));
  function roadHeightAt(x, z) {
    let best = Infinity, bestS = denseStations[0];
    for (let i = 0; i < denseStations.length; i++) {
      const s = denseStations[i];
      const d = (x - s.p.x) ** 2 + (z - s.p.z) ** 2;
      if (d < best) { best = d; bestS = s; }
    }
    const lat = (x - bestS.p.x) * bestS.left.x + (z - bestS.p.z) * bestS.left.z;
    return { y: bestS.p.y - 0.005, lat, station: bestS, dist: Math.sqrt(best) };
  }

  function addGuardrail(root, sign, {
    start = 0, end = 1, extra = 2.0, withFence = true, fenceColor = '#4c6158',
    railColor = '#9aa1a4', fenceHeight = 2.6,
  } = {}) {
    const metal = solidMat(railColor, 0.44, 0.76);
    metal.side = T.DoubleSide;
    const postMat = solidMat('#5a6266', 0.68, 0.65);
    const positions = [], indices = [];
    const fencePositions = [], fenceUv = [], fenceIndices = [];
    const n = Math.max(24, Math.round((end - start) * totalLength / 3.0));
    const extraAt = (s, t) => (typeof extra === 'function' ? extra(s, t) : extra);
    let vertex = 0, run = 0, prev = null;

    for (let i = 0; i <= n; i++) {
      const t = T.MathUtils.lerp(start, end, i / n);
      const s = sample(t);
      const edge = sign * ((sign > 0 ? s.leftWidth : s.rightWidth) + extraAt(s, t));
      const base = point(s, edge, 0);
      if (i % 2 === 0) {
        addBox(root, 0.11, 1.02, 0.11, base.x, base.y + 0.48, base.z, postMat);
      }
      for (let rail = 0; rail < 3; rail++) {
        for (const dy of [-0.09, 0.09]) {
          positions.push(base.x, base.y + 0.28 + rail * 0.22 + dy, base.z);
        }
      }
      if (i < n) {
        for (let rail = 0; rail < 3; rail++) {
          const k = vertex + rail * 2;
          indices.push(k, k + 1, k + 6, k + 1, k + 7, k + 6);
        }
      }
      vertex += 6;

      if (withFence) {
        const fp = point(s, edge + sign * 0.16, 0);
        if (prev) run += prev.distanceTo(fp);
        prev = fp;
        fencePositions.push(fp.x, fp.y + 1.0, fp.z, fp.x - sign * 0.25 * s.left.x, fp.y + 1.0 + fenceHeight, fp.z - sign * 0.25 * s.left.z);
        fenceUv.push(run / 0.9, 0, run / 0.9, fenceHeight / 0.9);
        if (i < n) {
          const k = i * 2;
          fenceIndices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
        if (i % 2 === 0) {
          addBox(root, 0.075, 1.0 + fenceHeight, 0.075, fp.x, fp.y + (1.0 + fenceHeight) * 0.5, fp.z, postMat);
        }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    root.add(new T.Mesh(g, metal));

    if (withFence && fencePositions.length) {
      const fg = new T.BufferGeometry();
      fg.setAttribute('position', new T.Float32BufferAttribute(fencePositions, 3));
      fg.setAttribute('uv', new T.Float32BufferAttribute(fenceUv, 2));
      fg.setIndex(fenceIndices);
      fg.computeVertexNormals();
      const fm = new T.MeshStandardMaterial({
        map: makeFenceTexture(),
        color: fenceColor,
        roughness: 0.8,
        metalness: 0.35,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
      });
      root.add(new T.Mesh(fg, fm));
    }
  }

  function addTecproWall(root, sign, {
    start = 0, end = 1, extra = 1.6, blockLen = 2.6, height = 1.02, depth = 0.85,
    colorA = '#d22723', colorB = '#eceef0',
  } = {}) {
    const positions = [], colors = [], indices = [];
    const c = new T.Color();
    const n = Math.max(16, Math.round((end - start) * totalLength / 1.8));
    const extraAt = (s, t) => (typeof extra === 'function' ? extra(s, t) : extra);
    let run = 0, v = 0;

    for (let i = 0; i < n; i++) {
      const t0 = T.MathUtils.lerp(start, end, i / n);
      const t1 = T.MathUtils.lerp(start, end, (i + 1) / n);
      const s0 = sample(t0), s1 = sample(t1);
      const e0 = sign * ((sign > 0 ? s0.leftWidth : s0.rightWidth) + extraAt(s0, t0));
      const e1 = sign * ((sign > 0 ? s1.leftWidth : s1.rightWidth) + extraAt(s1, t1));
      const f0 = point(s0, e0), b0 = point(s0, e0 + sign * depth);
      const f1 = point(s1, e1), b1 = point(s1, e1 + sign * depth);
      run += f0.distanceTo(f1);
      c.set(Math.floor(run / blockLen) % 2 === 0 ? colorA : colorB);
      for (const [f, b] of [[f0, b0], [f1, b1]]) {
        for (const [p, y] of [[f, -0.15], [f, height], [b, height], [b, -0.15]]) {
          positions.push(p.x, p.y + y, p.z);
          colors.push(c.r, c.g, c.b);
        }
      }
      for (let face = 0; face < 3; face++) {
        const k = v + face;
        indices.push(k, k + 4, k + 1, k + 1, k + 4, k + 5);
      }
      v += 8;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = solidMat('#ffffff', 0.72);
    m.vertexColors = true;
    m.side = T.DoubleSide;
    const mesh = new T.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }

  function addCarContactShadow(root) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 256;
    const c = canvas.getContext('2d');
    for (const [x, z, rx, rz, alpha] of [
      [0, 0, 0.78, 2.05, 0.24],
      [-0.84, 1.55, 0.28, 0.44, 0.72],
      [0.84, 1.55, 0.28, 0.44, 0.72],
      [-0.84, -1.95, 0.32, 0.46, 0.72],
      [0.84, -1.95, 0.32, 0.46, 0.72],
    ]) {
      c.save();
      c.translate(((x + 2) / 4) * 128, ((z + 3.5) / 7) * 256);
      c.scale((rx / 4) * 128, (rz / 7) * 256);
      const grad = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
    }
    const map = new T.CanvasTexture(canvas);
    const g = new T.PlaneGeometry(4, 7, 8, 24);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), pz = pos.getZ(i);
      const h = roadHeightAt(px, pz);
      pos.setY(i, h.y + 0.008);
    }
    g.computeVertexNormals();
    const m = new T.Mesh(g, new T.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }));
    m.renderOrder = 2;
    root.add(m);
  }

  function createShadowFloorGeometry(spanFrac = 0.08) {
    return ribbonGeometry(
      s => -s.rightWidth - 1.2,
      s => s.leftWidth + 1.2,
      {
        start: Math.max(0, anchorT - spanFrac),
        end: Math.min(1, anchorT + spanFrac),
        segments: 72,
        lift: 0.004,
      },
    );
  }

  return {
    road,
    curve,
    totalLength,
    anchorT,
    sample,
    point,
    ribbonGeometry,
    roadHeightAt,
    addGuardrail,
    addTecproWall,
    addCarContactShadow,
    createShadowFloorGeometry,
  };
}

/**
 * Lightweight procedural sky dome shader (zero external assets) for sunlit circuits.
 */
export function createSkyDome({
  zenith = '#3c77c4',
  horizon = '#c9dff0',
  ground = '#5b6750',
  sunDir = new T.Vector3(-0.45, 0.55, 0.7).normalize(),
  sunColor = '#fff4da',
} = {}) {
  const mat = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new T.Color(zenith) },
      horizon: { value: new T.Color(horizon) },
      ground: { value: new T.Color(ground) },
      sunDir: { value: sunDir.clone().normalize() },
      sunColor: { value: new T.Color(sunColor) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith, horizon, ground, sunDir, sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h >= 0.0
          ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.52))
          : mix(horizon, ground, pow(clamp(-h * 3.0, 0.0, 1.0), 0.7));
        float sunAmt = max(dot(d, sunDir), 0.0);
        col += sunColor * (0.28 * pow(sunAmt, 24.0) + 0.55 * pow(sunAmt, 260.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new T.Mesh(new T.SphereGeometry(560, 28, 16), mat);
  dome.userData.dynamic = true;
  dome.renderOrder = -10;
  return dome;
}
