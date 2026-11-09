"""Inspect originals and create separate, consistently lit review scenes."""
import json
import math
import sys
from collections import Counter
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
car = sys.argv[sys.argv.index("--") + 1]
original = ROOT / "assets/working" / car / (car + ".blend")
output = ROOT / "assets/working" / car / (car + "-review.blend")
images = ROOT / "assets/previews/review-2026-11-08" / car
images.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(original), load_ui=False, use_scripts=False)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == "MESH"]
bpy.context.view_layer.update()
corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
low = Vector([min(c[i] for c in corners) for i in range(3)])
high = Vector([max(c[i] for c in corners) for i in range(3)])
dimensions = high - low
report = {"car": car, "source": str(original.relative_to(ROOT)),
          "source_dimensions_in_blender_units": list(dimensions),
          "source_unit_scale": scene.unit_settings.scale_length,
          "source_unit_system": scene.unit_settings.system,
          "mesh_objects": len(meshes), "objects": [],
          "notes": ["Review presentation uses a uniform 5.5-unit length for lighting comparison only; this is not a verified real-car dimension.",
                    "Sources and original working copies are not overwritten."]}
boundary = nonmanifold = triangles = 0
dep = bpy.context.evaluated_depsgraph_get()
for obj in meshes:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edge_boundary = sum(e.is_boundary for e in bm.edges)
    edge_nonmanifold = sum(not e.is_manifold for e in bm.edges)
    boundary += edge_boundary
    nonmanifold += edge_nonmanifold
    bm.free()
    evaluated = obj.evaluated_get(dep)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    triangle_count = len(mesh.loop_triangles)
    triangles += triangle_count
    evaluated.to_mesh_clear()
    item = {"name": obj.name, "vertices": len(obj.data.vertices),
            "base_polygons": len(obj.data.polygons), "evaluated_triangles": triangle_count,
            "boundary_edges": edge_boundary, "nonmanifold_edges": edge_nonmanifold,
            "parent": obj.parent.name if obj.parent else None,
            "uv_layers": [u.name for u in obj.data.uv_layers],
            "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers]}
    if len(meshes) == 1:
        parent = list(range(len(obj.data.vertices)))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for edge in obj.data.edges:
            a, b = (find(i) for i in edge.vertices)
            parent[a] = b
        item["loose_components"] = len({find(i) for i in range(len(parent))})
    report["objects"].append(item)
report.update({"evaluated_triangles": triangles, "boundary_edges": boundary,
               "nonmanifold_edges": nonmanifold,
               "armatures": sum(o.type == "ARMATURE" for o in scene.objects),
               "actions_in_file": [a.name for a in bpy.data.actions],
               "drs_named_objects": [o.name for o in meshes if "drs" in o.name.lower()],
               "floor_named_objects": [o.name for o in meshes if any(w in o.name.lower() for w in ["floor", "diffuser"])]})

# Add a presentation parent without applying transforms or editing any mesh.
existing = list(scene.objects)
root = bpy.data.objects.new("AERO_REVIEW_PRESENTATION_ONLY", None)
scene.collection.objects.link(root)
for obj in existing:
    if obj.type in {"CAMERA", "LIGHT", "EMPTY"}:
        obj.hide_render = True
    if obj.parent is None:
        world = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world
factor = 5.5 / max(dimensions)
root.scale = (factor,) * 3
root.location = (-((low.x + high.x) / 2) * factor,
                 -((low.y + high.y) / 2) * factor, -low.z * factor)
bpy.context.view_layer.update()
height = dimensions.z * factor
target = Vector((0, 0, height * 0.45))
camera_data = bpy.data.cameras.new("AERO_REVIEW_CAMERA")
camera = bpy.data.objects.new("AERO_REVIEW_CAMERA", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 7.2
camera_data.clip_start = 0.01
camera_data.clip_end = 1000
scene.render.resolution_x = 960
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = (0.55, 0.55, 0.55)
scene.display.shading.show_cavity = True
scene.display.shading.background_type = "WORLD"
scene.world = bpy.data.worlds.new("AERO_REVIEW_WORLD")
scene.world.color = (0.055, 0.055, 0.055)
views = {"clay-hero": (8, -10, 7), "clay-side": (12, 0, height / 2),
         "clay-underfloor": (0, 0, -12), "clay-rear": (0, 12, height / 2)}
for name, location in views.items():
    camera_data.ortho_scale = 9.6 if name == "clay-underfloor" else 7.2
    camera.location = location
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(images / (name + ".png"))
    bpy.ops.render.render(write_still=True)

# A common studio baseline, using the supplied material graphs unchanged.
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.25, 0.25, 0.25, 1)
background.inputs["Strength"].default_value = 0.45
for name, location, energy, size in [
    ("Key", (3, -4, 6), 1200, 5), ("Fill", (-4, -1, 3), 800, 4),
    ("Rim", (1, 4, 5), 1500, 4),
]:
    light = bpy.data.lights.new("AERO_" + name, "AREA")
    light.energy, light.shape, light.size = energy, "DISK", size
    obj = bpy.data.objects.new(light.name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.03))
