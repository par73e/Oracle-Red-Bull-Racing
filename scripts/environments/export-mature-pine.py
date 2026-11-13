import bpy,json,numpy as np
from pathlib import Path
from mathutils import Matrix
ROOT=Path('/Users/louis/Suep/Project/AERO');folder=ROOT/'assets/source/environments/spa/mature-pine';j=json.loads((folder/'pine-source.gltf').read_text());binary=(folder/'trunk-prefix.bin').read_bytes()
bpy.ops.wm.read_factory_settings(use_empty=True)
def accessor(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']];size={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];return np.frombuffer(binary,dtype=dtype,count=a['count']*size,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,size)
def mesh_object(name,v,f):
 v=v[:,[0,2,1]].copy();v[:,1]*=-1
 m=bpy.data.meshes.new(name);m.from_pydata(v.tolist(),[],f.tolist());m.update();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o)
 for p in m.polygons:p.use_smooth=True
 return o
bark=bpy.data.materials.new('Photographed pine bark');bark.use_nodes=True;n=bark.node_tree.nodes;p=n.get('Principled BSDF');p.inputs['Roughness'].default_value=.95;t=n.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(ROOT/'assets/source/environments/spa/pine-sapling/textures/pine_sapling_small_bark_diff_1k.jpg'));bark.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
parts=[]
for k,prim in enumerate(j['meshes'][0]['primitives'][:2]):
 v=accessor(prim['attributes']['POSITION']);f=accessor(prim['indices']).reshape(-1,3);o=mesh_object('trunk'+str(k),v,f);o.data.materials.append(bark);uv=accessor(prim['attributes']['TEXCOORD_0']);layer=o.data.uv_layers.new(name='UVMap')
 for loop in o.data.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
 parts.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();trunk=bpy.context.object
v=np.load(folder/'canopy.npz');canopy=mesh_object('Source foliage envelope',v['vertices'],v['faces']);m=bpy.data.materials.new('Pine foliage');m.diffuse_color=(.027,.055,.016,1);m.use_nodes=True;pr=m.node_tree.nodes.get('Principled BSDF');pr.inputs['Base Color'].default_value=m.diffuse_color;pr.inputs['Roughness'].default_value=1;canopy.data.materials.append(m)
report=[]
for level,ratios in [('near',(.035,.15)),('far',(.008,.055))]:
 collection=bpy.data.collections.new(level+'_mature_pine');bpy.context.scene.collection.children.link(collection)
 for src,ratio,name in [(trunk,ratios[0],'bark'),(canopy,ratios[1],'foliage')]:
  o=src.copy();o.data=src.data.copy();collection.objects.link(o);o.name=level+'_mature_'+name;bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Display LOD','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name);o.data.validate(verbose=True);o.data.update(calc_edges=True);report.append({'name':o.name,'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)})
for o in [trunk,canopy]:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/working/spa/mature-pine-lods.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'web/public/environments/spa/mature-pine-lods.glb'),export_format='GLB',export_image_format='JPEG',export_image_quality=85)
(ROOT/'docs/research/spa-2026-11-12/mature-tree-lod-report.json').write_text(json.dumps({'source':'Poly Haven pine_tree_01 (CC0), source needle positions and actual trunk mesh','foliageLOD':'0.17 m voxel envelope of original needle distribution, smoothed and decimated; not original full-resolution needles','models':report},indent=2))
print('SAVED_MATURE_PINE',report)
