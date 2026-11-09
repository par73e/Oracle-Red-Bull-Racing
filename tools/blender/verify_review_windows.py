"""Check each live review window through the official MCP protocol."""
import asyncio
import base64
import json
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets/previews/review-2026-11-08"


async def check(car, port):
    install = Path.home() / ".local/share/blender-mcp-official"
    params = StdioServerParameters(
        command=str(install / ".venv/bin/blender-mcp"),
        env={"BLENDER_MCP_HOST": "127.0.0.1", "BLENDER_MCP_PORT": str(port),
             "BLENDER_PATH": "/Applications/Blender.app/Contents/MacOS/Blender"},
    )
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            response = await session.call_tool("get_blendfile_summary_path_info", {})
            if response.isError:
                raise RuntimeError(str(response))
            info = response.model_dump(mode="json")
            screenshot = await session.call_tool("get_screenshot_of_window_as_image", {"size_limit_in_bytes": 1200000})
            if screenshot.isError:
                raise RuntimeError(str(screenshot))
            path = OUTPUT / car / "blender-window.png"
            for item in screenshot.content:
                if item.type == "image":
                    path.write_bytes(base64.b64decode(item.data))
            return {"car": car, "port": port, "path_info": info, "screenshot": str(path)}


async def main():
    results = []
    for car, port in [("rb19", 9876), ("rb16b", 9877)]:
        results.append(await check(car, port))
    (OUTPUT / "live-window-verification.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results))


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(main(), timeout=90))
