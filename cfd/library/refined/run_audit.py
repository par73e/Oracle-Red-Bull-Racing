"""Prepare and run the 3-case refined prism-layer OpenFOAM audit and compare against coarse baselines."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
CASES = ROOT / 'cfd/library/cases'
SCRIPT = Path(__file__).resolve().parent / 'run_refined.sh'
COARSE_GRID = {'shape': [88, 34, 32], 'min': [-4, -1.65, .025], 'max': [9, 1.65, 1.65]}

AUDIT_SPECS = {
    'rb16b-base': ('rb16b', 'rb16b-display-base-drs-000', 'rb16b-refined-base'),
    'rb16b-open': ('rb16b', 'rb16b-display-base-drs-100', 'rb16b-refined-open'),
    'rb19-base': ('rb19', 'rb19-base', 'rb19-refined-base'),
}

BLOCK_MESH = """FoamFile
{version 2.0; format ascii; class dictionary; object blockMeshDict;}
convertToMeters 1;
vertices ((-20 -12 0)(38 -12 0)(38 12 0)(-20 12 0)(-20 -12 16)(38 -12 16)(38 12 16)(-20 12 16));
blocks (hex (0 1 2 3 4 5 6 7) (116 48 32) simpleGrading (1 1 1));
edges ();
boundary (
 inlet {type patch; faces ((0 4 7 3));}
 outlet {type patch; faces ((1 2 6 5));}
 ground {type wall; faces ((0 3 2 1));}
 sides {type symmetryPlane; faces ((0 1 5 4));}
 side2 {type symmetryPlane; faces ((3 7 6 2));}
 top {type symmetryPlane; faces ((4 5 6 7));}
);
mergePatchPairs ();
"""

SNAPPY_DICT = """FoamFile
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
  nearCar {type box; min (-3.3 -1.35 0); max (3.5 1.35 1.55);}
  underbody {type box; min (-2.6 -1.1 0); max (3.1 1.1 0.55);}
  frontWing {type box; min (-3.0 -1.05 0); max (-1.45 1.05 0.55);}
  rearWing {type box; min (1.75 -0.65 0.42); max (3.1 0.65 1.25);}
  wake {type box; min (2.8 -1.5 0); max (14 1.5 2.0);}
}
castellatedMeshControls {
  maxLocalCells 1500000;
  maxGlobalCells 4000000;
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
    wake {mode inside; level 2;}
  }
  insidePoint (-10.123 3.123 2.123);
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

FV_SCHEMES = """FoamFile
{version 2.0; format ascii; class dictionary; object fvSchemes;}
ddtSchemes {default steadyState;}
gradSchemes {
  default Gauss linear;
  grad(U) cellLimited Gauss linear 1;
  grad(p) cellLimited Gauss linear 1;
}
divSchemes {
  default none;
  div(phi,U) bounded Gauss linearUpwind grad(U);
  div(phi,k) bounded Gauss upwind;
  div(phi,omega) bounded Gauss upwind;
  div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes {default Gauss linear limited 0.5;}
interpolationSchemes {default linear;}
snGradSchemes {default limited 0.5;}
wallDist {method meshWave;}
"""

FV_SOLUTION = """FoamFile
{version 2.0; format ascii; class dictionary; object fvSolution;}
solvers {
  p {solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol 0.05;}
  Phi {$p;}
  "(U|k|omega)" {solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0.1;}
}
SIMPLE {
  nNonOrthogonalCorrectors 2;
  consistent yes;
}
potentialFlow {nNonOrthogonalCorrectors 5;}
relaxationFactors {
  fields {p 0.3;}
  equations {U 0.5; k 0.4; omega 0.4;}
}
"""

CONTROL_DICT = """FoamFile
{version 2.0; format ascii; class dictionary; object controlDict;}
solver incompressibleFluid;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime 1000;
deltaT 1;
writeControl timeStep;
writeInterval 200;
purgeWrite 2;
writeFormat binary;
writePrecision 8;
writeCompression off;
timeFormat general;
timePrecision 6;
runTimeModifiable true;
functions {
  forces {type forces; libs ("libforces.so"); patches (car); rho rhoInf; rhoInf 1.225; CofR (0 0 .3); writeControl timeStep; writeInterval 1; log yes;}
  yPlus {type yPlus; libs ("libfieldFunctionObjects.so"); writeControl writeTime;}
}
"""

