"""Final checks run automatically when both slider sweeps are fully published."""
import subprocess,sys
from plan import ROOT
subprocess.run([sys.executable,str(ROOT/'cfd/library/sweep/audit.py')],check=True)
for name in ['validate:sweep','validate:worker','validate:rolling','validate:flow-geometry','validate:underbody','validate:sidepod','build']:
 subprocess.run(['npm','run',name],cwd=ROOT/'web',check=True)
