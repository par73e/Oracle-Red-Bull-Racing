# 双车气流与环境交付记录

本地页面：http://127.0.0.1:5173/ 。保持 Vite 运行，未部署远程站点，也未自动提交或推送源码。

## 已交付

- RB19、RB16B 分别使用 9 个真实离线粗网格 CFD 工况，共 18 个，不互套车型数据。
- 车速 0–350 km/h、前轮转向、独立轮速及 DRS 开度连续改变流线；默认轮速随车速同步，手动轮速表示滑移条件。
- 零来流、零轮速时流线停止；静止车身仍可显示转轮诱导的轮边流动。
- 原创风洞、Eau Rouge 谷底、Raidillon 上坡／坡顶及中性检视场景可切换；2021／2023 布置分开，远景按深度虚化。
- 手机相机保持在风洞内；界面文字有稳定浅色保护面、本地 Inter 字体、一致 SVG 图标和中文失败恢复提示。

## 验证与边界

模型资产验证、机构、运动、RB19 连杆连续性、18 个流场文件哈希与插值节点、连续速度变化、独立完整三角网格流线穿透检查均通过；生产构建通过，仍有 Three.js 主包体积提示。网页实际检查包含双车切换、速度端点、静止独立轮速、转向与 DRS 组合、鼠标拖动、失败后重试，以及桌面和 390px 手机视口。

检查结果见 `docs/research/browser-airflow-checks-2026-11-10.json`、`browser-airflow-recovery-2026-11-10.json`、`browser-final-review-fixes-2026-11-10.json` 和 `flow-geometry-checks-2026-11-10.json`。界面独立审阅经启动重试完成，五项修改复核均 resolved，最终 disposition：ship；作用范围见 `.impeccable/review/finish-verdict.md`。文档代理额度耗尽后由主代理按降级流程补齐记录。

这些是探索性稳态 RANS 结果，不能把固定步数结束、有限值或 Mesh OK 称为工程收敛。RB16B 的严格残差目标尚未达到，基线有一个孤立异常采样点被标为无效；原始日志和结果保留。详情见 `cfd/library/reports/library-quality.md` 与 JSON。

中间及组合工况采用稀疏加性近似，静止转向轮边场还有局部坐标变形；没有完整高阶耦合、瞬态湍流、工程 CAD、网格独立性或实验验证。350 km/h 使用不可压近似，误差未量化。风洞房间壁面效应和真实赛道过弯载荷没有求解；斯帕地形与建筑是公开实景关系的展示近似。方法及复算入口见 `cfd/library/README.md`。

## 资产与资源

- 林木素材由内置 imagegen 生成：`web/public/environments/ardennes-beech-v1.webp`；完整提示词 `web/public/environments/ardennes-beech-v1.prompt.txt`，原始透明 PNG 在 `docs/design/assets/ardennes-beech-v1.png`。它不是斯帕实拍或测绘素材。
- 字体本地文件和原许可在 `web/public/fonts/`，没有安装到系统字体目录。
- CFD 专用 `aero-cfd` 虚拟机已停止，未动其他计算资源；本轮气流和场景工作未启动 Blender，最终未发现 Blender 进程。
- 原模型 GLB、Blender 文件和全量 CFD 算例仍为本地资产，不能假定 Git 仓库包含所有制作文件。
