"""Install a common dense sampling lattice in an explicit case, without touching its solution."""
from pathlib import Path
import sys
import numpy as np
case=Path(sys.argv[1]).resolve()
assert (case/'underbody.json').is_file() or case.name in ('rb19-base','rb16b-base')
xs=np.linspace(-1.8,2.8,93);ys=np.linspace(-1.0,1.0,41);zs=np.linspace(.01,.20,20)
points='\n'.join(f'({x:.7f} {y:.7f} {z:.7f})' for z in zs for y in ys for x in xs)
(case/'system/underbodySample').write_text('FoamFile {version 2.0; format ascii; class dictionary; object underbodySample;}\nfields (U p);\ninterpolationScheme cellPoint;\nsetFormat raw;\nsets {underbody {type points;ordered false;axis xyz;points (\n'+points+'\n);}}\n')
(case/'system/underbodyFunctions').write_text('FoamFile {version 2.0;format ascii;class dictionary;object underbodyFunctions;}\n underbodyData {type sets;libs ("libsampling.so");writeControl writeTime; #include "underbodySample"\n}\n')
print(len(xs)*len(ys)*len(zs),'sampling points')
