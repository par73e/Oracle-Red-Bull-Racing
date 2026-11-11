"""Compare mapped velocity at common sidepod probe points; not a CFD validation."""
from pathlib import Path
import json,sys
import numpy as np
root=Path(__file__).resolve().parents[3];car=sys.argv[1];assert car in ('rb19','rb16b')
names=[f'{car}-underbody-l6-continued1' if car=='rb19' else f'{car}-underbody-l6-retry1',f'{car}-sidepod-suspension-l5-20261111']
shape=np.array([105,105,47]);lo=np.array([-2.4,-1.3,.05]);hi=np.array([2.8,1.3,1.2]);step=(hi-lo)/(shape-1);arrays=[];times=[]
for name in names:
 directory=root/'cfd/library/cases'/name/'postProcessing/sidepodData';files=list(directory.glob('*/sidepod.xy'));file=max(files,key=lambda p:float(p.parent.name));times.append(file.parent.name);a=np.loadtxt(file);ind=np.rint((a[:,:3]-lo)/step).astype(int);valid=np.all((ind>=0)&(ind<shape),axis=1)&np.isfinite(a[:,3:6]).all(axis=1);a=a[valid];ind=ind[valid];flat=(ind[:,2]*shape[1]+ind[:,1])*shape[0]+ind[:,0];field=np.full((np.prod(shape),3),np.nan,np.float32);field[flat]=a[:,3:6];arrays.append(field)
x,y,z=np.meshgrid(np.linspace(lo[0],hi[0],shape[0]),np.linspace(lo[1],hi[1],shape[1]),np.linspace(lo[2],hi[2],shape[2]),indexing='xy');x=np.broadcast_to(x,(shape[1],shape[0],shape[2])).transpose(2,0,1).ravel();y=y.transpose(2,0,1).ravel();z=z.transpose(2,0,1).ravel()
valid=np.isfinite(arrays[0]).all(axis=1)&np.isfinite(arrays[1]).all(axis=1)
regions={'side_undercut':(-.4,1.8,.25,1.05,.18,.55),'side_upper':(-.4,1.8,.25,1.05,.55,1.10),'front_suspension':(-2.2,-.6,.20,1.05,.15,.80)};result={}
for name,(xmin,xmax,ymin,ymax,zmin,zmax) in regions.items():
 use=valid&(x>=xmin)&(x<=xmax)&(abs(y)>=ymin)&(abs(y)<=ymax)&(z>=zmin)&(z<=zmax);a,b=(f[use] for f in arrays);d=np.linalg.norm(a-b,axis=1)
 result[name]={'common_points':len(d),'median_speed_mps':[float(np.median(np.linalg.norm(v,axis=1))) for v in (a,b)],'vector_difference_mps_p50_p90':np.quantile(d,[.5,.9]).tolist()}
report={'cases':names,'times':times,'regions':result,'limitations':'Common located points in coordinate boxes, including exterior flow; source grids and iteration counts differ, and changes are not a proven error bound or evidence of convergence.'}
out=Path(__file__).parent/f'{car}-comparison.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
