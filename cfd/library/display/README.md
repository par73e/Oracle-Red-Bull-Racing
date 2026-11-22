# 网页 CFD 工况库

浏览器按车辆、相对来流速度、对地速度、偏航角、转向和实际 DRS 开度选择流场。静止无风时没有驱动来流。整车、底板与侧箱共享同一速度场，各自使用适合观察范围的流线种子。地面与轮周速度按纯滚动匹配。

每个车型的 `display/manifest.json` 列出已求解节点和通过对照的插值区间。旧单轴组合、滚动差分和侧风叠加仍可通过历史脚本复现。网页缺少覆盖时收起流线并提示最近已求解工况。力值有稳定的同工况求解结果时显示末 100 步平均值；在已通过独立算例验证的插值区间内，按动压（$v^2$）归一化后对相邻端点气动系数插值（等速区间退化为线性插值）并标为「插值」，缺少合格数据时显示「—」。这里的 CFD 使用展示几何的粗网格稳态 RANS，精度仍受网格、湍流模型及边界假设限制。

## 补算和打包

1. 在项目的 `aero-cfd` 虚拟机上运行 `cfd/.venv/bin/python cfd/library/display/solve.py <车型> <工况>`。`--help` 列出工况。在 180 km/h 无自然风下，目录直接读取 `sweep-drs-025`、`sweep-drs-050` 和 `sweep-drs-075` 的已完成算例。通过 `web/scripts/export-flow-geometry.mjs` 导出相应姿态，随后运行 `scripts/close_pose.py`、`sweep/prepare.py` 和 `scripts/run_anchor.sh`。
2. 从项目根目录运行 `cfd/.venv/bin/python cfd/library/display/catalog.py`。原始算例保留在 `cfd/library/cases/`。网页复用已打包的速度场，从原始采样生成独立的有效点位图。同一车型内容相同的位图共用一个文件，位图与速度文件按 SHA-256 校验。
3. 在 `web` 目录运行 `npm run validate:worker` 和 `npm run build`。前者包含用户报告的工况回放、浏览器使用的 Worker、求解场碰撞和积分收敛对照，以及数据加载失败和换车回归。

## 插值验收

对每个候选区间，用两端速度场预测中间的独立 OpenFOAM 工况。先测近车区域和底板区域的方向、速度矢量、有效点覆盖率及采样一致性。再用同一姿态、种子和积分设置，在固定截面上比较整车、底板和侧箱的流线。每层匹配参考截面交点至少 85%，横向与高度组合偏差的 P90 低于 6 厘米。通过后才把区间以内的相邻节点加入清单。判定及误差详见 `cfd/library/reports/*-display-validation.json`。
