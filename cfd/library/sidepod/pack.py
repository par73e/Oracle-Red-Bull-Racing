"""Pack an exploratory solved sidepod field with explicit valid-point mask."""
from pathlib import Path
import json,hashlib,sys
import numpy as np
case=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();assert (case/'sidepod-study.json').is_file()
files=list((case/'postProcessing/sidepodData').glob('*/sidepod.xy'));source=max(files,key=lambda p:float(p.parent.name));a=np.loadtxt(source)
shape=np.array([105,105,47]);lo=np.array([-2.4,-1.3,.05]);hi=np.array([2.8,1.3,1.2]);spacing=(hi-lo)/(shape-1)
index=np.rint((a[:,:3]-lo)/spacing).astype(int);valid=np.all((index>=0)&(index<shape),axis=1)&np.isfinite(a[:,3:6]).all(axis=1);a=a[valid];index=index[valid]
speed=np.linalg.norm(a[:,3:6],axis=1);anomalous=speed>150
assert anomalous.sum()/len(a)<.002,'Too many anomalous velocity samples'
a=a[~anomalous];index=index[~anomalous];flat=(index[:,2]*shape[1]+index[:,1])*shape[0]+index[:,0]
field=np.zeros((int(np.prod(shape)),4),dtype='<i2');scale=max(.001,float(np.max(np.abs(a[:,3:6])))/30000);field[flat,:3]=np.rint(a[:,3:6]/scale).astype('<i2');field[flat,3]=1
out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(field.tobytes());metadata={'case':case.name,'time':source.parent.name,'shape':shape.tolist(),'min':lo.tolist(),'max':hi.tolist(),'scale':scale,'located':len(a),'excludedNumericalSamples':int(anomalous.sum()),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'sourceSampleSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'proxySha256':json.loads((case/'anchor.json').read_text())['proxySha256'],'status':'exploratory; only 180 km/h neutral straight DRS closed rolling wheels; not validated real-car CFD','source':'OpenFOAM cellPoint samples, locally refined sidepod/suspension baseline; no boundary layers'}
out.with_suffix('.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata,indent=2))
