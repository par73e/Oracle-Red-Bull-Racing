# AERO / 01

红牛 F1 赛车的三维展示与气动交互项目，当前车型目标为 RB16B 和 RB19。模型几何优先，贴图、材质和网页体验逐步完善。

## 项目目录

```text
AERO/
├── assets/                 三维资产制作与管理
│   ├── archives/           四个原始下载文件，按车型归档
│   ├── source/             解压后的源模型和配套贴图
│   ├── working/            可编辑的 Blender 工作副本
│   ├── exports/            优化后导出的网页模型
│   ├── environments/       风洞、车库、赛道等环境资产
│   ├── textures/           后续制作、调整的贴图
│   ├── references/         外形、结构和场景参考资料
│   └── previews/           模型预览、渲染图和检查截图
├── web/                    网页应用
│   ├── src/                页面、交互与三维场景代码
│   └── public/             网页实际发布的模型、贴图和环境资源
├── tools/                  资产处理和开发辅助脚本
│   └── blender/            模型导入与官方 MCP 连接脚本
└── docs/                   项目说明、调研和署名信息
    └── research/           模型候选、导入记录和文件清单
```

## 模型文件

当前可编辑制作基线为 `2026-11-10-tail-detail1`：

- [RB19](assets/working/rb19/rb19-web.blend)
- [RB16B](assets/working/rb16b/rb16b-web.blend)

初次导入副本为各车型目录的 `<车型>.blend`。带统一灯光和材质预览的检查副本：[RB19](assets/working/rb19/rb19-review.blend)、[RB16B](assets/working/rb16b/rb16b-review.blend)。检查脚本会覆盖检查副本，生成脚本会覆盖 `*-web.blend`；后续手工制作请另存版本。操作时一次只运行一个 Blender，保存后退出（见 [AGENTS.md](AGENTS.md)）。

原下载文件完整保存在 `assets/archives/<车型>/`，解压后的资源在 `assets/source/<车型>/`。文件名、大小和 SHA-256 校验值见 [模型文件清单](docs/research/model-files.json)。原始资产保持原样，后续编辑在工作副本中进行。

资产流程为：原始下载 → 源文件 → Blender 工作副本 → 优化导出（普通 GLB + WebP/Meshopt 压缩 `.web.glb`）→ `web/public/models/`。线上站点部署于 `https://red-bull-racing.par73e.cn/`。

## 当前状态（2026-11-22）

- **模型与机构**：两车制作基线为 `2026-11-10-tail-detail1`，支持 DRS 液压联动（二态开关与过渡动画）、四轮自转与前轮转向，RB19 含简化底板通道，RB16B 含驾驶舱安全带与尾部碳纤维/排气细节。网页默认加载压缩后的 `.web.glb`（约 6.8 MB/车）。
- **三维场景**：提供「风洞（11 叶翼型风机 + 联动转台）」「艾尔罗格 Eau Rouge（含曲面阴影与 LiDAR 地形）」「纯白影棚」三个场景，支持自由观察与车体部位预设机位、`localStorage` 状态保持及自动/手动隐藏 HUD。
- **统一实算 CFD 流场与气动力**：整车、底板与侧箱共享当前工况选定的 OpenFOAM 粗网格稳态 RANS 速度场（详见 [cfd/library/display/README.md](cfd/library/display/README.md)），不再使用历史单轴叠加近似或 F1 基准估算。网页通过 `web/public/flow/<车型>/display/manifest.json` 在 343 个实算节点与 66 个经独立算例校验的插值区间内选场（气动力按动压 $v^2$ 归一插值），超出覆盖时隐藏流线并提供滑块覆盖刻度与一键切换最近实算工况。
- **调试与验收入口**：前端启动与校验见 [web/README.md](web/README.md)；浏览器控制台可通过 `window.aeroStudio`（含 `airflow`、`forces`、`metrics`、`runKinematicChecks()` 等）复核姿态、已显示工况与来源。
- **科学边界**：当前 CFD 基于展示几何的粗网格稳态 RANS（无近壁棱柱边界层），网格独立性验证、实验对照及多轴混合组合覆盖仍有局限，不代表车队实车工程载荷。

Node.js 版本记录在 `.node-version`。在项目中执行 `fnm use` 可切换到对应版本。

## Git 与素材许可

代码和说明文档由 Git 管理。原始下载、解压模型、Blender 工作文件、导出文件和预览图目前只保存在本地，已加入 `.gitignore`；它们没有随远程仓库备份。

第三方模型的作者和许可见 [模型署名记录](docs/research/model-attributions.md)。根目录 `LICENSE` 不替代第三方资产自身的许可。正式发布前，按需要选定版本管理方式并补齐发布资源的署名。
