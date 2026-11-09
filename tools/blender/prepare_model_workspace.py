"""Open a downloaded car safely and save a framed, solid-view working copy."""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
car = sys.argv[sys.argv.index("--") + 1]
source = ROOT / "assets/source" / car
if car == "rb19":
    input_file = source / "source/Sketchfab_2024_02_21_19_13_35.blend"
    bpy.ops.wm.open_mainfile(filepath=str(input_file), load_ui=False, use_scripts=False)
elif car == "rb16b":
    input_file = source / "source/Redbull rb16b/red_bull_rb16b.fbx"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.fbx(filepath=str(input_file), use_image_search=True)
else:
    raise ValueError(car)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise ValueError("No mesh objects found")
bpy.context.view_layer.update()
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
lower = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
upper = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
center = (lower + upper) / 2
span = max(upper - lower)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            space = area.spaces.active
            space.shading.type = "SOLID"
            space.shading.color_type = "SINGLE"
            space.shading.single_color = (0.65, 0.65, 0.65)
            space.clip_start = max(span / 10000, 0.0001)
            space.clip_end = max(span * 100, 1000)
            space.region_3d.view_location = center
            space.region_3d.view_distance = max(span * 1.5, 0.1)

working = ROOT / "assets/working" / car / (car + ".blend")
working.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(working))
report = {
    "car": car,
    "source": str(input_file),
    "working_copy": str(working),
    "blender_version": bpy.app.version_string,
    "mesh_objects": len(meshes),
    "vertices": sum(len(obj.data.vertices) for obj in meshes),
    "polygons_before_modifiers": sum(len(obj.data.polygons) for obj in meshes),
    "bounds_in_blender_units": list(upper - lower),
    "unit_system": bpy.context.scene.unit_settings.system,
    "unit_scale": bpy.context.scene.unit_settings.scale_length,
    "geometry_modified": False,
    "objects": [{"name": obj.name, "polygons": len(obj.data.polygons)} for obj in meshes],
}
report_path = ROOT / "docs/research" / (car + "-initial-import.json")
report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("AERO_MODEL_PREPARED", json.dumps({key: value for key, value in report.items() if key != "objects"}))
