"""Independent air/road speeds; tyre peripheral speed equals road speed.
New cases reuse only baseline mesh/config, never modify prior calculations.
"""
from pathlib import Path
import hashlib,json,re,shutil,sys
ROOT=Path(__file__).resolve().parents[3]
SETTINGS={'road-stop':(50,0),'road-slow':(50,25),'road-fast':(50,100),'still-air':(0,50)}
car,anchor=sys.argv[1:3];U,G=SETTINGS[anchor]
base=ROOT/f'cfd/library/cases/{car}-base';case=ROOT/f'cfd/library/cases/{car}-rolling-{anchor}'
if case.exists():
 meta=json.loads((case/'anchor.json').read_text());assert (meta['speedMps'],meta['groundSpeedMps'])==(U,G)
 print('EXISTING',case);sys.exit()
case.mkdir()
for name in ['0','constant','system']:shutil.copytree(base/name,case/name)
shutil.copy2(base/'log.checkMesh',case/'log.checkMesh')
meta=json.loads((base/'anchor.json').read_text());meta.update(anchor=anchor,family='rolling',speedMps=U,groundSpeedMps=G,wheelSpeedMps=G,noSlipRolling=True,sourceMesh=str(base.relative_to(ROOT)),sourceMeshSha256=hashlib.sha256((base/'constant/polyMesh/points').read_bytes()).hexdigest())
(case/'anchor.json').write_text(json.dumps(meta,indent=2)+'\n')
p=case/'0/U';s=p.read_text().replace('(50 0 0)',f'({U} 0 0)')
s=re.sub(r'(ground \{type fixedValue; value uniform )\([^)]*\)',lambda m:m[1]+f'({G} 0 0)',s)
for key,w in meta['wheels'].items():s=re.sub(r'('+key+r' \{[^\n]*?omega )[^;]+;',lambda m:m[1]+str(G/w['radius'])+';',s)
p.write_text(s)
# Free-stream turbulence depends on inlet, held constant for the 50 m/s sweep.
k=max(1e-6,1.5*(.01*U)**2);omega=max(1,k**.5/(.09**.25*.05))
for name,old,new in [('k','.375',k),('omega','22.36',omega)]:
 p=case/'0'/name;p.write_text(p.read_text().replace('uniform '+old,'uniform '+str(new)))
if car=='rb16b':
 p=case/'system/fvSolution';p.write_text(p.read_text().replace('p .15','p .1').replace('U .25; k .25; omega .25','U .15; k .2; omega .2'))
 p=case/'system/fvSchemes';p.write_text(p.read_text().replace('Gauss linear limited .25','Gauss linear uncorrected').replace('default limited .25','default uncorrected'))
print('PREPARED',case,flush=True)
