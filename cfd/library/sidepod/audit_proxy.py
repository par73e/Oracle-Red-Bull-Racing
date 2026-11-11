"""Measure raw-to-proxy nearest-surface differences in selected areas.
Not a proof of channel connectivity or model fidelity to a real car.
"""
from pathlib import Path
import hashlib,json,sys
import numpy as np
import trimesh
root=Path(__file__).resolve().parents[3];car=sys.argv[1];assert car in ('rb19','rb16b')
folder=root/f'cfd/library/geometry/{car}/neutral';paths=[folder/'body-raw.stl',folder/'body.stl']
raw=trimesh.load(paths[0],process=False);proxy=trimesh.load(paths[1],process=False)
rng=np.random.default_rng(20261111);centers=raw.triangles_center
regions={'side_undercut':(-.4,1.8,.25,1.05,.18,.55),'side_upper':(-.4,1.8,.25,1.05,.55,1.10),'front_suspension':(-2.2,-.6,.20,1.05,.15,.80)}
results={}
for name,(xmin,xmax,ymin,ymax,zmin,zmax) in regions.items():
 hit=(centers[:,0]>=xmin)&(centers[:,0]<=xmax)&(np.abs(centers[:,1])>=ymin)&(np.abs(centers[:,1])<=ymax)&(centers[:,2]>=zmin)&(centers[:,2]<=zmax)
 ids=np.flatnonzero(hit);chosen=rng.choice(ids,size=min(500,len(ids)),replace=False);points=centers[chosen]
 distances=[]
 for chunk in np.array_split(points,10):
  if len(chunk):distances.extend(trimesh.proximity.closest_point(proxy,chunk)[1])
 d=np.array(distances);results[name]={'candidate_triangles':int(len(ids)),'sampled_centroids':len(d),'distance_mm_p50_p90_p99':(np.quantile(d,[.5,.9,.99])*1000).tolist(),'over_12_5mm':int((d>.0125).sum()),'region_cfd_m':[xmin,xmax,ymin,ymax,zmin,zmax]}
 print(car,name,results[name],flush=True)
report={'car':car,'method':'500 uniformly sampled triangle centroids per coordinate region on raw display surface, nearest distance to CFD proxy; regions overlap other parts; not area weighted, not a connectivity audit or engineering CAD.','sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},'regions':results}
out=Path(__file__).parent/f'{car}-proxy-audit.json';out.write_text(json.dumps(report,indent=2)+'\n')
