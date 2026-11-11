"""Compare velocity and kinematic pressure at common located sample points."""
from pathlib import Path
import json,sys
import numpy as np
root=Path(__file__).resolve().parents[3]; car=sys.argv[1];left,right=sys.argv[2:4]
assert car in ('rb19','rb16b') and left in ('base','underbody-l5','underbody-l6','underbody-l5-stable1','underbody-l6-retry1','underbody-l5-continued1','underbody-l6-continued1') and right in ('base','underbody-l5','underbody-l6','underbody-l5-stable1','underbody-l6-retry1','underbody-l5-continued1','underbody-l6-continued1')
def load(name):
 directory=root/f'cfd/library/cases/{car}-{name}/postProcessing/underbodyData'; paths=list(directory.glob('*/underbody.xy')); p=max(paths,key=lambda f:float(f.parent.name)); a=np.loadtxt(p)
 return p.parent.name, {tuple(row[:3]):row[3:] for row in a if -1<=row[0]<=2 and abs(row[1])<=.6 and .02<=row[2]<=.10 and np.isfinite(row).all()}
(ta,a),(tb,b)=load(left),load(right);keys=sorted(a.keys()&b.keys());u=np.array([a[k] for k in keys]);v=np.array([b[k] for k in keys]);difference=np.linalg.norm(u[:,:3]-v[:,:3],axis=1)
report={'region':'x [-1,2] m, |y| <= .6 m, z [0.02,0.10] m','cases':[f'{car}-{left}',f'{car}-{right}'],'sample_times':[ta,tb],'located_in_both':len(keys),'left_only':len(a.keys()-b.keys()),'right_only':len(b.keys()-a.keys()),'median_speed_mps':[float(np.median(np.linalg.norm(w[:,:3],axis=1))) for w in (u,v)],'velocity_vector_difference_mps_median_p90':np.quantile(difference,[.5,.9]).tolist(),'kinematic_pressure_difference_m2_s2_median':float(np.median(abs(u[:,3]-v[:,3]))),'limitations':'Common located points only; wall/solid sampling ambiguity, proxy geometry, local mesh and convergence remain material. Differences are not a proven error bound.'}
out=Path(__file__).parent/f'{car}-{left}-vs-{right}.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
