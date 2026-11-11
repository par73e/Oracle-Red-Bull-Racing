#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd /Users/louis/Suep/Project/AERO/cfd/cases/rb19-50ms-coarse
ulimit -v 6291456
blockMesh > log.blockMesh 2>&1
for surface in body FL FR RL RR; do surfaceCheck "constant/geometry/$surface.stl" > "log.surfaceCheck.$surface" 2>&1; done
taskset -c 0-3 nice -n 5 snappyHexMesh -overwrite > log.snappyHexMesh 2>&1
checkMesh > log.checkMesh 2>&1
grep -q "Mesh OK." log.checkMesh
