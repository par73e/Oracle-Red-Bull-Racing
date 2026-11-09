"""Targeted read-only diagnosis of the issues reported on 2026-11-09."""
import bpy, json, sys, math, fcntl
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
car=sys.argv[sys.argv.index('--')+1]
lock=(ROOT/'assets/previews/.blender.lock').open('w')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
out=ROOT/f'assets/previews/fixes-2026-11-09/{car}'
out.mkdir(parents=True,exist_ok=True)
report={}
def setup():
    s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH'
    s.render.resolution_x=1200;s.render.resolution_y=800;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG'
    s.display.shading.light='STUDIO';s.display.shading.color_type='SINGLE'
    s.display.shading.show_cavity=True
    for o in s.objects:
        if o.name=='AERO_REVIEW_GROUND':o.hide_render=True
    return s
def render(s,name,position,target,scale):
    if '--no-renders' in sys.argv:return
    c=s.camera;c.location=position;c.rotation_euler=(Vector(target)-c.location).to_track_quat('-Z','Y').to_euler();c.data.ortho_scale=scale
    s.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)

bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'assets/working/{car}/{car}-review.blend'),use_scripts=False)
if car=='rb19':
    obj=bpy.data.objects['Full Body_Baked'];world=obj.matrix_world.copy()
    parents=list(range(len(obj.data.vertices)))
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for e in obj.data.edges:
        a,b=(find(v) for v in e.vertices);parents[a]=b
    vertices=[list(world@v.co) for v in obj.data.vertices]
    polygons=[{'id':p.index,'v':list(p.vertices),'component':find(p.vertices[0])} for p in obj.data.polygons]
    report['wing']={'vertices':vertices,'polygons':[p for p in polygons if p['component']==9016]}
    report['exhaust']={'vertices':vertices,'polygons':[p for p in polygons if p['component']==14207]}
    report['components']={}
    for comp in sorted({find(v.index) for v in obj.data.vertices}):
        pts=np.array([vertices[v.index] for v in obj.data.vertices if find(v.index)==comp])
        report['components'][comp]={'n':len(pts),'lo':pts.min(axis=0).tolist(),'hi':pts.max(axis=0).tolist()}
    s=setup()
    render(s,'source-floor',(2.7,.3,.65),(.52,.3,.13),2.5)
    render(s,'source-wing-side',(4,2.46,.9),(0,2.46,.9),.8)
    # Isolate the wing and color faces by proposed upper/lower geometric regions.
    colors=[(.22,.32,.50,1),(.75,.15,.12,1),(.15,.65,.35,1),(.8,.7,.15,1)]
    for i,col in enumerate(colors):
        m=bpy.data.materials.new(f'Diagnostic_{i}');m.diffuse_color=col;obj.data.materials.append(m)
    start=len(obj.data.materials)-4
    for p in obj.data.polygons:
        comp=find(p.vertices[0]);coords=[Vector(vertices[i]) for i in p.vertices]
        if comp!=9016:p.hide=True
        p.material_index=start+(1 if min(v.z for v in coords)>.85 and sum(v.y for v in coords)/len(coords)>2.5 else 0)
    # Workbench renders don't honor hidden mesh faces: remove unrelated faces in memory.
    import bmesh
    bm=bmesh.new();bm.from_mesh(obj.data);bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[f for f in bm.faces if find(f.verts[0].index)!=9016],context='FACES')
    bm.to_mesh(obj.data);bm.free()
    for mod in list(obj.modifiers):obj.modifiers.remove(mod)
    s.display.shading.color_type='MATERIAL'
    render(s,'wing-selection-side',(4,2.46,.9),(0,2.46,.9),.9)
    render(s,'wing-selection-rear',(1.6,4.4,1.55),(0,2.47,.89),1.7)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/working/rb19/rb19-web.blend'),use_scripts=False)
    s=setup();render(s,'current-floor',(2.7,.3,.65),(.52,.3,.13),2.5)
else:
    for key in ['fl','fr','bl','br']:
        obj=bpy.data.objects[f'x0_tyre_{key}_SUB1']
        pts=np.array([list(obj.matrix_world@v.co) for v in obj.data.vertices])
        mean=pts.mean(axis=0);vals,vecs=np.linalg.eigh(np.cov((pts-mean).T));axis=vecs[:,0]
        if axis[0]<0:axis=-axis
        u=vecs[:,1];v=vecs[:,2]
        projected=np.column_stack(((pts-mean)@u,(pts-mean)@v))
        fit=np.linalg.lstsq(np.column_stack((2*projected,np.ones(len(pts)))),(projected**2).sum(axis=1),rcond=None)[0]
        c=mean+u*fit[0]+v*fit[1]
        c+=axis*((pts@axis).min()+(pts@axis).max()-2*c@axis)/2
        report[key]={'axis':axis.tolist(),'center':c.tolist(),'pca_values':vals.tolist(),'old_center':((pts.min(axis=0)+pts.max(axis=0))/2).tolist()}
    report['materials']={}
    for name in ['discs','redbull_wheel_hub','generics','rb_paint','sidewall']:
        m=bpy.data.materials[name];bsdf=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        report['materials'][name]={'links':[(l.from_node.image.filepath if l.from_node.type=='TEX_IMAGE' and l.from_node.image else l.from_node.type,l.from_socket.name,l.to_socket.name) for l in m.node_tree.links],
            'images':[(n.name,n.image.filepath) for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]}
    s=setup();render(s,'front-wheel',(3,-2.0,1.0),(.80,-1.555,.33),1.0)
(out/'diagnosis.json').write_text(json.dumps(report,indent=2)+'\n')
summary={'components':report['components'],'raw_geometry':str((out/'diagnosis.json').relative_to(ROOT))} if car=='rb19' else report
(ROOT/f'docs/research/{car}-issue-diagnosis.json').write_text(json.dumps(summary,indent=2)+'\n')
print('ISSUE_DIAGNOSIS_DONE',car,flush=True)
