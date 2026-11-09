# 网页模型第一版交付

2026-11-09 近景修复已更新：侧裙、DRS 活动范围、尾管材质、轮轴、HONDA 贴片与刹车盘。见 [修复记录](research/model-fixes-2026-11-09.md)。

同日 RB19 `fix2` 补修：从 DRS 活动对象中分离误选的固定主翼后缘薄边，保留为固定件；活动面板只有一块连续网格，薄边在 21 个开合位置中顶点位移为零，网页关闭/半开/全开近景已检查。刷新页面即可加载新模型。

同日两车 `mechanics2` 更新：前轮改为主销轴转向与固定长度转向拉杆联动；DRS 使用有内孔的缸体、固定长度活塞杆、销轴和实际翼面支座，检查记录见 [机械机构研究与修复](research/mechanical-rig-2026-11-09.md)。

最新 `continuity1`：RB16B 使用竖直展示转向轴并协调叉臂端部，保留静态外倾，转向不再额外抬轮；清除合并车身中的灰白旧机构，DRS 支座改用原生碳纤维编织尺度及圆滑过渡。RB19 保持轮姿参数，把原生整流根部固定回车身，细杆在内部搭接；两车车身侧连接全行程保持遮蔽。详见上述记录的同日补修一节。

2026-11-08 开始制作，2026-11-09 完成验收。按 Sir 的六点标注制作，以现有造型为基础，改善材质、建立必要机械运动并提供网页可用文件。

## 文件与操作

| 内容 | RB19 | RB16B |
| --- | --- | --- |
| Blender 制作文件 | `assets/working/rb19/rb19-web.blend` | `assets/working/rb16b/rb16b-web.blend` |
| 导出模型 | `assets/exports/rb19/rb19.glb` | `assets/exports/rb16b/rb16b.glb` |
| 部件映射参数 | `assets/exports/rb19/rb19.json` | `assets/exports/rb16b/rb16b.json` |
| 网页加载副本 | `web/public/models/rb19.glb` | `web/public/models/rb16b.glb` |

网页用 `web/public/models/manifest.json` 选择车型，通过 `web/src/rig.js` 操作节点。启动命令见 [web README](../web/README.md)。原下载、源模型和初始工作副本保留。生成脚本会覆盖制作副本，后续手动修改应另存版本。

Blender 中选中 `AERO_CAR`，自定义属性 `drs` 为 0–1 开合，`steer_degrees` 为前轮角度，`wheel_spin` 为轮子自转弧度。GLB 保留部件层级，不包含自动播放动画；网页通过配套代码驱动。

## 完成内容

- 车漆、碳纤维、橡胶、金属分别调整。修正 RB16B 导入通道，保留现有涂装与 UV；RB19 从原合并材质中分配表面类别。主要贴图保留分辨率，RB19 为 4K。Blender 使用统一柔光摄影棚；网页使用环境光、柔和布光和实时阴影。
- 四轮各自自转。前轮的轮胎、轮毂和刹车盘旋转，刹车钳、风道仅随前轮转向；后轮保持零转向。RB16B 旋转模糊替代网格不参与网页显示。转向以叉臂外端确定主销轴，移动横向齿条，求解固定长度转向拉杆两端闭合关系；上下叉臂在没有悬架跳动的展示中保持固定，内外轮角度来自该近似几何，而非车队定位数据。
- DRS 活动翼片从固定主翼分离。液压机构有带内孔的缸体、固定长度活塞杆、密封口、轴承眼、横向销轴及支座。缸体对准两接点，活塞杆从翼片端反向定位，改变插入缸体的长度，不再把整根杆从基座拉伸到翼片。接点和避让按源网格重建，仍采用展示用近似尺寸。
- RB19 补建左右两条通道，包含高入口、收缩喉部与扩散段，并补上与原底板的边缘过渡。RB16B 保留自身年代的底板和扩散器。
- 两车统一到最长约 5.5 单位的米级展示尺度；这是编辑尺度，不是精确真车测量。网页镜头仍可自由缩放。

## 接入示例

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindRig, applyRig } from './rig.js';
const configs = await (await fetch('/models/manifest.json')).json();
const config = configs.find(c => c.id === 'rb19');
const gltf = await new GLTFLoader().loadAsync(config.file);
scene.add(gltf.scene);
const rig = bindRig(gltf.scene, config);
applyRig(rig, { drs: 1, steer: 12, spin: 0.8 });
```

`drs` 为 0–1；`steer` 为中心转向输入（度），页面范围 ±18°；`spin` 是统一模型尺度下的累计滚动距离，代码除以各轮半径转换成自转角，**不是角度**。页面通过 `km/h ÷ 3.6 × 秒` 累加距离。glTF 坐标 Y 向上、+Z 向车头。保留转向、车轮与 DRS 节点层级，避免再次合并。

## 验证与性能

- Blender 每车抽查 21 个 DRS 位置，杆端误差小于 0.0001 单位；执行器行程连续，无中途越过死点，杆端不退入缸体，近似行程不超过缸体长度。原始记录位于各车导出目录的 `kinematic-checks.json`。
- 浏览器每车抽查 5 个 DRS 位置 × 3 种转向，共 15 组，检查连接点与后轮固定方向：[机构检查](research/browser-kinematics.json)。
- 完整格式校验为两车各 0 错误、0 警告；保留未引用属性等信息级记录：[格式检查](research/web-asset-validation.json)。
- RB19 约 18.2 万三角面、23 MiB；RB16B 约 25.1 万三角面、30 MiB。RB19 的 16 位 PNG 转 8 位后明显缩小；主要贴图分辨率没有降低：[打包记录](research/asset-packing.json)。
- 本机 Chrome 在 1458 × 800、像素比 2 下初轮预览约 60 FPS。渲染统计含阴影通道，会高于模型面数。这不是手机硬件性能承诺。
- 390 × 844 的窄屏布局通过浏览器尺寸模拟检查；没有在真实手机上测量。`npm run build` 成功，页面仅在本地，未部署或推送。

## 参考与范围

DRS 参考 [F1 官方的红牛液压执行器说明](https://www.formula1.com/en/latest/article/tech-tuesday-what-was-going-on-with-red-bulls-oscillating-rear-wing-in-qatar.2kXstBbrgiwMX23Su4NfrU)，采用后缘附近铰接、液压机构驱动的思路。底板参考 [F1 的通道与底板边缘说明](https://www.formula1.com/en/latest/article/tech-tuesday-why-ripples-and-curls-adorn-the-floors-of-the-2022-cars.1OHf3EXwhbt521IpbXUtVt)。[RB19 底板文章](https://www.formula1.com/en/latest/article/tech-tuesday-the-secrets-behind-red-bulls-floor-design-and-how-it-differs-to.6J1SkUEvGWomlO9BJilUK4)仅访问公开引言，会员内容没有读取。

这是材质和机械交互第一版，底板与执行器为视觉近似，没有宣称复制车队 CAD。未运行 CFD、载荷或工程干涉求解，网页当前也没有气流功能。作者、来源、CC BY 4.0 许可与修改说明已放入网页和 [署名记录](research/model-attributions.md)。

Blender 后台逐辆运行、导出即退出；交付时不保留 Blender 主程序或渲染进程。模型文件留在磁盘不会持续占用等量运行内存。
