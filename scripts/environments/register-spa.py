from pathlib import Path
import json,numpy as np
from scipy.spatial import cKDTree
geo=np.array(json.loads(Path('docs/research/spa-2026-11-12/geo.txt').read_text())['features'][0]['geometry']['coordinates'])[:,:2]
a=6378137;e2=.00669437999014;lat=np.deg2rad(geo[:,1].mean());M=a*(1-e2)/(1-e2*np.sin(lat)**2)**1.5;N=a/(1-e2*np.sin(lat)**2)**.5
origin=geo[0];meters=np.array([N*np.cos(lat),M])*np.pi/180
xy=(geo-origin)*meters;distance=np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))];sample=np.column_stack([np.interp(np.arange(0,distance[-1],5),distance,xy[:,k]) for k in range(2)])
tum=np.loadtxt('docs/research/spa-2026-11-12/TUM-Spa.csv',delimiter=',');source=tum[:,:2];rotation=np.eye(2);translation=sample.mean(axis=0)-source.mean(axis=0)
for i in range(40):
 moved=source@rotation.T+translation;d,ix=cKDTree(sample).query(moved);target=sample[ix];A=source-source.mean(axis=0);B=target-target.mean(axis=0);u,s,vt=np.linalg.svd(A.T@B);rotation=vt.T@u.T;translation=target.mean(axis=0)-source.mean(axis=0)@rotation.T
ll=(source@rotation.T+translation)/meters+origin
out={'originLonLat':origin.tolist(),'metersPerDegree':meters.tolist(),'rotation':rotation.tolist(),'translation':translation.tolist(),'fitMedianM':float(np.median(d)),'points':np.column_stack([ll,tum]).tolist()}
Path('docs/research/spa-2026-11-12/registered-centerline.json').write_text(json.dumps(out))
print('fit',np.quantile(d,[.5,.9,1]),'angle',np.rad2deg(np.arctan2(rotation[1,0],rotation[0,0])),'length',distance[-1])
for i in range(0,260,10):print(i,ll[i].round(6),tum[i])
