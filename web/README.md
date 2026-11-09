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

模型控制由 `src/rig.js` 驱动，接入示例与文件位置见 [交付说明](../docs/web-model-handoff.md)。GLB 没有自动播放动画。当前页面未运行气流仿真。
