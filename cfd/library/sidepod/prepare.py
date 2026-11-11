"""Create an isolated neutral-pose sidepod/suspension refinement case."""
from pathlib import Path
import hashlib,json,shutil,sys
root=Path(__file__).resolve().parents[3];car=sys.argv[1];assert car in ('rb19','rb16b')
src=root/'cfd/library/cases'/f'{car}-base';dst=root/'cfd/library/cases'/f'{car}-sidepod-suspension-l5-20261111'
if dst.exists():raise SystemExit(f'Preserving existing case: {dst}')
dst.mkdir()
for name in ('0','system'):shutil.copytree(src/name,dst/name)
shutil.copytree(src/'constant',dst/'constant',ignore=shutil.ignore_patterns('polyMesh'))
shutil.copy2(src/'anchor.json',dst/'anchor.json')
regions={'underbody':((-1.8,-1.05,0),(2.8,1.05,.24)),'side_l':((-.7,.2,.15),(2.3,1.2,1.1)),'side_r':((-.7,-1.2,.15),(2.3,-.2,1.1)),'susp_l':((-2.4,.2,.1),(-.6,1.2,.85)),'susp_r':((-2.4,-1.2,.1),(-.6,-.2,.85))}
p=dst/'system/snappyHexMeshDict';s=p.read_text();boxes='\n'.join(f' {key} {{type box; min ({" ".join(map(str,lo))}); max ({" ".join(map(str,hi))});}}' for key,(lo,hi) in regions.items())
s=s.replace(' wake {type box;',boxes+'\n wake {type box;').replace('maxLocalCells 1200000; maxGlobalCells 1200000;', 'maxLocalCells 3500000; maxGlobalCells 3500000;')
settings=' '.join(f'{key} {{mode inside; level 5;}}' for key in regions)
s=s.replace('refinementRegions {nearCar {mode inside; level 2;}',f'refinementRegions {{{settings} nearCar {{mode inside; level 2;}}');p.write_text(s)
meta={'car':car,'anchor':'base','condition':'180 km/h, neutral steering, DRS closed, rolling wheels','level':5,'refinement_regions_CFD_m':regions,'proxy':'existing 12.5 mm voxel geometry','boundary_layers':False,'note':'local refinement exploratory, not an engineering validated vehicle; region boxes are not separate components'}
(dst/'sidepod-study.json').write_text(json.dumps(meta,indent=2)+'\n');print(dst)
