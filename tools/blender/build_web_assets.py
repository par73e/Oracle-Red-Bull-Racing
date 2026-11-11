"""Build reproducible, articulated presentation assets from preserved review files.

Blender coordinates: X across car, -Y forward, Z up. Exported glTF: X across,
+Z forward, Y up. The sidecar manifest describes controls in glTF coordinates.
"""
import bpy
import bmesh
import json
import math
import re
import sys
import fcntl
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from mechanical_rig import front_geometry, make_front_links, make_actuator, remove_legacy_drs_bar
_blender_lock = (ROOT / 'assets/previews/.blender.lock').open('w')
fcntl.flock(_blender_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
CAR = sys.argv[sys.argv.index('--') + 1]
OUT = ROOT / f'assets/exports/{CAR}'
PREVIEW = ROOT / f'assets/previews/production/{CAR}'
TEXTURES = ROOT / f'assets/textures/processed/{CAR}'
for p in [OUT, PREVIEW, TEXTURES]: p.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT / f'assets/working/{CAR}/{CAR}-review.blend'), use_scripts=False)
scene = bpy.context.scene
source_meshes = [o for o in scene.objects if o.type == 'MESH' and not o.name.startswith('AERO_')]
hidden = [o.name for o in source_meshes if o.hide_render]

# Freeze the review's uniform presentation transform into a fresh production copy.
for obj in source_meshes:
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.data = obj.data.copy()
    obj.data.transform(world)
    obj['source_name'] = obj.name
    obj.hide_set(False)
for obj in list(bpy.data.objects):
    if obj.name == 'AERO_REVIEW_PRESENTATION_ONLY': bpy.data.objects.remove(obj, do_unlink=True)

def bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return Vector([min(v[i] for v in pts) for i in range(3)]), Vector([max(v[i] for v in pts) for i in range(3)])

