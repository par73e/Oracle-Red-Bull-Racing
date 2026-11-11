from pathlib import Path
import json,re,sys,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[3];case=Path(sys.argv[1]);meta=json.loads((case/'anchor.json').read_text())
files=list((case/'postProcessing/grid').glob('*/grid.xy'))
assert files,'No sampled grid '+str(case)
file=max(files,key=lambda p:float(p.parent.name));rows=np.loadtxt(file)
shape=(88,34,32);lo=np.array([-4,-1.65,.025]);hi=np.array([9,1.65,1.65]);spacing=(hi-lo)/(np.array(shape)-1)
index=np.rint((rows[:,:3]-lo)/spacing).astype(int);valid=np.all((index>=0)&(index<shape),axis=1)&np.isfinite(rows[:,3:6]).all(axis=1)&(np.abs(rows[:,3:6])<1e20).all(axis=1)
index=index[valid];rows=rows[valid]
# Isolated near-wall numerical spikes are excluded, never clamped to a nicer
# velocity. A masked point is zero so trajectories terminate there. Keep counts
# and the raw maximum in the public manifest; reject broadly unstable fields.
speeds=np.linalg.norm(rows[:,3:6],axis=1);raw_max=float(speeds.max());limit=3*max(meta['speedMps'],meta['wheelSpeedMps'],1)
anomalous=speeds>limit;anomaly_count=int(anomalous.sum())
assert anomaly_count/max(len(rows),1)<.002,'Widespread velocity anomalies: solve rejected'
rows[anomalous,3:6]=0
flat=(index[:,2]*shape[1]+index[:,1])*shape[0]+index[:,0]
field=np.zeros((np.prod(shape),3),np.float32);field[flat]=rows[:,3:6]
scale=max(.001,float(np.max(np.abs(field)))/32760);packed=np.rint(field/scale).astype('<i2')
folder=ROOT/'web/public/flow'/meta['car'];folder.mkdir(parents=True,exist_ok=True);out=folder/(meta['anchor']+'.bin');out.write_bytes(packed.tobytes())
log=(case/'log.foamRun').read_text();mesh=(case/'log.checkMesh').read_text();res={};step=0
for line in log.splitlines():
 m=re.match(r'Time = ([\d.]+)',line)
 if m:step=float(m[1]);res={}
 m=re.search(r'Solving for (\w+), Initial residual = ([\deE+.-]+)',line)
 if m:res.setdefault(m[1],float(m[2]))
assert re.search(r'^End$',log,re.M) and 'FOAM FATAL' not in log
assert not re.search(r'residual = [-+]?nan',log,re.I),'Divergent solve rejected'
assert np.isfinite(field).all(),'Non-finite field rejected'
assert float(file.parent.name)==650,'Missing final sampled iteration'
record={**meta,'grid':{'shape':shape,'min':lo.tolist(),'max':hi.tolist()},'file':f'/flow/{meta["car"]}/{out.name}','scale':scale,'sampledPoints':len(rows),'unlocatedOrSolidGridPoints':int(np.prod(shape)-len(rows)),'excludedNumericalSamples':anomaly_count,'rawFieldMax':raw_max,'exclusionThresholdMps':limit,'sampling':'cellPoint; isolated >3x max(inlet,wheel) samples excluded, never clipped','fieldMax':float(np.max(np.linalg.norm(field,axis=1))),'cells':int(re.search(r'cells:\s+(\d+)',mesh)[1]),'lastIteration':step,'residuals':res,'meshOk':'Mesh OK.' in mesh,'solver':'OpenFOAM Foundation 14 kOmegaSST RANS','quality':'coarse voxel proxy; sparse factorised interpolation is approximate','sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
(case/'complete.json').write_text(json.dumps(record,indent=2)+'\n');(ROOT/f'cfd/library/reports/{meta["car"]}-{meta["anchor"]}.json').write_text(json.dumps(record,indent=2)+'\n')
records=[]
for p in sorted((ROOT/'cfd/library/reports').glob(meta['car']+'-*.json')):
 try:
  r=json.loads(p.read_text())
  if 'file' in r:records.append(r)
 except Exception:pass
(folder/'manifest.json').write_text(json.dumps({'car':meta['car'],'frames':'CFD X downstream Y right Z up; display (-y,z,-x)','anchors':records,'quality':'Exploratory CFD anchors, sparse additive surrogate; not engineering validation.'},indent=2)+'\n')
print('PACKED',meta['car'],meta['anchor'],record['fieldMax'],flush=True)
