#!/bin/bash
set -eo pipefail
source /opt/openfoam14/etc/bashrc
cd /Users/louis/Suep/Project/AERO/cfd/cases/rb19-50ms-coarse
cp ../../templates/postProcessDict system/postProcessDict
foamPostProcess -dict system/postProcessDict -latestTime > log.samplePlanes 2>&1
foamToVTK -latestTime -fields '(p U)' -noInternal -noFaceZones -excludePatches '(inlet outlet ground sides side2 top)' -ascii > log.foamToVTK 2>&1
