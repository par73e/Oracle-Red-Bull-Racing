# 2026-11-09 模型近景与运动修复

依据 Sir 的六张截图修正。RB19 活动范围已由 Sir 确认：中间印 ORACLE 的上层面板翻起，下方主翼、两侧端板及端板后方延伸部分固定。

| 问题 | 原因与处理 |
| --- | --- |
| RB19 侧裙像翘起的贴片 | 上一版删面后继续细分，把边界重新拉弯。现在先固定完整细分结果，再只切内部通道区域；保留 1416 个原外侧底板顶点的位置，移除替代边条。原有固定导流小翼保留 |
| RB19 尾管白色 | 原共用烘焙材质未体现尾管质感。已分配热变色金属、出口热色与较暗内壁；周围整流罩仍为碳纤维 |
| RB19 DRS 带动固定翼尖 | 高度选面误带了外侧延伸段。已重划内外侧边界、封边并三角化，活动组仅含内侧上层面板 |
| RB16B 前轮摇摆 | 模型前轮带外倾角，原自转轴却水平。已拟合几何轮轴与轮心，增加独立外倾轮轴父级，使车轮沿自身轴旋转 |
| RB16B HONDA 字样留在原地 | 字样是独立贴片。已将正反面及边缘共 5 个贴片绑定到活动翼片 |
| RB16B 刹车盘紫色 | 可见外层 `DISK_*` 和小盘面 `discs` 使用不同材质。已分别修正；外层使用独立碳刹车材质、正确颜色/法线、居中平面 UV，并加入各自车轮自转组；刹车钳不自转 |

## 验证

- 独立读取导出 GLB 顶点，每轮抽查 25 个自转姿态。RB16B 前轮最大轴线摆动从修复前约 8.12° 降至数值误差量级。这是模型几何检查，不是真车定位精度。[修复前记录](before-fix-wheel-checks-2026-11-09.json) / [修复后记录](moving-geometry-checks-2026-11-09.json)。
- 两车型固定主翼与相关外侧结构在 DRS 开合前后顶点位移为零；HONDA 的 5 个贴片随活动翼片实际移动。
- 网页检查了四个自转姿态及通过转速滑块驱动的实际旋转。[浏览器记录](browser-fix-motion-2026-11-09.json)。
- 射线检查确认可见 `DISK_LF` 已使用 `RB16B_CarbonDisc_Outer`，近景中紫色消失。
- 两份最终 GLB 各 0 错误、0 警告；网页构建通过。[格式检查](web-asset-validation.json)。
- Blender 逐辆运行，检查/制作脚本使用共享锁；导出后退出，没有同时打开两个 Blender 窗口。

## 近景对照

- RB19 侧裙：[之前](../../assets/previews/fixes-2026-11-09/before/rb19-floor.png) / [之后](../../assets/previews/fixes-2026-11-09/rb19/floor-browser.png)
- RB19 尾翼与尾管：[之前](../../assets/previews/fixes-2026-11-09/before/rb19-drs.png) / [之后](../../assets/previews/fixes-2026-11-09/rb19/drs-browser-open.png)
- RB16B 尾翼：[之前](../../assets/previews/fixes-2026-11-09/before/rb16b-honda.png) / [之后](../../assets/previews/fixes-2026-11-09/rb16b/drs-browser-open.png)
- RB16B 前轮：[之前](../../assets/previews/fixes-2026-11-09/before/rb16b-brake.png) / [之后](../../assets/previews/fixes-2026-11-09/rb16b/wheel-browser.png)

## 资料与文件

参考 [FIA 2023 技术规则 3.10.10](https://www.fia.com/sites/default/files/fia_2023_formula_1_technical_regulations_-_issue_6_-_2023-04-25.pdf) 区分活动襟翼与固定结构，并结合 Sir 确认的范围制作。碳刹车参考 [Brembo 制造说明](https://www.brembo.com/en/motorsport/formula1/carbon-fibers)，耐热合金排气参考 [GoodFabs](https://www.goodfabs.com/heritage-exhaust-systems)。尾管热色为视觉近似，没有认定 RB19 的具体合金牌号。

更新文件仍是 `assets/working/<车型>/<车型>-web.blend`、`assets/exports/<车型>/<车型>.glb` 和 `web/public/models/`。原始源文件保留；修复前制作文件与导出文件备份于各车型目录的 `versions/before-fixes-2026-11-09/`。

在 `web/` 执行 `npm run validate:motion` 和 `npm run validate:assets` 复查。`node scripts/check-moving-geometry.mjs --baseline` 可读取旧备份，复现原车轮摇摆。

## 同日补修：DRS 仍带起固定主翼薄边（fix2）

Sir 再次指出，ORACLE 活动面板下方仍有一条固定主翼薄边悬空。fix1 的空间选面虽然排除了外侧翼尖，却把高度范围重叠的主翼后缘薄边也划入了活动对象；原验收仅检查已列出的固定对象，漏掉活动对象内部混入的固定网格。此前「活动组仅含内侧上层面板」的结论不完整，以本节为准。

- 实测旧 `DRS_Flap_Surface` 有两块不相连的网格：ORACLE 面板 376 个顶点，误选固定薄边 117 个顶点（Blender 制作网格口径，非 GLB 接缝拆点后的数量）。
- 生成脚本现在在空间选面后按连接关系分组，以靠近翼片铰接点的网格识别活动面板。另一块保留原位置、UV 与材质，命名为 `DRS_Fixed_Mainplane_Lip`，归入固定车身和固定翼清单；未删除这块原几何。
- RB19 制作文件、导出和网页加载副本已更新，manifest 版本为 `2026-11-09-fix2`，使刷新后的模型请求使用新的版本参数。RB16B GLB 的 SHA-256 与本次修复前一致，没有重建其 Blender 文件。
- 新增独立 GLB 检查：消除 UV/材质导出接缝的拆点影响后，活动翼片只能有一块连续网格；固定薄边在 21 个 DRS 位置中所有顶点最大位移为 0。新检查在修复前资源上失败、更新后通过。
- 网页以同一镜头检查关闭、半开和全开：薄边保持贴合固定主翼，没有随上层面板悬空。15 组 DRS/转向组合的执行器连接误差为 0（本次数值结果，非物理精度承诺），见 [浏览器记录](browser-drs-fixed-strip-2026-11-09.json)。
- `validate:motion`、`validate:assets` 和 `build` 通过；两车 GLB 各 0 错误、0 警告。构建仍有现有的 JavaScript 分包体积提示。
- 本次只顺序运行单个后台 Blender；保存、导出后已退出，并核对无 Blender 主程序残留。网页服务保留在 5173。

近景：[修复前](../../assets/previews/fixes-2026-11-09/rb19/drs-fixed-strip-front-before.png) / [修复后全开](../../assets/previews/fixes-2026-11-09/rb19/drs-fixed-strip-open.png) / [半开](../../assets/previews/fixes-2026-11-09/rb19/drs-fixed-strip-half.png) / [关闭](../../assets/previews/fixes-2026-11-09/rb19/drs-fixed-strip-closed.png)。

本次修复前制作文件与 GLB/参数分别保留在 `assets/working/rb19/versions/drs-fixed-strip-before-2026-11-09/` 和 `assets/exports/rb19/versions/drs-fixed-strip-before-2026-11-09/`。原下载和源文件未覆盖。未提交或推送 Git，未部署。
