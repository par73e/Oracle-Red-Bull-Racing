"""Make an explicitly coarse watertight CFD proxy by 10 mm voxel union."""
from pathlib import Path
import json,time
import numpy as np
import trimesh
from scipy.ndimage import binary_closing,binary_fill_holes
ROOT=Path(__file__).resolve().parents[2];folder=ROOT/'cfd/geometry/rb19';report={'pitch_m':.01,'method':'10 mm surface voxelisation, one-voxel closing, enclosed void filling, marching cubes; not engineering CAD','groups':{}}
for group in ['body','FL','FR','RL','RR']:
 mesh=trimesh.load(folder/f'{group}-raw.stl',process=True)
 if group in ['RL','RR']:
  counts=np.bincount(mesh.edges_unique_inverse);edges=mesh.edges_unique[counts==1]
  adjacency={}
  for a,b in edges:adjacency.setdefault(int(a),[]).append(int(b));adjacency.setdefault(int(b),[]).append(int(a))
  assert all(len(n)==2 for n in adjacency.values())
  remaining=set(adjacency);vertices=mesh.vertices.tolist();faces=mesh.faces.tolist()
  while remaining:
   first=next(iter(remaining));loop=[first];previous=None;current=first
   while True:
    following=next(n for n in adjacency[current] if n!=previous)
    if following==first:break
    loop.append(following);previous,current=current,following
   remaining.difference_update(loop)
   center=len(vertices);vertices.append(mesh.vertices[loop].mean(axis=0).tolist())
   faces.extend([[loop[i],loop[(i+1)%len(loop)],center] for i in range(len(loop))])
  mesh=trimesh.Trimesh(vertices=vertices,faces=faces,process=True);mesh.fix_normals(multibody=True)
  assert mesh.is_watertight
 vox=mesh.voxelized(.01)
 matrix=np.pad(vox.matrix,2)
 matrix=binary_fill_holes(binary_closing(matrix,iterations=1))
 proxy=trimesh.voxel.ops.matrix_to_marching_cubes(matrix,pitch=.01)
 proxy.apply_translation(vox.transform[:3,3]-.02)
 # Merge tiny sub-mm tyre/ground gaps into a 5 mm contact approximation.
 proxy.apply_translation([0,0,-.005])
 simplified=proxy.simplify_quadric_decimation(face_count=min(len(proxy.faces),120000 if group=='body' else 20000))
 if simplified.is_watertight:proxy=simplified
 proxy.fix_normals(multibody=True)
 proxy.export(folder/f'{group}.stl')
 report['groups'][group]={'triangles':len(proxy.faces),'watertight':bool(proxy.is_watertight),'bounds':proxy.bounds.tolist(),'volume':float(proxy.volume)}
 print(group,report['groups'][group],flush=True)
 assert proxy.is_watertight
(ROOT/'cfd/reports/rb19-proxy-geometry.json').write_text(json.dumps(report,indent=2)+'\n')
