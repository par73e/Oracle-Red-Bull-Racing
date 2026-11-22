"""Run the full 20-case Core Refined Prism-Layer Anchor Set (10 per car, reusing refined meshes where geometry is identical)."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

import numpy as np

from run_audit import (
    BLOCK_MESH,
    CASES,
    CONTROL_DICT,
    FV_SCHEMES,
    FV_SOLUTION,
    ROOT,
    SCRIPT,
    SNAPPY_DICT,
    read_forces,
    read_mesh_stats,
)

YAW_BLOCK_MESH = """FoamFile
{version 2.0; format ascii; class dictionary; object blockMeshDict;}
convertToMeters 1;
vertices (
 (-24 -28 0) (30 -28 0) (30 28 0) (-24 28 0)
 (-24 -28 16) (30 -28 16) (30 28 16) (-24 28 16)
);
blocks (hex (0 1 2 3 4 5 6 7) (108 112 32) simpleGrading (1 1 1));
edges ();
boundary (
 xMin {type patch; faces ((0 4 7 3));}
 xMax {type patch; faces ((1 2 6 5));}
 ground {type wall; faces ((0 3 2 1));}
 yMin {type patch; faces ((0 1 5 4));}
 yMax {type patch; faces ((3 7 6 2));}
 top {type symmetryPlane; faces ((4 5 6 7));}
);
mergePatchPairs ();
"""

YAW_SNAPPY_DICT = """FoamFile
{version 2.0; format ascii; class dictionary; object snappyHexMeshDict;}
castellatedMesh true;
snap true;
addLayers true;
geometry {
  body {type triSurface; file "body.stl";}
  FL {type triSurface; file "FL.stl";}
  FR {type triSurface; file "FR.stl";}
  RL {type triSurface; file "RL.stl";}
  RR {type triSurface; file "RR.stl";}
  nearCar {type box; min (-3.3 -1.6 0); max (3.3 1.6 1.6);}
  underbody {type box; min (-2.6 -1.1 0); max (3.1 1.1 0.55);}
  frontWing {type box; min (-3.0 -1.05 0); max (-1.45 1.05 0.55);}
  rearWing {type box; min (1.75 -0.65 0.42); max (3.1 0.65 1.25);}
  omniWake {type box; min (-7.5 -8.5 0); max (9.5 8.5 2.0);}
}
castellatedMeshControls {
  maxLocalCells 1500000;
  maxGlobalCells 4500000;
  minRefinementCells 10;
  maxLoadUnbalance 0.1;
  nCellsBetweenLevels 3;
  features ();
  refinementSurfaces {
    body {level (4 5); patchInfo {type wall; inGroups (car);}}
    FL {level (4 5); patchInfo {type wall; inGroups (car);}}
    FR {level (4 5); patchInfo {type wall; inGroups (car);}}
    RL {level (4 5); patchInfo {type wall; inGroups (car);}}
    RR {level (4 5); patchInfo {type wall; inGroups (car);}}
  }
  resolveFeatureAngle 30;
  refinementRegions {
    frontWing {mode inside; level 4;}
    rearWing {mode inside; level 4;}
    underbody {mode inside; level 4;}
    nearCar {mode inside; level 3;}
    omniWake {mode inside; level 2;}
  }
  insidePoint (-14.123 14.123 3.123);
  allowFreeStandingZoneFaces true;
}
snapControls {
  nSmoothPatch 3;
  tolerance 1.5;
  nSolveIter 40;
  nRelaxIter 5;
  nFeatureSnapIter 8;
  implicitFeatureSnap true;
  explicitFeatureSnap false;
  multiRegionFeatureSnap false;
}
addLayersControls {
  relativeSizes true;
  layers {
    body {nSurfaceLayers 4;}
    FL {nSurfaceLayers 4;}
    FR {nSurfaceLayers 4;}
    RL {nSurfaceLayers 4;}
    RR {nSurfaceLayers 4;}
  }
  expansionRatio 1.25;
  finalLayerThickness 0.5;
  minThickness 0.05;
  nGrow 0;
  featureAngle 110;
  slipFeatureAngle 30;
  nRelaxIter 5;
  nSmoothSurfaceNormals 1;
  nSmoothNormals 3;
  nSmoothThickness 10;
  maxFaceThicknessRatio 0.5;
  maxThicknessToMedialRatio 0.5;
  minMedialAxisAngle 90;
  nBufferCellsNoExtrude 0;
  nLayerIter 50;
  nRelaxedIter 20;
}
meshQualityControls {
  #includeEtc "caseDicts/mesh/generation/meshQualityDict"
  maxBoundarySkewness 4;
  maxInternalSkewness 4;
  minFaceWeight 0.02;
  relaxed {
    maxNonOrtho 75;
  }
}
writeFlags (scalarLevels);
mergeTolerance 1e-7;
"""


def make_decompose_dict(np_ranks):
    return f"""FoamFile
{{version 2.0; format ascii; class dictionary; object decomposeParDict;}}
numberOfSubdomains {np_ranks};
method scotch;
"""


# (key, car, anchor, src_case, dst_case, is_yaw, mesh_donor_case_or_None)
CORE_CASES = [
    # Already completed 3 audit cases
    ('rb16b-base', 'rb16b', 'base', 'rb16b-display-base-drs-000', 'rb16b-refined-base', False, None),
    ('rb16b-open', 'rb16b', 'open', 'rb16b-display-base-drs-100', 'rb16b-refined-open', False, None),
    ('rb19-base', 'rb19', 'base', 'rb19-base', 'rb19-refined-base', False, None),
    # Remaining 17 core anchor cases (reusing refined polyMesh where geometry is identical!)
    ('rb19-open', 'rb19', 'open', 'rb19-open', 'rb19-refined-open', False, None),
    ('rb16b-low', 'rb16b', 'low', 'rb16b-display-roll-050', 'rb16b-refined-low', False, 'rb16b-refined-base'),
    ('rb16b-high', 'rb16b', 'high', 'rb16b-display-roll-350', 'rb16b-refined-high', False, 'rb16b-refined-base'),
    ('rb19-low', 'rb19', 'low', 'rb19-low', 'rb19-refined-low', False, 'rb19-refined-base'),
    ('rb19-high', 'rb19', 'high', 'rb19-high', 'rb19-refined-high', False, 'rb19-refined-base'),
    ('rb16b-left', 'rb16b', 'left', 'rb16b-left', 'rb16b-refined-left', False, None),
    ('rb16b-right', 'rb16b', 'right', 'rb16b-right', 'rb16b-refined-right', False, None),
    ('rb19-left', 'rb19', 'left', 'rb19-left', 'rb19-refined-left', False, None),
    ('rb19-right', 'rb19', 'right', 'rb19-right', 'rb19-refined-right', False, None),
    ('rb16b-yaw-p015', 'rb16b', 'yaw-p015', 'rb16b-yaw-yaw-p015', 'rb16b-refined-yaw-p015', True, None),
    ('rb16b-yaw-m015', 'rb16b', 'yaw-m015', 'rb16b-yaw-yaw-m015', 'rb16b-refined-yaw-m015', True, 'rb16b-refined-yaw-p015'),
    ('rb16b-yaw-p045', 'rb16b', 'yaw-p045', 'rb16b-yaw-yaw-p045', 'rb16b-refined-yaw-p045', True, 'rb16b-refined-yaw-p015'),
    ('rb16b-yaw-m045', 'rb16b', 'yaw-m045', 'rb16b-yaw-yaw-m045', 'rb16b-refined-yaw-m045', True, 'rb16b-refined-yaw-p015'),
    ('rb19-yaw-p015', 'rb19', 'yaw-p015', 'rb19-yaw-yaw-p015', 'rb19-refined-yaw-p015', True, None),
    ('rb19-yaw-m015', 'rb19', 'yaw-m015', 'rb19-yaw-yaw-m015', 'rb19-refined-yaw-m015', True, 'rb19-refined-yaw-p015'),
    ('rb19-yaw-p045', 'rb19', 'yaw-p045', 'rb19-yaw-yaw-p045', 'rb19-refined-yaw-p045', True, 'rb19-refined-yaw-p015'),
    ('rb19-yaw-m045', 'rb19', 'yaw-m045', 'rb19-yaw-yaw-m045', 'rb19-refined-yaw-m045', True, 'rb19-refined-yaw-p015'),
]


def is_complete(case_dir):
    return (
        (case_dir / 'postProcessing/grid/1000/grid.xy').is_file()
        and (case_dir / 'log.foamRun').is_file()
        and bool(re.search(r'^End$', (case_dir / 'log.foamRun').read_text(), re.M))
    )


def prepare_case(spec, np_ranks):
    key, car, anchor, src_name, dst_name, is_yaw, donor_name = spec
    src = CASES / src_name
    dst = CASES / dst_name
    if not dst.exists():
        if shutil.disk_usage(ROOT).free < 30 * 1024**3:
            raise RuntimeError('Less than 30 GiB free')
        dst.mkdir(parents=True)
        (dst / '0').mkdir()
        for field_name in ('U', 'p', 'k', 'omega', 'nut'):
            shutil.copy2(src / '0' / field_name, dst / '0' / field_name)
        shutil.copytree(src / 'constant', dst / 'constant')
        if (dst / 'constant/polyMesh').exists():
            shutil.rmtree(dst / 'constant/polyMesh')
        (dst / 'system').mkdir()
        shutil.copy2(src / 'system/gridFunctions', dst / 'system/gridFunctions')
        shutil.copy2(src / 'system/sampleGrid', dst / 'system/sampleGrid')
        shutil.copy2(src / 'anchor.json', dst / 'anchor.json')
    # Reuse identical refined polyMesh from donor if requested and not yet present
    if donor_name and not (dst / 'constant/polyMesh/points').is_file():
        donor = CASES / donor_name
        assert (donor / 'constant/polyMesh/points').is_file(), f'Missing donor mesh: {donor}'
        shutil.copytree(donor / 'constant/polyMesh', dst / 'constant/polyMesh')
        shutil.copy2(donor / 'log.checkMesh', dst / 'log.checkMesh')
        if (donor / 'log.snappyHexMesh').is_file():
            shutil.copy2(donor / 'log.snappyHexMesh', dst / 'log.snappyHexMesh')
    (dst / 'system/blockMeshDict').write_text(YAW_BLOCK_MESH if is_yaw else BLOCK_MESH)
    (dst / 'system/snappyHexMeshDict').write_text(YAW_SNAPPY_DICT if is_yaw else SNAPPY_DICT)
    (dst / 'system/fvSchemes').write_text(FV_SCHEMES)
    (dst / 'system/fvSolution').write_text(FV_SOLUTION)
    (dst / 'system/controlDict').write_text(CONTROL_DICT)
    (dst / 'system/decomposeParDict').write_text(make_decompose_dict(np_ranks))
    return dst


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cores', default='0-7')
    parser.add_argument('--np', type=int, default=8)
    parser.add_argument('--only', nargs='*', default=None)
    args = parser.parse_args()

    progress_path = ROOT / 'cfd/library/reports/refined-core-set-progress.json'
    progress = json.loads(progress_path.read_text()) if progress_path.is_file() else {'cases': {}}

    selected = [s for s in CORE_CASES if not args.only or s[0] in args.only]
    for idx, spec in enumerate(selected, 1):
        key, car, anchor, src_name, dst_name, is_yaw, donor_name = spec
        dst = CASES / dst_name
        if is_complete(dst) and key in progress['cases'] and progress['cases'][key].get('status') == 'done':
            print(f'[{idx}/{len(selected)}] SKIP (already done): {key}', flush=True)
            continue
        print(f'[{idx}/{len(selected)}] START: {key} (donor={donor_name}, np={args.np})', flush=True)
        t0 = time.time()
        try:
            dst = prepare_case(spec, args.np)
            if not is_complete(dst):
                subprocess.run(
                    ['orb', '-m', 'aero-cfd', 'bash', str(SCRIPT), str(dst), args.cores, str(args.np)],
                    check=True,
                    stdin=subprocess.DEVNULL,
                )
            elapsed = round(time.time() - t0, 1)
            meta = json.loads((dst / 'anchor.json').read_text())
            yaw_deg = float(meta.get('yawDeg', meta.get('windAngleDeg', 0)))
            forces_raw = read_forces(dst, end_time=1000, window=150)
            # Rotate drag along freestream for yaw cases
            rad = np.deg2rad(yaw_deg)
            samples = {}
            for path in sorted((dst / 'postProcessing/forces').glob('*/forces.dat'), key=lambda p: float(p.parent.name)):
                for line in path.read_text().splitlines():
                    if not line.strip() or line.startswith('#'):
                        continue
                    v = np.fromstring(line.translate(str.maketrans('()', '  ')), sep=' ')
                    if len(v) >= 7:
                        samples[int(round(v[0]))] = v[1:4] + v[4:7]
            last = np.array([samples[i] for i in range(851, 1001) if i in samples])
            drag_stream = float((last @ [np.cos(rad), -np.sin(rad), 0]).mean())
            forces_raw['dragN'] = drag_stream
            forces_raw['liftToDrag'] = float(forces_raw['downforceN'] / drag_stream) if drag_stream > 1e-6 else None

            progress['cases'][key] = {
                'status': 'done',
                'car': car,
                'anchor': anchor,
                'case': dst_name,
                'yawDeg': yaw_deg,
                'elapsedSec': elapsed,
                'mesh': read_mesh_stats(dst),
                'forces': forces_raw,
            }
            progress['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
            progress['completedCount'] = sum(1 for v in progress['cases'].values() if v.get('status') == 'done')
            progress['totalTarget'] = len(CORE_CASES)
            progress_path.write_text(json.dumps(progress, indent=2) + '\n')
            print(f'[{idx}/{len(selected)}] DONE: {key} in {elapsed}s | drag={forces_raw["dragN"]:.1f} N, df={forces_raw["downforceN"]:.1f} N', flush=True)
        except Exception as exc:
            progress['cases'][key] = {'status': 'failed', 'error': str(exc)}
            progress['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
            progress_path.write_text(json.dumps(progress, indent=2) + '\n')
            print(f'[{idx}/{len(selected)}] FAILED: {key}: {exc}', flush=True)
            raise


if __name__ == '__main__':
    main()
