"""Verify the official MCP protocol and its connection to a live Blender window."""
import asyncio
import base64
import json
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    install = Path.home() / ".local/share/blender-mcp-official"
    params = StdioServerParameters(
        command=str(install / ".venv/bin/blender-mcp"),
        env={
            "BLENDER_MCP_HOST": "127.0.0.1",
            "BLENDER_MCP_PORT": "9876",
            "BLENDER_PATH": "/Applications/Blender.app/Contents/MacOS/Blender",
        },
    )
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            initialized = await session.initialize()
            catalog = await session.list_tools()
            report = {
                "server": initialized.serverInfo.model_dump(),
                "tool_count": len(catalog.tools),
                "tool_names": [tool.name for tool in catalog.tools],
                "calls": {},
            }
            for name, arguments in [
                ("get_blendfile_summary_datablocks", {}),
                ("get_screenshot_of_window_as_json", {}),
                ("execute_blender_code", {"code": "import bpy, os\nresult = {'version': bpy.app.version_string, 'filepath': bpy.data.filepath, 'background': bpy.app.background, 'pid': os.getpid(), 'mesh_objects': sum(obj.type == 'MESH' for obj in bpy.context.scene.objects)}"}),
            ]:
                response = await session.call_tool(name, arguments)
                report["calls"][name] = response.model_dump(mode="json")
                if response.isError:
                    raise RuntimeError(json.dumps(report, ensure_ascii=False))
            image_response = await session.call_tool(
                "get_screenshot_of_window_as_image", {"size_limit_in_bytes": 500000}
            )
            if image_response.isError:
                raise RuntimeError(str(image_response))
            for content in image_response.content:
                if content.type == "image":
                    screenshot = install / "connection-screenshot.png"
                    screenshot.write_bytes(base64.b64decode(content.data))
                    report["screenshot"] = str(screenshot)
            (install / "verification.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
            print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=60))
