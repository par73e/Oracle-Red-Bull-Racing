# 2026-11-10 两车尾翼支座精细化

当前两车制作、导出与网页加载版本为 `2026-11-10-tail-detail1`。Sir 指出 RB19 新增支座缺少碳纤维纹理且是简单长方体／圆柱形组合，RB16B 活动翼支座明显歪斜。本次修改实际 blend 和 GLB，并同步更新网页副本。

## 根因和处理

RB19 上一版 `AERO_DRS_Mount_Carbon` 只有纯色，没有纹理和 UV；方形安装垫和锥形支撑也只是展示占位。RB16B 旧算法从翼面找最近点，活动翼支座选到了 X≈0.01528 的单侧表面，顶部却在 X=0，从而产生了横向偏斜。

新算法限定在车身 X=0 中心面与真实翼面／支柱表面的交线上寻找安装脚。两车固定和活动支座均保持左右镜像对称，安装处截面顺着实际表面方向逐渐过渡到上方叉耳。正常的纵向连接走向与随翼片转动保留，不把活动件强制固定成世界坐标竖直。

- 移除 RB19 原方块安装垫、锥形支撑和矩形叉耳，以及 RB16B 原偏置放样支座。
- 重做多截面圆滑支座，包含根部扩口、圆滑收颈和带真实孔位的水滴形双叉耳；局部倒角保留薄边厚度。
- 两车支座与叉耳使用 `AERO_DRS_Woven_Carbon`。程序生成细尺度 2×2 斜纹的颜色、法线贴图，按展示米级尺度约 0.8 mm 的纤维束宽排布 UV；这一比例是视觉设计，不是实车测量值。纹理生成不依赖下载的参考图。
- 销轴与轴承保留金属，补充车削倒角和带内六角凹槽的紧固端头；活塞杆仍为独立抛光金属，没有把功能金属件统一涂成碳纤维。
- 液压杆定长、活塞插入量、转轴、翼片归属及两车转向参数保持原值。11 月 10 日第一项 RB19 连杆网页外壳过渡修复仍由 `rig.js` 处理，并已回归。

## 参考与精度边界

核对了 [F1 官方的 RB16B DRS 结构示意](https://www.formula1.com/en/latest/article/tech-tuesday-what-was-going-on-with-red-bulls-oscillating-rear-wing-in-qatar.2kXstBbrgiwMX23Su4NfrU) 及 [Giorgio Piola 的 RB19 DRS 结构示意](https://www.autosport.com/f1/news/f1-tech-review-red-bull-finds-new-ways-to-pull-further-ahead/10563230/)（文内 “Red Bull Racing RB19 DRS detail”）。两张均是公开结构示意，未作为 CAD 或尺寸图。保留原模型的单中央支柱和活动翼范围，新增安装部件属于贴合现有资产的展示重建，不声称逐件还原车队机构。

## 文件与回退

实现为 `tools/blender/detailed_drs_mounts.py`，完整生成流程 `mechanical_rig.py` 已改用同一实现。本轮通过 `refine_drs_mounts.py` 只重做已有制作副本中的生成支座，没有重跑覆盖整车的生成脚本。两车分别通过 Blender MCP 后台实例顺序处理，保存后进程退出。

当前文件为 `assets/working/<车型>/<车型>-web.blend`、`assets/exports/<车型>/<车型>.glb` 及 `web/public/models/<车型>.glb`。本轮前回退位于相应工作／导出目录的 `versions/before-tail-detail-2026-11-10/`；网页回退在 `assets/archives/web-model-backups-2026-11-10/`。这些二进制与新纹理仍为 Git 忽略的本地资产，没有远端备份。

## 验证

- 两车各 41 个 DRS 位置：执行器对翼面、中央支柱和新支座的三角形表面检查通过。新支座接头 0.014 模型单位范围内的安装接触排除在检查外，支座与翼面安装接触也不是干涉错误。见两车 `*-drs-mount-clearance-2026-11-10.json`。这是离散表面检查，不是完整实体连续碰撞证明。
- `validate:mechanisms`：两车定长、接头与活塞行程回归通过；直接核对新支座的导出纹理、UV、X 中心与镜像顶点，镜像偏差约 1.1–1.7e-6 模型单位，属于 float32 细分舍入量级，不是实车尺寸精度。
- `validate:fairing`、`validate:motion` 通过。`validate:assets` 两车均 0 错误、0 警告。`build` 通过，保留既有 JS 大包提示。
- ego lite 独立任务 Space 中，逐车检查闭合／半开／全开近景与每车 15 组网页机构组合。见 `browser-tail-detail-2026-11-10.json`，截图位于 `assets/previews/tail-detail-2026-11-10/`。任务 Space 已关闭。

尚待 Sir 最终目视验收。未提交、推送或部署。
