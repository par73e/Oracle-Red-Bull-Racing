"""Run eight independent rolling cases serially, at most four solver ranks."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[3];python=str(ROOT/'cfd/.venv/bin/python')
for car in ['rb19','rb16b']:
 for anchor in ['road-stop','road-slow','road-fast','still-air']:
  print('START',car,anchor,flush=True)
  subprocess.run([python,str(ROOT/'cfd/library/rolling/prepare.py'),car,anchor],check=True)
  case=ROOT/f'cfd/library/cases/{car}-rolling-{anchor}'
  subprocess.run(['/opt/homebrew/bin/orb','-m','aero-cfd','bash',str(ROOT/'cfd/library/scripts/run_anchor.sh'),str(case)],check=True,stdin=subprocess.DEVNULL)
  subprocess.run([python,str(ROOT/'cfd/library/rolling/pack.py'),str(case)],check=True)
  print('DONE',car,anchor,flush=True)