DECOMPOSE_DICT = """FoamFile
{version 2.0; format ascii; class dictionary; object decomposeParDict;}
numberOfSubdomains 6;
method scotch;
"""


def prepare(key):
    car, src_name, dst_name = AUDIT_SPECS[key]
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
    (dst / 'system/blockMeshDict').write_text(BLOCK_MESH)
    (dst / 'system/snappyHexMeshDict').write_text(SNAPPY_DICT)
    (dst / 'system/fvSchemes').write_text(FV_SCHEMES)
    (dst / 'system/fvSolution').write_text(FV_SOLUTION)
    (dst / 'system/controlDict').write_text(CONTROL_DICT)
    (dst / 'system/decomposeParDict').write_text(DECOMPOSE_DICT)
    return dst


def read_forces(case_dir, end_time=1000, window=150):
    samples = {}
    for path in sorted((case_dir / 'postProcessing/forces').glob('*/forces.dat'), key=lambda p: float(p.parent.name)):
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            values = np.fromstring(line.translate(str.maketrans('()', '  ')), sep=' ')
            if len(values) >= 7:
                samples[int(round(values[0]))] = values[1:4] + values[4:7]
    keys = [i for i in range(end_time - window + 1, end_time + 1) if i in samples]
    arr = np.array([samples[i] for i in keys])
    mean = arr.mean(axis=0)
    ptp = np.ptp(arr, axis=0)
    return {
        'samples': len(keys),
        'dragN': float(mean[0]),
        'sideN': float(mean[1]),
        'downforceN': float(-mean[2]),
        'liftToDrag': float(-mean[2] / mean[0]) if mean[0] > 1e-6 else None,
        'dragPtpN': float(ptp[0]),
        'downforcePtpN': float(ptp[2]),
    }


def read_mesh_stats(case_dir):
    check = (case_dir / 'log.checkMesh').read_text()
    cells = int(re.search(r'cells:\s+(\d+)', check)[1])
    non_orth = re.search(r'Mesh non-orthogonality Max:\s+([0-9.]+)\s+average:\s+([0-9.]+)', check)
    skew = re.search(r'Max skewness\s*=\s*([0-9.]+)', check)
    layers = {}
    snappy_log = case_dir / 'log.snappyHexMesh'
    if snappy_log.is_file():
        for m in re.finditer(r'^\s*(body|FL|FR|RL|RR)\s+(\d+)\s+([0-9.]+)\s+([0-9.eE+-]+)\s+([0-9.]+)\s*$',
                             snappy_log.read_text(), re.M):
            layers[m[1]] = {'faces': int(m[2]), 'avgLayers': float(m[3]), 'avgThicknessM': float(m[4]), 'pctThickness': float(m[5])}
    yplus = {}
    yp_files = list((case_dir / 'postProcessing/yPlus').glob('*/yPlus.dat'))
    if yp_files:
        for line in yp_files[-1].read_text().splitlines():
            if line.strip() and not line.startswith('#'):
                parts = line.split()
                if len(parts) >= 5:
                    yplus[parts[1]] = {'min': float(parts[2]), 'max': float(parts[3]), 'avg': float(parts[4])}
    return {
        'cells': cells,
        'maxNonOrtho': float(non_orth[1]) if non_orth else None,
        'avgNonOrtho': float(non_orth[2]) if non_orth else None,
        'maxSkewness': float(skew[1]) if skew else None,
        'meshOk': 'Mesh OK.' in check,
        'layers': layers,
        'yPlus': yplus,
    }


