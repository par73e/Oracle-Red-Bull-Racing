import { captureCondition } from './flow-condition.js';
import { computeCalibratedForces } from './aero-forces-calc.js';

const SPEED_SAMPLES = [0, 30, 50, 80, 110, 140, 180, 210, 240, 270, 300, 325, 350];
const YAW_SAMPLES = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];

function fmtN(v) {
  return v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)} N`;
}

function fmtSignedN(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${r} N`;
}

function fmtPct(a, b, minBase = 1) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < minBase) return '—';
  const d = ((b - a) / Math.abs(a)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

export class AeroCompare {
  constructor({ tableEl, chartEl, summaryEl = null }) {
    this.tableEl = tableEl;
    this.chartEl = chartEl;
    this.summaryEl = summaryEl;
    this.chartAxis = 'speed'; // 'speed' | 'yaw'
    this.showDrsCurve = true;
    this.lastRenderKey = '';
  }

  setAxis(axis) {
    this.chartAxis = axis === 'yaw' ? 'yaw' : 'speed';
    this.lastRenderKey = '';
  }

  setShowDrs(show) {
    this.showDrsCurve = Boolean(show);
    this.lastRenderKey = '';
  }

  invalidate() {
    this.lastRenderKey = '';
  }

  evalAt(catalog, car, baseState, overrides = {}) {
    if (!catalog) return null;
    const merged = {
      ...baseState,
      model: car,
      ...overrides,
    };
    if ('drs' in overrides && !('drsCurrent' in overrides)) merged.drsCurrent = overrides.drs;
    const cond = captureCondition(merged);
    return computeCalibratedForces(catalog, cond);
  }

  render(flowCatalog, state) {
    const c16 = flowCatalog.getCatalog('rb16b');
    const c19 = flowCatalog.getCatalog('rb19');
    if (!c16 || !c19) {
      if (this.tableEl) this.tableEl.innerHTML = '<p class="compare-loading">正在加载双车 CFD 清单…</p>';
      if (this.summaryEl) this.summaryEl.textContent = '正在加载同工况双车对照…';
      return;
    }
    const key = [
      state.groundSpeed, state.windAngle, state.steer,
      Math.round((state.drsCurrent ?? state.drs) * 100),
      this.chartAxis, this.showDrsCurve ? 1 : 0, state.model,
    ].join('|');
    if (key === this.lastRenderKey) return;
    this.lastRenderKey = key;

    const f16 = this.evalAt(c16, 'rb16b', state);
    const f19 = this.evalAt(c19, 'rb19', state);

    if (this.summaryEl && f16 && f19) {
      const peerIs19 = state.model !== 'rb19';
      const cur = peerIs19 ? f16 : f19;
      const peer = peerIs19 ? f19 : f16;
      const peerName = peerIs19 ? 'RB19' : 'RB16B';
      if (cur.downforceN == null || Math.abs(cur.downforceN) < 1) {
        this.summaryEl.textContent = `静止工况 · 切至「双车对比」可查看速度/侧风极曲线`;
      } else {
        this.summaryEl.textContent = `同工况对比 ${peerName}：下压力 ${fmtPct(cur.downforceN, peer.downforceN)} · L/D ${fmtPct(cur.liftToDrag, peer.liftToDrag)}`;
      }
    }

    if (this.tableEl && f16 && f19) {
      const ld16 = f16.liftToDrag != null ? f16.liftToDrag.toFixed(2) : '—';
      const ld19 = f19.liftToDrag != null ? f19.liftToDrag.toFixed(2) : '—';
      const is19 = state.model === 'rb19';
      this.tableEl.innerHTML = `
        <div class="compare-grid">
          <span class="cg-head">指标</span>
          <span class="cg-head cg-16 ${!is19 ? 'is-cur' : ''}">RB16B<small>${!is19 ? '当前 · 2021' : '2021'}</small></span>
          <span class="cg-head cg-19 ${is19 ? 'is-cur' : ''}">RB19<small>${is19 ? '当前 · 2023' : '2023'}</small></span>
          <span class="cg-head cg-head-right">增幅<small>较 RB16B</small></span>

          <span>下压力 Fz</span>
          <strong>${fmtN(f16.downforceN)}</strong>
          <strong>${fmtN(f19.downforceN)}</strong>
          <em class="cg-delta">${fmtPct(f16.downforceN, f19.downforceN)}</em>

          <span>空气阻力</span>
          <strong>${fmtN(f16.dragN)}</strong>
          <strong>${fmtN(f19.dragN)}</strong>
          <em class="cg-delta">${fmtPct(f16.dragN, f19.dragN)}</em>

          <span>升阻比 L/D</span>
          <strong>${ld16}</strong>
          <strong>${ld19}</strong>
          <em class="cg-delta">${fmtPct(f16.liftToDrag, f19.liftToDrag)}</em>

          <span>侧向力 Fy</span>
          <strong>${fmtSignedN(f16.sideN)}</strong>
          <strong>${fmtSignedN(f19.sideN)}</strong>
          <em class="cg-delta" title="${Math.abs(f16.sideN ?? 0) < 25 ? '正迎风基准近零（< 25 N），调偏航角后显示侧力增幅' : ''}">${fmtPct(Math.abs(f16.sideN ?? 0), Math.abs(f19.sideN ?? 0), 25)}</em>

          <span class="cg-raw">原始 Fz</span>
          <span class="cg-raw">${fmtN(f16.rawDownforceN)}</span>
          <span class="cg-raw">${fmtN(f19.rawDownforceN)}</span>
          <span class="cg-raw" style="text-align:right">${fmtPct(f16.rawDownforceN, f19.rawDownforceN)}</span>
        </div>`;
    }

    if (this.chartEl) {
      this.chartEl.innerHTML = this.chartAxis === 'yaw'
        ? this.buildYawSvg(c16, c19, state)
        : this.buildSpeedSvg(c16, c19, state);
    }
  }

  buildSpeedSvg(c16, c19, state) {
    const W = 280, H = 136, padL = 34, padR = 8, padT = 10, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    const pts16 = SPEED_SAMPLES.map(v => ({ x: v, f: this.evalAt(c16, 'rb16b', state, { groundSpeed: v, drs: 0, drsCurrent: 0 }) }));
    const pts19 = SPEED_SAMPLES.map(v => ({ x: v, f: this.evalAt(c19, 'rb19', state, { groundSpeed: v, drs: 0, drsCurrent: 0 }) }));
    const pts19Drs = this.showDrsCurve
      ? SPEED_SAMPLES.map(v => ({ x: v, f: this.evalAt(c19, 'rb19', state, { groundSpeed: v, drs: 1, drsCurrent: 1 }) }))
      : [];

    const maxY = Math.max(
      1000,
      ...pts16.map(p => p.f?.downforceN ?? 0),
      ...pts19.map(p => p.f?.downforceN ?? 0),
    ) * 1.08;
    const sx = v => padL + (v / 350) * iw;
    const sy = y => padT + ih - (Math.max(0, y) / maxY) * ih;
    const pathOf = (arr, prop) => arr.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.f?.[prop] ?? 0).toFixed(1)}`).join('');

    const curX = sx(state.groundSpeed);
    const cur16 = this.evalAt(c16, 'rb16b', state);
    const cur19 = this.evalAt(c19, 'rb19', state);
    const ticksY = [0, 0.5, 1].map(k => ({
      y: padT + ih * (1 - k),
      label: `${Math.round((maxY * k) / 1000)}k`,
    }));

    return `<svg class="polar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="RB16B 与 RB19 速度下压力对比曲线">
      ${ticksY.map(t => `<line x1="${padL}" y1="${t.y.toFixed(1)}" x2="${W - padR}" y2="${t.y.toFixed(1)}" class="p-grid"/>
        <text x="${padL - 4}" y="${(t.y + 3).toFixed(1)}" class="p-axis" text-anchor="end">${t.label}</text>`).join('')}
      <line x1="${curX.toFixed(1)}" y1="${padT}" x2="${curX.toFixed(1)}" y2="${padT + ih}" class="p-cursor-line"/>
      <path d="${pathOf(pts16, 'dragN')}" class="p-line p-16 p-drag"/>
      <path d="${pathOf(pts19, 'dragN')}" class="p-line p-19 p-drag"/>
      ${pts19Drs.length ? `<path d="${pathOf(pts19Drs, 'downforceN')}" class="p-line p-19 p-drs"/>` : ''}
      <path d="${pathOf(pts16, 'downforceN')}" class="p-line p-16"/>
      <path d="${pathOf(pts19, 'downforceN')}" class="p-line p-19"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur16?.downforceN ?? 0).toFixed(1)}" r="7" class="p-dot-halo p-16"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur19?.downforceN ?? 0).toFixed(1)}" r="7" class="p-dot-halo p-19"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur16?.downforceN ?? 0).toFixed(1)}" r="4" class="p-dot p-16"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur19?.downforceN ?? 0).toFixed(1)}" r="4" class="p-dot p-19"/>
      <text x="${padL}" y="${H - 5}" class="p-axis">0</text>
      <text x="${sx(180).toFixed(1)}" y="${H - 5}" class="p-axis" text-anchor="middle">180 km/h</text>
      <text x="${W - padR}" y="${H - 5}" class="p-axis" text-anchor="end">350</text>
    </svg>
    <div class="polar-legend">
      <span><i class="lg-16"></i>RB16B 下压力</span>
      <span><i class="lg-19"></i>RB19 下压力</span>
      <span><i class="lg-drs"></i>RB19 DRS 开</span>
    </div>`;
  }

  buildYawSvg(c16, c19, state) {
    const W = 280, H = 136, padL = 34, padR = 8, padT = 10, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    const speed = Math.max(50, state.groundSpeed || 180);
    const pts16 = YAW_SAMPLES.map(a => ({ x: a, f: this.evalAt(c16, 'rb16b', state, { groundSpeed: speed, windAngle: a }) }));
    const pts19 = YAW_SAMPLES.map(a => ({ x: a, f: this.evalAt(c19, 'rb19', state, { groundSpeed: speed, windAngle: a }) }));
    const vals = [...pts16, ...pts19].map(p => p.f?.downforceN ?? 0);
    const minY = Math.min(0, ...vals) * 1.1;
    const maxY = Math.max(1000, ...vals) * 1.1;
    const span = Math.max(1, maxY - minY);
    const sx = a => padL + ((a + 90) / 180) * iw;
    const sy = y => padT + ih - ((y - minY) / span) * ih;
    const pathOf = arr => arr.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.f?.downforceN ?? 0).toFixed(1)}`).join('');
    const curX = sx(state.windAngle || 0);
    const cur16 = this.evalAt(c16, 'rb16b', state, { groundSpeed: speed });
    const cur19 = this.evalAt(c19, 'rb19', state, { groundSpeed: speed });

    return `<svg class="polar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="RB16B 与 RB19 偏航角下压力对比曲线">
      <line x1="${padL}" y1="${sy(0).toFixed(1)}" x2="${W - padR}" y2="${sy(0).toFixed(1)}" class="p-grid"/>
      <line x1="${sx(0).toFixed(1)}" y1="${padT}" x2="${sx(0).toFixed(1)}" y2="${padT + ih}" class="p-grid"/>
      <line x1="${curX.toFixed(1)}" y1="${padT}" x2="${curX.toFixed(1)}" y2="${padT + ih}" class="p-cursor-line"/>
      <text x="${padL - 4}" y="${(padT + 4).toFixed(1)}" class="p-axis" text-anchor="end">${(maxY / 1000).toFixed(1)}k</text>
      <text x="${padL - 4}" y="${(sy(0) + 3).toFixed(1)}" class="p-axis" text-anchor="end">0</text>
      <path d="${pathOf(pts16)}" class="p-line p-16"/>
      <path d="${pathOf(pts19)}" class="p-line p-19"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur16?.downforceN ?? 0).toFixed(1)}" r="7" class="p-dot-halo p-16"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur19?.downforceN ?? 0).toFixed(1)}" r="7" class="p-dot-halo p-19"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur16?.downforceN ?? 0).toFixed(1)}" r="4" class="p-dot p-16"/>
      <circle cx="${curX.toFixed(1)}" cy="${sy(cur19?.downforceN ?? 0).toFixed(1)}" r="4" class="p-dot p-19"/>
      <text x="${padL}" y="${H - 5}" class="p-axis">-90°</text>
      <text x="${sx(0).toFixed(1)}" y="${H - 5}" class="p-axis" text-anchor="middle">0° (${speed} km/h)</text>
      <text x="${W - padR}" y="${H - 5}" class="p-axis" text-anchor="end">+90°</text>
    </svg>
    <div class="polar-legend">
      <span><i class="lg-16"></i>RB16B 侧风 Fz</span>
      <span><i class="lg-19"></i>RB19 侧风 Fz</span>
    </div>`;
  }
}

