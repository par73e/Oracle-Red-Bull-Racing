#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
case_dir="$1"
cd "$case_dir"
ulimit -v 6291456
if [ -f complete.json ]; then exit 0; fi
if [ ! -f constant/polyMesh/points ]; then
 blockMesh > log.blockMesh 2>&1
 taskset -c 0-3 nice -n 5 snappyHexMesh -overwrite > log.snappyHexMesh 2>&1
 checkMesh > log.checkMesh 2>&1
fi
grep -q 'Mesh OK.' log.checkMesh
if [ ! -f 650/U ]; then
 decomposePar -force > log.decomposePar 2>&1
 taskset -c 0-3 nice -n 5 mpirun -np 4 foamRun -parallel </dev/null > log.foamRun 2>&1 &
 solver_pid=$!
 while kill -0 "$solver_pid" 2>/dev/null; do
  if grep -Eqi 'residual = [-+]?nan|FOAM FATAL' log.foamRun; then
   kill -TERM "$solver_pid" 2>/dev/null || true
   wait "$solver_pid" || true
   echo 'Numerical failure: field rejected' >&2
   exit 1
  fi
  sleep 3
 done
 wait "$solver_pid"
 reconstructPar -latestTime > log.reconstructPar 2>&1
fi
foamPostProcess -dict system/gridFunctions -latestTime > log.sampleGrid 2>&1
