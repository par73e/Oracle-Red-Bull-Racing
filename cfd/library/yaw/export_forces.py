"""Extract OpenFOAM forces.dat summaries from all solved cases for web load estimation."""
from pathlib import Path
import json
import re
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
CASES = ROOT / 'cfd/library/cases'


def read_last_100_forces(case_dir):
    files = sorted((case_dir / 'postProcessing/forces').glob('*/forces.dat'), key=lambda p: float(p.parent.name))
    if not files:
        return None
    rows = []
    for f in files:
        for line in f.read_text().splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            vals = [float(v) for v in re.findall(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?', line)]
            if len(vals) >= 7:
                rows.append([vals[0], vals[1] + vals[4], vals[2] + vals[5], vals[3] + vals[6]])
    if not rows:
        return None
    arr = np.array(rows)
    last = arr[-min(100, len(arr)):]
    if not np.isfinite(last).all():
        return None
    return {
        'samples': int(len(last)),
        'drag': float(last[:, 1].mean()),
        'side': float(last[:, 2].mean()),
        'downforce': float(-last[:, 3].mean()),
        'dragPtp': float(np.ptp(last[:, 1])),
        'sidePtp': float(np.ptp(last[:, 2])),
        'downforcePtp': float(np.ptp(last[:, 3])),
    }


def collect_car_forces(car):
    def get(name):
        d = CASES / name
        if not d.exists():
            return None
        c = d / 'complete.json'
        if c.exists():
            meta = json.loads(c.read_text())
            if 'rawForcesN' in meta and meta['rawForcesN']:
                return meta['rawForcesN']
        f = read_last_100_forces(d)
        if f is None or f['downforcePtp'] > 50000:
            return None
        return f

    air = {}
    ground = {}
    drs = {}
    steer = {}
    yaw = {}

    # Legacy & rolling seeds
    for val, name in [(0, f'{car}-rolling-still-air'), (50, f'{car}-low'), (180, f'{car}-base'), (350, f'{car}-high')]:
        f = get(name)
        if f:
            air[val] = f
    for val, name in [(0, f'{car}-rolling-road-stop'), (90, f'{car}-rolling-road-slow'), (180, f'{car}-base'), (360, f'{car}-rolling-road-fast')]:
        f = get(name)
        if f:
            ground[val] = f
    for val, name in [(0, f'{car}-base'), (100, f'{car}-open')]:
        f = get(name)
        if f:
            drs[val] = f
    for val, name in [(-18, f'{car}-left'), (0, f'{car}-base'), (18, f'{car}-right')]:
        f = get(name)
        if f:
            steer[val] = f

    # Sweep cases
    sweep_manifest = ROOT / f'web/public/flow/{car}/sweep/manifest.json'
    if sweep_manifest.exists():
        for rec in json.loads(sweep_manifest.read_text()).get('fields', []):
            if rec.get('reused'):
                continue
            p = rec['parameters']
            f = get(f'{car}-sweep-{rec["key"]}')
            if not f:
                continue
            if p['airKmh'] != 180:
                air[p['airKmh']] = f
            elif p['groundKmh'] != 180:
                ground[p['groundKmh']] = f
            elif p['drsPercent'] != 0:
                drs[p['drsPercent']] = f
            elif p['steerDeg'] != 0:
                steer[p['steerDeg']] = f

    # Yaw cases
    yaw_manifest = ROOT / f'web/public/flow/{car}/yaw/manifest.json'
    if yaw_manifest.exists():
        for rec in json.loads(yaw_manifest.read_text()).get('fields', []):
            deg = rec.get('windAngleDeg', rec.get('parameters', {}).get('windAngleDeg'))
            if deg is None:
                continue
            f = rec.get('rawForcesN') or get(f'{car}-yaw-{rec["key"]}')
            if f:
                yaw[int(deg)] = f

    # For RB16B baseline numerical oscillation, prefer steady neighbors if base ptp is huge
    base_f = air.get(180)
    if base_f and base_f.get('downforcePtp', 0) > 1000:
        for alt_key in [175, 185]:
            if alt_key in air and air[alt_key].get('downforcePtp', 9999) < 200:
                base_f = {**air[alt_key], 'note': f'steady neighbor air-{alt_key} used due to base ptp {base_f["downforcePtp"]:.0f} N'}
                air[180] = base_f
                ground[180] = base_f
                drs[0] = base_f
                steer[0] = base_f
                break

    def to_list(d):
        return [{'value': k, **{fk: round(v[fk], 2) for fk in ['drag', 'side', 'downforce', 'downforcePtp']}} for k, v in sorted(d.items())]

    payload = {
        'car': car,
        'source': 'OpenFOAM Foundation 14 libforces.so (last 100 iterations)',
        'base': {fk: round(base_f[fk], 2) for fk in ['drag', 'side', 'downforce', 'downforcePtp']} if base_f else None,
        'yawBase': {fk: round(yaw[0][fk], 2) for fk in ['drag', 'side', 'downforce', 'downforcePtp']} if 0 in yaw else None,
        'axes': {
            'air': to_list(air),
            'ground': to_list(ground),
            'drs': to_list(drs),
            'steer': to_list(steer),
            'yaw': to_list(yaw),
        },
    }
    out = ROOT / f'web/public/flow/{car}/forces.json'
    out.write_text(json.dumps(payload, indent=2) + '\n')
    print(f'EXPORTED {out}: air={len(air)}, ground={len(ground)}, drs={len(drs)}, steer={len(steer)}, yaw={len(yaw)}')
    return payload


if __name__ == '__main__':
    for car in ['rb19', 'rb16b']:
        collect_car_forces(car)
