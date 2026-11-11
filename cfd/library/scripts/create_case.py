"""Generate anchor cases from the known working Foundation-14 baseline."""
from pathlib import Path
import sys,json,re,shutil,hashlib
ROOT=Path(__file__).resolve().parents[3]
car,anchor=sys.argv[1:3]
settings={'base':('neutral',50,50),'low':('neutral',50/3.6,50/3.6),'high':('neutral',350/3.6,350/3.6),'open':('open',50,50),'left':('left',50,50),'right':('right',50,50),'locked':('neutral',50,0),'fast':('neutral',50,100),'spin':('neutral',0,50)}
pose,U,W=settings[anchor];folder=ROOT/f'cfd/library/geometry/{car}/{pose}';case=ROOT/f'cfd/library/cases/{car}-{anchor}'
meta=json.loads((folder/'pose.json').read_text());meta.update(speedMps=U,wheelSpeedMps=W,anchor=anchor,proxySha256={key:hashlib.sha256((folder/f'{key}.stl').read_bytes()).hexdigest() for key in ['body','FL','FR','RL','RR']})
if (case/'constant/polyMesh/points').exists():print('EXISTING',case);sys.exit(0)
if (case/'complete.json').exists():print('COMPLETE',case);sys.exit(0)
source=(ROOT/'cfd/scripts/create_car_case.py').read_text()
source=source.replace("ROOT=Path(__file__).resolve().parents[2];case=ROOT/'cfd/cases/rb19-50ms-coarse'",f"ROOT=Path({str(ROOT)!r});case=Path({str(case)!r})")
source=source.replace("audit=json.loads((ROOT/'cfd/reports/rb19-geometry-audit.json').read_text())","audit="+repr({'wheels':meta['wheels']}))
source=source.replace("c[2]-=.005","c[2]-=0")
source=source.replace("ROOT/f'cfd/geometry/rb19/{g}.stl'",f"Path({str(folder)!r})/f'{{g}}.stl'")
# Smaller but conservative far field. Shared mesh for all neutral geometry anchors.
source=source.replace('(116 48 32)','(88 36 24)').replace('level (3 4)','level (3 4)').replace('endTime 800','endTime 650').replace('writeInterval 100','writeInterval 50')
exec(compile(source,str(ROOT/'cfd/scripts/create_car_case.py'),'exec'),{'__file__':str(ROOT/'cfd/scripts/create_car_case.py')})
if anchor not in ['base','open','left','right']:
 base=ROOT/f'cfd/library/cases/{car}-base'
 if (base/'constant/polyMesh/points').exists():shutil.copytree(base/'constant/polyMesh',case/'constant/polyMesh',dirs_exist_ok=True);shutil.copy2(base/'log.checkMesh',case/'log.checkMesh')
# Rewrite dimensional boundary and turbulence values exactly, not visual-only scaling.
p=case/'0/U';s=p.read_text().replace('(50 0 0)',f'({U} 0 0)')
for key,w in meta['wheels'].items():
 s=re.sub(r'('+key+r' \{[^\n]*?omega )[^;]+;',lambda m:m[1]+str(W/w['radius'])+';',s)
p.write_text(s)
k=max(1e-6,1.5*(.01*max(U,W,1))**2);omega=max(1, k**.5/(.09**.25*.05))
for name,old,new in [('k','.375',k),('omega','22.36',omega)]:
 p=case/'0'/name;p.write_text(p.read_text().replace('uniform '+old,'uniform '+str(new)))
# RB16B has tighter gaps; stronger under-relaxation avoids the divergent
# initial SIMPLE transient seen with the RB19 settings. Same real boundary data.
if car=='rb16b':
 p=case/'system/fvSolution';p.write_text(p.read_text().replace('p .3','p .15').replace('U .5; k .4; omega .4','U .25; k .25; omega .25'))
 p=case/'system/fvSchemes';p.write_text(p.read_text().replace('limited .5','limited .25'))
if car=='rb16b' and anchor in ['left','right','locked','fast','spin']:
 p=case/'system/fvSolution';p.write_text(p.read_text().replace('p .15','p .1').replace('U .25; k .25; omega .25','U .15; k .2; omega .2'))
 p=case/'system/fvSchemes';p.write_text(p.read_text().replace('Gauss linear limited .25','Gauss linear uncorrected').replace('default limited .25','default uncorrected'))
# Baseline also serves as a high-iteration case; other anchors use 650 with
# the same quality/force checks recorded for review, never assumed converged.
(case/'anchor.json').write_text(json.dumps(meta,indent=2)+'\n')
# Regular physical grid used by every case, with zero/invalid mask inside solids.
import numpy as np
xs=np.linspace(-4,9,88);ys=np.linspace(-1.65,1.65,34);zs=np.linspace(.025,1.65,32)
points='\n'.join(f'({x:.7f} {y:.7f} {z:.7f})' for z in zs for y in ys for x in xs)
(case/'system/sampleGrid').write_text('FoamFile {version 2.0; format ascii; class dictionary; object sampleGrid;}\nfields (U);\ninterpolationScheme cellPoint;\nsetFormat raw;\nsets {grid {type points;ordered false;axis xyz;points (\n'+points+'\n);}}\n')
# foamPostProcess -dict expects function entries rather than a nested functions block.
(case/'system/gridFunctions').write_text('FoamFile {version 2.0;format ascii;class dictionary;object gridFunctions;}\n grid {type sets;libs ("libsampling.so");writeControl writeTime; #include "sampleGrid"\n}\n')
print('PREPARED',car,anchor,flush=True)
