"""Run shared yaw mesh + serial yaw CFD cases (supports trial subset or full 5-deg sweep)."""
import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from plan import ROOT, YAW_ANGLES, published, write_manifest, yaw_key
from prepare import prepare_case, prepare_mesh_case
from pack import pack_case

STATUS_FILE = ROOT / 'cfd/library/reports/yaw-status-2026-11-17.json'


def update_status(**kw):
    kw.update(updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S%z'), pid=os.getpid())
    tmp = STATUS_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(kw, indent=2) + '\n')
    tmp.replace(STATUS_FILE)


def ensure_mesh(car):
    mesh_case = prepare_mesh_case(car)
    if (mesh_case / 'constant/polyMesh/points').exists() and (mesh_case / 'log.checkMesh').exists():
        if 'Mesh OK.' in (mesh_case / 'log.checkMesh').read_text():
            return mesh_case
    cmd = f'''
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd {str(mesh_case)!r}
ulimit -v 6291456
blockMesh > log.blockMesh 2>&1
taskset -c 0-3 nice -n 5 snappyHexMesh -overwrite > log.snappyHexMesh 2>&1
checkMesh > log.checkMesh 2>&1
grep -q 'Mesh OK.' log.checkMesh
'''
    subprocess.run(['/opt/homebrew/bin/orb', '-m', 'aero-cfd', 'bash', '-c', cmd], check=True, stdin=subprocess.DEVNULL)
    return mesh_case


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cars', nargs='+', default=['rb19', 'rb16b'])
    parser.add_argument('--angles', nargs='+', type=int, default=None)
    args = parser.parse_args()

    angles = args.angles if args.angles is not None else sorted(YAW_ANGLES, key=lambda d: (abs(d), -d))
    for car in ['rb19', 'rb16b']:
        write_manifest(car)

    failed_cases = []
    try:
        for deg in angles:
            key = yaw_key(deg)
            for car in args.cars:
                if key in published(car):
                    continue
                if shutil.disk_usage(ROOT).free < 30 * 1024 ** 3:
                    raise RuntimeError('Less than 30 GiB free; stopped without deleting files')
                update_status(
                    state='running',
                    car=car,
                    key=key,
                    windAngleDeg=deg,
                    completed={c: len(published(c)) for c in ['rb19', 'rb16b']},
                    plannedPerCar=len(YAW_ANGLES),
                    failed=failed_cases,
                )
                print('MESH/PREPARE', car, key, flush=True)
                ensure_mesh(car)
                case = prepare_case(car, deg)
                print('SOLVE', car, key, flush=True)
                try:
                    subprocess.run(
                        ['/opt/homebrew/bin/orb', '-m', 'aero-cfd', 'bash', str(ROOT / 'cfd/library/scripts/run_anchor.sh'), str(case)],
                        check=True,
                        stdin=subprocess.DEVNULL,
                    )
                except subprocess.CalledProcessError:
                    print('RETRY_CONSERVATIVE', car, key, flush=True)
                    case = prepare_case(car, deg, conservative=True)
                    try:
                        subprocess.run(
                            ['/opt/homebrew/bin/orb', '-m', 'aero-cfd', 'bash', str(ROOT / 'cfd/library/scripts/run_anchor.sh'), str(case)],
                            check=True,
                            stdin=subprocess.DEVNULL,
                        )
                    except subprocess.CalledProcessError:
                        print('SKIP_FAILED', car, key, flush=True)
                        failed_cases.append(f'{car}:{key}')
                        continue
                pack_case(case)
        update_status(
            state='trial-complete' if args.angles is not None else 'complete',
            completed={c: len(published(c)) for c in ['rb19', 'rb16b']},
            plannedPerCar=len(YAW_ANGLES),
            failed=failed_cases,
        )
    except Exception as e:
        update_status(state='failed', error=str(e))
        raise


if __name__ == '__main__':
    main()
