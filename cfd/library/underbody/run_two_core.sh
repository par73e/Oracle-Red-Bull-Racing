#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd "$1"
grep -q 'Mesh OK.' log.checkMesh
ulimit -v 6291456
sed -i 's/numberOfSubdomains 4/numberOfSubdomains 2/' system/decomposeParDict
decomposePar -force > log.decomposePar 2>&1
taskset -c 4,5 nice -n 10 mpirun -np 2 foamRun -parallel </dev/null > log.foamRun 2>&1 &
solver_pid=$!
while kill -0 "$solver_pid" 2>/dev/null; do
 if [ -f postProcessing/forces/0/forces.dat ] && awk 'END {gsub(/[()]/," "); if ($1 > 50 && (sqrt($2*$2+$3*$3+$4*$4)>1e7)) exit 0; exit 1}' postProcessing/forces/0/forces.dat; then
  kill -TERM "$solver_pid" 2>/dev/null || true
  wait "$solver_pid" || true
  echo 'Numerical failure: force magnitude exceeds 1e7 N after startup' >&2
  exit 1
 fi
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
