#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 -m venv cfd/.venv
cfd/.venv/bin/pip install -r cfd/python-requirements.txt
# fast-simplification 0.1.13 evaluates Python 3.10 union annotations on the
# host's Python 3.9. Defer annotations only in this isolated project venv.
cfd/.venv/bin/python - <<'PY'
import sys,sysconfig
from pathlib import Path
if sys.version_info < (3,10):
 p=Path(sysconfig.get_paths()['purelib'])/'fast_simplification/simplify.py'
 s=p.read_text()
 if 'from __future__ import annotations' not in s:p.write_text('from __future__ import annotations\n'+s)
PY
