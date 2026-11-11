"""Presentation-scale mechanisms calibrated to the supplied meshes, not team CAD."""
import bpy
import bmesh
import math
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform


def remove_legacy_drs_bar(obj):
    mesh=obj.data;parents=list(range(len(mesh.vertices)))
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for edge in mesh.edges:
        a,b=(find(i) for i in edge.vertices);parents[a]=b
    groups={}
    for vertex in mesh.vertices:groups.setdefault(find(vertex.index),[]).append(vertex.index)
    removed=[]
    for indices in groups.values():
        points=[obj.matrix_world@mesh.vertices[i].co for i in indices]
        lo=[min(p[k] for p in points) for k in range(3)];hi=[max(p[k] for p in points) for k in range(3)]
        if max(abs(lo[0]),abs(hi[0]))<.02 and lo[1]>2.28 and hi[1]<2.46 and lo[2]>.985:
            removed.extend(indices)
    assert len(removed)==124,('Unexpected legacy DRS components',len(removed))
    bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[bm.verts[i] for i in removed],context='VERTS')
    bm.to_mesh(mesh);bm.free();mesh.update()
    return {'object':obj.name,'removed_vertices':len(removed),'reason':'Disconnected original gray DRS linkage, not the carbon pylon.'}


def front_geometry(car, parts):
    rows={}
    def refit(obj,a,old,b,keep_root=False):
        old_direction=(old-a).normalized();new_direction=(b-a).normalized()
        q=old_direction.rotation_difference(new_direction)
        ratio=(b-a).length/(old-a).length;inverse=obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            p=obj.matrix_world@vertex.co;d=p-a;along=old_direction*d.dot(old_direction)
            target=a+q@(d-along+along*ratio)
            t=max(0,min(1,(d.dot(old_direction)/(old-a).length-.23)/.50)) if keep_root else 1
            vertex.co=inverse@(p+(target-p)*(t*t*(3-2*t)))
        obj.data.update()
    identifiers={'FL':(10057,9992,10088,10092),'FR':(11119,11054,11150,11154)}
    for key,suffix in [('FL','fl'),('FR','fr')]:
        if car=='rb19': upper,lower,tie,spring=(parts[i] for i in identifiers[key])
        else: upper,lower,tie,spring=(parts[n] for n in [f'suspension2_{suffix}',f'suspension3_{suffix}',f'suspension_steeringarm_{suffix}',f'suspension_{suffix}'])
        def end(obj,outer):
            points=[obj.matrix_world@v.co for v in obj.data.vertices]
            x=(max if outer else min)(abs(p.x) for p in points)
            subset=[p for p in points if abs(abs(p.x)-x)<.008]
            return sum(subset,Vector())/len(subset)
        rows[key]={'upper':end(upper,True),'lower':end(lower,True),
                   'inner':end(tie,False),'outer':end(tie,True),'tie':tie,
                   'fixed':[upper,lower,spring]}
        row=rows[key]
        if car=='rb16b':
            # Mesh fairing edges are not measured ball-joint locations. Their
            # 26-degree inferred caster made the display wheel roll sideways.
            # Use a vertical showcase kingpin, retaining the tyre's rest camber,
            # and blend only the outboard tips of the fixed wishbones to it.
            xy=(row['upper']+row['lower'])/2
            for name,obj in [('upper',upper),('lower',lower)]:
                old=row[name].copy();target=Vector((xy.x,xy.y,old.z));delta=target-old
                xmax=max(abs((obj.matrix_world@v.co).x) for v in obj.data.vertices)
                inv=obj.matrix_world.inverted()
                for v in obj.data.vertices:
                    p=obj.matrix_world@v.co
                    t=max(0,min(1,(abs(p.x)-(xmax-.14))/.125));weight=t*t*(3-2*t)
                    v.co=inv@(p+delta*weight)
                obj.data.update();row[name]=target
            row['display_axis']='Vertical yaw, source static camber retained; wheel-end tips blended to the simplified joint.'
        if car=='rb19':
            # The display source terminates the track rod almost on the kingpin
            # axis: it has no usable steering lever. Refit its existing airfoil
            # to an aft pickup and supply a short, explicit upright steering arm.
            old=row['outer'].copy();row['outer'].y+=.13
            row['outer'].x=math.copysign(.54,row['outer'].x)
            refit(tie,row['inner'],old,row['outer'],keep_root=True)
            row['fixed_fairing']=split_rack_fairing(tie,row['inner'],(row['outer']-row['inner']).normalized())
            # The supplied pull-rod ends aft of the upper wishbone joint and
            # enters the tyre sweep. Seat its tip on the non-steering joint.
            refit(spring,end(spring,False),end(spring,True),row['upper'])
            row['refitted_pickup']=True
        row['length']=(row['outer']-row['inner']).length
        row['axis']=(row['upper']-row['lower']).normalized()
        arm=row['outer']-row['lower']
        row['c']=arm-row['axis']*row['axis'].dot(arm)
        row['s']=row['axis'].cross(row['c'])
        row['w']=row['lower']+row['axis']*row['axis'].dot(arm)-row['inner']
        row['a']=row['w'].dot(row['c']);row['b']=row['w'].dot(row['s'])
        row['k']=(row['length']**2-row['w'].length_squared-row['c'].length_squared)/2
        phi=math.atan2(row['b'],row['a']);spread=math.acos(max(-1,min(1,row['k']/math.hypot(row['a'],row['b']))))
        wrap=lambda v:math.atan2(math.sin(v),math.cos(v))
        row['branch']=min([-1,1],key=lambda s:abs(wrap(phi+s*spread)))
    derivatives=[(r['outer']-r['inner']).x/(r['outer']-r['inner']).dot(r['s']) for r in rows.values()]
    gain=math.pi/180/(sum(derivatives)/2)
    return rows,gain


