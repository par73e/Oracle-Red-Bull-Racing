import * as T from 'three';

const _ndc = new T.Vector2();
const _world = new T.Vector3();
const _local = new T.Vector3();
const _invMat = new T.Matrix4();
const _invRot = new T.Matrix3();
const _plane = new T.Plane();
const _hit = new T.Vector3();
const _dir = new T.Vector3();
const _viewDir = new T.Vector3();
const _localNorm = new T.Vector3();
const _localView = new T.Vector3();

const RING_OUTER_RADIUS_M = 0.046;
const TARGET_RING_RADIUS_PX = 9.0; // Crisp ~18 px diameter regardless of zoom distance

export class FlowProbe {
  constructor(parent, overlayEl) {
    this.parent = parent;
    this.overlay = overlayEl;
    this.enabled = false;
    this.pinned = false;
    this.pinnedRequest = null;
    this.lastResult = null;
    this.baseArrowLen = 0.34;
    this.raycaster = new T.Raycaster();
    this.raycaster.firstHitOnly = true;

    this.group = new T.Group();
    this.group.name = 'VIRTUAL_PITOT_PROBE';
    this.group.visible = false;
    parent?.add(this.group);

    // Distance-compensated marker group (ring + center core dot)
    this.markerGroup = new T.Group();
    this.group.add(this.markerGroup);

    const ring = new T.Mesh(
      new T.RingGeometry(0.030, RING_OUTER_RADIUS_M, 28),
      new T.MeshBasicMaterial({ color: 0x38e8ff, side: T.DoubleSide, transparent: true, opacity: 0.94, depthTest: false }),
    );
    ring.renderOrder = 10;
    this.ring = ring;
    this.markerGroup.add(ring);

    const core = new T.Mesh(
      new T.SphereGeometry(0.015, 14, 14),
      new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    core.renderOrder = 11;
    this.markerGroup.add(core);

    this.arrow = new T.ArrowHelper(new T.Vector3(0, 0, -1), new T.Vector3(0, 0, 0), 0.34, 0xff5a57, 0.088, 0.05);
    this.arrow.renderOrder = 10;
    this.group.add(this.arrow);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.pinned = false;
      this.pinnedRequest = null;
      this.clearResult();
    }
  }

  clearResult() {
    this.lastResult = null;
    this.group.visible = false;
    if (this.overlay) this.overlay.hidden = true;
  }

  unpin() {
    this.pinned = false;
    this.pinnedRequest = null;
  }

  /**
   * Returns screen distance (px) between a click and the currently pinned marker,
   * so clicking elsewhere directly re-pins while clicking the same marker unpins.
   */
  isNearPinnedScreen(clientX, clientY, camera, viewportEl, radiusPx = 26) {
    if (!this.pinned || !this.group.visible || !camera || !viewportEl) return false;
    this.parent.updateMatrixWorld(true);
    _world.copy(this.group.position).applyMatrix4(this.parent.matrixWorld).project(camera);
    if (_world.z < -1 || _world.z > 1) return false;
    const rect = viewportEl.getBoundingClientRect();
    const px = rect.left + (_world.x * 0.5 + 0.5) * rect.width;
    const py = rect.top + (-_world.y * 0.5 + 0.5) * rect.height;
    return Math.hypot(clientX - px, clientY - py) <= radiusPx;
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
    _invRot.setFromMatrix4(_invMat);

    // 1. Prefer intersecting active PIV slice plane (WYSIWYG probing on slice; no marching into solid cutouts)
    if (slice?.group?.visible) {
      const hits = this.raycaster.intersectObject(slice.mesh, false);
      if (hits.length) {
        _local.copy(hits[0].point).applyMatrix4(_invMat);
        return { point: [_local.x, _local.y, _local.z], allowMarch: false };
      }
    }

    // 2. Intersect car mesh: offset slightly outward & send oriented normal + viewDir for robust near-wall marching
    if (rig?.model) {
      const hits = this.raycaster.intersectObject(rig.model, true);
      if (hits.length) {
        const hit = hits[0];
        _world.copy(hit.point);
        _viewDir.copy(camera.position).sub(_world).normalize();
        if (hit.face?.normal) {
          _dir.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
          // Ensure double-sided/inverted face normals always face OUTWARD toward the viewer
          if (_dir.dot(_viewDir) < 0) _dir.negate();
        } else {
          _dir.copy(_viewDir);
        }
        _world.addScaledVector(_dir, 0.045);
        _local.copy(_world).applyMatrix4(_invMat);
        _localNorm.copy(_dir).applyMatrix3(_invRot).normalize();
        _localView.copy(_viewDir).applyMatrix3(_invRot).normalize();
        return {
          point: [_local.x, Math.max(0.035, _local.y), _local.z],
          normal: [_localNorm.x, _localNorm.y, _localNorm.z],
          viewDir: [_localView.x, _localView.y, _localView.z],
          allowMarch: true,
        };
      }
    }

    // 3. Fallback horizontal mid-car plane (y = 0.48 m) in world space
    _plane.setFromNormalAndCoplanarPoint(new T.Vector3(0, 1, 0), new T.Vector3(0, 0.48, 0));
    if (this.raycaster.ray.intersectPlane(_plane, _hit)) {
      _local.copy(_hit).applyMatrix4(_invMat);
      if (Math.abs(_local.x) <= 4.4 && _local.z >= -8.8 && _local.z <= 5.4) {
        return { point: [_local.x, 0.48, _local.z], allowMarch: false };
      }
    }
    return null;
  }

