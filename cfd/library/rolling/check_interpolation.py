"""Withhold the G=25 solve and compare it with the endpoints G=0 and G=50.
This tests interpolation against this mesh's CFD, not against real-car truth.
"""
from pathlib import Path
import json
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
def load(a):
 b=(ROOT/('web/public'+a['file'])).read_bytes()
 return np.frombuffer(b,dtype='<i2').astype(float).reshape(-1,3)*a['scale']
reports=[]
for car in ['rb19','rb16b']:
 old=json.loads((ROOT/f'web/public/flow/{car}/manifest.json').read_text())
 new=json.loads((ROOT/f'web/public/flow/{car}/rolling/manifest.json').read_text())
 nodes={a['anchor']:a for a in old['anchors']+new['anchors']}
 a,b,truth=[load(nodes[k]) for k in ['road-stop','base','road-slow']]
 valid=np.all([np.linalg.norm(x,axis=1)>0 for x in [a,b,truth]],axis=0)
 pred=(a+b)/2;error=np.linalg.norm(pred-truth,axis=1)
 spec=nodes['base']['grid'];nz,ny,nx=spec['shape'][::-1]
 z,y,x=np.meshgrid(np.linspace(spec['min'][2],spec['max'][2],nz),np.linspace(spec['min'][1],spec['max'][1],ny),np.linspace(spec['min'][0],spec['max'][0],nx),indexing='ij')
 near=np.zeros(len(valid),bool)
 for w in nodes['base']['wheels'].values():
  c=w['center'];near|=((x.ravel()-c[0])**2+(y.ravel()-c[1])**2+(z.ravel()-c[2])**2)<.8**2
 record={'car':car,'heldOut':'road-slow (air=50, road=25 m/s)','prediction':'0.5 * road-stop + 0.5 * base','regions':{}}
 for name,mask in [('allCommonFluid',valid),('within0.8mOfWheelCentres',valid&near)]:
  e=error[mask];speed=np.linalg.norm(truth[mask],axis=1)
  record['regions'][name]={'points':len(e),'velocityErrorMpsP50P90':np.quantile(e,[.5,.9]).tolist(),'rmsVelocityErrorMps':float(np.sqrt(np.mean(e**2))),'rmsErrorRelativeToTruthRms':float(np.sqrt(np.mean(e**2)/np.mean(speed**2)))}
 reports.append(record)
result={'records':reports,'scope':'Single interior holdout at air=50 m/s. Does not validate the entire two-dimensional domain, DRS/steering combinations, fine fields or actual car aerodynamics.'}
(ROOT/'cfd/library/reports/rolling-interpolation-check-2026-11-12.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
