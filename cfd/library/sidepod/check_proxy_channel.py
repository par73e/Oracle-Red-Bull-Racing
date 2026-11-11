"""Coarse free-space connectivity within coordinate-defined side boxes.
Not a proof of the actual designed undercut: boxes contain outside air, the
input is an approximate voxel proxy, and grid spacing can miss narrow paths.
"""
from pathlib import Path
import json,sys
import numpy as np
import trimesh
from scipy.ndimage import label,generate_binary_structure
root=Path(__file__).resolve().parents[3];car=sys.argv[1];assert car in ('rb19','rb16b')
mesh=trimesh.load(root/f'cfd/library/geometry/{car}/neutral/body.stl',process=True)
result={}
for side in (-1,1):
 xs=np.arange(-.65,2.301,.05);ys=side*np.arange(.30,1.151,.05);zs=np.arange(.15,.551,.05)
 coords=np.array([(x,y,z) for x in xs for y in ys for z in zs]);inside=[]
 for block in np.array_split(coords,int(np.ceil(len(coords)/150))):inside.extend(mesh.contains(block))
 fluid=~np.array(inside).reshape((len(xs),len(ys),len(zs)))
 components,n=label(fluid,structure=generate_binary_structure(3,1));front=set(components[0].ravel())-{0};back=set(components[-1].ravel())-{0};connected=front&back
 result[str(side)]={'grid_points':int(len(coords)),'spacing_m':.05,'free_points':int(fluid.sum()),'free_components':int(n),'through_components':len(connected),'through_grid_points':int(np.isin(components,list(connected)).sum())}
 print(car,side,result[str(side)],flush=True)
out=Path(__file__).parent/f'{car}-coarse-channel-connectivity.json';out.write_text(json.dumps({'method':'proxy body.contains grid, x=-0.65..2.3m, abs(y)=0.3..1.15m, z=0.15..0.55m; 0.05m spacing, 6-neighbour adjacency; box includes external free air. Does not prove true undercut openness, small passages or raw mesh fidelity.', 'sides':result},indent=2)+'\n')
