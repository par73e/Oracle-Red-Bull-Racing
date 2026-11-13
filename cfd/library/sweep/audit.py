"""Validate every planned single-axis node without treating finite runs as convergence."""
import hashlib,json,re
import numpy as np
from plan import ROOT,requests,write_manifest
records=[]
for car in ['rb19','rb16b']:
 m=write_manifest(car);assert m['complete'] and m['completedUnique']==277
 fields={a['key']:a for a in m['fields']};assert set(fields)==set(requests())
 for key,p in requests().items():
  a=fields[key];b=(ROOT/('web/public'+a['file'])).read_bytes();assert hashlib.sha256(b).hexdigest()==a['sha256'];assert a['parameters']==p
  assert a['meshOk'] and a['lastIteration']==650 and np.isfinite(list(a['residuals'].values())).all()
  if a.get('reused'):continue
  assert a['wheelSpeedMps']==a['groundSpeedMps']==p['groundKmh']/3.6 and a['speedMps']==p['airKmh']/3.6
  case=ROOT/f'cfd/library/cases/{car}-sweep-{key}';s=(case/'0/U').read_text()
  assert float(re.search(r'inlet \{type fixedValue; value uniform \(([^ ]+)',s)[1])==a['speedMps']
  assert float(re.search(r'ground \{type fixedValue; value uniform \(([^ ]+)',s)[1])==a['groundSpeedMps']
  for name,w in a['wheels'].items():assert abs(float(re.search(name+r' \{[^\n]*omega ([^;]+)',s)[1])*w['radius']-a['groundSpeedMps'])<1e-8
  mesh=(case/'log.checkMesh').read_text();assert 'Mesh OK.' in mesh
  log=(case/'log.foamRun').read_text();assert re.search(r'^End$',log,re.M) and not re.search('FOAM FATAL|residual = [-+]?nan',log,re.I)
  continuity=re.findall(r'sum local = ([\deE+.-]+), global = ([\deE+.-]+)',log)
  force=[]
  for line in (case/'postProcessing/forces/0/forces.dat').read_text().splitlines():
   if not line.strip() or line.startswith('#'):continue
   v=np.array([float(n) for n in re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?',line)])
   if v[0]>=550:force.append(v[1:4]+v[4:7])
  f=np.array(force);assert len(f)>=100 and np.isfinite(f).all()
  records.append({'car':car,'key':key,'parameters':p,'maxResidual':max(a['residuals'].values()),'strictResidualTargetMet':max(a['residuals'].values())<1e-4,'localContinuity':float(continuity[-1][0]),'globalContinuity':float(continuity[-1][1]),'forceRelativeRangeLast100':(np.ptp(f,axis=0)/np.maximum(np.abs(f.mean(axis=0)),1)).tolist(),'excludedSamples':a['excludedNumericalSamples']})
(ROOT/'cfd/library/reports/sweep-quality-2026-11-12.json').write_text(json.dumps({'records':records,'scope':'One-factor sweep of coarse steady proxy CFD only. Finite results and 650 iterations do not prove convergence. Combined controls and locally refined flow remain approximate.'},indent=2)+'\n')
print('554 planned nodes audited, including reused nodes, boundary values, original logs, grid checks, finite fields and source hashes')
