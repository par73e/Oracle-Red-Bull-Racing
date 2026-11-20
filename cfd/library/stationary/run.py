"""Solve the parked, straight, DRS-closed headwind axis on each base mesh."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
LIBRARY = ROOT / 'cfd/library'
CARS = ('rb19', 'rb16b')
# Solve the two reported settings first. Further nodes bracket the remaining
# wind slider range without importing any moving-road or wheel field.
SPEEDS = (0.5, 1.0, 2.0, 5.0, 15.0)


def prepare(car, speed):
    key = f'wind-{round(speed * 1000):05d}'
    base = LIBRARY / 'cases' / f'{car}-base'
    case = LIBRARY / 'cases' / f'{car}-stationary-{key}'
    mesh_hash = hashlib.sha256((base / 'constant/polyMesh/points').read_bytes()).hexdigest()
    meta = json.loads((base / 'anchor.json').read_text())
    meta.update(anchor=key, family='stationary', speedMps=speed, groundSpeedMps=0,
                wheelSpeedMps=0, drs=0, steer=0, yawDeg=0,
                sourceMesh=str(base.relative_to(ROOT)), sourceMeshSha256=mesh_hash)
    if case.exists():
        old = json.loads((case / 'anchor.json').read_text())
        assert all(old[k] == meta[k] for k in ('car', 'anchor', 'speedMps', 'sourceMeshSha256'))
        return case

    case.mkdir()
    for name in ('0', 'constant', 'system'):
        shutil.copytree(base / name, case / name)
    shutil.copy2(base / 'log.checkMesh', case / 'log.checkMesh')
    path = case / '0/U'
    text = path.read_text().replace('(50 0 0)', f'({speed} 0 0)')
    text, ground = re.subn(r'(ground \{type fixedValue; value uniform )\([^)]*\)', r'\g<1>(0 0 0)', text)
    text, wheels = re.subn(r'omega [^;]+;', 'omega 0;', text)
    assert (ground, wheels) == (1, 4)
    path.write_text(text)
    k = max(1e-6, 1.5 * (0.01 * speed)**2)
    omega = max(1, k**0.5 / (0.09**0.25 * 0.05))
    for name, value in [('k', k), ('omega', omega)]:
        path = case / '0' / name
        path.write_text(re.sub(r'(?<=uniform )[0-9.eE+-]+', str(value), path.read_text()))
    if car == 'rb16b':
        # Match the established sweep settings on this mesh.
        path = case / 'system/fvSolution'
        path.write_text(path.read_text().replace('p .15', 'p .1').replace('U .25; k .25; omega .25', 'U .15; k .2; omega .2'))
        path = case / 'system/fvSchemes'
        path.write_text(path.read_text().replace('Gauss linear limited .25', 'Gauss linear uncorrected').replace('default limited .25', 'default uncorrected'))
    (case / 'anchor.json').write_text(json.dumps(meta, indent=2) + '\n')
    return case


def main():
    for speed in SPEEDS:
        for car in CARS:
            if shutil.disk_usage(ROOT).free < 30 * 1024**3:
                raise RuntimeError('Less than 30 GiB of free space')
            case = prepare(car, speed)
            print('START', car, speed, flush=True)
            subprocess.run(['/opt/homebrew/bin/orb', '-m', 'aero-cfd', 'bash', str(LIBRARY / 'scripts/run_anchor.sh'), str(case)], check=True, stdin=subprocess.DEVNULL)
            subprocess.run([sys.executable, str(LIBRARY / 'sweep/pack.py'), str(case)], check=True)
            print('DONE', car, speed, flush=True)


if __name__ == '__main__':
    main()
