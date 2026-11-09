# 红牛赛车模型候选｜2026-11-07

## 检索范围与结论

用户后续明确收窄目标：只优先寻找 **RB16B 和 RB19 的车体几何模型**；贴图、涂装与材质作为后续独立工作。RB20 不再是当前优先选型。筛选应先看白模、线框、底板、部件拆分及参考照片对应关系，不能用贴图分辨率或总面数替代几何还原度。

优先考虑近年的红牛赛车，并按用户给出的参考图纳入 2021 RB16B，以便比较 2022 年前后两代空力规则。两代都属于混动赛车；这里用“2022 年前车型”和“2022–2025 地面效应车型”区分。

目前仅完成公开页面、文件清单及部分预览的检查。没有购买或下载模型，也没有在 Blender 中验证拓扑、材质、部件分离、DRS 或底板隧道。页面的精度与可用性描述属于卖方或上传者声明。

建议先用免费 RB19 与 RB16B 检查几何质量；付费方案重新围绕这两种车型评估。最终选型以源文件验收为准。

### 按几何需求补充核验

- [Project 212 新版 RB19 实时预览](https://sketchfab.com/3d-models/f1-red-bull-rb19-ea3757002f7844238560a557a17e4b9d)：已在 ego lite 中打开，约 150 万三角面，作者列出 BLEND／FBX／OBJ，宣称包括引擎及座舱细节。评论区有买家反映尺寸问题，这只是买家反馈，尚未验证是否属实或已修复；选用前需要检查单位、轴距和比例。不能依据高面数认定外形准确。
- [Factorio 的 RB16B 建模作品](https://factorio.artstation.com/projects/r9DY8J)：已在 ego lite 中打开，作者展示白模、线框、悬挂分解图，适合作为几何质量评估线索；本次未找到源文件销售或下载入口，不能当作已可获取的模型。
- 同一车型应记录模型所声称对应的发布版、赛季阶段或大奖赛配置；优先让整车部件来自一致的参考版本。当前尚未要求用户选定具体分站。

## 优先候选

| 车型／上传者 | 页面价格 | 页面明确列出的内容 | 评价与未确认项 |
| --- | --- | --- | --- |
| RB19 2023／Redgrund，Sketchfab | 免费 | 675k 三角面；341.1k 顶点；CC Attribution；标注 Uploaded with Blender | 已确认有下载入口，点击要求登录；查看到了完整涂装预览。适合优先试用。未确认可下载的具体文件格式、贴图分辨率、原创来源、底板和部件层级。 |
| RB16B 2021／MattDoesBlender，Sketchfab | 免费 | 256.2k 三角面；143k 顶点；许可链接为 CC BY 4.0 | 可作为上一代待验候选。页面无说明；本次预览加载后模型取景很小，未能据此可靠判断材质和细节质量。不能承诺满足近距离展示要求。 |
| RB20 2024／Sarvesh，ArtStation | USD 30 | 4K 贴图；Blender、GLB、glTF、FBX、OBJ、Maya；文件清单列 GLB 63 MB、Blender 23 MB；同作者 Sketchfab 预览约 239.2k 三角面 | 格式最契合现有工具，优先评估的付费候选。尚未确认独立 DRS 翼片、转轴、底板内部或网页渲染质量。63 MB GLB 仍需优化。Standard Use License 的公开网站使用范围需核对。 |
| RB16B 2021／DSGStudio，RenderHub | USD 99 | 2K–4K 贴图；MAX、FBX、OBJ；无现成绑定或动画；85.8 MB 下载包 | 细节型付费备选。无原生 Blender 文件，FBX 为标准材质，需重建材质与动画。详情表和描述的面数不一致（396,582 与 560,319）；不能直接作为性能预算。许可标有 IP Restricted／Editorial 限制。 |

价格为本次页面显示值，不代表下单时价格或含税总价。

## 直接链接

- [免费 RB19／Redgrund](https://sketchfab.com/3d-models/oracle-red-bull-f1-car-rb19-2023-e4afe46f3aab4b23a418da06fc163821)
- [免费 RB16B／MattDoesBlender](https://sketchfab.com/3d-models/redbull-rb16b-19e81922e7144e4193c01f307e37f23a)
- [RB20／Sarvesh／ArtStation](https://www.artstation.com/marketplace/p/Lrky0/redbull-rb-20-f1-2024)
- [同作者 RB20 的 Sketchfab 预览](https://sketchfab.com/3d-models/f1-redbull-rb-20-2024-0c9e188ef67b49f1bafd4b9e290a410c)
- [RB16B／DSGStudio／RenderHub](https://www.renderhub.com/dsgstudio/f1-redbull-rb16b-season-2021)

## 其他线索与筛除理由

- [Sarvesh RB19 Rigged，USD 40](https://www.artstation.com/marketplace/p/mj8NV/redbull-rb19-rigged)：页面明确说绑定在 Maya 文件中，OBJ／FBX 不带材质和绑定。不能因为标题含 Rigged，就认为 Blender 或网页能直接使用 DRS 动画。约 141,619 多边形，4K 贴图。
- [Project-212 RB19](https://www.cgtrader.com/3d-models/car/racing-car/f1-red-bull-rb19)：检索内容列 USD 30、Blender、4K、PBR、约 150 万多边形；但浏览器访问跳转到模型列表，本次未可靠核验实时销售状态，仅保留线索。
- [Kney RB16B](https://www.cgtrader.com/3d-models/vehicle/other/f1-redbull-rb16b-season-2021-low-poly-3d-car-model)：检索内容列 Blender、glTF、Animated／Rigged、约 USD 20；统计字段存在疑点，未验收源文件。
- [Kney RB18](https://www.cgtrader.com/3d-models/car/racing-car/red-bull-racing-f1-car-rb18-2022-formula-one-season)：检索页面有贴图与跨软件使用的负面买家反馈，不作为高还原目标的首选。
- 免费 RB20 转载页与付费原创页存在相同三角面数等相似信息；这不足以认定侵权，但本次未能确认来源，不优先采用。
- 3D 打印 STL 和 Gaussian Splat 扫描，不优先用于本项目的精细材质、独立翼片与气动几何需求。

## 拿到源文件后的验收

1. 对照实际车型照片，检查侧箱、悬挂、前后翼和轮胎，排除通用展车套涂装。
2. 检查底板下表面：文丘里隧道入口、喉部、扩散器是否实际建模。外形像地面效应赛车不能证明底板完整。
3. 确认 DRS 活动翼片独立、转轴可设置，四轮能独立运动。
4. 检查基础色、粗糙度、法线等贴图完整性，确认车漆、碳纤维、橡胶能分别调节。
5. 导出 GLB，在网页里检查近景质量、文件体积、材质数、绘制调用与运行帧率。
6. 公开部署前核对源作者权限、署名要求及可下载网页资产的许可范围。购买模型不等于获得车队官方气动数据。

## 规则与许可参考

- [Honda RB18 官方资料：地面效应回归、混动动力单元](https://global.honda/en/F1/machine/2022_RedBullRB18/)
- [F1 官方 RB18 分析：文丘里隧道](https://www.formula1.com/en/latest/article/tech-tuesday-the-design-secrets-that-set-red-bulls-rb18-apart-from-its-f1.1ul2YIRb2nFywEwjYLWe0l.1ul2YIRb2nFywEwjYLWe0l)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [CGTrader Royalty Free 许可说明](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License)
- [CGTrader 完整条款](https://www.cgtrader.com/pages/terms-and-conditions)
