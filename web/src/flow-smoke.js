import * as T from 'three';

const SMOKE_VERT = /* glsl */ `
attribute vec3 sideDir;
attribute float lineAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = lineAlpha;
  vec3 pos = position + sideDir;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const SMOKE_FRAG = /* glsl */ `
uniform float clock;
uniform float opacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float across = exp(-pow(vUv.x * 2.15, 2.0));
  float t = clock - vUv.y;
  float wisp1 = 0.5 + 0.5 * sin(t * 15.0 + vUv.x * 2.4);
  float wisp2 = 0.5 + 0.5 * sin(t * 27.0 - vUv.x * 3.1 + 1.3);
  float puff = 0.72 + 0.28 * (0.65 * wisp1 + 0.35 * wisp2);
  float core = smoothstep(0.05, 0.92, across);
  vec3 col = mix(vec3(0.76, 0.88, 0.98), vec3(0.96, 0.98, 1.0), core);
  float alpha = across * puff * vAlpha * opacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export class FlowSmoke {
  constructor(parent) {
    this.group = new T.Group();
    this.group.name = 'SMOKE_RAKE_FLOW';
    this.group.visible = false;
    parent?.add(this.group);

    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: T.DoubleSide,
      uniforms: {
        clock: { value: 0 },
        opacity: { value: 0.54 },
      },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
    });

    this.geometry = new T.BufferGeometry();
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);

    // Minimal metallic wind-tunnel smoke rake wand at nozzle origin
    const wandGeom = new T.CylinderGeometry(0.008, 0.011, 1.15, 10);
    const wandMat = new T.MeshStandardMaterial({
      color: 0x9aa8b8,
      metalness: 0.75,
      roughness: 0.32,
    });
    this.wand = new T.Mesh(wandGeom, wandMat);
    this.wand.name = 'SMOKE_RAKE_WAND';
    this.wand.visible = false;
    this.group.add(this.wand);
    this.count = 0;
    this.lastKey = null;
  }

  setClock(clock) {
    this.material.uniforms.clock.value = clock;
  }

  clear() {
    this.count = 0;
    this.lastKey = null;
    this.group.visible = false;
  }

  applyResult(result, key = null) {
    if (!result?.attributes?.position?.length) {
      this.count = 0;
      this.lastKey = null;
      this.group.visible = false;
      return;
    }
    const next = new T.BufferGeometry();
    for (const [keyName, array] of Object.entries(result.attributes)) {
      const itemSize = keyName === 'position' || keyName === 'sideDir' ? 3 : keyName === 'uv' ? 2 : 1;
      next.setAttribute(keyName, new T.BufferAttribute(array, itemSize));
    }
    this.geometry.dispose();
    this.geometry = this.mesh.geometry = next;
    this.count = result.lines || 0;
    this.lastKey = key;
    if (result.rakeOrigin) {
      const [rx, ry0, ry1, rz] = result.rakeOrigin;
      const h = Math.max(0.2, ry1 - ry0 + 0.14);
      this.wand.scale.set(1, h / 1.15, 1);
      this.wand.position.set(rx, 0.5 * (ry0 + ry1), rz);
      this.wand.visible = true;
    } else {
      this.wand.visible = false;
    }
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible && this.count > 0);
  }

  dispose() {
    this.geometry?.dispose();
    this.material?.dispose();
    this.wand?.geometry?.dispose();
    this.wand?.material?.dispose();
  }
}
