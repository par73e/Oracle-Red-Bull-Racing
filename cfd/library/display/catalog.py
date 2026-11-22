"""Generate the runtime catalog and validity masks from completed solver outputs."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / 'web/public'
CASES = ROOT / 'cfd/library/cases'
COARSE = {'shape': [88, 34, 32], 'min': [-4, -1.65, .025], 'max': [9, 1.65, 1.65]}
YAW = {'shape': [78, 60, 26], 'min': [-5.5, -4.5, .025], 'max': [6.5, 4.5, 1.75]}
DRS_SWEEP_NODES = {'drs-025': 'base-quarter-drs', 'drs-050': 'base-mid-drs', 'drs-075': 'base-three-quarter-drs'}
RB16B_ENDPOINT_GROUPS = (
    {'base': 'base-drs-000', 'open': 'base-drs-100'},
    {'low': 'roll-050', 'high': 'roll-350'},
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def store(path, data):
    if path.exists() and path.read_bytes() == data:
        return
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_bytes(data)
    tmp.replace(path)


def json_bytes(data):
    return (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def coordinates(record):
    return [record['speedMps'], record['groundSpeedMps'], record.get('yawDeg', record.get('windAngleDeg', 0)),
            record['steer'], record['drs']]


def velocity_samples(case, grid, at, threshold):
    rows = np.loadtxt(case / 'postProcessing/grid/650/grid.xy')
    shape = np.asarray(grid['shape'])
    origin = np.asarray(grid['min'])
    steps = (np.asarray(grid['max']) - origin) / (shape - 1)
    indices = np.rint((rows[:, :3] - origin) / steps).astype(int)
    assert np.all((indices >= 0) & (indices < shape)), case
    assert np.max(np.abs(rows[:, :3] - (origin + indices * steps))) < 1e-4, case
    values = rows[:, 3:6]
    assert np.isfinite(values).all(), case
    safe = np.linalg.norm(values, axis=1) <= (threshold or 3 * max(at[0], at[1]))
    assert 1 - np.mean(safe) < .002, case
    ix, iy, iz = indices.T
    flat = (iz * shape[1] + iy) * shape[0] + ix
    assert len(np.unique(flat)) == len(flat), case
    valid = np.zeros(np.prod(shape), bool)
    field = np.zeros((np.prod(shape), 3), np.float32)
    valid[flat] = safe
    field[flat[safe]] = values[safe]
    return field, valid


def forces(case, yaw):
    samples = {}
    for path in sorted((case / 'postProcessing/forces').glob('*/forces.dat'), key=lambda p: float(p.parent.name)):
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            values = np.fromstring(line.translate(str.maketrans('()', '  ')), sep=' ')
            if len(values) >= 7:
                samples[values[0]] = values[1:4] + values[4:7]
    if not all(i in samples for i in range(551, 651)):
        return None
    last = np.array([samples[i] for i in range(551, 651)])
    angle = np.deg2rad(yaw)
    drag = last @ [np.cos(angle), -np.sin(angle), 0]
    mean = last.mean(axis=0)
    values = {'drag': float(drag.mean()), 'side': float(mean[1]), 'downforce': float(-mean[2])}
    if not np.isfinite(last).all() or drag.mean() < 0:
        return None
    # Only use the measured mean if the final window is sufficiently stable.
    scales = np.maximum(np.abs(mean), max(.1, abs(drag.mean()) * .1))
    if (np.ptp(last, axis=0) / scales).max() > .5:
        return None
    return values


def interpolate_forces(lo, hi, speed_mps, fraction):
    a, b = lo['forces'], hi['forces']
    va, vb = lo['at'][0], hi['at'][0]
    if va > 0 and vb > 0:
        q = speed_mps * speed_mps
        wa, wb = (1 - fraction) * q / (va * va), fraction * q / (vb * vb)
    else:
        wa, wb = 1 - fraction, fraction
    return {key: wa * a[key] + wb * b[key] for key in a}


def force_interpolation_passes(lo, middle, hi, fraction):
    samples = [node.get('forces') for node in (lo, middle, hi)]
    if not all(samples):
        return False
    m = middle['forces']
    estimate = interpolate_forces(lo, hi, middle['at'][0], fraction)
    return all(abs(estimate[key] - m[key])
               <= max(.25, .12 * abs(m[key]), .02 * m['drag']) for key in m)


def bracket_fraction(lo, point, hi):
    delta = hi - lo
    axis = np.argmax(np.abs(delta))
    fraction = (point[axis] - lo[axis]) / delta[axis]
    if not np.allclose(lo + fraction * delta, point, atol=1e-8, rtol=0):
        return None
    return fraction


def adjacent_segments(nodes, lo, hi):
    start, end = (np.asarray(node['at']) for node in (lo, hi))
    candidates = {}
    for node in nodes:
        if node['grid'] != lo['grid']:
            continue
        fraction = bracket_fraction(start, np.asarray(node['at']), end)
        if fraction is not None and 0 <= fraction <= 1:
            candidates.setdefault(fraction, node['id'])
    ordered = [candidates[key] for key in sorted(candidates)]
    return list(zip(ordered, ordered[1:]))


def audit_segment(a, middle, b, grid):
    lo, mid, hi = (np.asarray(item['node']['at']) for item in (a, middle, b))
    fraction = bracket_fraction(lo, mid, hi)
    assert fraction is not None and 0 < fraction < 1
    estimate = (1 - fraction) * a['field'] + fraction * b['field']
    expected = middle['field']
    speed = np.linalg.norm(expected, axis=1)
    predicted = np.linalg.norm(estimate, axis=1)
    nx, ny, nz = grid['shape']
    z, y, x = np.meshgrid(*(np.linspace(grid['min'][i], grid['max'][i], grid['shape'][i])
                            for i in (2, 1, 0)), indexing='ij')
    near_car = ((np.abs(x) <= 3.5) & (np.abs(y) <= 1.2) & (z <= 1.55)).ravel()
    keep = a['valid'] & b['valid']
    reference = middle['valid'] & near_car
    shared = reference & keep
    moving = shared & (speed > .05 * mid[0]) & (predicted > .05 * mid[0])
    cosine = np.sum(expected[moving] * estimate[moving], axis=1) / (speed[moving] * predicted[moving])
    direction = np.degrees(np.arccos(np.clip(cosine, -1, 1)))
    normalized = np.linalg.norm(expected[shared] - estimate[shared], axis=1) / max(mid[0], mid[1])
    # Measure both the full near-car volume and the near-floor band.
    floor = (z <= .45).ravel()
    floor_shared = shared & floor
    floor_moving = moving & floor
    floor_error = np.linalg.norm(expected[floor_shared] - estimate[floor_shared], axis=1) / max(mid[0], mid[1])
    floor_direction = direction[floor_moving[moving]]
    coverage = shared.sum() / reference.sum()
    floor_coverage = floor_shared.sum() / (reference & floor).sum()
    occupied_mismatch = (keep & ~middle['valid'] & near_car).sum() / reference.sum()
    quantile = lambda v: float(np.quantile(v, .9)) if len(v) else None
    metrics = dict(vectorP90=quantile(normalized), angleP90=quantile(direction),
                   floorVectorP90=quantile(floor_error), floorAngleP90=quantile(floor_direction),
                   coverage=float(coverage), floorCoverage=float(floor_coverage), otherOccupancy=float(occupied_mismatch))
    passed = (all(v is not None for v in metrics.values()) and coverage >= .97 and floor_coverage >= .95
              and occupied_mismatch <= .015 and metrics['vectorP90'] <= .12 and metrics['angleP90'] <= 9
              and metrics['floorVectorP90'] <= .18 and metrics['floorAngleP90'] <= 15)
    return {key: round(value, 5) if value is not None else None for key, value in metrics.items()} | {'passed': bool(passed)}


def sampled_case(case):
    return (case / 'postProcessing/grid/650/grid.xy').is_file() and re.search(
        r'^End$', (case / 'log.foamRun').read_text(), re.M)


def inputs(car):
    base = PUBLIC / 'flow' / car
    matched_endpoints = {}
    replacement_cases = set()
    if car == 'rb16b':
        for group in RB16B_ENDPOINT_GROUPS:
            cases = {name: CASES / f'{car}-display-{key}' for name, key in group.items()}
            replacement_cases.update(cases.values())
            # Keep the comparison on one numerical scheme once the group is complete.
            if all(map(sampled_case, cases.values())):
                matched_endpoints.update(cases)
    for family in ('', 'rolling', 'sweep', 'yaw', 'stationary', 'road010'):
        path = base / family / 'manifest.json'
        if not path.is_file():
            continue
        manifest = json.loads(path.read_text())
        for record in manifest.get('fields', manifest.get('anchors')):
            key = record['anchor']
            if family == '' and key not in ('base', 'open', 'left', 'right', 'low', 'high'):
                continue
            if family == 'sweep' and (record.get('reused') or key in DRS_SWEEP_NODES):
                continue
            if family == 'road010':
                case = CASES / f'{car}-headwind-audit-road010-wind{record["naturalWindMps"]:02.0f}'
            else:
                case = CASES / '-'.join(filter(None, (car, family, key)))
            if family == '':
                if key in matched_endpoints:
                    case = matched_endpoints[key]
                    yield json.loads((case / 'anchor.json').read_text()) | {'grid': COARSE, 'anchor': key}, case, True
                    continue
                record['groundSpeedMps'] = record['wheelSpeedMps']
            yield record, case, False
    for case in sorted(CASES.glob(f'{car}-display-*')):
        if case not in replacement_cases and sampled_case(case):
            meta = json.loads((case / 'anchor.json').read_text())
            meta['grid'] = YAW if 'freestreamVelocity' in (case / '0/U').read_text() else COARSE
            yield meta, case, True
    for pose, key in DRS_SWEEP_NODES.items():
        case = CASES / f'{car}-sweep-{pose}'
        if sampled_case(case):
            yield json.loads((case / 'anchor.json').read_text()) | {'grid': COARSE, 'anchor': key}, case, True


def build(car):
    folder = PUBLIC / 'flow' / car / 'display'
    folder.mkdir(parents=True, exist_ok=True)
    nodes, series, grids, omitted = [], {}, {}, []
    pairs = [('base', 'base-mid-drs', 'open'), ('low-closed', 'low-mid-drs', 'low-open'),
             ('road010-wind-00000', 'low-mid-drs', 'low-open'), ('wind-01000', 'park-mid-drs1', 'park-open1'),
             ('road010-wind-00000', 'low-wind2', 'road010-wind-04000'), ('low-closed', 'low-wind2', 'low-wind4'),
             ('wind-00500', 'wind-01000', 'wind-02000'), ('wind-01000', 'wind-02000', 'wind-05000'),
             ('wind-02000', 'wind-05000', 'wind-15000'), ('road010-wind-04000', 'road010-wind-11000', 'road010-wind-15000'),
             ('road010-wind-00000', 'road010-wind-04000', 'road010-wind-11000'),
             ('low-wind4', 'low-wind8', 'low-wind15'),
             ('roll-005', 'road010-wind-00000', 'roll-020'), ('roll-005', 'low-closed', 'roll-020'),
             ('road010-wind-00000', 'roll-020', 'low'), ('low-closed', 'roll-020', 'low'),
             ('low', 'roll-100', 'base'), ('base', 'roll-260', 'high')]
    pairs.extend([('base', 'base-quarter-drs', 'base-mid-drs'),
                  ('base-mid-drs', 'base-three-quarter-drs', 'open')])
    # At 180 km/h road speed, the headwind slider uses this existing sweep axis.
    inlet_axis = ['base', *(f'air-{speed:03d}' for speed in range(185, 236, 5))]
    pairs.extend(zip(inlet_axis, inlet_axis[1:], inlet_axis[2:]))
    tracked = {name for row in pairs for name in row}
    for record, case, new in inputs(car):
        grid, at = record['grid'], coordinates(record)
        key = record['anchor']
        grid_id = 'yaw' if grid == YAW else 'headwind'
        grids[grid_id] = grid
        if not (case / 'postProcessing/grid/650/grid.xy').exists():
            omitted.append(str(case.relative_to(ROOT)))
            continue
        field, valid = velocity_samples(case, grid, at, record.get('exclusionThresholdMps'))
        if new:
            assert 'Mesh OK.' in (case / 'log.checkMesh').read_text(), case
            scale = max(1e-6, float(np.max(np.abs(field))) / 32760)
            data = np.rint(field / scale).astype('<i2').tobytes()
            file = f'/flow/{car}/display/{key}.bin'
            store(PUBLIC / file[1:], data)
        else:
            scale, file = record['scale'], record['file']
            data = (PUBLIC / file[1:]).read_bytes()
            assert digest(data) == record['sha256'], file
            decoded = np.frombuffer(data, '<i2').reshape(-1, 3).astype(np.float32) * scale
            assert np.max(np.abs(field - decoded)) <= .501 * scale + 1e-5, file
        mask = np.packbits(valid, bitorder='little').tobytes()
        mask_hash = digest(mask)
        mask_path = f'/flow/{car}/display/{mask_hash}.mask'
        store(PUBLIC / mask_path[1:], mask)
        node = {'id': key, 'at': at, 'grid': grid_id, 'file': file, 'mask': mask_path, 'scale': scale,
                'sha256': digest(data), 'maskSha256': mask_hash, 'case': case.name}
        result = forces(case, at[2])
        if result is not None:
            node['forces'] = result
        nodes.append(node)
        if key in tracked:
            series[key] = {'node': node, 'field': field, 'valid': valid}
    checks = []
    for lo, mid, hi in pairs:
        if not all(name in series for name in (lo, mid, hi)):
            continue
        a, m, b = (series[name] for name in (lo, mid, hi))
        grid = a['node']['grid']
        assert grid == m['node']['grid'] == b['node']['grid']
        result = audit_segment(a, m, b, grids[grid])
        weight = bracket_fraction(*[np.asarray(item['node']['at']) for item in (a, m, b)])
        checks.append({'endpoints': [lo, hi], 'heldOut': mid, 'weight': float(weight), **result})
        checks[-1]['vectorPassed'] = checks[-1].pop('passed')

    catalog = dict(version=1, car=car, grids=grids, nodes=nodes, segments=[], forceSegments=[])
    with tempfile.TemporaryDirectory(prefix='aero-display-') as work:
        draft_path = Path(work) / 'manifest.json'
        check_path = Path(work) / 'checks.json'
        draft_path.write_bytes(json_bytes(catalog))
        check_path.write_bytes(json_bytes(dict(checks=checks)))
        decisions = json.loads(subprocess.check_output([
            'node', str(ROOT / 'web/scripts/check-display-flow.mjs'), '--measure', car, str(draft_path), str(check_path),
        ]))
    by_case = {(row['heldOut'], tuple(row['endpoints'])): row for row in decisions}
    segments, force_segments = [], []
    for item in checks:
        lo, hi = item['endpoints']
        if item['vectorPassed']:
            item.update(by_case[(item['heldOut'], (lo, hi))])
        item['passed'] = item['vectorPassed'] and item['trajectoryPassed']
        a, m, b = (series[key]['node'] for key in (lo, item['heldOut'], hi))
        item['forcePassed'] = item['passed'] and force_interpolation_passes(a, m, b, item['weight'])
        if item['passed']:
            adjacent = adjacent_segments(nodes, a, b)
            segments.extend(adjacent)
            if item['forcePassed']:
                force_segments.extend(adjacent)
    segments = list(dict.fromkeys(segments))
    catalog['segments'] = segments
    catalog['forceSegments'] = list(dict.fromkeys(force_segments))
    store(folder / 'manifest.json', json_bytes(catalog))
    store(ROOT / f'cfd/library/reports/{car}-display-validation.json', (json.dumps(dict(checks=checks, omitted=omitted), indent=2) + '\n').encode())
    print(car, len(nodes), 'nodes,', len(segments), 'segments,', len(omitted), 'omitted')


if __name__ == '__main__':
    for vehicle in ('rb19', 'rb16b'):
        build(vehicle)
