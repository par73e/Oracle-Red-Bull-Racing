from pathlib import Path
import subprocess,time,json,sys,re
ROOT=Path(__file__).resolve().parents[3]
for car in ['rb19','rb16b']:
 for anchor in ['base','low','high','open','left','right','locked','fast','spin']:
  pose='open' if anchor=='open' else anchor if anchor in ['left','right'] else 'neutral'
  folder=ROOT/f'cfd/library/geometry/{car}/{pose}'
  while not (folder/'closed.json').exists():time.sleep(5)
  print('START',car,anchor,flush=True)
  subprocess.run([str(ROOT/'cfd/.venv/bin/python'),str(ROOT/'cfd/library/scripts/create_case.py'),car,anchor],check=True)
  case=ROOT/f'cfd/library/cases/{car}-{anchor}'
  subprocess.run(['/opt/homebrew/bin/orb','-m','aero-cfd','bash',str(ROOT/'cfd/library/scripts/run_anchor.sh'),str(case)],check=True,stdin=subprocess.DEVNULL)
  subprocess.run([str(ROOT/'cfd/.venv/bin/python'),str(ROOT/'cfd/library/scripts/pack_anchor.py'),str(case)],check=True)
  print('DONE',car,anchor,flush=True)
