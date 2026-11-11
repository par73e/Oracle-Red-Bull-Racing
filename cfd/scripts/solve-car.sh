#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd /Users/louis/Suep/Project/AERO/cfd/cases/rb19-50ms-coarse
ulimit -v 6291456
grep -q "Mesh OK." log.checkMesh
decomposePar > log.decomposePar 2>&1
taskset -c 0-3 nice -n 5 mpirun -np 4 foamRun -parallel </dev/null > log.foamRun 2>&1
reconstructPar -latestTime > log.reconstructPar 2>&1
