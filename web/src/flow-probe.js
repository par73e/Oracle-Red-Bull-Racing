import * as T from 'three';

const _ndc = new T.Vector2();
const _world = new T.Vector3();
const _local = new T.Vector3();
const _invMat = new T.Matrix4();
const _plane = new T.Plane();
const _hit = new T.Vector3();
const _dir = new T.Vector3();

export class FlowProbe {
  constructor(parent, overlayEl) {
    this.parent = parent;
    this.overlay = overlayEl;
    this.enabled = false;
    this.pinned = false;
    this.pinnedPoint = null;
    this.lastResult = null;
    this.raycaster = new T.Raycaster();
    this.raycaster.firstHitOnly = true;

    this.group = new T.Group();
    this.group.name = 'VIRTUAL_PITOT_PROBE';
    this.group.visible = false;
    parent?.add(this.group);

    // Glowing ring marker
    const ring = new T.Mesh(
      new T.RingGeometry(0.028, 0.046, 24),
      new T.MeshBasicMaterial({ color: 0x38e8ff, side: T.DoubleSide, transparent: true, opacity: 0.92, depthTest: false }),
    );
    ring.renderOrder = 10;
    this.ring = ring;
    this.group.add(ring);

    const core = new T.Mesh(
      new T.SphereGeometry(0.016, 12, 12),
      new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    core.renderOrder = 11;
    this.group.add(core);

    this.arrow = new T.ArrowHelper(new T.Vector3(0, 0, -1), new T.Vector3(0, 0, 0), 0.35, 0xff5a57, 0.09, 0.055);
    this.arrow.renderOrder = 10;
    this.group.add(this.arrow);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.pinned = false;
      this.pinnedPoint = null;
      this.lastResult = null;
      this.group.visible = false;
      if (this.overlay) this.overlay.hidden = true;
    }
  }

  unpin() {
    this.pinned = false;
    this.pinnedPoint = null;
  }

  pickPoint({ clientX, clientY, domElement, camera, rig, slice }) {
    if (!this.enabled || !domElement || !camera) return null;
    const rect = domElement.getBoundingClientRect();
    _ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(_ndc, camera);
    this.parent.updateMatrixWorld(true);
    _invMat.copy(this.parent.matrixWorld).invert();

    // 1. Prefer intersecting active PIV slice plane (WYSIWYG probing!)
    if (slice?.group?.visible) {
      const hits = this.raycaster.intersectObject(slice.mesh, false);
      if (hits.length) {
        _local.copy(hits[0].point).applyMatrix4(_invMat);
        return [_local.x, _local.y, _local.z];
      }
    }

    // 2. Intersect car mesh and offset +5 cm along outward surface normal into fluid domain
    if (rig?.model) {
      const hits = this.raycaster.intersectObject(rig.model, true);
      if (hits.length) {
        const hit = hits[0];
        _world.copy(hit.point);
        if (hit.face?.normal) {
          _dir.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
          _world.addScaledVector(_dir, 0.055);
        } else {
          _world.y += 0.055;
        }
        _local.copy(_world).applyMatrix4(_invMat);
        return [_local.x, Math.max(0.04, _local.y), _local.z];
      }
    }

    // 3. Fallback horizontal mid-car plane (y = 0.48 m) in world space
    _plane.setFromNormalAndCoplanarPoint(new T.Vector3(0, 1, 0), new T.Vector3(0, 0.48, 0));
    if (this.raycaster.ray.intersectPlane(_plane, _hit)) {
      _local.copy(_hit).applyMatrix4(_invMat);
      if (Math.abs(_local.x) <= 4.4 && _local.z >= -8.8 && _local.z <= 5.4) {
        return [_local.x, 0.48, _local.z];
      }
    }
    return null;
  }

  applyResult(result, refSpeedMps) {
    if (!this.enabled) return;
    if (!result?.valid) {
      if (!this.pinned) {
        this.group.visible = false;
        if (this.overlay) this.overlay.hidden = true;
      }
      return;
    }
    this.lastResult = { ...result, refSpeedMps };
    const [x, y, z] = result.point;
    this.group.position.set(x, y, z);
    const [vx, vy, vz] = result.velocity;
    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-4) {
      _dir.set(vx / len, vy / len, vz / len);
      this.arrow.setDirection(_dir);
      const arrowLen = T.MathUtils.clamp(0.18 + (len / Math.max(refSpeedMps, 10)) * 0.28, 0.18, 0.56);
      this.arrow.setLength(arrowLen, 0.085, 0.048);
      this.arrow.visible = true;
    } else {
      this.arrow.visible = false;
    }
    this.group.visible = true;
  }

  updateOverlay(camera, viewportEl) {
    if (!this.enabled || !this.group.visible || !this.lastResult || !this.overlay || !viewportEl) {
      if (this.overlay) this.overlay.hidden = true;
      return;
    }
    this.ring.quaternion.copy(camera.quaternion);
    this.parent.updateMatrixWorld(true);
    _world.copy(this.group.position).applyMatrix4(this.parent.matrixWorld);
    _world.project(camera);
    if (_world.z > 1 || _world.z < -1) {
      this.overlay.hidden = true;
      return;
    }
    const w = viewportEl.clientWidth;
    const h = viewportEl.clientHeight;
    const px = (_world.x * 0.5 + 0.5) * w;
    const py = (-_world.y * 0.5 + 0.5) * h;
    const r = this.lastResult;
    const ratio = r.refSpeedMps > 0.5 ? r.speedMps / r.refSpeedMps : 0;
    const ratioText = r.refSpeedMps > 0.5 ? `${ratio.toFixed(2)}× 来流` : '局部流动';
    const [x, y, z] = r.point;
    this.overlay.innerHTML =
      `<div class="probe-head"><strong>${Math.round(r.speedKmh)} km/h</strong><span>${r.speedMps.toFixed(1)} m/s</span>`
      + (this.pinned ? '<em class="probe-pin">已钉住</em>' : '')
      + `</div><div class="probe-sub">${ratioText} · 偏转 ${r.yawDeg >= 0 ? '+' : ''}${r.yawDeg.toFixed(1)}°</div>`
      + `<div class="probe-coords">X ${x.toFixed(2)} · Y ${y.toFixed(2)} · Z ${z.toFixed(2)} m</div>`;
    this.overlay.style.transform = `translate(${Math.round(px + 14)}px, ${Math.round(py - 28)}px)`;
    this.overlay.hidden = false;
  }
}