def compare_grid(coarse_dir, refined_dir):
    def load_xy(path):
        rows = np.loadtxt(path)
        shape = np.asarray(COARSE_GRID['shape'])
        origin = np.asarray(COARSE_GRID['min'])
        steps = (np.asarray(COARSE_GRID['max']) - origin) / (shape - 1)
        idx = np.rint((rows[:, :3] - origin) / steps).astype(int)
        ix, iy, iz = idx.T
        flat = (iz * shape[1] + iy) * shape[0] + ix
        vals = rows[:, 3:6]
        safe = np.linalg.norm(vals, axis=1) <= 150.0
        valid = np.zeros(np.prod(shape), bool)
        field = np.zeros((np.prod(shape), 3), np.float32)
        valid[flat] = safe
        field[flat[safe]] = vals[safe]
        return field, valid

    fc, vc = load_xy(coarse_dir / 'postProcessing/grid/650/grid.xy')
    fr, vr = load_xy(refined_dir / 'postProcessing/grid/1000/grid.xy')
    z, y, x = np.meshgrid(*(np.linspace(COARSE_GRID['min'][i], COARSE_GRID['max'][i], COARSE_GRID['shape'][i])
                            for i in (2, 1, 0)), indexing='ij')
    near = ((np.abs(x) <= 3.5) & (np.abs(y) <= 1.2) & (z <= 1.55)).ravel()
    floor = (z <= 0.45).ravel()
    shared = near & vc & vr
    floor_shared = shared & floor
    diff = np.linalg.norm(fr[shared] - fc[shared], axis=1) / 50.0
    floor_diff = np.linalg.norm(fr[floor_shared] - fc[floor_shared], axis=1) / 50.0
    sr, sc = np.linalg.norm(fr[shared], axis=1), np.linalg.norm(fc[shared], axis=1)
    mov = (sr > 2.5) & (sc > 2.5)
    cos = np.sum(fr[shared][mov] * fc[shared][mov], axis=1) / (sr[mov] * sc[mov])
    ang = np.degrees(np.arccos(np.clip(cos, -1, 1)))
    return {
        'nearCarVectorP50': round(float(np.quantile(diff, 0.5)), 4),
        'nearCarVectorP90': round(float(np.quantile(diff, 0.9)), 4),
        'nearCarAngleP50Deg': round(float(np.quantile(ang, 0.5)), 2),
        'nearCarAngleP90Deg': round(float(np.quantile(ang, 0.9)), 2),
        'floorVectorP50': round(float(np.quantile(floor_diff, 0.5)), 4),
        'floorVectorP90': round(float(np.quantile(floor_diff, 0.9)), 4),
        'coarseValidNearCar': int((near & vc).sum()),
        'refinedValidNearCar': int((near & vr).sum()),
    }


def run_case(key, cores='0-5', np_ranks=6):
    dst = prepare(key)
    t0 = time.time()
    subprocess.run(['orb', '-m', 'aero-cfd', 'bash', str(SCRIPT), str(dst), cores, str(np_ranks)],
                   check=True, stdin=subprocess.DEVNULL)
    elapsed = round(time.time() - t0, 1)
    car, src_name, _ = AUDIT_SPECS[key]
    src = CASES / src_name
    summary = {
        'key': key,
        'car': car,
        'coarseCase': src_name,
        'refinedCase': dst.name,
        'elapsedSec': elapsed,
        'coarseMesh': read_mesh_stats(src),
        'refinedMesh': read_mesh_stats(dst),
        'coarseForces': read_forces(src, end_time=650, window=100),
        'refinedForces': read_forces(dst, end_time=1000, window=150),
        'fieldDelta': compare_grid(src, dst),
    }
    (dst / 'audit-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', nargs='*', default=['rb16b-base', 'rb16b-open', 'rb19-base'],
                        choices=list(AUDIT_SPECS))
    parser.add_argument('--cores', default='0-5')
    parser.add_argument('--np', type=int, default=6)
    args = parser.parse_args()
    results = {}
    for k in args.cases:
        results[k] = run_case(k, args.cores, args.np)
    report_path = ROOT / 'cfd/library/reports/refined-mesh-audit-2026-11-22.json'
    report_path.write_text(json.dumps(results, indent=2) + '\n')
    print('Wrote report:', report_path)