def center(obj):
    lo, hi = bounds(obj)
    return (lo + hi) / 2

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def detach_faces(obj, select, name):
    activate(obj)
    for v in obj.data.vertices:v.select=False
    for e in obj.data.edges:e.select=False
    for p in obj.data.polygons: p.select = bool(select(p))
    selected = sum(p.select for p in obj.data.polygons)
    assert selected > 0, ('No faces selected', name)
    before = set(bpy.data.objects)
    bpy.context.tool_settings.mesh_select_mode=(False,False,True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    result = next(o for o in bpy.data.objects if o not in before)
    result.name = name
    return result

def parent_keep(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world

def empty(name, position, parent=None):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.empty_display_size = 0.08
    if parent: parent_keep(obj, parent)
    return obj

def basic_material(name, color, roughness, metal=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes.get('Principled BSDF')
    n.inputs['Base Color'].default_value = (*color, 1)
    n.inputs['Metallic'].default_value = metal
    n.inputs['Roughness'].default_value = roughness
    return m

carbon = basic_material('AERO_Carbon_Satin', (0.018, .022, .027), .48)
alloy = basic_material('AERO_Actuator_Alloy', (.12, .14, .16), .31, .8)
steel = basic_material('AERO_Piston_Chrome', (.55, .58, .62), .21, 1)
rubber = basic_material('AERO_Rubber_Detail', (.014, .016, .019), .82)

root = empty('AERO_CAR', (0, 0, 0))
root['model_id'] = CAR
root['drs'] = 0.0
root['steer_degrees'] = 0.0
root['wheel_spin'] = 0.0
for key, limits in [('drs',(0,1)),('steer_degrees',(-18,18)),('wheel_spin',(-1000,1000))]:
    root.id_properties_ui(key).update(min=limits[0], max=limits[1])
root['scale_note'] = 'Uniform 5.5-unit display length; not measured team CAD.'
body = empty('CHASSIS', (0,0,0), root)
removed_alternatives=[]
wheel_specs={}
quality_fixes={}

def apply_subdivision(obj):
    activate(obj)
    for modifier in list(obj.modifiers):
        if modifier.type=='SUBSURF':
            bpy.ops.object.modifier_apply(modifier=modifier.name)

def fitted_wheel_frame(obj):
    points=np.array([list(obj.matrix_world@v.co) for v in obj.data.vertices])
    mean=points.mean(axis=0)
    values,vectors=np.linalg.eigh(np.cov((points-mean).T))
    axis=vectors[:,0]
    if axis[0]<0:axis=-axis
    u,v=vectors[:,1],vectors[:,2]
    plane=np.column_stack(((points-mean)@u,(points-mean)@v))
    fit=np.linalg.lstsq(np.column_stack((2*plane,np.ones(len(points)))),(plane**2).sum(axis=1),rcond=None)[0]
    c=mean+u*fit[0]+v*fit[1]
    c+=axis*((points@axis).min()+(points@axis).max()-2*c@axis)/2
    return Vector(c),Vector(axis)

if CAR == 'rb19':
    original = bpy.data.objects['Full Body_Baked']
    # Capture connected-component identity before any separation.
    parents = list(range(len(original.data.vertices)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i
    for edge in original.data.edges:
        a,b=(find(i) for i in edge.vertices); parents[a]=b
    attr=original.data.attributes.new('source_component','INT','POINT')
    for i,d in enumerate(attr.data): d.value=find(i)
    activate(original)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
    parts={}
    for obj in [o for o in scene.objects if o.type=='MESH' and not o.name.startswith('AERO_')]:
        component=obj.data.attributes['source_component'].data[0].value
        obj.name=f'RB19_Part_{component}'
        obj['source_component']=component
        parts[component]=obj
        # One subdivision level retains the silhouette with a smaller web mesh.
        for modifier in obj.modifiers:
            if modifier.type=='SUBSURF': modifier.levels=1;modifier.render_levels=1
    wing=parts[9016]
    # Preserve the closed source shape before cutting. The previous height-only
    # selection incorrectly included the outboard, fixed wing-tip extensions.
    apply_subdivision(wing)
    bm=bmesh.new();bm.from_mesh(wing.data)
    for x in [-.535,.535]:
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                              dist=1e-6,plane_co=(x,0,0),plane_no=(1,0,0),
                              clear_inner=False,clear_outer=False)
    bm.to_mesh(wing.data);bm.free();wing.data.update()
    candidate=detach_faces(wing,lambda p: min(wing.data.vertices[v].co.z for v in p.vertices) > .85
                      and max(abs(wing.data.vertices[v].co.x) for v in p.vertices)<=.535001
                      and sum(wing.data.vertices[v].co.y for v in p.vertices)/len(p.vertices)>2.50,
                      'DRS_Fixed_Mainplane_Lip')
    # The spatial envelope also intersects the mainplane's thin trailing lip.
    # These are two disconnected sheets, even though their height ranges overlap.
    # Only the sheet adjoining the flap hinge may rotate; preserve the other one
    # as a named fixed mesh so exported-vertex checks can cover this exact part.
    mesh=candidate.data
    sheet_parents=list(range(len(mesh.vertices)))
    def sheet_root(i):
        while sheet_parents[i]!=i:
            sheet_parents[i]=sheet_parents[sheet_parents[i]];i=sheet_parents[i]
        return i
    for edge in mesh.edges:
        a,b=(sheet_root(i) for i in edge.vertices);sheet_parents[a]=b
    sheets={}
    for vertex in mesh.vertices:sheets.setdefault(sheet_root(vertex.index),[]).append(vertex.index)
    assert len(sheets)==2,('Unexpected RB19 wing sheets',len(sheets))
    hinge_seed=Vector((0,2.59,1.019))
    seed_vertex=min(mesh.vertices,key=lambda v:(v.co-hinge_seed).length_squared)
    moving_sheet=sheet_root(seed_vertex.index)
    moving_faces={p.index for p in mesh.polygons if sheet_root(p.vertices[0])==moving_sheet}
    quality_fixes['drs_sheet_split']={
        'candidate_sheets':len(sheets),'moving_vertices':len(sheets[moving_sheet]),
        'fixed_lip_vertices':sum(len(indices) for key,indices in sheets.items() if key!=moving_sheet),
        'fixed_lip_mesh':candidate.name,
    }
    flap=detach_faces(candidate,lambda p:p.index in moving_faces,'DRS_Flap_Surface')
    for obj in [wing,flap,candidate]:
        bm=bmesh.new();bm.from_mesh(obj.data)
        edges=[e for e in bm.edges if e.is_boundary and all(abs(abs(v.co.x)-.535)<2e-5 for v in e.verts)]
        if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        obj.modifiers.new('Triangulate cut caps for tangent export','TRIANGULATE')
    quality_fixes['drs_region']='Only connected inboard ORACLE flap; mainplane trailing lip, mainplane, endplates and outboard rear extensions fixed.'
    fixed_wing_meshes=[wing,candidate]+[parts[i] for i in [8352,9060]]
    for key,part in [('FL',1284),('FR',2671),('RL',3489),('RR',5108)]:
        tyre=parts[part]; c=center(tyre)
        wheel_specs[key]={'center':c,'spin':[tyre],'steer':[],'radius':(bounds(tyre)[1].z-bounds(tyre)[0].z)/2}
    # Front brake ducts and covers steer, but do not spin around the axle.
    for key,ids in [('FL',[10797,10887,10813,10829]),('FR',[11859,11949,11875,11891])]:
        wheel_specs[key]['steer']=[parts[i] for i in ids]
    flap_parts=[flap]
    hinge=Vector((0,2.59,1.019))
    attach=Vector((0,2.570,1.040))
    actuator_base=Vector((0,2.400,1.027))
    max_angle=math.radians(52)
    # Freeze the intact surface before an interior-only cut. Never let a later
    # subdivision shrink the cut perimeter into the visible outer floor.
    chassis=parts[17185]
    apply_subdivision(chassis)
    preserved=[tuple(v.co) for v in chassis.data.vertices if abs(v.co.x)>.56 and v.co.z<.24]
    bm=bmesh.new();bm.from_mesh(chassis.data)
    faces=[]
    for f in bm.faces:
        if all(.205<abs(v.co.x)<.545 and -.78<v.co.y<2.23 and v.co.z<.22 for v in f.verts):
            faces.append(f)
    floor_faces_removed=len(faces)
    bmesh.ops.delete(bm,geom=faces,context='FACES')
    bm.to_mesh(chassis.data);bm.free()
    remaining={tuple(v.co) for v in chassis.data.vertices}
    assert all(p in remaining for p in preserved),'Visible floor-edge vertices changed'
    quality_fixes['floor_outer_vertices_preserved']=len(preserved)
else:
    parts={o.name:o for o in source_meshes}
    quality_fixes['removed_legacy_drs_bar']=remove_legacy_drs_bar(parts['safetycell_SUB1'])
    legacy_profile=parts['rearwing_top_SUB0']
    legacy_profile.hide_render=True;legacy_profile.hide_set(True)
    for obj in source_meshes:
        if obj.hide_render:
            removed_alternatives.append(obj.name)
            obj.hide_set(True)
    for key,suffix in [('FL','fl'),('FR','fr'),('RL','bl'),('RR','br')]:
        tyre=parts[f'x0_tyre_{suffix}_SUB1']
        lo,hi=bounds(tyre);c,axis=fitted_wheel_frame(tyre)
        spin=[o for n,o in parts.items() if n.startswith(f'x0_tyre_{suffix}_') or n==f'wheel_{suffix}' or n.startswith(f'disc_{suffix}_')]
        disk=parts[{'FL':'DISK_LF','FR':'DISK_RF','RL':'DISK_LR','RR':'DISK_RR'}[key]]
        spin.append(disk)
        steer=[o for n,o in parts.items() if n.startswith(f'hub_caliper_{suffix}_')]
        wheel_specs[key]={'center':c,'axis':axis,'spin':spin,'steer':steer,'radius':(hi.z-lo.z)/2}
    flap_parts=[o for n,o in parts.items() if n.startswith('rearwingmoving_top_SUB') and n not in ['rearwingmoving_top_SUB0','rearwingmoving_top_SUB1']]
    for name in ['rearwingmoving_top_SUB0','rearwingmoving_top_SUB1']:
        obj=parts[name];obj.hide_render=True;obj.hide_set(True);removed_alternatives.append(name)
    for obj in source_meshes:
        lo,hi=bounds(obj)
        if any(s.material and s.material.name=='rb_paint' for s in obj.material_slots) and lo.y>2.37 and hi.y<2.505 and lo.z>.9 and hi.z<1.04:
            flap_parts.append(obj)
    quality_fixes['flap_decal_meshes']=[o.name for o in flap_parts if o.name.startswith('21_')]
    fixed_wing_meshes=[o for n,o in parts.items() if not o.hide_render and (n.startswith('rearwing_top_') or n.startswith('rearwing_bl_') or n.startswith('rearwing_br_'))]
    # Existing center linkage is replaced by an explicitly articulated assembly.
    for n,o in parts.items():
        if n.startswith('rearwingmoving_top_2_'):
            o.hide_render=True;o.hide_set(True);removed_alternatives.append(n)
    hinge=Vector((0,2.486,1.023))
    attach=Vector((0,2.440,1.050))
    actuator_base=Vector((0,2.350,1.040))
    max_angle=math.radians(42)
    floor_faces_removed=0

all_car_meshes=[o for o in scene.objects if o.type=='MESH' and not o.name.startswith('AERO_')]
for obj in all_car_meshes: parent_keep(obj,body)

def driver(obj, path, index, prop, expression):
    curve=obj.driver_add(path,index)
    d=curve.driver;d.type='SCRIPTED'
    var=d.variables.new();var.name='value';var.type='SINGLE_PROP'
    var.targets[0].id=root;var.targets[0].data_path=f'["{prop}"]'
    d.expression=expression

front_rows,rack_gain=front_geometry(CAR,parts)
wheel_manifest={};steer_nodes={}
for key,spec in wheel_specs.items():
    c=spec['center']
    if key in front_rows:
        row=front_rows[key]
        frame=empty(f'KINGPIN_FRAME_{key}',row['lower'],root)
        frame.rotation_mode='QUATERNION'
        frame.rotation_quaternion=Vector((0,0,1)).rotation_difference(row['axis'])
        steer=empty(f'STEER_{key}',row['lower'])
        steer.parent=frame;steer.matrix_parent_inverse=Matrix.Identity(4);steer.matrix_basis=Matrix.Identity(4)
    else:steer=empty(f'STEER_{key}',c,root)
    steer_nodes[key]=steer
    axle=empty(f'AXLE_{key}',c)
    axle.rotation_mode='QUATERNION'
    axis=spec.get('axis',Vector((1,0,0)))
    axle.rotation_quaternion=Vector((1,0,0)).rotation_difference(axis)
    parent_keep(axle,steer)
    spin=empty(f'SPIN_{key}',c)
    spin.parent=axle;spin.matrix_parent_inverse=Matrix.Identity(4);spin.matrix_basis=Matrix.Identity(4)
    for obj in spec['spin']: parent_keep(obj,spin)
    for obj in spec['steer']: parent_keep(obj,steer)
    driver(spin,'rotation_euler',0,'wheel_spin','value')
    wheel_manifest[key]={'steer':steer.name,'axle':axle.name,'spin':spin.name,'radius':spec['radius'],
                         'rest_axis':[axis.x,axis.z,-axis.y],
                         'center':[c.x,c.z,-c.y], 'spin_meshes':[o.name for o in spec['spin']],
                         'steer_only_meshes':[o.name for o in spec['steer']]}

suspension=make_front_links(front_rows,rack_gain,root,steer_nodes,empty,parent_keep,driver,alloy)

flap_pivot=empty('DRS_PIVOT',hinge,root)
for obj in flap_parts: parent_keep(obj,flap_pivot)
driver(flap_pivot,'rotation_euler',0,'drs',f'-value*{max_angle!r}')
root['drs_max_angle']=max_angle
mount_surfaces=fixed_wing_meshes+([parts[16649]] if CAR=='rb19' else [parts['safetycell_SUB2_001_001'],parts['safetycell_SUB3']])
anchor,tip,barrel,rod,actuator=make_actuator(actuator_base,attach,flap_pivot,root,empty,parent_keep,basic_material,body,CAR,mount_surfaces,flap_parts)
cylinder_length=actuator['cylinder_length']
quality_fixes['mechanisms']='Kingpin steering, constant-length track rods, rigid piston with bored body and clevis pins.'

if CAR=='rb19':
    # Two approximate tunnel roofs with a high inlet, low throat and rising exit.
    # This is visual reconstruction, not a claim to the RB19's secret floor CAD.
    stations=[(-.82,.19,.66,.235),(-.58,.19,.65,.185),(-.15,.20,.61,.132),
              (.45,.20,.57,.108),(1.05,.19,.54,.13),(1.58,.18,.51,.21),(2.30,.16,.48,.325)]
    for sign,label in [(1,'L'),(-1,'R')]:
        verts=[];faces=[];cols=13
        for y,inner,outer,z in stations:
            for j in range(cols):
                t=j/(cols-1);x=sign*(inner+(outer-inner)*t)
                verts.append((x,y,z+.027*math.sin(math.pi*t)))
        for row in range(len(stations)-1):
            for j in range(cols-1):
                a=row*cols+j
                faces.append((a,a+cols,a+cols+1,a+1))
        # Side walls define the passage while leaving inlet and diffuser open.
        for edge in [0,cols-1]:
            top=[r*cols+edge for r in range(len(stations))];bottom=[]
            for i in top:
                x,y,z=verts[i];bottom.append(len(verts));verts.append((x,y,.075))
            for i in range(len(top)-1): faces.append((top[i],bottom[i],bottom[i+1],top[i+1]))
        mesh=bpy.data.meshes.new(f'Venturi_{label}');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new(f'FLOOR_VENTURI_{label}',mesh);scene.collection.objects.link(obj)
        obj.data.materials.append(carbon);parent_keep(obj,body)
        solid=obj.modifiers.new('Carbon shell','SOLIDIFY');solid.thickness=.006
        bevel=obj.modifiers.new('Tunnel transitions','SUBSURF');bevel.levels=2;bevel.render_levels=2
        for p in mesh.polygons:p.use_smooth=True
        # The original outer floor remains intact; no floating replacement strips.

# Refine material categories. Every supplied livery remains on its original UVs.
if CAR=='rb19':
    original_mat=bpy.data.materials['Full Body_Baked']
    def atlas_material(name,roughness,metallic,coat):
        m=original_mat.copy();m.name=name
        bsdf=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        for channel,value in [('Roughness',roughness),('Metallic',metallic),('Coat Weight',coat),('Coat Roughness',.35)]:
            for link in list(bsdf.inputs[channel].links):m.node_tree.links.remove(link)
            bsdf.inputs[channel].default_value=value
        return m
    paint=atlas_material('RB19_Paint_Satin_Atlas',.53,0,.12)
    carbon_atlas=atlas_material('RB19_Carbon_Atlas',.48,0,.02)
    tyre_atlas=atlas_material('RB19_Rubber_Atlas',.82,0,0)
    rim_atlas=atlas_material('RB19_Wheel_Atlas',.39,.15,.05)
    for obj in all_car_meshes:
        obj.data.materials.clear()
        for m in [paint,carbon_atlas,tyre_atlas,rim_atlas]:obj.data.materials.append(m)
        lo,hi=bounds(obj);c=(lo+hi)/2
        wheel=next((s for s in wheel_specs.values() if obj in s['spin']),None)
        for polygon in obj.data.polygons:
            pc=sum((obj.data.vertices[v].co for v in polygon.vertices),Vector())/len(polygon.vertices)
            if wheel:
                wc=wheel['center'];radial=math.hypot(pc.y-wc.y,pc.z-wc.z)
                polygon.material_index=2 if radial>wheel['radius']*.72 else 3
            elif hi.z<.65 or (pc.z<.20 and -.9<pc.y<2.4):polygon.material_index=1
            else:polygon.material_index=0
    exhaust=parts[14207]
    for row in front_rows.values():
        if row.get('fixed_fairing'):
            row['fixed_fairing'].data.materials.clear();row['fixed_fairing'].data.materials.append(carbon_atlas)
            for polygon in row['fixed_fairing'].data.polygons:polygon.material_index=0
    heat=basic_material('RB19_Exhaust_HeatAlloy',(.22,.185,.145),.48,.85)
    tint=basic_material('RB19_Exhaust_HeatTint',(.095,.11,.135),.51,.85)
    soot=basic_material('RB19_Exhaust_InnerSoot',(.009,.010,.012),.9)
    exhaust.data.materials.clear()
    for m in [heat,tint,soot]:exhaust.data.materials.append(m)
    interior=0
    for p in exhaust.data.polygons:
        c=sum((exhaust.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
        radial=Vector((c.x,0,c.z-.535))
        if p.normal.dot(radial)<-.005:p.material_index=2;interior+=1
        else:p.material_index=1 if c.y>2.53 else 0
    quality_fixes['exhaust']={'material':'heat-tinted metal outside, soot-dark inside','inner_faces':interior}
else:
    material_values={'redbull_paint':(.54,0,.12),'redbull_detail':(.5,0,.05),
                     'rb_paint':(.54,0,.12),'rb_number':(.54,0,.12),'redbull_number_33':(.54,0,.12),
                     'tread_medium':(.84,0,0),'sidewall':(.79,0,0),
                     'redbull_carbon1':(.47,0,.025),'redbull_carbon2':(.47,0,.025),
                     'redbull_wheel_hub':(.37,.65,.03)}
    for name,(rough,metal,coat) in material_values.items():
        m=bpy.data.materials.get(name)
        if not m:continue
        bsdf=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        for channel,value in [('Roughness',rough),('Metallic',metal),('Coat Weight',coat),('Coat Roughness',.35)]:
            for link in list(bsdf.inputs[channel].links):m.node_tree.links.remove(link)
            bsdf.inputs[channel].default_value=value
        # FBX had an unconnected normal node; discard that link on decals.
        if name in ['rb_paint','rb_number','redbull_number_33']:
            for link in list(bsdf.inputs['Normal'].links):m.node_tree.links.remove(link)
    disc=bpy.data.materials['discs']
    nodes,links=disc.node_tree.nodes,disc.node_tree.links
    bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    for channel in ['Base Color','Normal','Alpha','Metallic','Roughness']:
        for link in list(bsdf.inputs[channel].links):links.remove(link)
    texture_dir=ROOT/'assets/source/rb16b/source/Redbull rb16b'
    color=nodes.new('ShaderNodeTexImage');color.image=bpy.data.images.load(str(texture_dir/'brake_disc_d.dds'),check_existing=True)
    color.image.colorspace_settings.name='sRGB';links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
    normal=nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(texture_dir/'brake_disc_n.dds'),check_existing=True)
    normal.image.colorspace_settings.name='Non-Color'
    normal_map=nodes.new('ShaderNodeNormalMap');normal_map.inputs['Strength'].default_value=.22
    links.new(normal.outputs['Color'],normal_map.inputs['Color']);links.new(normal_map.outputs['Normal'],bsdf.inputs['Normal'])
    bsdf.inputs['Alpha'].default_value=1;bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.8
    outer_disc=disc.copy();outer_disc.name='RB16B_CarbonDisc_Outer'
    for key,spec in wheel_specs.items():
        disk=next(o for o in spec['spin'] if o.name.startswith('DISK_'))
        disk.data.materials.clear();disk.data.materials.append(outer_disc)
        # The outer source mesh previously displayed a purple normal image as
        # color and used wrapped game UVs. Give the disc a centered planar map.
        c=spec['center'];axis=spec['axis']
        u=Vector((0,1,0));u=(u-axis*u.dot(axis)).normalized();v=axis.cross(u).normalized()
        points=[disk.matrix_world@vertex.co-c for vertex in disk.data.vertices]
        radius=max(math.hypot(p.dot(u),p.dot(v)) for p in points)*1.015
        uv=disk.data.uv_layers.active
        for loop in disk.data.loops:
            p=points[loop.vertex_index];uv.data[loop.index].uv=(.5+p.dot(u)/(2*radius),.5+p.dot(v)/(2*radius))
    quality_fixes['brake_disc']={'color':'brake_disc_d.dds','normal':'brake_disc_n.dds','metallic':0,'roughness':.8}
    quality_fixes['visible_disc_meshes']=['DISK_LF','DISK_RF','DISK_LR','DISK_RR']

# glTF does not embed DDS; make portable PNG copies of the actually used images.
converted={}
processed_materials=set()
car_objects=[root]+list(root.children_recursive)
for obj in car_objects:
    if obj.type!='MESH' or obj.hide_render:continue
    for slot in obj.material_slots:
        mat=slot.material
        if not mat or not mat.use_nodes:continue
        if mat.as_pointer() in processed_materials:continue
        processed_materials.add(mat.as_pointer())
        connected=set()
        def visit(node):
            if node in connected:return
            connected.add(node)
            for socket in node.inputs:
                for link in socket.links:visit(link.from_node)
        for output_node in mat.node_tree.nodes:
            if output_node.type=='OUTPUT_MATERIAL':visit(output_node)
        for node in mat.node_tree.nodes:
            if node not in connected or node.type!='TEX_IMAGE' or not node.image:continue
            old=node.image
            if old.as_pointer() not in converted:
                if not old.packed_file:
                    image=bpy.data.images.load(bpy.path.abspath(old.filepath),check_existing=False)
                    image.colorspace_settings.name=old.colorspace_settings.name
                else:
                    image=old.copy()
                # Force lazy file-backed images to load before saving a PNG.
                _=image.pixels[0]
                filename=re.sub(r'[^a-zA-Z0-9_.-]+','_',old.name)+'.png'
                image.filepath_raw=str(TEXTURES/filename);image.file_format='PNG'
                image.save();image.pack()
                converted[old.as_pointer()]=image
            node.image=converted[old.as_pointer()]

def pose(drs=0,steer=0,spin=0):
    root['drs']=drs;root['steer_degrees']=steer;root['wheel_spin']=spin
    root.update_tag();bpy.context.view_layer.update()

pose()
# Identical softbox lighting for both assets, with controlled neutral surroundings.
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35
ground=bpy.data.objects.get('AERO_REVIEW_GROUND')
if ground:
    ground.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.075,.085,.10,1)
for name,energy in [('AERO_Key',850),('AERO_Fill',450),('AERO_Rim',1050)]:
    obj=bpy.data.objects.get(name)
    if obj:obj.data.energy=energy
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1440;scene.render.resolution_y=960
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
camera=scene.camera;camera.data.ortho_scale=6.9
target=Vector((0,0,.5));camera.location=(7,-9,5)
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.shading.type='MATERIAL'
            space.overlay.show_overlays=False;space.region_3d.view_location=target
            space.region_3d.view_rotation=camera.rotation_euler.to_quaternion();space.region_3d.view_distance=7
activate(root)

production=ROOT/f'assets/working/{CAR}/{CAR}-web.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(production))
# Export only the articulated car, excluding the studio.
bpy.ops.object.select_all(action='DESELECT')
for obj in car_objects:
    if not obj.hide_render:
        obj.hide_set(False);obj.select_set(True)
glb=OUT/f'{CAR}.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
                         use_renderable=True,export_apply=True,export_animations=False,
                         export_extras=True,export_yup=True,export_image_format='AUTO',
                         export_tangents=True,
                         export_unused_images=False,export_copyright='See model-attributions.md; modified for AERO')

def gltf_vec(v):return [float(v.x),float(v.z),float(-v.y)]
manifest={'id':CAR,'revision':'2026-11-10-tail-detail1','name':'RB19' if CAR=='rb19' else 'RB16B','year':2023 if CAR=='rb19' else 2021,
          'file':f'/models/{CAR}.glb','display_length':5.5,'units':'metre-scale presentation; approximate',
          'coordinate_system':'glTF Y-up, +Z forward, +X vehicle left',
          'wheels':wheel_manifest,'wheelbase':abs(wheel_specs['FL']['center'].y-wheel_specs['RL']['center'].y),
          'front_track':abs(wheel_specs['FL']['center'].x-wheel_specs['FR']['center'].x),
          'suspension':suspension,
          'drs':{'pivot':flap_pivot.name,'max_angle_radians':max_angle,'hinge':gltf_vec(hinge),
                 'base':gltf_vec(actuator_base),'closed_attachment':gltf_vec(attach),
                 'attachment':tip.name,'cylinder':barrel.name,'rod':rod.name,**actuator,
                 'fixed_meshes':[o.name for o in fixed_wing_meshes],
                 'flap_meshes':[o.name for o in flap_parts]},
          'floor':{'mode':'approximate twin venturi tunnels' if CAR=='rb19' else 'original period floor and diffuser',
                   'removed_shallow_faces':floor_faces_removed},
          'hidden_source_alternatives':removed_alternatives,
          'quality_fixes':quality_fixes,
          'license':{'title':'Creative Commons Attribution 4.0','url':'https://creativecommons.org/licenses/by/4.0/',
                     'author':'Redgrund' if CAR=='rb19' else 'MattDoesBlender',
                     'source':'https://skfb.ly/oR7sq' if CAR=='rb19' else 'https://skfb.ly/py9Uu',
                     'modifications':'Materials, articulated wheels and DRS hydraulic approximation, uniform scale; RB19 floor reconstruction'},
          'glb_bytes':glb.stat().st_size}
(OUT/f'{CAR}.json').write_text(json.dumps(manifest,indent=2)+'\n')

# Evidence: every joint must remain attached through the DRS stroke.
checks=[]
for amount in [i/20 for i in range(21)]:
    pose(amount)
    dg=bpy.context.evaluated_depsgraph_get()
    r=rod.evaluated_get(dg);t=tip.evaluated_get(dg)
    rod_end=r.matrix_world@Vector((0,0,actuator['rod_length']))
    error=(rod_end-t.matrix_world.translation).length
    distance=(t.matrix_world.translation-anchor.matrix_world.translation).length
    checks.append({'drs':amount,'rod_attachment_error':error,'rod_total_length':distance,
                   'piston_length':actuator['rod_length'],'piston_insertion':actuator['rod_length']-(distance-cylinder_length)})
    assert error<1e-4,checks[-1]
lengths=[c['rod_total_length'] for c in checks]
differences=[b-a for a,b in zip(lengths,lengths[1:])]
assert all(d>=-1e-6 for d in differences) or all(d<=1e-6 for d in differences), 'Actuator crosses dead center'
assert min(lengths)>=cylinder_length, 'Rod attachment retracts inside the barrel'
assert max(lengths)-min(lengths)<=cylinder_length, 'Stroke exceeds the approximate barrel length'
pose()
(OUT/'kinematic-checks.json').write_text(json.dumps(checks,indent=2)+'\n')

for name,drs,steer,position,target,scale in ([] if '--skip-renders' in sys.argv else [
    ('studio',0,0,(7,-9,5),(0,0,.5),6.9),
    ('drs-closed',0,0,(2.8,4.4,1.9),(0,2.4,.87),1.9),
    ('drs-open',1,0,(2.8,4.4,1.9),(0,2.4,.87),1.9),
    ('steering',0,16,(4,-6,2.7),(0,-1,.4),3.4),
    ('underfloor',0,0,(0,0,-8),(0,0,.15),9.0),
]):
    pose(drs,steer)
    if ground:ground.hide_render=name=='underfloor'
    camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.ortho_scale=scale
    scene.render.filepath=str(PREVIEW/f'{name}.png')
    bpy.ops.render.render(write_still=True)
pose()
if ground:ground.hide_render=False
camera.location=(7,-9,5);camera.rotation_euler=(Vector((0,0,.5))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=6.9
activate(root)
bpy.ops.wm.save_as_mainfile(filepath=str(production))
print('AERO_ASSET_BUILT',CAR,glb.stat().st_size,'kinematic samples',len(checks),flush=True)
