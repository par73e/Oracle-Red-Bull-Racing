# AERO

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

以可近距离观察、操作的 RB19 与 RB16B 模型展示赛车的外形、材质和机械动作。Sir 要求进一步设计真实物理来流的风洞，以及符合斯帕 Eau Rouge／Raidillon 实际场景的网页环境，赛道远景可以模糊。

## Operating Context

当前为 Three.js + Vite 本地双车验收页，入口为 `web/`，本地端口 5173；模型制作文件由 Blender 维护。Blender 的图形界面与后台实例合计最多一个，保存、退出并确认结束后才启动下一项，详见根目录 AGENTS.md。

## Capabilities and Constraints

- 已有车轮自转、前轮转向、DRS 开合及整车／侧面／尾翼／底板视角。
- 当前模型采用米级展示尺度；底板、机构等存在展示近似，不是车队 CAD。
- 网页现已接入双车各自的离线 CFD 关键工况、实时插值流线，以及风洞／斯帕近似三维场景。求解与显示的边界见 `cfd/library/README.md`。
- 真实物理结果需要记录几何版本、单位、工况、求解器和验证过程；展示效果不能作为未经计算的气动结论。
- 车型源码与本地二进制资产分开保存；计算使用经审计后单独体素封闭的展示代理，不能替代工程 CAD。

## Evidence on Hand

`README.md`、`docs/web-model-handoff.md`、`docs/research/model-attributions.md`、`web/src/main.js`、`web/public/models/manifest.json`。Sir 已确认赛道目标是斯帕 Eau Rouge／Raidillon；本轮方案见 `docs/design/wind-tunnel-and-spa-2026-11-10.md`。

## Product Principles

- 近景几何、材质与真实运动关系需要经得起查看。
- 场景的地形、光照、年代和车辆朝向保持一致。
- 数值仿真、物理近似和视觉展示的依据要清楚。
- 保留现有模型操作与观察流程，新环境服务于赛车展示。

## 已确认的交互气流需求（2026-11-10）

RB19 与 RB16B 均需让气流随车速 0–350 km/h、前轮转向、轮速及 DRS 开度连续变化，网页拖动滑块时立即响应。采用离线真实 CFD 关键工况结果库与网页插值显示，中间工况为近似；不要求每次拖动都等待整车重算。完整需求和验证边界见 `docs/design/coupled-airflow-requirements-2026-11-10.md`。两车分别计算，不复用车型流场；中间及组合状态的科学边界见流场库说明。
