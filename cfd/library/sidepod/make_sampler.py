"""Create reusable sidepod and suspension velocity probe lattice."""
from pathlib import Path
import numpy as np,sys
case=Path(sys.argv[1]).resolve();assert (case/'sidepod-study.json').exists() or case.name in ('rb19-base','rb16b-base','rb19-underbody-l6-continued1','rb16b-underbody-l6-retry1')
xs=np.linspace(-2.4,2.8,105);ys=np.linspace(-1.3,1.3,105);zs=np.linspace(.05,1.2,47)
points='\n'.join(f'({x:.7f} {y:.7f} {z:.7f})' for z in zs for y in ys for x in xs)
(case/'system/sidepodSample').write_text('FoamFile {version 2.0;format ascii;class dictionary;object sidepodSample;}\nfields (U);\ninterpolationScheme cellPoint;\nsetFormat raw;\nsets {sidepod {type points;ordered false;axis xyz;points (\n'+points+'\n);}}\n')
(case/'system/sidepodFunctions').write_text('FoamFile {version 2.0;format ascii;class dictionary;object sidepodFunctions;}\n sidepodData {type sets;libs ("libsampling.so");writeControl writeTime; #include "sidepodSample"\n}\n')
print(len(xs)*len(ys)*len(zs),'points')
