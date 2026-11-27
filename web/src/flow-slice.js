import * as T from 'three';

const SLICE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SLICE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.02) discard;
  vec2 edge = smoothstep(0.0, 0.035, vUv) * smoothstep(1.0, 0.965, vUv);
  float border = edge.x * edge.y;
  gl_FragColor = vec4(c.rgb, c.a * opacity * border);
}
`;

export class FlowSlice {
  constructor(parent) {
    this.group = new T.Group();
    this.group.name = 'PIV_LASER_SLICE';
    this.group.visible = false;
    parent?.add(this.group);

    this.texture = new T.DataTexture(new Uint8Array(4), 1, 1, T.RGBAFormat);
    this.texture.minFilter = T.LinearFilter;
    this.texture.magFilter = T.LinearFilter;
    this.texture.wrapS = T.ClampToEdgeWrapping;
    this.texture.wrapT = T.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: T.DoubleSide,
      uniforms: {
        map: { value: this.texture },
        opacity: { value: 0.86 },
      },
      vertexShader: SLICE_VERT,
      fragmentShader: SLICE_FRAG,
    });

    this.mesh = new T.Mesh(new T.PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'PIV_SLICE_PLANE';
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);

    const frameGeom = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-0.5, -0.5, 0),
      new T.Vector3(0.5, -0.5, 0),
      new T.Vector3(0.5, 0.5, 0),
      new T.Vector3(-0.5, 0.5, 0),
    ]);
    this.frame = new T.LineLoop(
      frameGeom,
      new T.LineBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.frame.renderOrder = 3;
    this.mesh.add(this.frame);
    this.lastBounds = null;
    this.hasData = false;
  }

  clear() {
    this.hasData = false;
    this.lastBounds = null;
    this.group.visible = false;
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible && this.hasData && this.lastBounds);
  }

  applyResult(result) {
    if (!result?.rgba || !result.width || !result.height) {
      this.hasData = false;
      this.group.visible = false;
      return;
    }
    const { axis, position, width, height, bounds, rgba } = result;
    const data = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
    if (this.texture.image.width !== width || this.texture.image.height !== height) {
      this.texture.dispose();
      this.texture = new T.DataTexture(data, width, height, T.RGBAFormat);
      this.texture.minFilter = T.LinearFilter;
      this.texture.magFilter = T.LinearFilter;
      this.texture.wrapS = T.ClampToEdgeWrapping;
      this.texture.wrapT = T.ClampToEdgeWrapping;
      this.material.uniforms.map.value = this.texture;
    } else {
      this.texture.image.data.set(data);
    }
    this.texture.needsUpdate = true;
    this.lastBounds = bounds;
    this.hasData = true;

    // Position and orient PlaneGeometry (local +X = texture U, local +Y = texture V)
    const uSpan = bounds.uMax - bounds.uMin;
    const vSpan = bounds.vMax - bounds.vMin;
    const uMid = 0.5 * (bounds.uMin + bounds.uMax);
    const vMid = 0.5 * (bounds.vMin + bounds.vMax);
    this.mesh.scale.set(uSpan, vSpan, 1);

    if (axis === 'x') {
      // U = display Z, V = display Y at constant display X = position
      // Local +X -> world +Z requires rotY = -PI/2
      this.mesh.rotation.set(0, -Math.PI / 2, 0);
      this.mesh.position.set(position, vMid, uMid);
    } else if (axis === 'z') {
      // U = display X, V = display Y at constant display Z = position
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.set(uMid, vMid, position);
    } else {
      // axis === 'y': U = display X, V = display Z at constant display Y = position
      // Local +Y -> world +Z requires rotX = +PI/2
      this.mesh.rotation.set(Math.PI / 2, 0, 0);
      this.mesh.position.set(uMid, position, vMid);
    }
    this.mesh.updateMatrixWorld(true);
    this.group.visible = true;
  }

  dispose() {
    this.texture?.dispose();
    this.mesh.geometry?.dispose();
    this.material?.dispose();
    this.frame.geometry?.dispose();
    this.frame.material?.dispose();
  }
}
