# Eau Rouge 坡底仰视重建

视觉方向：真实米制场地、自然多云日光、实拍沥青与植被材质；赛车在前景，Raidillon 坡度与盲顶在中景主导构图。

场景保留风洞、纯空白、Eau Rouge 三项。默认相机在谷底车辆后方朝坡顶；保留绕车、近景和自由相机。采用统一现代场景，切换赛车不再自动切换场地年代。

几何依据：TUMFTM 中心线及路宽、地理线配准、SPW 0.5m LiDAR 的 1,881 处地形采样和道路高程。按米制使用数据，不人为放大高度。地理线配准中位距离约 1.61m，不是测绘级模型；建筑尺寸按实拍比例估计。

参考 2023 WEC 坡底照片：新看台沿道路左侧，中段右侧是草地楔形及绕行道路；护栏、立柱、看台与树林使用立体几何。使用 CC0 摄影 PBR 材质、真实 HDR 天空和 Poly Haven 三维树模型。原始成熟松树针叶网格约 684 万三角面，从中截取 103,377 面的真实针叶枝组，在 Blender 渲染三个方向；以 436/212 个枝叶中心组成近/远景立体分层树冠，近景保留原树干。不是整棵树面向镜头的平面贴片。

场景切换沿用现有相机缓动，不改变 CFD 计算域，不将直线流场称为弯道 CFD。

## 来源及再现

- [官方弯道说明](https://www.spa-francorchamps.be/de/news/96_les-virages-du-circuit-de-spa-francorchamps)：左—右—左弯、盲顶和约 40m 的整体爬升背景。
- [TUMFTM 赛道数据库](https://github.com/TUMFTM/racetrack-database)：中心线及左右宽度；原始 `TUM-Spa.csv` 与 LGPL-3.0 许可一并保存。不是赛道官方 CAD，源路宽主要来自卫星图估算。
- [地理定位参考](https://github.com/bacinger/f1-circuits)：MIT 许可，保存原始 GeoJSON 与许可；刚性 ICP 配准中位距离 1.61m。
- [SPW LiDAR MNT](https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer)：源栅格分辨率 0.5m，网页地形为 15m 网格采样，并非完整 0.5m 网格；路面高程约每 10m 采样后作保形插值。道路所用 670m 区段净高差 28m、最低至最高约 35.3m，未人为拉高至官方概述的 40m。路肩周围作地形接缝处理，误差与源坐标配准有关。
- [2023 WEC 坡底实拍](https://cms.autosport.nl/images/stories/2023/Internationaal/Sportscars/FIA-WEC/3_230429_6H_Spa/230426_WEC_Spa_Raidillon_JT.jpg)：看台与场地关系参考，照片仅研究使用，没有放入网页运行资源。
- Poly Haven CC0：`asphalt_02`、`leafy_grass`、`pine_tree_01`、`kloofendal_48d_partly_cloudy_puresky`；下载地址与用途见 `material-downloads.json`，运行资源同目录保留 `sources.json`。试验用而未采用的贴图移至本地 `assets/source/environments/spa/material-tests/`，保留原文件。

处理脚本按顺序为 `register-spa.py`、`sample-spa-profile.py`、`sample-spa-terrain.py`；成熟松树转换见 `prepare-mature-canopy.py`、`export-mature-pine.py`、`prepare-pine-branch.py`、`render-pine-branches.py`、`pack-pine-atlas.py`。依赖 NumPy/SciPy/scikit-image、Blender 5.2 和 cwebp；本地二进制源资产保存在 `assets/source/environments/spa/`。Blender 必须串行运行，完成后退出。

## 验收边界

`npm --prefix web run validate:spa` 检查三个环境入口、135 个道路节点、1,881 个地形采样，以及两车宽度和四轮相对路面的接地误差（本次最大约 2cm）。建筑、绕行道路和护栏布局为实景关系近似，未做测绘级细节复原；没有倾斜摄影或摄影测量质量的全场扫描。前景车与道路采用米制，外观改动不改变既有 CFD 网格及边界条件。
