# Blender 官方 Lab MCP 本地连接

## 已安装

- 官方源码：https://projects.blender.org/lab/blender_mcp.git
- 固定提交：`dbbf836ad4b1025f14a2b3b504c43903f39e0b04`
- 说明：https://www.blender.org/lab/mcp-server/
- Blender：5.2.3 LTS。
- 扩展：MCP 1.0.0，模块 `bl_ext.user_default.mcp`，安装到 Blender 本地 User Default 仓库。
- Python MCP 包：官方 `blender-mcp` 1.0.2，独立 Python 3.12 虚拟环境。
- 安装目录：`/Users/louis/.local/share/blender-mcp-official`。

Blender 扩展设置为自动启动，监听 `127.0.0.1:9876`。Blender 的在线访问设置已开启，以满足官方扩展的通信检查；原偏好设置备份在安装目录的 `userpref.before-mcp.blend`。

## Codex 配置

已在用户级 `~/.codex/config.toml` 新增并启用 `blender_official`。原有 MCP 保留。原配置备份在安装目录的 `codex-config.before-mcp.toml`，该文件仅保存在本机，不加入项目仓库。

启动命令：

```text
/Users/louis/.local/share/blender-mcp-official/.venv/bin/blender-mcp
```

服务环境变量：

```text
BLENDER_MCP_HOST=127.0.0.1
BLENDER_MCP_PORT=9876
BLENDER_PATH=/Applications/Blender.app/Contents/MacOS/Blender
```

## 已完成的验证

使用真实 MCP stdio 客户端完成 initialize、tools/list 和 tools/call：

- 返回 26 个工具。
- `get_blendfile_summary_datablocks` 成功读取数据块。
- `get_screenshot_of_window_as_json` 成功读取当前窗口布局。
- `execute_blender_code` 成功读取 Blender 5.2.3、当前文件路径、进程号和网格对象数；确认是交互模式，非后台模式。
- `get_screenshot_of_window_as_image` 成功取得窗口截图；人工查看后确认窗口中显示 RB19 灰模。

测试窗口加载的是本项目 `assets/working/rb19/rb19.blend`，通过独立 Blender 进程启动，未关闭原有窗口。测试没有修改或保存赛车几何。

验证记录与截图在安装目录的 `verification.json` 和 `connection-screenshot.png`。测试脚本为 `tools/blender/check_official_mcp.py`，须用安装目录内的 `.venv/bin/python` 执行。

## 当前聊天的工具加载

用户完全退出并重新打开聊天应用后，当前聊天已加载 `mcp__blender_official` 工具。已通过原生 `get_blendfile_summary_path_info` 成功读取 RB19 工作副本，返回 `is_saved=true`、`is_dirty=false`，确认当前聊天可直接调用实时 Blender MCP。

此前给出的“设置 → MCP 服务器 → Restart／重新连接”路径没有在本机界面中验证，用户反馈找不到该入口，因此不再使用这一指引。如之后再次新增 MCP，已有聊天可能需要重启应用后重新加载工具。

后续正常开启 Blender 时，已启用的扩展应自动启动。若同时开启多个 Blender 实例，只有一个实例能占用 9876 端口；实际操作前应先读取文件路径，确认连接到了目标工作副本。
