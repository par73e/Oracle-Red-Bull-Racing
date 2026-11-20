"""Repeat the RB19 straight 10 km/h audit and export its four solved fields."""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
from hashlib import sha256
root=Path(__file__).resolve().parents[3]
lib=root/'cfd/library'
base=lib/'cases/rb19-base'
for wind in (0, 4, 11, 15):
    road=10/3.6
    inlet=road+wind
    case=lib/'cases'/f'rb19-headwind-audit-road010-wind{wind:02}'
    if not case.exists():
        if shutil.disk_usage(root).free < 30 * 1024**3:
            raise RuntimeError('Less than 30 GiB of free space')
        case.mkdir()
        for name in ('0','constant','system'):
            shutil.copytree(base/name,case/name)
        shutil.copy2(base/'log.checkMesh',case/'log.checkMesh')
        meta=json.loads((base/'anchor.json').read_text())
        u=case/'0/U'
        text=u.read_text().replace('(50 0 0)',f'({inlet} 0 0)')
        text,n=re.subn(r'(ground \{type fixedValue; value uniform )\([^)]*\)',lambda m:m[1]+f'({road} 0 0)',text)
        assert n==1
        for wheel,spec in meta['wheels'].items():
            text,n=re.subn(r'('+wheel+r' \{[^\n]+?omega )[^;]+;',lambda m:m[1]+f'{road/spec["radius"]};',text)
            assert n==1
        u.write_text(text)
        k=max(1e-6,1.5*(.01*inlet)**2)
        omega=max(1,k**.5/(.09**.25*.05))
        for name,val in [('k',k),('omega',omega)]:
            p=case/'0'/name
            p.write_text(re.sub(r'(?<=uniform )[0-9.eE+-]+',str(val),p.read_text()))
        (case/'audit-conditions.json').write_text(json.dumps({'inletMps':inlet,'naturalWindMps':wind,'roadMps':road,'wheelMps':road,'drs':0,'steer':0,'yaw':0})+'\n')
    raw = json.loads((case/'audit-conditions.json').read_text())
    assert raw == {'inletMps': inlet, 'naturalWindMps': wind, 'roadMps': road,
                   'wheelMps': road, 'drs': 0, 'steer': 0, 'yaw': 0}
    print('START', case.name, flush=True)
    subprocess.run(['/opt/homebrew/bin/orb', '-m', 'aero-cfd', 'bash', str(lib/'scripts/run_anchor.sh'), str(case)],
                   check=True, stdin=subprocess.DEVNULL)
    meta = json.loads((base/'anchor.json').read_text())
    meta.update(anchor=f'road010-wind-{wind*1000:05d}', family='road010', speedMps=inlet,
                naturalWindMps=wind, groundSpeedMps=road, wheelSpeedMps=road,
                drs=0, steer=0, yawDeg=0, sourceMesh=str(base.relative_to(root)),
                sourceMeshSha256=sha256((case/'constant/polyMesh/points').read_bytes()).hexdigest())
    (case/'anchor.json').write_text(json.dumps(meta, indent=2)+'\n')
    subprocess.run([sys.executable, str(lib/'sweep/pack.py'), str(case)], check=True)
    print('DONE',case.name,flush=True)
