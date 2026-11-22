"""Solve a new condition on an existing, pose-specific OpenFOAM mesh."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[3]
CASES = ROOT / 'cfd/library/cases'


def replace_patch(text, patch, transform):
    pattern = rf'\b{patch}\s*\{{[^}}]*\}}'
    text, count = re.subn(pattern, lambda match: transform(match[0]), text)
    if count != 1:
        raise ValueError(f'Expected one {patch} boundary')
    return text


def solve(car, key, template, road_kmh, ambient_mps, ambient_angle, cores):
    source = CASES / f'{car}-{template}'
    case = CASES / f'{car}-display-{key}'
    road = road_kmh / 3.6
    angle = math.radians(ambient_angle)
    ux, uy = road + ambient_mps * math.cos(angle), -ambient_mps * math.sin(angle)
    speed = math.hypot(ux, uy)
    yaw = math.degrees(math.atan2(-uy, ux))
    vector = f'({ux:.12g} {uy:.12g} 0)'
    meta = json.loads((source / 'anchor.json').read_text())
    meta.update(anchor=key, speedMps=speed, groundSpeedMps=road, wheelSpeedMps=road,
                yawDeg=yaw, windAngleDeg=yaw, inflowVector=[ux, uy, 0],
                sourceMesh=str(source.relative_to(ROOT)),
                sourceMeshSha256=hashlib.sha256((source / 'constant/polyMesh/points').read_bytes()).hexdigest())
    if case.exists():
        prior = json.loads((case / 'anchor.json').read_text())
        if prior != meta:
            raise ValueError(f'Existing case identity differs: {case}')
    else:
        if shutil.disk_usage(ROOT).free < 30 * 1024**3:
            raise RuntimeError('Less than 30 GiB free')
        case.mkdir()
        (case / 'anchor.json').write_text(json.dumps(meta, indent=2) + '\n')
        for name in ('0', 'constant', 'system'):
            shutil.copytree(source / name, case / name)
        shutil.copy2(source / 'log.checkMesh', case / 'log.checkMesh')
        path = case / '0/U'
        text = path.read_text()
        yaw_mesh = 'freestreamVelocity' in text
        if not yaw_mesh and abs(yaw) > 1e-8:
            raise ValueError('Crosswind requires freestream side boundaries')
        text = re.sub(r'(internalField uniform )\([^)]*\)', lambda m: m[1] + vector, text)
        for patch in (('xMin', 'xMax', 'yMin', 'yMax') if yaw_mesh else ('inlet', 'outlet')):
            text = replace_patch(text, patch, lambda s: re.sub(r'(?<=uniform )\([^)]*\)', vector, s))
        text = replace_patch(text, 'ground', lambda s: re.sub(r'(?<=uniform )\([^)]*\)', f'({road:.12g} 0 0)', s))
        for wheel, spec in meta['wheels'].items():
            text = replace_patch(text, wheel, lambda s: re.sub(r'(?<=omega )[^;]+', str(road / spec['radius']), s))
        path.write_text(text)
        k = max(1e-6, 1.5 * (.01 * speed)**2)
        omega = max(1, k**.5 / (.09**.25 * .05))
        for name, value in [('k', k), ('omega', omega)]:
            path = case / '0' / name
            path.write_text(re.sub(r'(?<=uniform )[0-9.eE+-]+', str(value), path.read_text()))
        if car == 'rb16b' and not yaw_mesh:
            path = case / 'system/fvSolution'
            path.write_text(path.read_text().replace('p .15', 'p .1').replace('U .25; k .25; omega .25', 'U .15; k .2; omega .2'))
            path = case / 'system/fvSchemes'
            path.write_text(path.read_text().replace('Gauss linear limited .25', 'Gauss linear uncorrected').replace('default limited .25', 'default uncorrected'))
    print('START', case.name, flush=True)
    subprocess.run(['orb', '-m', 'aero-cfd', 'bash', str(CASES.parent / 'scripts/run_anchor.sh'), str(case), cores],
                   check=True, stdin=subprocess.DEVNULL)
    print('DONE', case.name, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('car', choices=['rb19', 'rb16b'])
    batch = {
        'low-closed': ('base', 10, 0, 0),
        'low-open': ('open', 10, 0, 0),
        'low-wind2': ('base', 10, 2, 0),
        'low-wind4': ('base', 10, 4, 0),
        'park-open1': ('open', 0, 1, 0),
        'park-open5': ('open', 0, 5, 0),
        'park-mid-drs1': ('sweep-drs-050', 0, 1, 0),
        'low-mid-drs': ('sweep-drs-050', 10, 0, 0),
        'low-wind8': ('base', 10, 8, 0),
        'low-wind15': ('base', 10, 15, 0),
        'roll-005': ('base', 5, 0, 0),
        'roll-020': ('base', 20, 0, 0),
        'roll-050': ('low', 50, 0, 0),
        'roll-100': ('base', 100, 0, 0),
        'roll-260': ('base', 260, 0, 0),
        'roll-350': ('high', 350, 0, 0),
        'low-steer': ('left', 10, 0, 0),
        'park-yaw': ('yaw-yaw-000', 0, 1, 45),
        'low-yaw': ('yaw-yaw-000', 10, 1, 90),
        'base-yaw': ('yaw-yaw-000', 180, 4, 90),
        'base-drs-000': ('base', 180, 0, 0),
        'base-drs-100': ('open', 180, 0, 0),
    }
    parser.add_argument('key', choices=batch)
    parser.add_argument('--cores', default='0-3')
    args = parser.parse_args()
    solve(args.car, args.key, *batch[args.key], args.cores)
