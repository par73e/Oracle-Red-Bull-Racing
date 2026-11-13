import bpy,numpy as np,math
from pathlib import Path
from mathutils import Vector
ROOT=Path('/Users/louis/Suep/Project/AERO');folder=ROOT/'assets/source/environments/spa/mature-pine';data=np.load(folder/'branch.npz');v=data['vertices'][:,[0,2,1]].copy();v[:,1]*=-1;f=data['faces']
bpy.ops.wm.read_factory_settings(use_empty=True)
m=bpy.data.meshes.new('Original mature-pine needles');m.vertices.add(len(v));m.vertices.foreach_set('co',v.ravel());m.loops.add(len(f)*3);m.loops.foreach_set('vertex_index',f.ravel());m.polygons.add(len(f));m.polygons.foreach_set('loop_start',np.arange(len(f),dtype=np.int32)*3);m.polygons.foreach_set('loop_total',np.full(len(f),3,dtype=np.int32));m.update(calc_edges=True);m.validate()
obj=bpy.data.objects.new('Source branch needles',m);bpy.context.collection.objects.link(obj)
mat=bpy.data.materials.new('Natural pine needles');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.035,.095,.014,1);p.inputs['Roughness'].default_value=.85;obj.data.materials.append(mat)
center=Vector(tuple((v.min(axis=0)+v.max(axis=0))/2));camera_data=bpy.data.cameras.new('Branch baking camera');camera=bpy.data.objects.new('Branch baking camera',camera_data);bpy.context.collection.objects.link(camera);camera_data.type='ORTHO';camera_data.ortho_scale=3.05;bpy.context.scene.camera=camera
world=bpy.data.worlds.new('Soft daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.75,.83,1,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45;bpy.context.scene.world=world
for name,location,energy,size in [('Key',(4,-4,6),1200,5),('Fill',(-3,2,4),650,4)]:
 light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.shape='DISK';light.size=size;o=bpy.data.objects.new(name,light);bpy.context.collection.objects.link(o);o.location=center+Vector(location);o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='AgX'
for i,angle in enumerate([0,math.pi/3,2*math.pi/3]):
 camera.location=center+Vector((7*math.sin(angle),-7*math.cos(angle),1.3));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(folder/f'branch-{i}.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/working/spa/pine-branch-bake.blend'))
print('RENDERED_3D_PINE_BRANCHES')
