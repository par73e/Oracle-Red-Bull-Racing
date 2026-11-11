#!/bin/bash
set -eo pipefail
cd /Users/louis/Suep/Project/AERO
for car in rb19 rb16b; do
 for pose in neutral open left right; do
  if [ ! -f "cfd/library/geometry/$car/$pose/pose.json" ]; then node web/scripts/export-flow-geometry.mjs "$car" "$pose"; fi
  cfd/.venv/bin/python -u cfd/library/scripts/close_pose.py "$car" "$pose"
 done
done
