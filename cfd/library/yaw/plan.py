"""±90° (5° step) crosswind/yaw CFD plan."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[3]
YAW_ANGLES = list(range(-90, 91, 5))


def yaw_key(deg):
    sign = 'm' if deg < 0 else 'p' if deg > 0 else ''
    return f'yaw-{sign}{abs(deg):03d}'


def parameters(deg):
    return {
        'airKmh': 180,
        'groundKmh': 180,
        'drsPercent': 0,
        'steerDeg': 0,
        'windAngleDeg': int(deg),
    }


def requests():
    return {yaw_key(deg): parameters(deg) for deg in YAW_ANGLES}


def published(car):
    result = {}
    for path in sorted((ROOT / 'cfd/library/reports').glob(f'{car}-yaw-*.json')):
        a = json.loads(path.read_text())
        result[a['anchor']] = {**a, 'key': a['anchor']}
    return result


def write_manifest(car):
    records = published(car)
    axis = [{'value': deg, 'key': yaw_key(deg)} for deg in YAW_ANGLES]
    data = {
        'car': car,
        'strategy': 'crosswind yaw sweep in 5 deg steps; vehicle and ground stay longitudinal',
        'convention': 'windAngleDeg < 0 blows from vehicle left (+Y CFD / -X web); > 0 blows from vehicle right (-Y CFD / +X web)',
        'baseline': parameters(0),
        'axis': axis,
        'plannedUnique': len(YAW_ANGLES),
        'completedUnique': len(records),
        'complete': len(records) == len(YAW_ANGLES),
        'fields': list(records.values()),
    }
    folder = ROOT / f'web/public/flow/{car}/yaw'
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / 'manifest.json'
    tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n')
    tmp.replace(p)
    return data


if __name__ == '__main__':
    for car in ['rb19', 'rb16b']:
        m = write_manifest(car)
        print(car, m['completedUnique'], '/', m['plannedUnique'])
