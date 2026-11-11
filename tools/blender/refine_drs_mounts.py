"""Refine only generated DRS mount meshes in the current production copy."""
import bpy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from detailed_drs_mounts import make_detailed_mounts, make_detailed_pins
car=sys.argv[sys.argv.index('--')+1]
config_path=ROOT/f'assets/exports/{car}/{car}.json'
config=json.loads(config_path.read_text())
assert Path(bpy.data.filepath)==ROOT/f'assets/working/{car}/{car}-web.blend'
root=bpy.data.objects['AERO_CAR'];root['drs']=0;root['steer_degrees']=0;root['wheel_spin']=0
root.update_tag();bpy.context.view_layer.update()
base=bpy.data.objects['DRS_BASE'].matrix_world.translation.copy()
attach=bpy.data.objects['DRS_ATTACH'].matrix_world.translation.copy()
pivot=bpy.data.objects['DRS_PIVOT']
fixed=config['drs']['fixed_meshes']+(['RB19_Part_16649'] if car=='rb19' else ['safetycell_SUB2_001_001','safetycell_SUB3'])
moving=config['drs']['flap_meshes']
removed=[]
for obj in list(bpy.context.scene.objects):
 if obj.type=='MESH' and any(obj.name.startswith('DRS_'+label+'_'+suffix) for label in ['BASE','TIP'] for suffix in ['MOLDED_CARBON','CARBON_EAR','MOUNT_PAD','CARBON_HORN','CLEVIS','PIN']):
  removed.append(obj.name);bpy.data.objects.remove(obj,do_unlink=True)
def parent_keep(obj,parent):
 bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world
report=make_detailed_mounts(base,attach,pivot,root,car,[bpy.data.objects[n] for n in fixed],[bpy.data.objects[n] for n in moving],parent_keep)
make_detailed_pins(base,attach,pivot,root,bpy.data.materials['AERO_DRS_Machined_Gland'],parent_keep)
for label in ['BASE','TIP']:
 eye=bpy.data.objects[f'DRS_{label}_BEARING_EYE']
 bevel=eye.modifiers.new('Bearing edge chamfer','BEVEL');bevel.width=.0003;bevel.segments=3
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'assets/working/{car}/{car}-web.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in [root]+list(root.children_recursive):
 if not obj.hide_render:obj.hide_set(False);obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/f'assets/exports/{car}/{car}.glb'),export_format='GLB',use_selection=True,
 use_renderable=True,export_apply=True,export_animations=False,export_extras=True,export_yup=True,export_image_format='AUTO',
 export_tangents=True,export_unused_images=False,export_copyright='See model-attributions.md; modified for AERO')
config['revision']='2026-11-10-tail-detail1'
config['quality_fixes']['drs_mounts']={'revision':config['revision'],'mounts':report,'removed':removed,'scope':'Symmetric molded presentation mounts, fine woven carbon and detailed metal pin retainers; not team CAD.'}
config_path.write_text(json.dumps(config,indent=2)+'\n')
(ROOT/f'docs/research/{car}-drs-mount-detail-2026-11-10.json').write_text(json.dumps(config['quality_fixes']['drs_mounts'],indent=2)+'\n')
result={'car':car,'mounts':report,'removed':removed,'saved':bpy.data.filepath}