def split_rack_fairing(obj,inner,direction):
    """Keep the source flared nose fairing fixed; telescope the slim rod inside."""
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    for modifier in list(obj.modifiers):
        if modifier.type=='SUBSURF':bpy.ops.object.modifier_apply(modifier=modifier.name)
    fixed=obj.copy();fixed.data=obj.data.copy();fixed.name=obj.name+'_Fixed_Fairing'
    bpy.context.scene.collection.objects.link(fixed)
    reference=obj.data.copy();reference.calc_loop_triangles()
    reference_vertices=[obj.matrix_world@v.co for v in reference.vertices]
    reference_triangles=list(reference.loop_triangles)
    uv_tree=BVHTree.FromPolygons(reference_vertices,[tuple(t.vertices) for t in reference_triangles],all_triangles=True)
    plane=inner+direction*.13
    for part,moving in [(fixed,False),(obj,True)]:
        inverse=part.matrix_world.inverted();bm=bmesh.new();bm.from_mesh(part.data)
        cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-6,
                                   plane_co=inverse@plane,plane_no=inverse.to_3x3()@direction,
                                   clear_inner=moving,clear_outer=not moving)
        edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_boundary]
        if moving:
            extrusion=bmesh.ops.extrude_edge_only(bm,edges=edges)
            vertices=[e for e in extrusion['geom'] if isinstance(e,bmesh.types.BMVert)]
            bmesh.ops.translate(bm,verts=vertices,vec=inverse.to_3x3()@(-direction*.12))
        bm.to_mesh(part.data);bm.free();part.data.update()
        if moving:
            # Extruded edge UVs otherwise smear into long gray stripes. Project
            # only the overlap segment onto the intact source carbon surface.
            for face in part.data.polygons:
                if min((part.matrix_world@part.data.vertices[i].co-inner).dot(direction) for i in face.vertices)>.12999:continue
                for li in face.loop_indices:
                    p=part.matrix_world@part.data.vertices[part.data.loops[li].vertex_index].co
                    location,normal,index,distance=uv_tree.find_nearest(p);triangle=reference_triangles[index]
                    xyz=[reference_vertices[i] for i in triangle.vertices]
                    for layer in part.data.uv_layers:
                        source=reference.uv_layers[layer.name]
                        coords=[Vector((*source.data[i].uv,0)) for i in triangle.loops]
                        result=barycentric_transform(location,*xyz,*coords)
                        layer.data[li].uv=(result.x,result.y)
        part.modifiers.new('Triangulate rack collar transition','TRIANGULATE')
    bpy.data.meshes.remove(reference)
    return fixed


def steering_angle(row,travel):
    a=row['a']-row['c'].x*travel;b=row['b']-row['s'].x*travel
    k=row['k']+row['w'].x*travel-.5*travel**2
    ratio=k/math.hypot(a,b)
    assert abs(ratio)<=1+1e-8,('Unreachable steering pose',travel,ratio)
    v=math.atan2(b,a)+row['branch']*math.acos(max(-1,min(1,ratio)))
    return math.atan2(math.sin(v),math.cos(v))


