# AERO Model Studio

Three.js + Vite 本地资产验收页。支持两款车型、DRS 与液压杆联动、四轮自转、前轮转向，以及整车/侧面/尾翼/底板观察。

前轮使用主销轴与固定长度转向拉杆求解；DRS 使用固定长度活塞杆与实际插入量，详细说明见 [机构研究与修复](../docs/research/mechanical-rig-2026-11-09.md)。在 `web/` 执行 `npm run validate:mechanisms` 可检查导出层级、网页驱动、连接误差和液压行程；Blender 网格表面碰撞检查由 `tools/blender/verify_mechanical_clearance.py` 逐辆运行。

## 启动

```bash
cd /Users/louis/Suep/Project/AERO/web
npm ci
npm run dev
```

默认地址 http://127.0.0.1:5173/ 。`npm run build` 生成 `dist/`，`npm run preview` 本地预览静态构建。

## 生成资源

在项目根目录逐辆运行，避免多个 Blender 同时占内存：

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --disable-autoexec --python tools/blender/build_web_assets.py -- rb19 --skip-renders
/Applications/Blender.app/Contents/MacOS/Blender --background --disable-autoexec --python tools/blender/build_web_assets.py -- rb16b --skip-renders
cd web
npm run pack:assets
npm run validate:assets
npm run build
```

每个 Blender 命令结束后自动退出。去掉 `--skip-renders` 才生成比较渲染图。脚本会覆盖 `*-web.blend`，手工制作请另存文件。

`pack:assets` 保留贴图分辨率，将 16 位 PNG 转为 8 位，清理未用 UV 属性，并修复少量退化 UV 处的零切线。两个 GLB 是本地生成文件，未加入 Git；换电脑需复制资产或重新生成。

模型控制由 `src/rig.js` 驱动，接入示例与文件位置见 [交付说明](../docs/web-model-handoff.md)。GLB 没有自动播放动画。

## 双车交互气流与环境（当前实现）

网页以实际物理工况坐标（合成相对来流速度、对地车速、合成来流偏航角、前轮转角、实际 DRS 尾翼开度）统一选场，核心模块为：

- `src/flow-condition.js`：合成相对来流与物理工况坐标计算（自然风与车辆运动按分量合成，零自然风时风向不引入偏航）。
- `src/flow-catalog.js`：读取 `public/flow/<车型>/display/manifest.json`，进行 SHA-256 校验与缓存、实算节点/已验收插值区间匹配、按动压 $v^2$ 归一化的气动力插值，以及滑块覆盖刻度与最近实算工况引导。
- `src/flow-jobs.js` & `src/flow-worker.js`：在独立 Web Worker 内基于同一速度场分别为整车、底板与侧箱播种并做 BVH 几何碰撞追踪；DRS 开闭动画期间按实际尾翼姿态平滑过渡。

默认参数为对地车速 `10 km/h`、对地自然风速 `0 m/s`、正迎风 `0°`、转向 `0°`、DRS 关闭；风洞转台随风向旋转，风扇与地面履带分别响应合成来流与对地速度。命中 343 个实算节点与 66 个已校验区间时显示绿色「已求解 CFD / 相邻 CFD 插值」；其余任意转向、±90° 侧风及多参数组合自动基于已求解场、74 档 ±90° 侧风库与单轴差分实时合成（标为「CFD 组合近似」），保证任意参数位置均呈现连续流线与气动力，同时在滑块绿轨标出精确实算范围。运行 `npm run validate:worker` 可执行完整调度、三层覆盖、碰撞、积分收敛、动压插值与容错回归；打包与校验规则详见 [网页 CFD 工况库说明](../cfd/library/display/README.md)。

场景保留「风洞」「艾尔罗格 Eau Rouge」「纯白影棚」三项。Eau Rouge 默认从谷底车辆后方望向上坡与盲顶，地形来自 SPW 瓦隆地区 LiDAR 高程采样，中心线与路宽来自 TUMFTM 赛道库，树林采用 CC0 三维松树烘焙与分层 LOD；风洞内显示自由外流算例，不包含房间壁面效应，赛道也不代表真实过弯载荷。自由观察时 `WASD` 移动、`Q`/空格上升、`E` 下降、`Shift` 加速。

> 以下章节保留 2026-11-10 至 2026-11-12 的阶段演进记录（旧单轴叠加与各层独立细场脚本仅作历史复现保留，不再用于当前线上运行时）。

## 2026-11-10 验收补充

两车当前模型版本为 `2026-11-10-tail-detail1`；尾翼支座和细尺度碳纤维纹理见 [尾翼支座记录](../docs/research/drs-mount-detail-2026-11-10.md)。在 `web/` 运行 `npm run validate:fairing` 可额外检查 RB19 网页连杆外壳的真实切口连续性；它不由原有刚性机构检查替代。

### 2026-11-12 独立来流与对地速度

相对来流、对地车速分开控制，均为 0–350 km/h、每格 5 km/h。轮速由对地速度自动计算，风洞风扇随来流、地面履带随对地速度。8 个新 CFD 种子已发布；每车 277 个单轴节点的队列正在本地逐项计算，页面显示当前覆盖率并读取新增结果，尚未算到的档位明确使用近似预览。完整说明与恢复命令见 `cfd/library/sweep/README.md`。同时变化多个参数与底盘/侧箱加密场仍为代理近似。

滑块性能修复：流场混合、三组流线积分与碰撞检查已移到独立 Web Worker，主线程只提交最新参数并接收几何；拖动不启动新的 OpenFOAM 求解。`npm run validate:worker` 验证线程前后结果一致；测量和限制见 `docs/research/slider-performance-2026-11-12.md`。

### 2026-11-12 Eau Rouge 场地重建

接边修复：`src/spa-surface.js` 统一缓冲区、辅路与地形横断面，修复俯视时的铺装穿插；涂层和相机另处理远距离深度精度。`validate:spa` 包含三角面穿透回归检查，详见 [接边修复记录](../docs/research/spa-2026-11-12/seams-fix.md)。

几何与素材来源、重建方式和误差见 [场景记录](../docs/research/spa-2026-11-12/brief.md)。135 个道路节点、1,881 个独立地形采样，单位统一为米；车辆处路宽 8.379m、两车宽约 2.04m。`npm run validate:spa` 核对场景数量、道路连续性、路宽、双车尺度与轮胎接地偏差。地形与周边建筑用于视觉展示，不参与弯道 CFD。Blender 原始处理文件保存于 `assets/working/spa/`，针叶烘焙脚本与可重跑处理位于 `scripts/environments/`；本地源资产未纳入 Git。
