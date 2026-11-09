"""Sweep the saved production rig; report mesh intersections separately from joints."""
import bpy,json,sys,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
car=sys.argv[sys.argv.index('--')+1]
config=json.loads((ROOT/f'assets/exports/{car}/{car}.json').read_text())
root=bpy.data.objects['AERO_CAR']
report={'car':car,'revision':config['revision'],'steering':[],'drs':[],'scope':'Triangle surface intersections against wheel meshes and rear-wing surfaces; joint/mount contact is intentional, not a full vehicle clearance certification.'}

def pose(steer=0,drs=0):
    root['steer_degrees']=steer;root['drs']=drs;root['wheel_spin']=0
    root.update_tag();bpy.context.view_layer.update()
    return bpy.context.evaluated_depsgraph_get()

def mesh(name,dg):
    obj=bpy.data.objects[name].evaluated_get(dg);data=obj.to_mesh();data.calc_loop_triangles()
    vertices=[obj.matrix_world@v.co for v in data.vertices]
    faces=[tuple(t.vertices) for t in data.loop_triangles]
    obj.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True)

for angle in range(-18,19,2):
    dg=pose(steer=angle);record={'input':angle,'wheels':{}}
    for key,spec in config['suspension']['wheels'].items():
        a=bpy.data.objects[spec['inner_node']].evaluated_get(dg).matrix_world.translation
        b=bpy.data.objects[spec['outer_node']].evaluated_get(dg).matrix_world.translation
        link=bpy.data.objects[spec['link']].evaluated_get(dg)
        end=link.matrix_world@Vector((0,0,spec['length']))
        overlaps={}
        for name in spec['fixed_meshes']+[spec['tie_mesh']]:
            count=sum(len(mesh(name,dg).overlap(mesh(wheel,dg))) for wheel in config['wheels'][key]['spin_meshes'] if 'tyre' in wheel.lower() or car=='rb19')
            if count:overlaps[name]=count
        record['wheels'][key]={'angle':bpy.data.objects[config['wheels'][key]['steer']].rotation_euler.z,
                              'length_error':abs((b-a).length-spec['length']),
                              'link_endpoint_error':(end-b).length,'wheel_intersections':overlaps}
    report['steering'].append(record)
    print('STEERING',car,json.dumps(record),flush=True)

obstacles=config['drs']['fixed_meshes']+config['drs']['flap_meshes']
obstacles+=['RB19_Part_16649'] if car=='rb19' else ['safetycell_SUB2_001_001','safetycell_SUB3']
static_obstacles={name:mesh(name,bpy.context.evaluated_depsgraph_get()) for name in obstacles if name not in config['drs']['flap_meshes']}
for i in range(41):
    dg=pose(drs=i/40);record={'amount':i/40,'intersections':{}}
    for part in ['DRS_CYLINDER','DRS_ROD']:
        source=mesh(part,dg)
        hits={name:len(source.overlap(static_obstacles[name] if name in static_obstacles else mesh(name,dg))) for name in obstacles}
        hits={name:count for name,count in hits.items() if count}
        if hits:record['intersections'][part]=hits
    report['drs'].append(record)
    if record['intersections']:print('DRS_INTERSECTION',car,json.dumps(record),flush=True)
pose()
report['blender_driver_tolerance']=5e-5
path=ROOT/f'docs/research/{car}-mechanical-clearance-2026-11-09.json'
path.write_text(json.dumps(report,indent=2)+'\n')
steering_errors=[v for r in report['steering'] for v in r['wheels'].values() if v['length_error']>5e-5 or v['link_endpoint_error']>5e-5 or v['wheel_intersections']]
drs_errors=[r for r in report['drs'] if r['intersections']]
print('MECHANICAL_SWEEP',car,'steering_failures',len(steering_errors),'drs_failures',len(drs_errors),flush=True)
assert not steering_errors and not drs_errors,'Mechanical sweep requires correction; see report'
