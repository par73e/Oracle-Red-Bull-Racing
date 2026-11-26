import * as T from 'three';

const _world = new T.Vector3();

export const AERO_HOTSPOTS = [
  {
    id: 'front-wing',
    label: '前翼端板',
    title: '前翼端板与乱流外洗 (Outwash)',
    point: () => [0.78, 0.22, 2.38],
    camera: { position: [2.35, 0.88, 3.65], target: [0.42, 0.26, 2.15] },
    rb16b: 'RB16B（2021）采用多层外洗端板与导流槽，强力将前轮乱流推向车身外侧以保护高倾角底板。',
    rb19: 'RB19（2023）遵循地面效应新规改为曲面连体端板，重点引导洁净气流进入文丘里底板入口。',
  },
  {
    id: 'suspension',
    label: '前悬挂',
    title: '前双叉臂与抗俯仰几何',
    point: () => [0.58, 0.44, 1.52],
    camera: { position: [2.25, 1.05, 2.55], target: [0.28, 0.42, 1.48] },
    rb16b: 'RB16B 兼顾高倾角姿态控制，前悬挂翼型碳纤臂兼作整流叶片梳理吹向侧箱的来流。',
    rb19: 'RB19 采用大倾角抗俯仰前上叉臂，重刹时锁住车头离地间隙，防止地面效应底板失速。',
  },
  {
    id: 'sidepod',
    label: '侧箱下切',
    title: '侧箱下切与下洗斜坡 (Undercut)',
    point: () => [0.70, 0.50, 0.10],
    camera: { position: [3.1, 1.25, 1.35], target: [0.2, 0.48, -0.05] },
    rb16b: 'RB16B 以紧致收腰（Coke Bottle）著称，配合高倾角将高速气流引入后轮内侧与扩散器上方。',
    rb19: 'RB19 拥有标志性极深侧箱下切与下洗斜坡，既把前轮乱流挡在外侧，又给底板边缘形成气动密封。',
  },
  {
    id: 'floor',
    label: '底板扩散器',
    title: '底板文丘里通道与尾部扩散器',
    point: () => [0.0, 0.18, -1.95],
    camera: { position: [2.1, 0.58, -4.45], target: [0.0, 0.24, -1.85] },
    rb16b: 'RB16B 依赖平底板 + 高车身倾角在车尾放大有效扩散器容积，下压力对底板离地高度非常敏感。',
    rb19: 'RB19 依靠车底三维文丘里隧道产生强地面效应，在更低阻力下输出更大且更稳定的整体下压力。',
  },
  {
    id: 'drs',
    label: 'DRS 尾翼',
    title: '尾翼主翼与 DRS 液压执行器',
    point: rig => rig?.config?.drs?.hinge ? [0.0, rig.config.drs.hinge[1] + 0.04, rig.config.drs.hinge[2]] : [0.0, 0.98, -2.45],
    camera: { position: [1.55, 1.62, -4.25], target: [0.0, 0.94, -2.42] },
    rb16b: 'RB16B 高下压力尾翼配合单立柱 DRS 机构，开启后平放活动襟翼显著削减直道诱导阻力。',
    rb19: 'RB19 拥有极高的 DRS 效率，精算数据显示开启后可显著压平尾翼尾流并削减大比例阻力。',
    hasDrsAction: true,
  },
];

export class AeroHotspots {
  constructor(parent, layerEl, cardEl, { onSelect, onToggleDrs }) {
    this.parent = parent;
    this.layer = layerEl;
    this.card = cardEl;
    this.onSelect = onSelect;
    this.onToggleDrs = onToggleDrs;
    this.enabled = false;
    this.activeId = null;
    this.buttons = new Map();

    if (this.layer) {
      this.layer.innerHTML = '';
      for (const spot of AERO_HOTSPOTS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hotspot-pin';
        btn.dataset.hotspot = spot.id;
        btn.setAttribute('aria-label', spot.title);
        btn.innerHTML = `<span class="hotspot-dot" aria-hidden="true"></span><span class="hotspot-label">${spot.label}</span>`;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this.select(spot.id);
        });
        this.layer.appendChild(btn);
        this.buttons.set(spot.id, btn);
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.layer) this.layer.hidden = !this.enabled;
    if (!this.enabled) this.clearSelection();
  }

  clearSelection() {
    this.activeId = null;
    for (const btn of this.buttons.values()) btn.classList.remove('is-active');
    if (this.card) this.card.hidden = true;
  }

  select(id, currentModel = 'rb16b') {
    const spot = AERO_HOTSPOTS.find(s => s.id === id);
    if (!spot) return;
    if (this.activeId === id) {
      this.clearSelection();
      return;
    }
    this.activeId = id;
    for (const [k, btn] of this.buttons) btn.classList.toggle('is-active', k === id);
    this.renderCard(spot, currentModel);
    this.onSelect?.(spot);
  }

  renderCard(spot, currentModel) {
    if (!this.card || !spot) return;
    const is19 = currentModel === 'rb19';
    this.card.innerHTML = `
      <div class="hotspot-card-head">
        <strong>${spot.title}</strong>
        <button type="button" class="icon-button hotspot-close" aria-label="关闭导览卡片">✕</button>
      </div>
      <p class="hotspot-desc ${!is19 ? 'is-current' : ''}"><b>RB16B (2021)</b>：${spot.rb16b}</p>
      <p class="hotspot-desc ${is19 ? 'is-current' : ''}"><b>RB19 (2023)</b>：${spot.rb19}</p>
      ${spot.hasDrsAction ? '<div class="hotspot-card-foot"><button type="button" class="chip" data-hotspot-drs>切换 DRS 观察尾翼动作</button></div>' : ''}`;
    this.card.querySelector('.hotspot-close')?.addEventListener('click', () => this.clearSelection());
    this.card.querySelector('[data-hotspot-drs]')?.addEventListener('click', () => this.onToggleDrs?.());
    this.card.hidden = false;
  }

  refreshModel(currentModel) {
    if (!this.activeId) return;
    const spot = AERO_HOTSPOTS.find(s => s.id === this.activeId);
    if (spot) this.renderCard(spot, currentModel);
  }

  update(camera, rig, viewportEl) {
    if (!this.enabled || !this.layer || !viewportEl || !camera) return;
    this.parent.updateMatrixWorld(true);
    const w = viewportEl.clientWidth;
    const h = viewportEl.clientHeight;
    for (const spot of AERO_HOTSPOTS) {
      const btn = this.buttons.get(spot.id);
      if (!btn) continue;
      const [x, y, z] = spot.point(rig);
      _world.set(x, y, z).applyMatrix4(this.parent.matrixWorld).project(camera);
      const visible = _world.z >= -1 && _world.z <= 1
        && _world.x >= -1.05 && _world.x <= 1.05
        && _world.y >= -1.05 && _world.y <= 1.05;
      btn.hidden = !visible;
      if (visible) {
        const px = (_world.x * 0.5 + 0.5) * w;
        const py = (-_world.y * 0.5 + 0.5) * h;
        btn.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      }
    }
  }
}
