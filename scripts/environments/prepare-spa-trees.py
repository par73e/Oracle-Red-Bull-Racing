"""Derive two real-geometry LODs from Poly Haven's CC0 pine saplings."""
import bpy,json
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path('/Users/louis/Suep/Project/AERO')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/source/environments/spa/pine-sapling/pine.gltf'))
originals=[o for o in bpy.context.scene.objects if o.type=='MESH'];report=[]
for i,src in enumerate(originals):
 bpy.context.view_layer.objects.active=src;src.select_set(True)
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);src.select_set(False)
 coords=[Vector(c) for c in src.bound_box];lo=Vector(tuple(min(v[k] for v in coords) for k in range(3)));hi=Vector(tuple(max(v[k] for v in coords) for k in range(3)))
 src.data.transform(Matrix.Translation((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z)))
 for level,ratio in [('near',.065),('far',.018)]:
  obj=src.copy();obj.data=src.data.copy();bpy.context.collection.objects.link(obj);obj.name=f'{level}_pine_{i}';obj.location=(0,0,0)
  bpy.context.view_layer.objects.active=obj;obj.select_set(True);mod=obj.modifiers.new('Web LOD','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
  report.append({'name':obj.name,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'source':'Poly Haven pine_sapling_small','license':'CC0','ratio':ratio,'nativeHeightM':hi.z-lo.z})
 bpy.data.objects.remove(src,do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/working/spa/photographic-pine-lods.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'web/public/environments/spa/pine-lods.glb'),export_format='GLB',export_image_format='JPEG',export_image_quality=85,export_yup=True)
(ROOT/'docs/research/spa-2026-11-12/tree-lod-report.json').write_text(json.dumps(report,indent=2))
print('SPA_TREE_LODS_SAVED',report)