def make_front_links(rows,gain,root,steers,empty,parent_keep,driver,material):
    scene=bpy.context.scene
    rack=empty('STEERING_RACK',(0,0,0),root)
    driver(rack,'location',0,'steer_degrees',f'value*{gain!r}')
    manifest={}
    for key,row in rows.items():
        # Scalar driver intermediates keep the final expression short and use
        # only Blender's supported built-in math (no Python driver namespace).
        solver=empty(f'STEERING_SOLVER_{key}',(0,0,0),root)
        for name,expr in [('a',f"{row['a']!r}-{row['c'].x!r}*(value*{gain!r})"),
                          ('b',f"{row['b']!r}-{row['s'].x!r}*(value*{gain!r})"),
                          ('k',f"{row['k']!r}+{row['w'].x!r}*(value*{gain!r})-.5*(value*{gain!r})**2")]:
            solver[name]=0.0
            curve=solver.driver_add(f'["{name}"]');d=curve.driver;d.type='SCRIPTED'
            v=d.variables.new();v.name='value';v.type='SINGLE_PROP';v.targets[0].id=root;v.targets[0].data_path='["steer_degrees"]'
            d.expression=expr
        curve=steers[key].driver_add('rotation_euler',2);d=curve.driver;d.type='SCRIPTED'
        for name in ['a','b','k']:
            v=d.variables.new();v.name=name;v.type='SINGLE_PROP';v.targets[0].id=solver;v.targets[0].data_path=f'["{name}"]'
        angle=f"atan2(b,a)+({row['branch']})*acos(max(-1,min(1,k/sqrt(a*a+b*b))))"
        d.expression=f'atan2(sin({angle}),cos({angle}))'
        inner=empty(f'TRACK_ROD_INNER_{key}',row['inner'],rack)
        outer=empty(f'TRACK_ROD_OUTER_{key}',row['outer'],steers[key])
        link=empty(f'TRACK_ROD_LINK_{key}',row['inner'],root)
        link.rotation_mode='QUATERNION'
        link.rotation_quaternion=Vector((0,0,1)).rotation_difference((row['outer']-row['inner']).normalized())
        parent_keep(row['tie'],link)
        follow=link.constraints.new('COPY_LOCATION');follow.target=inner
        track=link.constraints.new('DAMPED_TRACK');track.target=outer;track.track_axis='TRACK_Z'
        port=make_steering_port(key,row,gain,root,link,empty,parent_keep)
        if row.get('refitted_pickup'):
            p=row['lower']+row['axis']*((row['outer']-row['lower']).dot(row['axis']))
            direction=row['outer']-p
            bpy.ops.mesh.primitive_cube_add(size=1,location=(p+row['outer'])/2)
            arm=bpy.context.object;arm.name=f'STEERING_ARM_{key}'
            arm.rotation_mode='QUATERNION';arm.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction.normalized())
            arm.scale=(.014,.010,direction.length)
            bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            arm.data.materials.append(material)
            bevel=arm.modifiers.new('Forged arm edges','BEVEL');bevel.width=.003;bevel.segments=3
            parent_keep(arm,steers[key])
        # Compact ball-joint housings at the fixed wishbone endpoints; the
        # upright turns between these joints rather than around the tyre center.
        for label,point in [('UPPER',row['upper']),('LOWER',row['lower']),('TRACK',row['outer'])]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.008,location=point)
            obj=bpy.context.object;obj.name=f'STEERING_JOINT_{key}_{label}'
            obj.data.materials.append(material)
            for face in obj.data.polygons:face.use_smooth=True
            parent_keep(obj,steers[key] if label=='TRACK' else root)
        to_gltf=lambda p:[float(p.x),float(p.z),float(-p.y)]
        manifest[key]={**{n:to_gltf(row[n]) for n in ['upper','lower','inner','outer']},
                       'length':row['length'],'tie_mesh':row['tie'].name,'link':link.name,
                       'inner_node':inner.name,'outer_node':outer.name,
                       'pickup_refitted':row.get('refitted_pickup',False),
                       'port':port,'axis_mode':row.get('display_axis','Source-derived kingpin; unchanged'),
                       'fixed_fairing':row['fixed_fairing'].name if row.get('fixed_fairing') else None,
                       'fixed_meshes':[o.name for o in row['fixed']]}
    return {'rack':rack.name,'travel_per_degree':gain,'wheels':manifest,
            'note':'Constant-length track rods and kingpin axes derived from mesh joints; no heave or team alignment claim.'}


