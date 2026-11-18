"""Prepare OpenFOAM Foundation 14 crosswind/yaw cases with freestream far-field BCs."""
from pathlib import Path
import hashlib
import json
import math
import shutil
import sys
import numpy as np
from plan import ROOT, parameters, yaw_key

GRID_SHAPE = (78, 60, 26)
GRID_MIN = (-5.5, -4.5, 0.025)
GRID_MAX = (6.5, 4.5, 1.75)


def dictionary(name, text, klass='dictionary'):
    return f'FoamFile\n{{version 2.0; format ascii; class {klass}; object {name};}}\n' + text + '\n'


def write_dict(path, text, klass='dictionary'):
    path.write_text(dictionary(path.name, text, klass))


def prepare_mesh_case(car):
    mesh_case = ROOT / f'cfd/library/cases/{car}-yaw-mesh'
    if (mesh_case / 'constant/polyMesh/points').exists():
        return mesh_case
    pose_dir = ROOT / f'cfd/library/geometry/{car}/neutral'
    for d in ['0', 'constant/geometry', 'system']:
        (mesh_case / d).mkdir(parents=True, exist_ok=True)

    write_dict(mesh_case / 'system/blockMeshDict', '''convertToMeters 1;
vertices (
 (-24 -28 0) (30 -28 0) (30 28 0) (-24 28 0)
 (-24 -28 16) (30 -28 16) (30 28 16) (-24 28 16)
);
blocks (hex (0 1 2 3 4 5 6 7) (84 84 24) simpleGrading (1 1 1));
edges ();
boundary (
 xMin {type patch; faces ((0 4 7 3));}
 xMax {type patch; faces ((1 2 6 5));}
 ground {type wall; faces ((0 3 2 1));}
 yMin {type patch; faces ((0 1 5 4));}
 yMax {type patch; faces ((3 7 6 2));}
 top {type symmetryPlane; faces ((4 5 6 7));}
);
mergePatchPairs ();''')

    geometry = '\n'.join(f' {g} {{type triSurface; file "{g}.stl";}}' for g in ['body', 'FL', 'FR', 'RL', 'RR'])
    surfaces = '\n'.join(f'  {g} {{level (3 4); patchInfo {{type wall; inGroups (car);}}}}' for g in ['body', 'FL', 'FR', 'RL', 'RR'])
    write_dict(mesh_case / 'system/snappyHexMeshDict', f'''castellatedMesh true;
snap true;
addLayers false;
geometry {{
{geometry}
 nearCar {{type box; min (-3.3 -1.6 0); max (3.3 1.6 1.6);}}
 omniWake {{type box; min (-7.5 -8.5 0); max (9.5 8.5 2.0);}}
}}
castellatedMeshControls {{
 maxLocalCells 1200000;
 maxGlobalCells 1200000;
 minRefinementCells 10;
 maxLoadUnbalance .1;
 nCellsBetweenLevels 3;
 features ();
 refinementSurfaces {{
{surfaces}
 }}
 resolveFeatureAngle 30;
 refinementRegions {{
  nearCar {{mode inside; level 2;}}
  omniWake {{mode inside; level 1;}}
 }}
 insidePoint (-10.123 3.123 2.123);
 allowFreeStandingZoneFaces true;
}}
snapControls {{
 nSmoothPatch 3;
 tolerance 1.5;
 nSolveIter 30;
 nRelaxIter 5;
 nFeatureSnapIter 5;
 implicitFeatureSnap true;
 explicitFeatureSnap false;
 multiRegionFeatureSnap false;
}}
meshQualityControls {{
 #includeEtc "caseDicts/mesh/generation/meshQualityDict"
 maxBoundarySkewness 4;
 maxInternalSkewness 4;
 minFaceWeight .02;
}}
writeFlags (scalarLevels);
mergeTolerance 1e-7;''')

    write_dict(mesh_case / 'system/controlDict', '''solver incompressibleFluid;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime 650;
deltaT 1;
writeControl timeStep;
writeInterval 50;
purgeWrite 2;
writeFormat binary;
writePrecision 8;
writeCompression off;
timeFormat general;
timePrecision 6;
runTimeModifiable true;''')
    write_dict(mesh_case / 'system/fvSchemes', 'ddtSchemes {default steadyState;}')
    write_dict(mesh_case / 'system/fvSolution', 'solvers {}')
    write_dict(mesh_case / 'system/decomposeParDict', 'numberOfSubdomains 4; method scotch;')
    for g in ['body', 'FL', 'FR', 'RL', 'RR']:
        shutil.copy2(pose_dir / f'{g}.stl', mesh_case / f'constant/geometry/{g}.stl')
    return mesh_case


