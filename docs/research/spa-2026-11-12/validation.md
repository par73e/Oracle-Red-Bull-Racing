# 场景验证 — 2026-11-12

- `npm --prefix web run validate:spa` 通过。两个车型车宽约 2.04m，车辆处路宽 8.379m；四轮相对采样路面最大高度偏差约 2cm。135 个道路节点、1,881 个地形采样均为有限米制数据。
- `npm --prefix web run build` 通过；仍有既有主包大于 500KB 的 Vite 提示。`git diff --check` 通过。
- Ego Lite 同一任务 Space 中检查纯空白、风洞、Eau Rouge，以及 RB19/RB16B 切换。未发现页面异常和 HTTP 失败资源。结果保存在 `browser-qa.json`。
- 当前电脑桌面 1440×900、像素比 1.5、开启气流：连续 120 帧约 29.1 FPS。连续输入 71 档速度约 3.4s，无 PerformanceObserver 长任务；这不是 60FPS 或跨设备性能保证。首次场景/模型加载及 GPU 编译耗时未算入稳定帧率。
- 390×844 仿真手机宽度无横向溢出。首次检查发现面板遮住车辆，修正 Eau Rouge 的面板最大高度为 32svh，并把场景说明移至环境切换下方；`/private/tmp/aero-spa-mobile-refined.png` 已目视验证车辆完整可见，其他参数可在面板内滚动。未做实体手机或跨浏览器测试。
- 最终预览为 `preview-desktop.png` 和 `preview-scene.png`；本轮浏览器任务已 finish，未接管或关闭用户已有非空 Space。
- 本轮 Blender 均串行后台运行，保留 `assets/working/spa/photographic-pine-lods.blend`、`mature-pine-lods.blend`、`pine-branch-bake.blend`。树木 GLB 与针叶三个方向渲染已保存；最后日志含 `Blender quit`，进程检查确认无残留 Blender。
- 逐档 CFD 队列保持运行，未停止或修改计算。20:06 本地状态为 RB19 36/277、RB16B 35/277，正在 RB16B air-145；实际后续进度以队列状态文件为准。

道路数据和高程是公开资料重建，建筑细节仍为人工估计；当前是写实材质的实时三维展示，未达到摄影测量或照片级全场复刻。场景没有生成或替换弯道 CFD。
