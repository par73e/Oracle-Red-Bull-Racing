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

当前可编辑制作文件（`2026-11-09-continuity1`）：

- [RB19](assets/working/rb19/rb19-web.blend)
- [RB16B](assets/working/rb16b/rb16b-web.blend)

初次导入副本为各车型目录的 `<车型>.blend`。带统一灯光和材质预览的检查副本：[RB19](assets/working/rb19/rb19-review.blend)、[RB16B](assets/working/rb16b/rb16b-review.blend)。检查脚本会覆盖检查副本，生成脚本会覆盖 `*-web.blend`；后续手工制作请另存版本。操作时一次只运行一个 Blender，保存后退出。

原下载文件完整保存在 `assets/archives/<车型>/`，解压后的资源在 `assets/source/<车型>/`。文件名、大小和 SHA-256 校验值见 [模型文件清单](docs/research/model-files.json)。原始资产保持原样，后续编辑在工作副本中进行。

资产流程为：原始下载 → 源文件 → Blender 工作副本 → 优化导出 → `web/public/`。网页实际加载本地生成的 `web/public/models/<车型>.glb`，与下载的来源 GLB 分开保存；当前没有线上部署。

## 当前状态（2026-11-09）

- 四个下载文件已在本地工作区归档，两个车型均已生成 Blender 工作副本。
- Blender 官方 Lab MCP 已接入，重启后已通过当前聊天的原生工具验证实时连接。
- 已完成首轮几何结构、现有贴图与材质基准检查，并修正 RB16B 检查副本的主要材质通道错误。见 [模型检查报告](docs/research/model-review-2026-11-08.md)。
- 当前模型版本为 `2026-11-09-continuity1`，支持 DRS 液压联动、四轮自转和前轮转向，补建 RB19 简化底板通道。RB16B 采用竖直展示转向轴并保留静态外倾；RB19 原生整流根部固定，细杆在内部搭接。见 [机构研究与修复](docs/research/mechanical-rig-2026-11-09.md)。
- 开发阶段已完成记录中的机械采样、网页近景、GLB 格式与构建检查；具体范围和限制见 [交付说明](docs/web-model-handoff.md)。两车为约 5.5 单位长的米级展示尺度，底板、机构和材质是视觉近似，尚无 CFD 或气流功能；具体赛道版本、精确尺寸及真实气动效果未确认。
- `web/` 已建立 Three.js 本地验收页，可切换车型、操作部件与观察角度。[启动方式](web/README.md)、[交付说明](docs/web-model-handoff.md)。

Node.js 版本记录在 `.node-version`。在项目中执行 `fnm use` 可切换到对应版本。

## Git 与素材许可

代码和说明文档由 Git 管理。原始下载、解压模型、Blender 工作文件、导出文件和预览图目前只保存在本地，已加入 `.gitignore`；它们没有随远程仓库备份。

第三方模型的作者和许可见 [模型署名记录](docs/research/model-attributions.md)。根目录 `LICENSE` 不替代第三方资产自身的许可。正式发布前，按需要选定版本管理方式并补齐发布资源的署名。
