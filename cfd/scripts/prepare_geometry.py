"""Export CFD-oriented neutral GLB surfaces without modifying display assets."""
from pathlib import Path
import hashlib,json
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parents[2]
car='rb19';source=ROOT/f'web/public/models/{car}.glb'
config=next(c for c in json.loads((ROOT/'web/public/models/manifest.json').read_text()) if c['id']==car)
out=ROOT/'cfd/geometry/rb19';out.mkdir(parents=True,exist_ok=True)
scene=trimesh.load(source,force='scene',process=False,skip_materials=True)
transform=np.array([[0,0,-1,0],[-1,0,0,0],[0,1,0,0],[0,0,0,1]],float)
wheel_nodes={n:k for k,w in config['wheels'].items() for n in w['spin_meshes']}
groups={k:[] for k in ['body','FL','FR','RL','RR']};inventory=[]
for name in scene.graph.nodes_geometry:
 matrix,geometry=scene.graph[name];mesh=scene.geometry[geometry].copy();mesh.apply_transform(transform@matrix)
 group=next((k for n,k in wheel_nodes.items() if name==n or name.startswith(n+'_')),'body')
 groups[group].append(mesh)
 inventory.append({'name':name,'group':group,'triangles':len(mesh.faces)})
report={'source':str(source.relative_to(ROOT)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'frame':'X downstream, Y vehicle right, Z up; transform (-glTF.Z,-glTF.X,glTF.Y)','pose':{'drs':0,'steer':0},'groups':{},'inventory':inventory,'wheels':{}}
for group,meshes in groups.items():
 assert meshes,group
 mesh=trimesh.util.concatenate(meshes);mesh.merge_vertices();mesh.update_faces(mesh.nondegenerate_faces());mesh.remove_unreferenced_vertices()
 counts=np.bincount(mesh.edges_unique_inverse)
 report['groups'][group]={'triangles':len(mesh.faces),'vertices':len(mesh.vertices),'bounds':mesh.bounds.tolist(),'watertight':bool(mesh.is_watertight),'boundaryEdges':int(np.sum(counts==1)),'nonManifoldEdges':int(np.sum(counts>2))}
 mesh.export(out/f'{group}-raw.stl')
 if group!='body':
  c=np.array(config['wheels'][group]['center']);center=(transform@np.r_[c,1])[:3]
  axis=(transform[:3,:3]@np.array(config['wheels'][group]['rest_axis'])).tolist()
  report['wheels'][group]={'center':center.tolist(),'axis':axis,'radius':config['wheels'][group]['radius']}
(ROOT/'cfd/reports/rb19-geometry-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='inventory'},indent=2))
