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

## 双车交互气流与环境

相对来流与对地车速分别支持 0–350 km/h；默认无纵向滑移，轮周速度与对地车速同步。前轮转向与 DRS 开度连续改变流线。两车各有 9 个独立 OpenFOAM 粗网格稳态工况，网页加载速度场后插值与积分，不需要启动虚拟机或求解器。零来流、零轮速时流线停止；静止车辆仍可演示转动车轮诱导的局部气流。

`src/airflow.js` 负责场插值、真实几何碰撞与流线动画；`public/flow/` 保存压缩速度场、单位、工况、来源哈希和数值质量记录。`npm run validate:airflow` 检查两车 18 个文件、关键节点复现、连续性与独立响应。复算步骤与科学边界见 [流场库说明](../cfd/library/README.md)。

场景仅保留风洞、纯空白、Eau Rouge 三项，删除独立 Raidillon 场景。Eau Rouge 默认从谷底车辆后方望向上坡与盲顶，两个车型共用现代场地。中心线及宽度来自 TUMFTM 赛道库，地形来自 SPW 瓦隆地区 LiDAR 高程采样；约 1.61m 的地理配准误差仍存在，看台和护栏按照片比例重建，不是赛道测绘或车队 CAD。地形、路肩、看台与护栏为三维网格，树林用 CC0 原始三维松树的枝叶烘焙与空间分层 LOD，替换旧的 AI 整树贴片；使用摄影 PBR 草地、沥青与 HDR 天空。风洞内显示自由外流算例，不包含场景房间的壁面效应；赛道也没有另算真实过弯载荷。

底盘另有两车型独立的局部加密基线，180 km/h、直行、DRS 关闭且轮周速度为 50 m/s 时直接使用；其他工况通过速度缩放加上对应粗网格整车场相对基线的变化，属于探索性代理近似，而非其他工况的底盘加密重算。无有效采样处终止，来流和车轮均为零时无流线。密度控制同时调整这些流线。两档网格仍有差异，RB19 尚未充分收敛，没有近壁边界层或工程验证。数据来源、计算过程与限制见 [底盘加密研究](../cfd/library/underbody/README.md)。

两车侧箱下方、上沿及前悬挂另接入独立的局部加密基线；工况改变时由旧粗网格差分近似，局部缺失处沿用缩放基线。计算仍未充分收敛、没有近壁边界层，详见 [侧箱和前悬挂研究](../cfd/library/sidepod/README.md)。自由观察时 Q 或空格上升、E 下降，Shift 加速。

流线用于探索与展示。中间开度、组合状态及低速轮边场均有近似，不构成实时 CFD、瞬态湍流或真实赛车性能预测。详情可在页面的“模型来源”中查看。

## 2026-11-10 验收补充

两车当前模型版本为 `2026-11-10-tail-detail1`；尾翼支座和细尺度碳纤维纹理见 [尾翼支座记录](../docs/research/drs-mount-detail-2026-11-10.md)。在 `web/` 运行 `npm run validate:fairing` 可额外检查 RB19 网页连杆外壳的真实切口连续性；它不由原有刚性机构检查替代。

### 2026-11-12 独立来流与对地速度

相对来流、对地车速分开控制，均为 0–350 km/h、每格 5 km/h。轮速由对地速度自动计算，风洞风扇随来流、地面履带随对地速度。8 个新 CFD 种子已发布；每车 277 个单轴节点的队列正在本地逐项计算，页面显示当前覆盖率并读取新增结果，尚未算到的档位明确使用近似预览。完整说明与恢复命令见 `cfd/library/sweep/README.md`。同时变化多个参数与底盘/侧箱加密场仍为代理近似。

滑块性能修复：流场混合、三组流线积分与碰撞检查已移到独立 Web Worker，主线程只提交最新参数并接收几何；拖动不启动新的 OpenFOAM 求解。`npm run validate:worker` 验证线程前后结果一致；测量和限制见 `docs/research/slider-performance-2026-11-12.md`。

### 2026-11-12 Eau Rouge 场地重建

接边修复：`src/spa-surface.js` 统一缓冲区、辅路与地形横断面，修复俯视时的铺装穿插；涂层和相机另处理远距离深度精度。`validate:spa` 包含三角面穿透回归检查，详见 [接边修复记录](../docs/research/spa-2026-11-12/seams-fix.md)。

几何与素材来源、重建方式和误差见 [场景记录](../docs/research/spa-2026-11-12/brief.md)。135 个道路节点、1,881 个独立地形采样，单位统一为米；车辆处路宽 8.379m、两车宽约 2.04m。`npm run validate:spa` 核对场景数量、道路连续性、路宽、双车尺度与轮胎接地偏差。地形与周边建筑用于视觉展示，不参与弯道 CFD。Blender 原始处理文件保存于 `assets/working/spa/`，针叶烘焙脚本与可重跑处理位于 `scripts/environments/`；本地源资产未纳入 Git。
