"""Compare vertical first-hit clearance of raw and CFD proxy at selected points."""
from pathlib import Path
import json, hashlib
import numpy as np
import trimesh
root=Path(__file__).resolve().parents[3]
results={}
for car in ('rb19','rb16b'):
 origins=np.array([[a,b,-.1] for a in np.linspace(-1,2,13) for b in np.linspace(-.6,.6,13)])
 directions=np.tile([0,0,1],(len(origins),1));results[car]={}
 for file in ('body-raw.stl','body.stl'):
  path=root/f'cfd/library/geometry/{car}/neutral/{file}'
  mesh=trimesh.load(path,process=True)
  locations,indices,_=mesh.ray.intersects_location(origins,directions,multiple_hits=True)
  lowest=np.full(len(origins),np.inf)
  for index,z in zip(indices,locations[:,2]):
   if z>=0:lowest[index]=min(lowest[index],z)
  good=lowest[np.isfinite(lowest)]
  results[car][file]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'total_rays':len(origins),'hits':int(len(good)),'min_m':float(good.min()),'median_m':float(np.median(good)),'max_m':float(good.max()),'at_or_below_50mm':int(sum(good<=.05))}
output={'method':'Vertical first positive body-surface intersection for 169 rays over x=-1..2 m, y=-0.6..0.6 m. This is not a full channel connectivity or minimum-clearance proof.', 'results':results}
p=Path(__file__).parent/'geometry-audit.json';p.write_text(json.dumps(output,indent=2)+'\n');print(p)
