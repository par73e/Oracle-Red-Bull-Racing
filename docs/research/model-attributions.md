# 赛车模型来源与署名

以下两段署名由用户从各自 Sketchfab 下载窗口复制提供，原文保留。页面标注的许可及作者信息不代表本项目已独立确认上传者拥有全部相关权利。

## RB19

"Oracle Red Bull F1 Car RB19 2023" (https://skfb.ly/oR7sq) by Redgrund is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

- 完整来源页面：https://sketchfab.com/3d-models/oracle-red-bull-f1-car-rb19-2023-e4afe46f3aab4b23a418da06fc163821
- 下载窗口所示原始格式：Blender `.blend`，约 123 MB。
- 建议同时保存的展示格式：GLB，4K 贴图，约 51 MB。

## RB16B

"Redbull rb16b" (https://skfb.ly/py9Uu) by MattDoesBlender is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

- 完整来源页面：https://sketchfab.com/3d-models/redbull-rb16b-19e81922e7144e4193c01f307e37f23a
- 下载窗口所示原始格式：FBX `.fbx`，约 16 MB。
- 建议同时保存的展示格式：GLB，4K 贴图，约 16 MB。

## 2026-11-07 初次导入记录（历史）

- 已完成初次导入：RB19 原始 `.blend` 可读取；RB16B 原始 FBX 可导入。完整几何还原度、底板和机械动作尚未验收。
- 本地工作副本位于 `assets/working/rb19/rb19.blend` 和 `assets/working/rb16b/rb16b.blend`。仅调整查看范围和灰模显示，没有修改车体几何；原下载文件保留。
- 初次导入时 RB19 场景为 1 个网格对象，RB16B 为 315 个网格对象。两者导入后的比例不同，需要在后续工作中核对单位、比例和部件层级。
- 修改后的模型应补充修改说明，例如单位与朝向修正、网格优化、材质调整或部件拆分。
- 网站展示与后续分发时，应保留作者、来源和许可链接，并按实际修改情况说明变更。

## 2026-11-09 制作版本与修改说明

当前两车制作及网页加载版本为 `2026-11-09-continuity1`，仍基于上述作者模型。主要改动包括米级展示尺度与朝向统一、材质通道和质感调整、网页网格与贴图打包、车轮自转／前轮转向层级、DRS 翼片拆分和近似液压机构。RB19 增补展示用底板通道；RB16B 简化展示转向轴并调整叉臂外端、清除旧机构残件，重塑碳纤维支座；RB19 整流根部固定，细杆内部搭接。

逐项修改及验证范围以 [网页交付说明](../web-model-handoff.md)、[近景修复记录](model-fixes-2026-11-09.md)、[机械机构记录](mechanical-rig-2026-11-09.md) 为准。网页的模型来源对话框保留作者、来源与 CC BY 4.0 链接；原始资产和衍生二进制仍仅本地保存，没有随代码仓库备份。历史导入阶段的“未修改几何”不描述当前制作版本。
