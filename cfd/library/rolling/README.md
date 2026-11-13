# 来流与对地车速独立 · 纯滚动

所有数值采用车身固定参考系。入口速度 U 与地面向车后运动的速度 G 独立；四个轮子的旋转壁面满足 `omega = G / radius`，不再使用旧的停轮／超速／静止空转工况去代替地面变化。不同半径使用不同角速度。新工况为直行、DRS 关闭；转向组合延续姿态代理，不代表无侧滑真实转弯。

每车新增 4 个算例，原算例与已完成结果不覆盖：

|键|来流 U (m/s)|地面 G (m/s)|轮周速度 (m/s)|
|---|---:|---:|---:|
|road-stop|50|0|0|
|road-slow|50|25|25|
|road-fast|50|100|100|
|still-air|0|50|50|

50 m/s = 180 km/h，25 m/s = 90 km/h，100 m/s = 360 km/h。网页两项均为 0–350 km/h；360 km/h 节点用于覆盖其上限。各车复用自己的原 base 网格、计算代理和原始边界定义；复制至 `cases/<car>-rolling-<anchor>`，记录网格和代理哈希。两车串行、每例四进程、650 步。自由来流湍流参数只按 U 设置，固定 U 的扫描保持相同入口湍流。零来流使用 k 下限 1e-6，不代表测得的背景湍流。

```sh
cfd/.venv/bin/python -u cfd/library/rolling/run.py
cfd/.venv/bin/python cfd/library/rolling/audit.py
cd web
npm run validate:rolling
npm run validate:flow-geometry
npm run validate:underbody
npm run validate:sidepod
npm run build
```

新数据位于 `web/public/flow/<car>/rolling/`，元数据在 `cfd/library/reports/<car>-rolling-*.json`，质量汇总记录残差、守恒、末 100 步力波动和异常取样数。打包前核查日志正常结束、最终采样为 650、场有限且广泛速度异常不存在；极少量异常采样置为无效，保留原始最大值和排除数量。

## 网页插值与适用边界

`rollingWeights(U,G,steer,drs)` 在 U=50 的 G/U 比值 0、0.5、1、2 之间插值，将相对于原 base 的差分按 U/50 缩放，加到原 low/base/high 的同速基线上。G>2U 时，在按 G 缩放的 road-fast 与 still-air 之间混合，并连续保留同速基线修正。DRS 和转向仍使用原独立差分。十个有效节点（原 low/base/high/open/left/right 加新增四例）精确复现对应数据；二者均为零时停止显示流线。其他输入是速度缩放、差分叠加的稀疏代理，不是每个滑块位置的新 CFD，不保证守恒或雷诺数效应准确。

底盘及侧箱继续使用旧的 180 km/h 同速加密基线与新粗场的差分；没有新增这两个区域的加密求解，界面继续提示近似。轮边仍是体素代理、无边界层网格、稳态旋转壁面，不解析胎纹、胎形变或瞬态轮辐尾流。零来流移动地面的极限工况还受有限域和入口／地面交界影响。高速仍为不可压模型，新增 G=100 节点用于插值覆盖，不能视为已验证的高速精度。
