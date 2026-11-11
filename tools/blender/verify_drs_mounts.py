"""Check actuator travel against wings and the detailed mounts outside joints."""
import bpy,json,sys
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[2]
car=sys.argv[sys.argv.index('--')+1]
config=json.loads((ROOT/f'assets/exports/{car}/{car}.json').read_text())
root=bpy.data.objects['AERO_CAR']
def tree(name,dg,exclude_joints=False):
 obj=bpy.data.objects[name].evaluated_get(dg);mesh=obj.to_mesh();mesh.calc_loop_triangles()
 vertices=[obj.matrix_world@v.co for v in mesh.vertices]
 joints=[bpy.data.objects[n].evaluated_get(dg).matrix_world.translation for n in ['DRS_BASE','DRS_ATTACH']]
 triangles=[tuple(t.vertices) for t in mesh.loop_triangles if not exclude_joints or all(min((vertices[i]-j).length for j in joints)>.014 for i in t.vertices)]
 obj.to_mesh_clear()
 return BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
obstacles=config['drs']['fixed_meshes']+config['drs']['flap_meshes']+(['RB19_Part_16649'] if car=='rb19' else ['safetycell_SUB2_001_001','safetycell_SUB3'])
mounts=[o.name for o in bpy.context.scene.objects if o.type=='MESH' and ('MOLDED_CARBON' in o.name or 'CARBON_EAR' in o.name) and o.name.startswith('DRS_')]
report={'car':car,'revision':config['revision'],'samples':[],'joint_exclusion_radius':.014,'scope':'Triangle surface overlap at 41 positions, mount/wing installation contact excluded; no load or continuous collision certification.'}
for i in range(41):
 root['drs']=i/40;root.update_tag();bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
 hits={}
 for name in ['DRS_CYLINDER','DRS_ROD']:
  source=tree(name,dg);trimmed=tree(name,dg,True)
  for other in obstacles+mounts:
   count=len((trimmed if other in mounts else source).overlap(tree(other,dg,other in mounts)))
   if count:hits[name+' / '+other]=count
 report['samples'].append({'drs':i/40,'intersections':hits})
root['drs']=0;root.update_tag();bpy.context.view_layer.update()
(ROOT/f'docs/research/{car}-drs-mount-clearance-2026-11-10.json').write_text(json.dumps(report,indent=2)+'\n')
failures=[r for r in report['samples'] if r['intersections']]
result={'car':car,'positions':41,'failures':failures}
assert not failures,str(failures)
