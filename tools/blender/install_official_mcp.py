"""Install the pinned Blender Lab extension into the local user repository."""
import json
import shutil
from pathlib import Path

import bpy

install = Path.home() / ".local/share/blender-mcp-official"
module = "bl_ext.user_default.mcp"
config = Path(bpy.utils.user_resource("CONFIG"))
preferences_file = config / "userpref.blend"
backup = install / "userpref.before-mcp.blend"
if preferences_file.exists() and not backup.exists():
    shutil.copy2(preferences_file, backup)
previous_online_access = bpy.context.preferences.system.use_online_access
result = bpy.ops.extensions.package_install_files(
    filepath=str(install / "blender_mcp_addon-1.0.0.zip"),
    repo="user_default",
    enable_on_install=True,
)
if result != {"FINISHED"} or module not in bpy.context.preferences.addons:
    raise RuntimeError(f"Extension installation failed: {result}")
preferences = bpy.context.preferences.addons[module].preferences
preferences.host = "127.0.0.1"
preferences.port = 9876
preferences.use_autostart = True
bpy.context.preferences.system.use_online_access = True
bpy.ops.wm.save_userpref()
receipt = {
    "module": module,
    "host": preferences.host,
    "port": preferences.port,
    "autostart": preferences.use_autostart,
    "previous_online_access": previous_online_access,
    "preferences_backup": str(backup) if backup.exists() else None,
    "extension_version": "1.0.0",
    "blender_version": bpy.app.version_string,
}
(install / "extension-installation.json").write_text(json.dumps(receipt, indent=2) + "\n")
print("AERO_MCP_EXTENSION_INSTALLED", json.dumps(receipt))