def make_steering_port(key,row,gain,root,link,empty,parent_keep):
    """Fixed protective sleeve, with the moving rod root hidden through its stroke."""
    direction=(row['outer']-row['inner']).normalized()
    q=Vector((0,0,1)).rotation_difference(direction);inverse=q.inverted()
    points=[row['tie'].matrix_world@v.co for v in row['tie'].data.vertices]
    cap=[p for p in points if (p-row['inner']).dot(direction)<.025]
    swept=[]
    for degrees in range(-18,19):
        travel=degrees*gain;angle=steering_angle(row,travel)
        b=row['lower']+Quaternion(row['axis'],angle)@(row['outer']-row['lower'])
        a=row['inner']+Vector((travel,0,0))
        turn=direction.rotation_difference((b-a).normalized())
        swept.extend(inverse@(a+turn@(p-row['inner'])-row['inner']) for p in cap)
    begin=min(p.z for p in swept)-.018;end=max(p.z for p in swept)+.032
    rx=max(.012,max(abs(p.x) for p in swept)+.004)
    ry=max(.012,max(abs(p.y) for p in swept)+.004)
    envelope=max(1,max(math.hypot(p.x/rx,p.y/ry) for p in swept))*1.04
    rx=rx*envelope/.91;ry=ry*envelope/.91
    rubber=bpy.data.materials.get('AERO_Steering_Port_Rubber')
    if rubber is None:
        rubber=bpy.data.materials.new('AERO_Steering_Port_Rubber');rubber.use_nodes=True
        bsdf=rubber.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value=(.013,.016,.020,1);bsdf.inputs['Roughness'].default_value=.64
    # An oval hollow shell reads as a fixed rack gland / dust cover, rather than
    # a cut carbon face sliding out of the nose. Its bore clears the swept cap.
    n=32;verts=[];faces=[]
    stations=[(begin,1.06),(begin+.008,1.10),(end-.008,1.04),(end,1),
              (end,.91),(begin,.91)]
    for z,f in stations:verts.extend((rx*f*math.cos(i*math.tau/n),ry*f*math.sin(i*math.tau/n),z) for i in range(n))
    for j in range(len(stations)):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(stations))*n+(i+1)%n,((j+1)%len(stations))*n+i))
    if row.get('fixed_fairing'):
        # The native flared fairing already provides the visible housing. Keep
        # the port frame for clearance checks without adding a bulky outer boot.
        sleeve=empty(f'STEERING_PORT_{key}',row['inner'],root)
        sleeve.rotation_mode='QUATERNION';sleeve.rotation_quaternion=q
        parent_keep(row['fixed_fairing'],sleeve)
    else:
        mesh=bpy.data.meshes.new(f'STEERING_PORT_{key}');mesh.from_pydata(verts,[],faces);mesh.update()
        sleeve=bpy.data.objects.new(f'STEERING_PORT_{key}',mesh);bpy.context.scene.collection.objects.link(sleeve)
        sleeve.location=row['inner'];sleeve.rotation_mode='QUATERNION';sleeve.rotation_quaternion=q
        mesh.materials.append(rubber)
        for face in mesh.polygons:face.use_smooth=True
        parent_keep(sleeve,root)
    # Hidden extension ensures the moving root always enters the chassis; the
    # linkage constraint still uses the actual ball-joint centers and rod length.
    shank_begin=begin-.035;shank_end=end+.025
    bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.006,depth=shank_end-shank_begin,
                                      location=row['inner']+direction*((shank_begin+shank_end)/2))
    shank=bpy.context.object;shank.name=f'STEERING_HIDDEN_SHANK_{key}'
    shank.rotation_mode='QUATERNION';shank.rotation_quaternion=q;shank.data.materials.append(rubber)
    for face in shank.data.polygons:face.use_smooth=len(face.vertices)==4
    parent_keep(shank,link)
    return {'mesh':sleeve.name,'shank':shank.name,'begin':begin,'end':end,
            'bore_rx':rx*.91,'bore_rz':ry*.91,'cap_limit':.025,'covered_root':True,
            'native_fairing':bool(row.get('fixed_fairing'))}


