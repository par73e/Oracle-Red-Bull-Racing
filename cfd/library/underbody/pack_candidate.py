"""Prepare a local candidate lattice; not a publication or quality approval."""
import json,sys,hashlib
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[3];case=Path(sys.argv[1]).resolve(); output=Path(sys.argv[2]).resolve()
assert (case/'underbody.json').exists()
files=list((case/'postProcessing/underbodyData').glob('*/underbody.xy')); source=max(files,key=lambda p:float(p.parent.name));a=np.loadtxt(source)
shape=np.array([93,41,20]);lo=np.array([-1.8,-1.,.01]);hi=np.array([2.8,1.,.2]);spacing=(hi-lo)/(shape-1);index=np.rint((a[:,:3]-lo)/spacing).astype(int)
valid=np.all((index>=0)&(index<shape),axis=1)&np.isfinite(a[:,3:6]).all(axis=1)&(np.linalg.norm(a[:,3:6],axis=1)<=150)
a=a[valid];index=index[valid];flat=(index[:,2]*shape[1]+index[:,1])*shape[0]+index[:,0]
field=np.zeros((int(np.prod(shape)),4),dtype='<i2');scale=max(.001,float(np.max(np.abs(a[:,3:6])))/30000);field[flat,:3]=np.rint(a[:,3:6]/scale).astype('<i2');field[flat,3]=1
output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(field.tobytes());metadata={'case':case.name,'time':source.parent.name,'shape':shape.tolist(),'min':lo.tolist(),'max':hi.tolist(),'scale':scale,'located':len(a),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'status':'exploratory candidate; no engineering validation; only 180 km/h, straight, DRS closed, rolling wheels','source':'OpenFOAM cellPoint samples; separate from whole-car coarse field','sourceSampleSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'proxySha256':json.loads((case/'anchor.json').read_text())['proxySha256']};output.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata,indent=2))