ground = bpy.context.object
ground.name = "AERO_REVIEW_GROUND"
mat = bpy.data.materials.new("AERO_Studio_Ground")
mat.use_nodes = True
mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.07, 0.07, 0.07, 1)
mat.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.75
ground.data.materials.append(mat)
camera.location = views["clay-hero"]
camera_data.ortho_scale = 7.2
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "VIEW_3D":
            space = area.spaces.active
            space.shading.type = "MATERIAL"
            space.region_3d.view_location = target
            space.region_3d.view_distance = 8
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            space.clip_start, space.clip_end = 0.01, 1000
report["review_file"] = str(output.relative_to(ROOT))
report["previews"] = [str(p.relative_to(ROOT)) for p in images.glob("*.png")]
report_path = ROOT / "docs/research" / (car + "-geometry-review-2026-11-08.json")
bpy.ops.wm.save_as_mainfile(filepath=str(output))
scene.render.filepath = str(images / "material-baseline.png")
bpy.ops.render.render(write_still=True)
report["previews"].append(str((images / "material-baseline.png").relative_to(ROOT)))

# Correct the demonstrated FBX channel mismatches only in the review copy.
if car == "rb16b":
    texture_dir = ROOT / "assets/source/rb16b/source/Redbull rb16b"
    # The source includes spinning-rim alternatives alongside static wheels.
    # Keep them in the file, but use the static assembly for this still preview.
    hidden_alternatives = []
    for obj in meshes:
        if obj.name.startswith("RIM_BLUR_"):
            obj.hide_render = True
            obj.hide_set(True)
            hidden_alternatives.append(obj.name)
    report["hidden_static_preview_alternatives"] = hidden_alternatives
    for material in {slot.material for obj in meshes for slot in obj.material_slots if slot.material}:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            if node.inputs.get("Weight"):
                node.inputs["Weight"].default_value = 1.0
            node.inputs["Specular IOR Level"].default_value = 0.5
            if material.name not in {"chrome.001", "redbull_wheel_hub", "redbull_mirror_left", "redbull_mirror_right"}:
                node.inputs["Metallic"].default_value = 0.0
    report["global_import_corrections"] = "Principled weight 1; dielectric specular 0.5; non-metal categories metallic 0; decal alpha links preserved."
    mapping = {
        "redbull_paint": ("redbull_paint_d.dds", None, 0.5, 0.0),
        "redbull_detail": ("redbull_detail_d.dds", None, 0.5, 0.0),
        "tread_medium": ("slick_diffuse.dds", "slick_normal.dds", 0.85, 0.0),
        "sidewall": ("sidewall_diffuse.dds", "sidewall_n.dds", 0.8, 0.0),
        "redbull_carbon1": ("carbon_fiber2.dds", "carbon_fiber_nm2.dds", 0.5, 0.0),
        "redbull_carbon2": ("carbon_fiber2.dds", "carbon_fiber_nm2.dds", 0.5, 0.0),
        "redbull_wheel_hub": ("redbull_wheel_d.dds", None, 0.4, 0.7),
    }
    changes = []
    for name, (diffuse, normal, roughness, metallic) in mapping.items():
        material = bpy.data.materials.get(name)
        if not material:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
        for channel in ["Base Color", "Metallic", "Roughness", "Alpha", "Normal"]:
            for link in list(bsdf.inputs[channel].links):
                links.remove(link)
        color = nodes.new("ShaderNodeTexImage")
        color.image = bpy.data.images.load(str(texture_dir / diffuse), check_existing=True)
        color.image.colorspace_settings.name = "sRGB"
        links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Alpha"].default_value = 1.0
        if normal:
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(str(texture_dir / normal), check_existing=True)
            tex.image.colorspace_settings.name = "Non-Color"
            normal_node = nodes.new("ShaderNodeNormalMap")
            normal_node.inputs["Strength"].default_value = 0.35
            links.new(tex.outputs["Color"], normal_node.inputs["Color"])
            links.new(normal_node.outputs["Normal"], bsdf.inputs["Normal"])
        changes.append({"material": name, "diffuse": diffuse, "normal": normal,
                        "roughness": roughness, "metallic": metallic})
    report["material_corrections"] = changes
    report["notes"].append("Material values are an initial visual calibration, not measured physical properties.")
    scene.render.filepath = str(images / "material-corrected.png")
    bpy.ops.render.render(write_still=True)
    report["previews"].append(str((images / "material-corrected.png").relative_to(ROOT)))
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
print("AERO_REVIEW_DONE", car, report["mesh_objects"], triangles, boundary, nonmanifold, flush=True)