def make_actuator(base,attach,pivot,root,empty,parent_keep,basic_material,body,car,fixed_surfaces,moving_surfaces):
    scene=bpy.context.scene
    alloy=basic_material('AERO_DRS_Anodized_Alloy',(.035,.041,.05),.32,.85)
    gland=basic_material('AERO_DRS_Machined_Gland',(.25,.28,.31),.27,1)
    chrome=basic_material('AERO_DRS_Polished_Piston',(.56,.59,.62),.17,1)
    seal=basic_material('AERO_DRS_Black_Seal',(.008,.009,.011),.75,0)
    anchor=empty('DRS_BASE',base,root);tip=empty('DRS_ATTACH',attach,pivot)
    def lathe(name,profile,materials,sections=None):
        n=32;verts=[];faces=[]
        for r,z in profile:
            verts.extend((r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for i in range(n))
        for j in range(len(profile)):
            for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
        for m in materials:mesh.materials.append(m)
        for face in mesh.polygons:
            face.use_smooth=True
            if sections:face.material_index=sections[face.index//n]
        uv=mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops:
            j,i=divmod(loop.vertex_index,n);r,z=profile[j]
            density=87.5 if any(m.name=='redbull_carbon1' for m in materials) else 2
            uv.data[loop.index].uv=(i/n*math.tau*r*density,z*density)
        return obj
    # Measure the actual stroke instead of scaling a piston from the base to
    # the tip. The rod is rigid; its hidden insertion changes inside a bored body.
    distances=[]
    h=pivot.matrix_world.translation
    max_angle=float(root['drs_max_angle'])
    for i in range(81):
        q=Quaternion((1,0,0),-max_angle*i/80)
        distances.append((h+q@(attach-h)-base).length)
    low,high=min(distances),max(distances)
    length=low*.72;rod_length=high-length+.018
    assert rod_length<low-.010,('Insufficient cylinder insertion space',low,high)
    profile=[(.006,0),(.006,.004),(.006,length-.012),(.007,length-.012),
             (.007,length-.008),(.0045,length-.004),(.0045,length),(.0028,length),(.0028,0)]
    barrel=lathe('DRS_CYLINDER',profile,[alloy,gland,seal],[0,0,0,1,1,1,2,1,0])
    barrel.location=base
    barrel.rotation_mode='QUATERNION';barrel.rotation_quaternion=Vector((0,0,1)).rotation_difference((attach-base).normalized())
    parent_keep(barrel,root)
    track=barrel.constraints.new('DAMPED_TRACK');track.target=tip;track.track_axis='TRACK_Z'
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.0025,depth=rod_length,location=(0,0,0))
    rod=bpy.context.object;rod.name='DRS_ROD'
    for v in rod.data.vertices:v.co.z+=rod_length/2
    for f in rod.data.polygons:f.use_smooth=len(f.vertices)==4
    rod.data.materials.append(chrome)
    rod.location=attach;rod.rotation_mode='QUATERNION';rod.rotation_quaternion=barrel.rotation_quaternion.copy()
    parent_keep(rod,root)
    # Local-space translation after the solved rotation places the fixed-length
    # rod's endpoint at the flap joint without any axial scaling.
    # An intermediate tip frame points in the same direction as the cylinder.
    frame=empty('DRS_PISTON_FRAME',attach,root)
    follow=frame.constraints.new('COPY_LOCATION');follow.target=tip
    rotation=frame.constraints.new('COPY_ROTATION');rotation.target=barrel
    rod.parent=frame;rod.matrix_parent_inverse.identity();rod.location=(0,0,-rod_length)
    rod.rotation_quaternion=Quaternion();rod.scale=(1,1,1)
    for label,point,parent in [('BASE',base,barrel),('TIP',attach,rod)]:
        eye=lathe(f'DRS_{label}_BEARING_EYE',[(.008,-.003),(.008,.003),(.0052,.003),(.0052,-.003)],[gland])
        eye.location=point;eye.rotation_euler.y=math.pi/2;parent_keep(eye,parent)
    from detailed_drs_mounts import make_detailed_mounts, make_detailed_pins
    make_detailed_mounts(base,attach,pivot,root,car,fixed_surfaces,moving_surfaces,parent_keep)
    make_detailed_pins(base,attach,pivot,root,gland,parent_keep)
    return anchor,tip,barrel,rod,{'cylinder_length':length,'rod_length':rod_length,'piston_frame':frame.name,
                                'distance_min':low,'distance_max':high,'rod_radius':.0025,'barrel_radius':.007}
