from pathlib import Path
import sys,json
import numpy as np
import trimesh
from scipy.ndimage import binary_closing,binary_fill_holes
ROOT=Path(__file__).resolve().parents[3];car,pose=sys.argv[1:3];folder=ROOT/f'cfd/library/geometry/{car}/{pose}'
report={}
for key in ['body','FL','FR','RL','RR']:
 out=folder/f'{key}.stl'
 if out.exists():continue
 mesh=trimesh.load(folder/f'{key}-raw.stl',process=True)
 # Cap simple planar wheel-hub boundary loops before voxel filling. Never
 # apply this to arbitrary car openings, or to a non-cyclic edge graph.
 if key!='body' and not mesh.is_watertight:
  counts=np.bincount(mesh.edges_unique_inverse);edges=mesh.edges_unique[counts==1];adj={}
  for a,b in edges:adj.setdefault(int(a),[]).append(int(b));adj.setdefault(int(b),[]).append(int(a))
  if adj and all(len(v)==2 for v in adj.values()):
   remaining=set(adj);vertices=mesh.vertices.tolist();faces=mesh.faces.tolist()
   while remaining:
    first=next(iter(remaining));loop=[first];previous=None;current=first
    while True:
     following=next(n for n in adj[current] if n!=previous)
     if following==first:break
     loop.append(following);previous,current=current,following
    remaining.difference_update(loop);center=len(vertices);vertices.append(mesh.vertices[loop].mean(axis=0).tolist())
    faces.extend([[loop[i],loop[(i+1)%len(loop)],center] for i in range(len(loop))])
   mesh=trimesh.Trimesh(vertices,faces,process=True);mesh.fix_normals(multibody=True)
 vox=mesh.voxelized(.0125);matrix=binary_fill_holes(binary_closing(np.pad(vox.matrix,2),iterations=1))
 proxy=trimesh.voxel.ops.matrix_to_marching_cubes(matrix,pitch=.0125);proxy.apply_translation(vox.transform[:3,3]-.025);proxy.apply_translation([0,0,-.005])
 small=proxy.simplify_quadric_decimation(face_count=min(len(proxy.faces),100000 if key=='body' else 16000))
 if small.is_watertight:proxy=small
 proxy.fix_normals(multibody=True);assert proxy.is_watertight
 proxy.export(out);report[key]={'faces':len(proxy.faces),'watertight':True}
 print(car,pose,key,len(proxy.faces),flush=True)
(folder/'closed.json').write_text(json.dumps(report,indent=2))
