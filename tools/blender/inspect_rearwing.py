import bpy, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/working/rb19/rb19-review.blend'),use_scripts=False)
obj=bpy.data.objects['Full Body_Baked']
parent=list(range(len(obj.data.vertices)))
def find(i):
    while parent[i]!=i:
        parent[i]=parent[parent[i]];i=parent[i]
    return i
for e in obj.data.edges:
    a,b=(find(i) for i in e.vertices);parent[a]=b
for p in obj.data.polygons:
    p.select=find(p.vertices[0])==9016
bpy.context.view_layer.objects.active=obj
obj.select_set(True)
for other in bpy.context.selected_objects:
    if other!=obj:other.select_set(False)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT')
wing=next(o for o in bpy.context.selected_objects if o!=obj)
for other in bpy.context.scene.objects:
    if other.type=='MESH':other.hide_render=other!=wing
wing.modifiers.clear()
pts=[list(wing.matrix_world@v.co) for v in wing.data.vertices]
(ROOT/'docs/research/rb19-rearwing-vertices.json').write_text(json.dumps(pts))
scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE'
scene.render.resolution_x=1200;scene.render.resolution_y=800
cam=scene.camera;cam.data.ortho_scale=.85
target=Vector((0,2.47,.83))
for name,pos in [('side',(4,2.47,.83)),('rear',(1,5,1.6))]:
    cam.location=pos;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(ROOT/f'assets/previews/review-2026-11-08/rb19/wing-{name}.png')
    bpy.ops.render.render(write_still=True)
