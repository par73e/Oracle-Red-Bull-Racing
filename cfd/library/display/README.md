# 网页 CFD 工况库

浏览器按车辆、相对来流速度、对地速度、偏航角、转向和实际 DRS 开度选择流场。静止无风时没有驱动来流。整车、底板与侧箱共享同一速度场，各自使用适合观察范围的流线种子。地面与轮周速度按纯滚动匹配。

每个车型的 `display/manifest.json` 列出已求解节点和通过对照的插值区间。命中实算节点与已验收插值区间时直接使用精确 CFD 速度场与动压（$v^2$）归一化插值力值；其余任意前轮转向、±90° 风向与多参数组合，由 `flow-catalog.js` 与 `flow-worker.js` 基于已求解节点、74 档 ±90° 侧风库及单轴差分实时合成，并在界面中明确标为「CFD 组合近似 / 近似」。这里的 CFD 使用展示几何的粗网格稳态 RANS，精度仍受网格、湍流模型及边界假设限制。

## 补算和打包

1. 在项目的 `aero-cfd` 虚拟机上运行 `cfd/.venv/bin/python cfd/library/display/solve.py <车型> <工况>`。`--help` 列出工况。在 180 km/h 无自然风下，目录原先直接读取 `sweep-drs-025`、`sweep-drs-050` 和 `sweep-drs-075` 的已完成算例；精算主干齐全时，这三个粗网格节点已被取代并跳过，`sweep-drs-025`、`sweep-drs-075` 的算例已于 2026-11-26 删除，`sweep-drs-050` 保留，供 `park-mid-drs1`、`low-mid-drs` 补算时复制。通过 `web/scripts/export-flow-geometry.mjs` 导出相应姿态，随后运行 `scripts/close_pose.py`、`sweep/prepare.py` 和 `scripts/run_anchor.sh`。
2. 从项目根目录运行 `cfd/.venv/bin/python cfd/library/display/catalog.py`。它读取的原始算例在 `cfd/library/cases/`。2026-11-26 清理后，现有清单里来流与对地车速不同的 201 个节点已无对应算例，重跑时被跳过、不写入新清单，其余 134 个节点与现有清单一致（见 [流场库说明](../README.md)）。网页复用已打包的速度场，从原始采样生成独立的有效点位图。同一车型内容相同的位图共用一个文件，位图与速度文件按 SHA-256 校验。
3. 在 `web` 目录运行 `npm run validate:worker` 和 `npm run build`。前者包含用户报告的工况回放、浏览器使用的 Worker、求解场碰撞和积分收敛对照，以及数据加载失败和换车回归。

## 插值验收

对每个候选区间，用两端速度场预测中间的独立 OpenFOAM 工况。先测近车区域和底板区域的方向、速度矢量、有效点覆盖率及采样一致性。再用同一姿态、种子和积分设置，在固定截面上比较整车、底板和侧箱的流线。每层匹配参考截面交点至少 85%，横向与高度组合偏差的 P90 低于 6 厘米。通过后才把区间以内的相邻节点加入清单。判定及误差详见 `cfd/library/reports/*-display-validation.json`。
