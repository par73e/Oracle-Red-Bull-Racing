"""Reproducible coarse RB19 RANS case, OpenFOAM Foundation 14."""
from pathlib import Path
import json,shutil
ROOT=Path(__file__).resolve().parents[2];case=ROOT/'cfd/cases/rb19-50ms-coarse'
if (case/'constant/polyMesh/points').exists():raise SystemExit('Refusing to overwrite an existing meshed case; choose a new case directory.')
for d in ['0','constant/geometry','system']:(case/d).mkdir(parents=True,exist_ok=True)
def dictionary(name,text,klass='dictionary',location='system'):
 return f'FoamFile\n{{version 2.0; format ascii; class {klass}; object {name};}}\n'+text+'\n'
def write(name,text):
 (case/name).write_text(dictionary(Path(name).name,text))
write('system/blockMeshDict','''convertToMeters 1;
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
mergePatchPairs ();''')
geometry='\n'.join(f'{g} {{type triSurface; file "{g}.stl";}}' for g in ['body','FL','FR','RL','RR'])
surfaces='\n'.join(f'{g} {{level (3 4);patchInfo {{type wall; inGroups (car);}}}}' for g in ['body','FL','FR','RL','RR'])
write('system/snappyHexMeshDict',f'''castellatedMesh true; snap true; addLayers false;
geometry {{
{geometry}
 nearCar {{type box; min (-3.2 -1.3 0); max (3.3 1.3 1.5);}}
 wake {{type box; min (2.8 -1.4 0); max (12 1.4 2);}}
}}
castellatedMeshControls {{
 maxLocalCells 1200000; maxGlobalCells 1200000; minRefinementCells 10; maxLoadUnbalance .1;
 nCellsBetweenLevels 3; features (); refinementSurfaces {{{surfaces}}}
 resolveFeatureAngle 30;
 refinementRegions {{nearCar {{mode inside; level 2;}} wake {{mode inside; level 1;}}}}
 insidePoint (-10.123 3.123 2.123); allowFreeStandingZoneFaces true;
}}
snapControls {{nSmoothPatch 3; tolerance 1.5; nSolveIter 30; nRelaxIter 5; nFeatureSnapIter 5;
 implicitFeatureSnap true; explicitFeatureSnap false; multiRegionFeatureSnap false;}}
meshQualityControls {{#includeEtc "caseDicts/mesh/generation/meshQualityDict"
 maxBoundarySkewness 4; maxInternalSkewness 4; minFaceWeight .02;
}}
writeFlags (scalarLevels);mergeTolerance 1e-7;''')
write('constant/physicalProperties','viscosityModel constant;\nnu 1.5e-5;')
write('constant/momentumTransport','simulationType RAS;\nRAS {model kOmegaSST; turbulence on;}')
write('system/controlDict','''solver incompressibleFluid;
startFrom startTime; startTime 0; stopAt endTime; endTime 800; deltaT 1;
writeControl timeStep; writeInterval 100; purgeWrite 2;
writeFormat binary; writePrecision 8; writeCompression off;
timeFormat general; timePrecision 6; runTimeModifiable true;
functions {
 forces {type forces; libs ("libforces.so"); patches (car); rho rhoInf; rhoInf 1.225; CofR (0 0 .3); writeControl timeStep; writeInterval 1; log yes;}
 yPlus {type yPlus; libs ("libfieldFunctionObjects.so"); writeControl writeTime;}
}
''')
write('system/fvSchemes','''ddtSchemes {default steadyState;}
gradSchemes {default Gauss linear; grad(U) cellLimited Gauss linear 1;}
divSchemes {default none; div(phi,U) bounded Gauss upwind; div(phi,k) bounded Gauss upwind; div(phi,omega) bounded Gauss upwind; div((nuEff*dev2(T(grad(U))))) Gauss linear;}
laplacianSchemes {default Gauss linear limited .5;}
interpolationSchemes {default linear;}
snGradSchemes {default limited .5;}
wallDist {method meshWave;}''')
write('system/fvSolution','''solvers {
 p {solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol .05;}
 Phi {$p;}
 "(U|k|omega)" {solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol .1;}
}
SIMPLE {nNonOrthogonalCorrectors 1; consistent no;}
potentialFlow {nNonOrthogonalCorrectors 5;}
relaxationFactors {fields {p .3;} equations {U .5; k .4; omega .4;}}
''')
write('system/decomposeParDict','numberOfSubdomains 4; method scotch;')
audit=json.loads((ROOT/'cfd/reports/rb19-geometry-audit.json').read_text())
for field,klass,dims,initial in [('U','volVectorField','0 1 -1 0 0 0 0','(50 0 0)'),('p','volScalarField','0 2 -2 0 0 0 0','0'),('k','volScalarField','0 2 -2 0 0 0 0','.375'),('omega','volScalarField','0 0 -1 0 0 0 0','22.36'),('nut','volScalarField','0 2 -1 0 0 0 0','0')]:
 bcs=[]
 for patch in ['inlet','outlet','ground','body','FL','FR','RL','RR','sides','side2','top']:
  if patch in ['sides','side2','top']:bc='type symmetryPlane;'
  elif field=='U':
   if patch in ['inlet','ground']:bc='type fixedValue; value uniform (50 0 0);'
   elif patch=='outlet':bc='type inletOutlet; inletValue uniform (50 0 0); value uniform (50 0 0);'
   elif patch=='body':bc='type noSlip;'
   else:
    w=audit['wheels'][patch];c=w['center'];c[2]-=.005
    vec=lambda values:'('+' '.join(str(v) for v in values)+')'
    bc=f'type rotatingWallVelocity; origin {vec(c)}; axis {vec(w["axis"])}; omega {50/w["radius"]}; value uniform (0 0 0);'
  elif field=='p':bc='type fixedValue; value uniform 0;' if patch=='outlet' else 'type zeroGradient;'
  elif field=='nut':bc='type calculated; value uniform 0;' if patch in ['inlet','outlet'] else 'type nutkWallFunction; value uniform 0;'
  elif patch=='inlet':bc=f'type fixedValue; value uniform {initial};'
  elif patch=='outlet':bc=f'type inletOutlet; inletValue uniform {initial}; value uniform {initial};'
  else:bc=f'type {"kqRWallFunction" if field=="k" else "omegaWallFunction"}; value uniform {initial};'
  bcs.append(patch+' {'+bc+'}')
 (case/'0'/field).write_text(dictionary(field,f'dimensions [{dims}];\ninternalField uniform {initial};\nboundaryField {{'+ '\n'.join(bcs)+'}',klass))
for g in ['body','FL','FR','RL','RR']:shutil.copy2(ROOT/f'cfd/geometry/rb19/{g}.stl',case/f'constant/geometry/{g}.stl')
(case/'rb19.foam').touch()
print(case)
