"""Symmetric, UV-mapped presentation DRS supports; not measured team CAD."""
import bpy
import math
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
TILE_METRES = .0032  # four 0.8 mm tows, rather than oversized woven blocks


def woven_carbon():
    material = bpy.data.materials.get('AERO_DRS_Woven_Carbon')
    if material:
        return material
    material = bpy.data.materials.new('AERO_DRS_Woven_Carbon');material.use_nodes = True
    nodes = material.node_tree.nodes;shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .42
    shader.inputs['Coat Weight'].default_value = .12
    shader.inputs['Coat Roughness'].default_value = .35
    n = 512
    yy, xx = np.mgrid[:n, :n] / n * 4
    vertical = ((np.floor(xx) - np.floor(yy)) % 4) < 2
    across = np.where(vertical, xx % 1, yy % 1)
    along = np.where(vertical, yy, xx)
    crown = np.sin(np.pi * across) ** .65
    filament = .5 + .5 * np.cos(across * math.tau * 11)
    shade = .10 + .055 * crown + .012 * filament + np.where(vertical, .012, 0)
    shade *= .96 + .04 * np.cos(along * math.tau / 4)
    height = .000012 * crown
    dy, dx = np.gradient(height, TILE_METRES / n)
    normal = np.stack([-dx, -dy, np.ones_like(dx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    folder = ROOT / 'assets/textures/processed/drs';folder.mkdir(parents=True, exist_ok=True)
    for label, rgb, space in [('Color', np.repeat(shade[..., None], 3, axis=2), 'sRGB'), ('Normal', normal * .5 + .5, 'Non-Color')]:
        pixels = np.concatenate([rgb, np.ones((n, n, 1))], axis=-1).astype(np.float32)
        image = bpy.data.images.new('AERO_DRS_Twill_' + label, width=n, height=n)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw = str(folder / ('twill-' + label.lower() + '.png'));image.file_format = 'PNG'
        image.save();image.pack()
        tex = nodes.new('ShaderNodeTexImage');tex.image = image;tex.extension = 'REPEAT'
        if label == 'Color':material.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        else:
            normal_node = nodes.new('ShaderNodeNormalMap');normal_node.inputs['Strength'].default_value = .28
            material.node_tree.links.new(tex.outputs['Color'], normal_node.inputs['Color'])
            material.node_tree.links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
    return material


def center_surface(point, objects):
    """Nearest surface *in the car center plane*, avoiding one-sided BVH hits."""
    dg = bpy.context.evaluated_depsgraph_get();candidates = []
    for source in objects:
        evaluated = source.evaluated_get(dg);data = evaluated.to_mesh()
        vertices = [evaluated.matrix_world @ v.co for v in data.vertices]
        for face in data.polygons:
            hits = []
            for i, j in face.edge_keys:
                a, b = vertices[i], vertices[j]
                if abs(a.x) < 1e-7:hits.append(a.copy())
                if a.x * b.x < 0:hits.append(a.lerp(b, -a.x / (b.x - a.x)))
            if len(hits) >= 2:
                a = hits[0]
                for b in hits[1:]:
                    direction = b - a
                    t = max(0, min(1, (point - a).dot(direction) / direction.length_squared)) if direction.length_squared else 0
                    p = a + direction * t;p.x = 0
                    normal = evaluated.matrix_world.to_3x3() @ face.normal
                    normal.x = 0
                    if normal.z < 0:normal.negate()
                    candidates.append((p, normal.normalized()))
        evaluated.to_mesh_clear()
    assert candidates, 'No mounting surface crosses the center plane'
    return min(candidates, key=lambda item: (item[0] - point).length_squared)


def make_mesh(name, vertices, faces, material, uv_coords, parent, parent_keep, wrap_size=None):
    mesh = bpy.data.meshes.new(name);mesh.from_pydata(vertices, [], faces);mesh.update()
    obj = bpy.data.objects.new(name, mesh);bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(material)
    uv = mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        face.use_smooth = True
        indices = [mesh.loops[li].vertex_index for li in face.loop_indices]
        seam = wrap_size and any(i % wrap_size == 0 for i in indices) and any(i % wrap_size == wrap_size-1 for i in indices)
        for li in face.loop_indices:
            i=mesh.loops[li].vertex_index;u,v=uv_coords[i]
            if seam and i % wrap_size == 0:u=uv_coords[i+wrap_size-1][0]*wrap_size/(wrap_size-1)
            uv.data[li].uv=(u,v)
    parent_keep(obj, parent)
    return obj


def make_detailed_mounts(base, attach, pivot, root, car, fixed_surfaces, moving_surfaces, parent_keep):
    carbon = woven_carbon();report = {}
    for label, point, parent, surfaces in [('BASE', base, root, fixed_surfaces), ('TIP', attach, pivot, moving_surfaces)]:
        foot, surface_normal = center_surface(point, surfaces)
        top = point - Vector((0, 0, .012))
        # Rounded rectangular sections, a flared saddle and a narrow neck.
        # All sections remain mirror symmetric about X=0; no arbitrary roll.
        n = 64;verts = [];faces = [];uv = []
        stations = [(-.08,.011,.010),(0,.012,.012),(.06,.012,.012),(.17,.011,.011),
                    (.32,.0095,.010),(.52,.008,.009),(.72,.0065,.0085),(.90,.0055,.008),(1,.0055,.008)]
        if car == 'rb19':stations = [(t, rx * .9, ry) for t, rx, ry in stations]
        for t, rx, ry in stations:
            center = foot.lerp(top, t)
            blend = max(0,min(1,t/.55));blend=blend*blend*(3-2*blend)
            tangent=Vector((0,surface_normal.z,-surface_normal.y)).lerp(Vector((0,1,0)),blend).normalized()
            for i in range(n):
                a = math.tau * i / n
                x = rx * math.copysign(abs(math.cos(a)) ** .8, math.cos(a))
                y = ry * math.copysign(abs(math.sin(a)) ** .8, math.sin(a))
                verts.append(center + Vector((x, 0, 0)) + tangent*y)
                # Arc length mapping with small real-world weave repeats.
                uv.append((i / n * math.tau * (rx + ry) / 2 / TILE_METRES,
                           t * (top - foot).length / TILE_METRES))
        for j in range(len(stations)-1):
            for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
        faces += [tuple(reversed(range(n))), tuple((len(stations)-1)*n+i for i in range(n))]
        mount = make_mesh(f'DRS_{label}_MOLDED_CARBON', verts, faces, carbon, uv, parent, parent_keep, wrap_size=n)
        # Subdivision rounds the saddle/neck; support rings preserve the seat.
        sub = mount.modifiers.new('Continuous molded saddle fillets', 'SUBSURF');sub.levels=2;sub.render_levels=2
        for sign in [-1, 1]:
            verts=[];faces=[];uv=[]
            # A tear-drop cheek with a real bore and a tapered load path down
            # into the neck, rather than a disc glued onto a cylinder.
            rings=[(-.0017,False),(.0017,False),(.0017,True),(-.0017,True)]
            for depth, inner in rings:
                for i in range(n):
                    a = math.tau*i/n
                    radius = .0052 if inner else .0096 + .007*max(0,-math.sin(a))**2
                    y,z = radius*math.cos(a),radius*math.sin(a)
                    verts.append(point+Vector((sign*.008+depth,y,z)))
                    uv.append((y/TILE_METRES,z/TILE_METRES))
            for j in range(4):
                for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,((j+1)%4)*n+(i+1)%n,((j+1)%4)*n+i))
            ear=make_mesh(f'DRS_{label}_CARBON_EAR_{sign}',verts,faces,carbon,uv,parent,parent_keep)
            bevel=ear.modifiers.new('Laminated cheek edge radius','BEVEL');bevel.width=.00045;bevel.segments=3
        report[label]={'surface_foot':list(foot),'joint':list(point),'centerline_error':abs(foot.x),
                       'material':carbon.name,'tow_width_metres':TILE_METRES/4}
    return report


def make_detailed_pins(base, attach, pivot, root, metal, parent_keep):
    for label, point, parent in [('BASE', base, root), ('TIP', attach, pivot)]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=.0049, depth=.020, location=point)
        pin=bpy.context.object;pin.name=f'DRS_{label}_PIN';pin.rotation_euler.y=math.pi/2
        pin.data.materials.append(metal)
        for face in pin.data.polygons:face.use_smooth=len(face.vertices)==4
        bevel=pin.modifiers.new('Turned pin chamfer','BEVEL');bevel.width=.00045;bevel.segments=3
        parent_keep(pin,parent)
        for sign in [-1,1]:
            # Counterbored retaining head with a recessed hex socket.
            n=60;verts=[];faces=[]
            profile=[(.0053,.0098),(.0058,.0101),(.0058,.0106),(.0052,.0111),(.0022,.0111),(.0022,.0103)]
            for r,x in profile:
                for i in range(n):
                    angle=math.tau*i/n
                    if r==.0022:
                        # Hexagon boundary sampled on the same angular grid.
                        r_eff=r*math.cos(math.pi/6)/math.cos((angle%(math.pi/3))-math.pi/6)
                    else:r_eff=r
                    verts.append(point+Vector((sign*x,r_eff*math.cos(angle),r_eff*math.sin(angle))))
            for j in range(len(profile)-1):
                for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
            faces.append(tuple((len(profile)-1)*n+i for i in range(n)))
            uv=[(v.y,v.z) for v in verts]
            cap=make_mesh(f'DRS_{label}_PIN_RETAINER_{sign}',verts,faces,metal,uv,parent,parent_keep)
            for face in cap.data.polygons:face.use_smooth=face.index//n<3