def prepare_case(car, deg, conservative=False):
    deg = int(deg)
    key = yaw_key(deg)
    p = parameters(deg)
    case = ROOT / f'cfd/library/cases/{car}-yaw-{key}'
    if case.exists() and (case / 'complete.json').exists():
        print('COMPLETE', case, flush=True)
        return case
    if case.exists():
        for child in case.iterdir():
            if child.name.startswith('processor') or child.name == 'postProcessing' or (child.name.isdigit() and child.name != '0'):
                shutil.rmtree(child, ignore_errors=True)

    pose_dir = ROOT / f'cfd/library/geometry/{car}/neutral'
    meta = json.loads((pose_dir / 'pose.json').read_text())
    U = p['airKmh'] / 3.6
    G = p['groundKmh'] / 3.6
    beta = math.radians(deg)
    ux = U * math.cos(beta)
    uy = -U * math.sin(beta)
    meta.update(
        anchor=key,
        family='yaw',
        parameters=p,
        speedMps=U,
        groundSpeedMps=G,
        wheelSpeedMps=G,
        windAngleDeg=deg,
        inflowVector=[ux, uy, 0.0],
        noSlipRolling=True,
        proxySha256={k: hashlib.sha256((pose_dir / f'{k}.stl').read_bytes()).hexdigest() for k in ['body', 'FL', 'FR', 'RL', 'RR']},
    )

    mesh_case = prepare_mesh_case(car)
    for d in ['0', 'constant', 'system']:
        (case / d).mkdir(parents=True, exist_ok=True)
    if (mesh_case / 'constant/polyMesh/points').exists():
        shutil.copytree(mesh_case / 'constant/polyMesh', case / 'constant/polyMesh', dirs_exist_ok=True)
        if (mesh_case / 'log.checkMesh').exists():
            shutil.copy2(mesh_case / 'log.checkMesh', case / 'log.checkMesh')
    shutil.copy2(mesh_case / 'system/blockMeshDict', case / 'system/blockMeshDict')
    shutil.copy2(mesh_case / 'system/snappyHexMeshDict', case / 'system/snappyHexMeshDict')
    shutil.copytree(mesh_case / 'constant/geometry', case / 'constant/geometry', dirs_exist_ok=True)

    write_dict(case / 'constant/physicalProperties', 'viscosityModel constant;\nnu 1.5e-5;')
    write_dict(case / 'constant/momentumTransport', 'simulationType RAS;\nRAS {model kOmegaSST; turbulence on;}')
    write_dict(case / 'system/controlDict', '''solver incompressibleFluid;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime 650;
deltaT 1;
writeControl timeStep;
writeInterval 50;
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
}''')

    if conservative:
        p_relax, u_relax, kw_relax, n_non_orth, grad_lim, grad_u_lim, p_reltol = 0.06, 0.1, 0.12, 0, 'uncorrected', '0.5', '.02'
    elif car == 'rb19':
        p_relax, u_relax, kw_relax, n_non_orth, grad_lim, grad_u_lim, p_reltol = 0.18, 0.25, 0.25, 0, 'limited .25', '1', '.05'
    else:
        p_relax, u_relax, kw_relax, n_non_orth, grad_lim, grad_u_lim, p_reltol = 0.1, 0.15, 0.2, 0, 'uncorrected', '1', '.05'

    write_dict(case / 'system/fvSchemes', f'''ddtSchemes {{default steadyState;}}
gradSchemes {{default Gauss linear; grad(U) cellLimited Gauss linear {grad_u_lim};}}
divSchemes {{default none; div(phi,U) bounded Gauss upwind; div(phi,k) bounded Gauss upwind; div(phi,omega) bounded Gauss upwind; div((nuEff*dev2(T(grad(U))))) Gauss linear;}}
laplacianSchemes {{default Gauss linear {grad_lim};}}
interpolationSchemes {{default linear;}}
snGradSchemes {{default {grad_lim};}}
wallDist {{method meshWave;}}''')

    write_dict(case / 'system/fvSolution', f'''solvers {{
 p {{solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol {p_reltol};}}
 Phi {{$p;}}
 "(U|k|omega)" {{solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol .1;}}
}}
SIMPLE {{nNonOrthogonalCorrectors {n_non_orth}; consistent no;}}
potentialFlow {{nNonOrthogonalCorrectors 5;}}
relaxationFactors {{fields {{p {p_relax};}} equations {{U {u_relax}; k {kw_relax}; omega {kw_relax};}}}}''')

    write_dict(case / 'system/decomposeParDict', 'numberOfSubdomains 4; method scotch;')

    k_val = max(1e-6, 1.5 * (0.01 * U) ** 2)
    omega_val = max(1.0, k_val ** 0.5 / (0.09 ** 0.25 * 0.05))
    u_str = f'({ux:.8g} {uy:.8g} 0)'
    g_str = f'({G:.8g} 0 0)'

    patches = ['xMin', 'xMax', 'yMin', 'yMax', 'ground', 'top', 'body', 'FL', 'FR', 'RL', 'RR']
    for field, klass, dims, initial in [
        ('U', 'volVectorField', '0 1 -1 0 0 0 0', u_str),
        ('p', 'volScalarField', '0 2 -2 0 0 0 0', '0'),
        ('k', 'volScalarField', '0 2 -2 0 0 0 0', str(k_val)),
        ('omega', 'volScalarField', '0 0 -1 0 0 0 0', str(omega_val)),
        ('nut', 'volScalarField', '0 2 -1 0 0 0 0', '0'),
    ]:
        bcs = []
        for patch in patches:
            if patch == 'top':
                bc = 'type symmetryPlane;'
            elif patch in ['xMin', 'xMax', 'yMin', 'yMax']:
                if field == 'U':
                    bc = f'type freestreamVelocity; freestreamValue uniform {u_str};'
                elif field == 'p':
                    bc = 'type freestreamPressure; freestreamValue uniform 0;'
                elif field == 'nut':
                    bc = 'type calculated; value uniform 0;'
                else:
                    bc = f'type freestream; freestreamValue uniform {initial};'
            elif field == 'U':
                if patch == 'ground':
                    bc = f'type fixedValue; value uniform {g_str};'
                elif patch == 'body':
                    bc = 'type noSlip;'
                else:
                    w = meta['wheels'][patch]
                    vec = lambda values: '(' + ' '.join(str(v) for v in values) + ')'
                    bc = f'type rotatingWallVelocity; origin {vec(w["center"])}; axis {vec(w["axis"])}; omega {G / w["radius"]}; value uniform (0 0 0);'
            elif field == 'p':
                bc = 'type zeroGradient;'
            elif field == 'nut':
                bc = 'type nutkWallFunction; value uniform 0;'
            else:
                bc = f'type {"kqRWallFunction" if field == "k" else "omegaWallFunction"}; value uniform {initial};'
            bcs.append(f' {patch} {{{bc}}}')
        write_dict(case / '0' / field, f'dimensions [{dims}];\ninternalField uniform {initial};\nboundaryField {{\n' + '\n'.join(bcs) + '\n}}', klass)

    xs = np.linspace(GRID_MIN[0], GRID_MAX[0], GRID_SHAPE[0])
    ys = np.linspace(GRID_MIN[1], GRID_MAX[1], GRID_SHAPE[1])
    zs = np.linspace(GRID_MIN[2], GRID_MAX[2], GRID_SHAPE[2])
    points = '\n'.join(f'({x:.7f} {y:.7f} {z:.7f})' for z in zs for y in ys for x in xs)
    write_dict(case / 'system/sampleGrid', 'fields (U);\ninterpolationScheme cellPoint;\nsetFormat raw;\nsets {\n grid {\n  type points;\n  ordered false;\n  axis xyz;\n  points (\n' + points + '\n  );\n }\n}')
    write_dict(case / 'system/gridFunctions', 'grid {type sets; libs ("libsampling.so"); writeControl writeTime; #include "sampleGrid"\n}')

    (case / 'anchor.json').write_text(json.dumps(meta, indent=2) + '\n')
    (case / f'{car}.foam').touch()
    (case / 'log.foamRun').touch()
    print('PREPARED', case, flush=True)
    return case


if __name__ == '__main__':
    prepare_case(sys.argv[1], int(sys.argv[2]))
