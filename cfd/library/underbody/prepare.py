"""Create isolated underbody-refined baselines; never overwrite previous cases."""
from pathlib import Path
import json, shutil, sys
root=Path(__file__).resolve().parents[3]
car,level=sys.argv[1],int(sys.argv[2])
assert car in ('rb19','rb16b') and level in (5,6)
source=root/'cfd/library/cases'/f'{car}-base'
suffix=sys.argv[3] if len(sys.argv)>3 else ''
assert suffix in ('','-retry1')
dest=root/'cfd/library/cases'/f'{car}-underbody-l{level}{suffix}'
if dest.exists(): raise SystemExit(f'Case already exists: {dest}')
dest.mkdir()
shutil.copytree(source/'0',dest/'0')
shutil.copytree(source/'system',dest/'system')
shutil.copytree(source/'constant',dest/'constant',ignore=shutil.ignore_patterns('polyMesh'))
shutil.copy2(source/'anchor.json',dest/'anchor.json')
p=dest/'system/snappyHexMeshDict';s=p.read_text()
s=s.replace(' wake {type box;', ' underbody {type box; min (-1.8 -1.05 0); max (2.8 1.05 .24);}\n wake {type box;')
s=s.replace('maxLocalCells 1200000; maxGlobalCells 1200000;', 'maxLocalCells 3500000; maxGlobalCells 3500000;')
s=s.replace('refinementRegions {nearCar {mode inside; level 2;}',f'refinementRegions {{underbody {{mode inside; level {level};}} nearCar {{mode inside; level 2;}}')
p.write_text(s)
meta={'car':car,'baseline':'180 km/h, straight, DRS closed','refinementLevel':level,'region_m':[[-1.8,-1.05,0],[2.8,1.05,.24]],'parent':f'{car}-base','proxy':'existing 12.5 mm voxel body','boundaryLayers':False,'intent':'exploratory comparison, not validated real-car performance'}
(dest/'underbody.json').write_text(json.dumps(meta,indent=2)+'\n')
print(dest)
