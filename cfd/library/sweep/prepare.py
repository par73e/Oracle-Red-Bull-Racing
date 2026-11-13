from pathlib import Path
import sys,json,re,shutil,hashlib
from plan import ROOT,requests
car,key=sys.argv[1:3];p=requests()[key];U=p['airKmh']/3.6;G=p['groundKmh']/3.6
case=ROOT/f'cfd/library/cases/{car}-sweep-{key}';base=ROOT/f'cfd/library/cases/{car}-base'
if case.exists():
 assert json.loads((case/'anchor.json').read_text())['parameters']==p
 print('EXISTING',case);sys.exit()
pose=key if key.startswith(('drs-','steer-')) else 'neutral'
folder=ROOT/f'cfd/library/geometry/{car}/{pose}'
meta=json.loads((folder/'pose.json').read_text());meta.update(anchor=key,family='sweep',parameters=p,speedMps=U,groundSpeedMps=G,wheelSpeedMps=G,noSlipRolling=True,proxySha256={k:hashlib.sha256((folder/f'{k}.stl').read_bytes()).hexdigest() for k in ['body','FL','FR','RL','RR']})
if pose=='neutral':
 case.mkdir()
 for name in ['0','constant','system']:shutil.copytree(base/name,case/name)
 shutil.copy2(base/'log.checkMesh',case/'log.checkMesh')
else:
 source=(ROOT/'cfd/scripts/create_car_case.py').read_text()
 source=source.replace("ROOT=Path(__file__).resolve().parents[2];case=ROOT/'cfd/cases/rb19-50ms-coarse'",f"ROOT=Path({str(ROOT)!r});case=Path({str(case)!r})")
 source=source.replace("audit=json.loads((ROOT/'cfd/reports/rb19-geometry-audit.json').read_text())","audit="+repr({'wheels':meta['wheels']})).replace('c[2]-=.005','c[2]-=0')
 source=source.replace("ROOT/f'cfd/geometry/rb19/{g}.stl'",f"Path({str(folder)!r})/f'{{g}}.stl'")
 source=source.replace('(116 48 32)','(88 36 24)').replace('endTime 800','endTime 650').replace('writeInterval 100','writeInterval 50')
 exec(compile(source,str(ROOT/'cfd/scripts/create_car_case.py'),'exec'),{'__file__':str(ROOT/'cfd/scripts/create_car_case.py')})
 # Identical sampling lattice to the original published fields.
 for name in ['sampleGrid','gridFunctions']:shutil.copy2(base/'system'/name,case/'system'/name)
 if car=='rb16b':
  fp=case/'system/fvSolution';fp.write_text(fp.read_text().replace('p .3','p .15').replace('U .5; k .4; omega .4','U .25; k .25; omega .25'))
  fp=case/'system/fvSchemes';fp.write_text(fp.read_text().replace('limited .5','limited .25'))
(case/'anchor.json').write_text(json.dumps(meta,indent=2)+'\n')
fp=case/'0/U';s=fp.read_text().replace('(50 0 0)',f'({U} 0 0)');s=re.sub(r'(ground \{type fixedValue; value uniform )\([^)]*\)',lambda m:m[1]+f'({G} 0 0)',s)
for k,w in meta['wheels'].items():s=re.sub(r'('+k+r' \{[^\n]*?omega )[^;]+;',lambda m:m[1]+str(G/w['radius'])+';',s)
fp.write_text(s)
k=max(1e-6,1.5*(.01*U)**2);omega=max(1,k**.5/(.09**.25*.05))
for name,old,value in [('k','.375',k),('omega','22.36',omega)]:
 fp=case/'0'/name;fp.write_text(fp.read_text().replace('uniform '+old,'uniform '+str(value)))
if car=='rb16b':
 fp=case/'system/fvSolution';fp.write_text(fp.read_text().replace('p .15','p .1').replace('U .25; k .25; omega .25','U .15; k .2; omega .2'))
 fp=case/'system/fvSchemes';fp.write_text(fp.read_text().replace('Gauss linear limited .25','Gauss linear uncorrected').replace('default limited .25','default uncorrected'))
(case/'log.foamRun').touch()
print('PREPARED',case,flush=True)
