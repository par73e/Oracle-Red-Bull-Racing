"""Pack OpenFOAM crosswind/yaw velocity field + last-100 forces summary."""
from pathlib import Path
import hashlib
import json
import re
import sys
import numpy as np
from plan import ROOT, write_manifest
from export_forces import collect_car_forces
from prepare import GRID_SHAPE, GRID_MIN, GRID_MAX


def parse_forces(case_dir):
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
    return {
        'samples': int(len(last)),
        'drag': float(last[:, 1].mean()),
        'side': float(last[:, 2].mean()),
        'downforce': float(-last[:, 3].mean()),
        'dragPtp': float(np.ptp(last[:, 1])),
        'sidePtp': float(np.ptp(last[:, 2])),
        'downforcePtp': float(np.ptp(last[:, 3])),
    }


def pack_case(case_dir):
    case = Path(case_dir)
    meta = json.loads((case / 'anchor.json').read_text())
    files = list((case / 'postProcessing/grid').glob('*/grid.xy'))
    assert files, 'No sampled grid ' + str(case)
    file = max(files, key=lambda p: float(p.parent.name))
    rows = np.loadtxt(file)
    assert np.isfinite(rows[:, 3:6]).all() and (np.abs(rows[:, 3:6]) < 1e20).all(), 'Non-finite or unbounded raw velocity samples'

    shape = GRID_SHAPE
    lo = np.array(GRID_MIN)
    hi = np.array(GRID_MAX)
    spacing = (hi - lo) / (np.array(shape) - 1)
    index = np.rint((rows[:, :3] - lo) / spacing).astype(int)
    valid = np.all((index >= 0) & (index < shape), axis=1) & np.isfinite(rows[:, 3:6]).all(axis=1) & (np.abs(rows[:, 3:6]) < 1e20).all(axis=1)
    index = index[valid]
    rows = rows[valid]

    speeds = np.linalg.norm(rows[:, 3:6], axis=1)
    raw_max = float(speeds.max())
    limit = 3 * max(meta['speedMps'], meta['wheelSpeedMps'], 1)
    anomalous = speeds > limit
    anomaly_count = int(anomalous.sum())
    assert anomaly_count / max(len(rows), 1) < 0.002, f'Widespread velocity anomalies ({anomaly_count}): solve rejected'
    rows[anomalous, 3:6] = 0

    flat = (index[:, 2] * shape[1] + index[:, 1]) * shape[0] + index[:, 0]
    field = np.zeros((np.prod(shape), 3), np.float32)
    field[flat] = rows[:, 3:6]
    scale = max(0.001, float(np.max(np.abs(field))) / 32760)
    packed = np.rint(field / scale).astype('<i2')

    folder = ROOT / 'web/public/flow' / meta['car'] / 'yaw'
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / (meta['anchor'] + '.bin')

    log = (case / 'log.foamRun').read_text()
    mesh = (case / 'log.checkMesh').read_text()
    res = {}
    step = 0
    for line in log.splitlines():
        m = re.match(r'Time = ([\d.]+)', line)
        if m:
            step = float(m[1])
            res = {}
        m = re.search(r'Solving for (\w+), Initial residual = ([\deE+.-]+)', line)
        if m:
            res.setdefault(m[1], float(m[2]))
    assert re.search(r'^End$', log, re.M) and 'FOAM FATAL' not in log
    assert not re.search(r'residual = [-+]?nan', log, re.I), 'Divergent solve rejected'
    assert np.isfinite(field).all(), 'Non-finite field rejected'
    assert float(file.parent.name) == 650, 'Missing final sampled iteration'

    out.write_bytes(packed.tobytes())
    raw_forces = parse_forces(case)
    record = {
        **meta,
        'grid': {'shape': list(shape), 'min': list(GRID_MIN), 'max': list(GRID_MAX)},
        'file': f'/flow/{meta["car"]}/yaw/{out.name}',
        'scale': scale,
        'sampledPoints': len(rows),
        'unlocatedOrSolidGridPoints': int(np.prod(shape) - len(rows)),
        'excludedNumericalSamples': anomaly_count,
        'rawFieldMax': raw_max,
        'exclusionThresholdMps': limit,
        'sampling': 'cellPoint; isolated >3x max(inlet,wheel) samples excluded, never clipped',
        'fieldMax': float(np.max(np.linalg.norm(field, axis=1))),
        'cells': int(re.search(r'cells:\s+(\d+)', mesh)[1]),
        'lastIteration': step,
        'residuals': res,
        'rawForcesN': raw_forces,
        'meshOk': 'Mesh OK.' in mesh,
        'solver': 'OpenFOAM Foundation 14 kOmegaSST RANS (freestream yaw)',
        'quality': 'coarse voxel proxy; exploratory steady crosswind',
        'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
    }
    (case / 'complete.json').write_text(json.dumps(record, indent=2) + '\n')
    (ROOT / f'cfd/library/reports/{meta["car"]}-yaw-{meta["anchor"]}.json').write_text(json.dumps(record, indent=2) + '\n')
    write_manifest(meta['car'])
    collect_car_forces(meta['car'])
    print('PACKED', meta['car'], meta['anchor'], 'fieldMax=', round(record['fieldMax'], 2), 'forces=', raw_forces, flush=True)
    return record


if __name__ == '__main__':
    pack_case(sys.argv[1])
