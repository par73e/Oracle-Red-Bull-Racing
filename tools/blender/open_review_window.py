"""Give each review window its own local MCP bridge without saving preferences."""
import sys
import bpy

port = int(sys.argv[sys.argv.index("--") + 1])
module = "bl_ext.user_default.mcp"
if module not in bpy.context.preferences.addons:
    bpy.ops.preferences.addon_enable(module=module)
preferences = bpy.context.preferences.addons[module].preferences
preferences.host = "127.0.0.1"
preferences.port = port
from bl_ext.user_default.mcp import mcp_to_blender_server
if not mcp_to_blender_server.is_running():
    bpy.ops.blmcp.server_start()
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            area.spaces.active.shading.type = "MATERIAL"
            area.spaces.active.overlay.show_overlays = False
print("AERO_REVIEW_WINDOW", bpy.data.filepath, port, flush=True)
