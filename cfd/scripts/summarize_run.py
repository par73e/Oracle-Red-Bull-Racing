"""Report what ran; do not promote a coarse calculation to validated aero."""
from pathlib import Path
import json,re
import numpy as np
ROOT=Path(__file__).resolve().parents[2];case=ROOT/'cfd/cases/rb19-50ms-coarse'
log=(case/'log.foamRun').read_text();mesh=(case/'log.checkMesh').read_text()
rows=[]
for line in (case/'postProcessing/forces/0/forces.dat').read_text().splitlines():
 if not line.strip() or line.startswith('#'):continue
 values=[float(v) for v in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?',line)]
 if len(values)==13:rows.append([values[0]]+list(np.array(values[1:4])+values[4:7]))
a=np.array(rows);assert np.isfinite(a).all()
last=a[-100:,1:];mean=last.mean(axis=0)
residuals={};iteration=0
for line in log.splitlines():
 m=re.match(r'Time = ([\d.]+)',line)
 if m:iteration=int(float(m[1]));residuals[iteration]={}
 m=re.search(r'Solving for (\w+), Initial residual = ([\deE+.-]+)',line)
 if m:residuals[iteration].setdefault(m[1],float(m[2]))
continuity=re.findall(r'continuity errors : sum local = ([^,]+), global = ([^,]+), cumulative = ([^\s]+)',log)
report={'kind':'coarse full-car numerical trial, not mesh-independent or validated RB19 aerodynamics','solver':'OpenFOAM Foundation 14 incompressibleFluid','speed_mps':50,'drs':0,'steer_deg':0,'cells':int(re.search(r'cells:\s+(\d+)',mesh)[1]),'mesh_ok':'Mesh OK.' in mesh,'last_iteration':int(a[-1,0]),'solver_reached_end':bool(re.search(r'^End$',log,re.M)) and 'FOAM FATAL' not in log,'last_initial_residuals':residuals.get(int(a[-1,0]),{}),'last_continuity':dict(zip(['local','global','cumulative'],map(float,continuity[-1]))),'last_100_force_mean_N':{'drag':float(mean[0]),'side':float(mean[1]),'downforce':float(-mean[2])},'last_100_force_peak_to_peak_relative':{'drag':float(np.ptp(last[:,0])/abs(mean[0])),'downforce':float(np.ptp(last[:,2])/max(abs(mean[2]),1))},'geometry_proxy':'10 mm voxel union; rear hub caps; 5 mm downward placement; tyre intersection/contact approximate','limitations':['first-order upwind on coarse grid','no prism boundary layers; wall-function y+ requires review','no grid or domain independence study','display-model floor and vehicle geometry are approximations','only RB19 straight-line DRS-closed baseline; no RB16B or cornering case']}
flows={}
for side in ['inlet','outlet']:
 path=case/f'postProcessing/{side}Flow/{report["last_iteration"]}/surfaceFieldValue.dat'
 if path.exists():
  lines=[l for l in path.read_text().splitlines() if l.strip() and not l.startswith('#')]
  flows[side]=float(lines[-1].split()[-1])
if len(flows)==2:
 report['boundary_flux_m3_s']=flows
 report['boundary_flux_relative_imbalance_at_output_precision']=abs(sum(flows.values()))/abs(flows['inlet'])
report['last_100_numerically_stable']=all(v<.01 for v in report['last_100_force_peak_to_peak_relative'].values()) and all(v<1e-4 for v in report['last_initial_residuals'].values()) and report.get('boundary_flux_relative_imbalance_at_output_precision',1)<1e-4
report['yPlus_at_800']={}
yp=case/'postProcessing/yPlus/0/yPlus.dat'
if yp.exists():
 for line in yp.read_text().splitlines():
  t=line.split()
  if t and t[0]==str(report['last_iteration']):report['yPlus_at_800'][t[1]]={'min':float(t[2]),'max':float(t[3]),'mean':float(t[4])}
(ROOT/'cfd/reports/rb19-run-summary.json').write_text(json.dumps(report,indent=2)+'\n')
np.savetxt(ROOT/'cfd/reports/rb19-forces.csv',a,delimiter=',',header='iteration,drag_N,side_N,lift_N',comments='')
print(json.dumps(report,indent=2))
