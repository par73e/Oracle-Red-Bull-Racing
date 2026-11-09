# 三维资产目录

按制作阶段组织资产，在各阶段内用 `rb16b/`、`rb19/` 区分车型。

| 目录 | 用途 |
| --- | --- |
| `archives/` | 原始下载包及下载的 GLB，保留原文件名与内容 |
| `source/` | 解压后的 Blender、FBX、配套贴图和原始 GLB |
| `working/` | 日常编辑的 Blender 工程，保留源文件 |
| `exports/` | 完成检查与优化后导出的 GLB 等资源 |
| `environments/` | 风洞、车库和赛道环境的制作资源 |
| `textures/` | 后续新增或修改的材质贴图 |
| `references/` | 照片、尺寸和结构参考；注明来源与对应版本 |
| `previews/` | 白模预览、渲染图、检查截图 |

原始文件清单及校验值在 `docs/research/model-files.json`，署名信息在 `docs/research/model-attributions.md`。`exports/` 中通过验收的资源再复制到 `web/public/`；原始高精度模型不直接作为网页发布版本。
