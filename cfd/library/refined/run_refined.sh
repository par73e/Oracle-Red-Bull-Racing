#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
case_dir="$1"
solver_cores="${2:-0-5}"
np="${3:-6}"
cd "$case_dir"

if [ ! -f constant/polyMesh/points ] || ! grep -q 'body' constant/polyMesh/boundary 2>/dev/null; then
  rm -rf constant/polyMesh processor*
  echo "[mesh] blockMesh"
  blockMesh > log.blockMesh 2>&1
  echo "[mesh] decomposePar (background)"
  decomposePar -force -noFields > log.decomposeMesh 2>&1
  echo "[mesh] snappyHexMesh -parallel (np=$np)"
  taskset -c "$solver_cores" nice -n 5 mpirun -np "$np" snappyHexMesh -parallel -overwrite </dev/null > log.snappyHexMesh 2>&1
  echo "[mesh] reconstructPar -constant"
  reconstructPar -constant > log.reconstructMesh 2>&1
  rm -rf processor*
  grep -q 'body' constant/polyMesh/boundary
  echo "[mesh] checkMesh"
  checkMesh > log.checkMesh 2>&1
fi
grep -q 'Mesh OK.' log.checkMesh
grep -q 'body' constant/polyMesh/boundary

if [ ! -f 1000/U ]; then
  echo "[solve] decomposePar"
  decomposePar -force > log.decomposePar 2>&1
  echo "[solve] foamRun -parallel (np=$np)"
  taskset -c "$solver_cores" nice -n 5 mpirun -np "$np" foamRun -parallel </dev/null > log.foamRun 2>&1 &
  solver_pid=$!
  while kill -0 "$solver_pid" 2>/dev/null; do
    if grep -Eqi 'residual = [-+]?nan|FOAM FATAL' log.foamRun; then
      kill -TERM "$solver_pid" 2>/dev/null || true
      wait "$solver_pid" || true
      echo 'Numerical failure: field rejected' >&2
      exit 1
    fi
    sleep 5
  done
  wait "$solver_pid"
  grep -qx 'End' log.foamRun
  echo "[solve] reconstructPar -time 1000"
  reconstructPar -time 1000 > log.reconstructPar 2>&1
  rm -rf processor*
fi

echo "[post] gridFunctions"
foamPostProcess -dict system/gridFunctions -time 1000 > log.sampleGrid 2>&1
echo "[done] $case_dir"