/**
 * Real-Time WebGL Scissor-Split Curtain Controller.
 * Both halves share the exact live camera (OrbitControls + WASD + presets + rig + CFD);
 * dragging the 28px handle strip moves the live scissor split ratio smoothly from 5% to 95%.
 */
export class CurtainCompare {
  constructor({ overlayEl, handleEl, leftLabelEl, rightLabelEl, statusEl, onSwap, onExit }) {
    this.overlay = overlayEl;
    this.handle = handleEl;
    this.leftLabel = leftLabelEl;
    this.rightLabel = rightLabelEl;
    this.statusEl = statusEl;
    this.onSwap = onSwap;
    this.onExit = onExit;
    this.active = false;
    this.ratio = 0.5;
    this.dragging = false;
    this.leftCar = 'rb19';
    this.rightCar = 'rb16b';

    const updateFromClientX = clientX => {
      if (!this.active || !this.overlay) return;
      const rect = this.overlay.getBoundingClientRect();
      this.setRatio(Math.max(0.05, Math.min(0.95, (clientX - rect.left) / Math.max(1, rect.width))));
    };
    this.handle?.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      this.dragging = true;
      this.handle.setPointerCapture?.(e.pointerId);
    });
    this.handle?.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      this.setRatio(0.5);
    });
    window.addEventListener('pointermove', e => {
      if (this.dragging) {
        e.stopPropagation();
        updateFromClientX(e.clientX);
      }
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointercancel', () => { this.dragging = false; });
  }

  setRatio(ratio) {
    this.ratio = Math.max(0.05, Math.min(0.95, ratio));
    const pct = `${(this.ratio * 100).toFixed(2)}%`;
    this.overlay?.style.setProperty('--wipe', pct);
  }

  nudge(delta) {
    if (!this.active) return;
    this.setRatio(this.ratio + delta);
  }

  setCars(leftCar, rightCar, mainCar = rightCar) {
    this.leftCar = leftCar;
    this.rightCar = rightCar;
    const fmt = id => (id === 'rb19' ? 'RB19 · 2023' : 'RB16B · 2021');
    if (this.leftLabel) {
      this.leftLabel.textContent = `左 · ${fmt(leftCar)}${leftCar === mainCar ? '（主车）' : ''}`;
      this.leftLabel.dataset.car = leftCar;
    }
    if (this.rightLabel) {
      this.rightLabel.textContent = `右 · ${fmt(rightCar)}${rightCar === mainCar ? '（主车）' : ''}`;
      this.rightLabel.dataset.car = rightCar;
    }
  }

  setLoading(text) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || '';
    this.statusEl.hidden = !text;
  }

  activate({ leftCar, rightCar }) {
    this.active = true;
    this.setCars(leftCar, rightCar);
    this.setRatio(0.5);
    if (this.overlay) this.overlay.hidden = false;
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;
    this.setLoading('');
    if (this.overlay) this.overlay.hidden = true;
    this.onExit?.();
  }
}