  applyResult(result, refSpeedMps, carLabel = null) {
    if (!this.enabled) return;
    if (!result?.valid) {
      if (!this.pinned) {
        this.clearResult();
      }
      return;
    }
    this.lastResult = { ...result, refSpeedMps, carLabel };
    const [x, y, z] = result.point;
    this.group.position.set(x, y, z);
    const [vx, vy, vz] = result.velocity;
    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-4) {
      _dir.set(vx / len, vy / len, vz / len);
      this.arrow.setDirection(_dir);
      this.baseArrowLen = T.MathUtils.clamp(0.18 + (len / Math.max(refSpeedMps, 10)) * 0.28, 0.18, 0.52);
      this.arrow.setLength(this.baseArrowLen, this.baseArrowLen * 0.26, this.baseArrowLen * 0.14);
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
    this.parent.updateMatrixWorld(true);
    _world.copy(this.group.position).applyMatrix4(this.parent.matrixWorld);

    // Constant screen-space apparent sizing for marker ring/dot + gentle distance scaling for arrow
    const dist = Math.max(0.2, camera.position.distanceTo(_world));
    const h = Math.max(1, viewportEl.clientHeight);
    const w = Math.max(1, viewportEl.clientWidth);
    const metersPerPx = (2 * dist * Math.tan(T.MathUtils.degToRad(camera.fov * 0.5))) / h;
    const markerScale = T.MathUtils.clamp((TARGET_RING_RADIUS_PX * metersPerPx) / RING_OUTER_RADIUS_M, 0.12, 1.45);
    this.markerGroup.scale.setScalar(markerScale);
    this.markerGroup.quaternion.copy(camera.quaternion);
    if (this.arrow.visible) {
      const arrowScale = T.MathUtils.clamp(dist / 5.4, 0.26, 1.35);
      const scaledLen = this.baseArrowLen * arrowScale;
      this.arrow.setLength(scaledLen, scaledLen * 0.27, scaledLen * 0.15);
    }

    _world.project(camera);
    if (_world.z > 1 || _world.z < -1) {
      this.overlay.hidden = true;
      return;
    }
    const px = (_world.x * 0.5 + 0.5) * w;
    const py = (-_world.y * 0.5 + 0.5) * h;
    const r = this.lastResult;
    const ratio = r.refSpeedMps > 0.5 ? r.speedMps / r.refSpeedMps : 0;
    const ratioText = r.refSpeedMps > 0.5 ? `${ratio.toFixed(2)}× 来流` : '局部流动';
    const [x, y, z] = r.point;
    const contentKey = `${r.carLabel || ''}|${Math.round(r.speedKmh)}|${r.speedMps.toFixed(1)}|${ratioText}|${r.yawDeg.toFixed(1)}|${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}|${this.pinned ? 1 : 0}`;
    if (this._lastHtmlKey !== contentKey) {
      this._lastHtmlKey = contentKey;
      const carBadge = r.carLabel ? `<em class="probe-car">${r.carLabel}</em>` : '';
      this.overlay.innerHTML =
        `<div class="probe-head">${carBadge}<strong>${Math.round(r.speedKmh)} km/h</strong><span>${r.speedMps.toFixed(1)} m/s</span>`
        + (this.pinned ? '<em class="probe-pin">已钉住</em>' : '')
        + `</div><div class="probe-sub">${ratioText} · 偏转 ${r.yawDeg >= 0 ? '+' : ''}${r.yawDeg.toFixed(1)}°</div>`
        + `<div class="probe-coords">X ${x.toFixed(2)} · Y ${y.toFixed(2)} · Z ${z.toFixed(2)} m</div>`;
    }
    this.overlay.hidden = false;
    // Viewport-safe edge auto-flip & clamping so readout never clips off-screen
    const rw = this.overlay.offsetWidth || 190;
    const rh = this.overlay.offsetHeight || 64;
    let tx = px + 16;
    let ty = py - rh * 0.55;
    if (tx + rw > w - 12) tx = px - rw - 16;
    if (ty < 64) ty = py + 16;
    tx = T.MathUtils.clamp(tx, 12, Math.max(12, w - rw - 12));
    ty = T.MathUtils.clamp(ty, 64, Math.max(64, h - rh - 82));
    this.overlay.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
  }
}
