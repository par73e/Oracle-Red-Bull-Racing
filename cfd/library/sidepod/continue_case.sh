#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd "$1"
ulimit -v 6291456
taskset -c 0-3 nice -n 5 mpirun -np 4 foamRun -parallel </dev/null > log.foamRun.continue 2>&1 &
solver_pid=$!
while kill -0 "$solver_pid" 2>/dev/null; do
 if grep -Eqi 'residual = [-+]?nan|FOAM FATAL' log.foamRun.continue; then
  kill -TERM "$solver_pid" 2>/dev/null || true
  wait "$solver_pid" || true
  echo 'Numerical failure: field rejected' >&2;exit 1
 fi
 if [ -f postProcessing/forces/650/forces.dat ] && awk 'END {gsub(/[()]/," "); if ($1 > 700 && sqrt($2*$2+$3*$3+$4*$4)>1e7) exit 0; exit 1}' postProcessing/forces/650/forces.dat; then
  kill -TERM "$solver_pid" 2>/dev/null || true
  wait "$solver_pid" || true
  echo 'Numerical failure: excessive force' >&2;exit 1
 fi
 sleep 3
done
wait "$solver_pid"
reconstructPar -latestTime > log.reconstructPar.continue 2>&1
