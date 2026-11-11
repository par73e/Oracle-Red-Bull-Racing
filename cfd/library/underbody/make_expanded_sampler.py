"""Sample a wider near-car volume from an already solved field."""
from pathlib import Path
import sys
import numpy as np
case=Path(sys.argv[1]).resolve()
assert (case/'underbody.json').is_file() and (case/'1150'/'U').is_file()
xs=np.linspace(-1.8,4,117);ys=np.linspace(-1.4,1.4,57);zs=np.linspace(.01,.45,45)
points='\n'.join(f'({x:.7f} {y:.7f} {z:.7f})' for z in zs for y in ys for x in xs)
(case/'system/underbodyExpandedSample').write_text('FoamFile {version 2.0; format ascii; class dictionary; object underbodyExpandedSample;}\nfields (U);\ninterpolationScheme cellPoint;\nsetFormat raw;\nsets {underbodyExpanded {type points;ordered false;axis xyz;points (\n'+points+'\n);}}\n')
(case/'system/underbodyExpandedFunctions').write_text('FoamFile {version 2.0;format ascii;class dictionary;object underbodyExpandedFunctions;}\n underbodyExpandedData {type sets;libs ("libsampling.so");writeControl writeTime; #include "underbodyExpandedSample"\n}\n')
print(len(xs)*len(ys)*len(zs),'points')
