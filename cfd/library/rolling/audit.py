"""Audit solved rolling cases, including BCs, mesh identity and convergence diagnostics."""
from pathlib import Path
import json,re,hashlib
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
records=[]
for car in ['rb19','rb16b']:
 for anchor in ['road-stop','road-slow','road-fast','still-air']:
  case=ROOT/f'cfd/library/cases/{car}-rolling-{anchor}'
  a=json.loads((case/'complete.json').read_text());log=(case/'log.foamRun').read_text()
  assert a['groundSpeedMps']==a['wheelSpeedMps'] and a['noSlipRolling']
  assert a['meshOk'] and re.search(r'^End$',log,re.M) and not re.search('FOAM FATAL|residual = [-+]?nan',log,re.I)
  assert hashlib.sha256((case/'constant/polyMesh/points').read_bytes()).hexdigest()==a['sourceMeshSha256']
  field=(ROOT/('web/public'+a['file'])).read_bytes();assert hashlib.sha256(field).hexdigest()==a['sha256']
  continuity=re.findall(r'sum local = ([\deE+.-]+), global = ([\deE+.-]+)',log)
  values=[]
  for line in (case/'postProcessing/forces/0/forces.dat').read_text().splitlines():
   if not line.strip() or line.startswith('#'):continue
   v=np.array([float(n) for n in re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?',line)])
   if v[0]>=550:values.append(v[1:4]+v[4:7])
  f=np.array(values);assert len(f)>=100 and np.isfinite(f).all()
  r={k:a[k] for k in ['car','anchor','speedMps','groundSpeedMps','wheelSpeedMps','cells','residuals','rawFieldMax','fieldMax','excludedNumericalSamples','sha256']}
  r.update(lastLocalContinuity=float(continuity[-1][0]),lastGlobalContinuity=float(continuity[-1][1]),forceRelativeRangeLast100=(np.ptp(f,axis=0)/np.maximum(np.abs(f.mean(axis=0)),1)).tolist(),strictResidualTargetMet=max(a['residuals'].values())<1e-4)
  records.append(r)
report={'records':records,'quality':'Exploratory steady coarse RANS, not grid-independent or experimentally validated. No new locally refined underbody/sidepod solves. Straight geometry only; combined steering and DRS are sparse additive approximations.'}
(ROOT/'cfd/library/reports/rolling-quality-2026-11-12.json').write_text(json.dumps(report,indent=2)+'\n')
lines=['# 独立来流与对地速度 CFD 核查 · 2026-11-12','','同车身参考系下独立设置入口与地面速度，四轮壁面角速度始终为地面速度除以各轮半径。原 18 例和加密基线均保留。','','|车型|工况|来流 m/s|地面 m/s|最大残差|局部连续性误差|排除采样点|','|---|---|---:|---:|---:|---:|---:|']
for r in records:lines.append(f"|{r['car']}|{r['anchor']}|{r['speedMps']}|{r['groundSpeedMps']}|{max(r['residuals'].values()):.3g}|{r['lastLocalContinuity']:.3g}|{r['excludedNumericalSamples']}|")
lines+=['','逐例网格哈希、原始最大流速、显示场最大速度、残差和末 100 步力波动见 JSON。有限场与固定 650 步不代表严格收敛；不得从展示代理推导真实赛车性能。']
(ROOT/'cfd/library/reports/rolling-quality-2026-11-12.md').write_text('\n'.join(lines)+'\n')
print('Audited eight rolling cases, original logs/forces, exact mesh identity and published hashes')
