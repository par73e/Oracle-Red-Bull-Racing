"""Resumable serial full slider-axis sweep. No deletion, no concurrent solvers."""
import json,subprocess,time,shutil,os
from plan import ROOT,requests,published,write_manifest
python=str(ROOT/'cfd/.venv/bin/python');status=ROOT/'cfd/library/reports/sweep-status-2026-11-12.json'
def update(**kw):
 kw.update(updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S%z'),pid=os.getpid());tmp=status.with_suffix('.tmp');tmp.write_text(json.dumps(kw,indent=2)+'\n');tmp.replace(status)
# The authorized eight seed cases run first. A missing seed is never faked.
while not all((ROOT/f'cfd/library/cases/{car}-rolling-{anchor}/complete.json').exists() for car in ['rb19','rb16b'] for anchor in ['road-stop','road-slow','road-fast','still-air']):
 update(state='waiting-for-rolling-seeds');time.sleep(5)
try:
 for car in ['rb19','rb16b']:write_manifest(car)
 # Interleave cars so each model gains the same covered values before the next.
 for key,p in requests().items():
  for car in ['rb19','rb16b']:
   if key in published(car):continue
   if shutil.disk_usage(ROOT).free<30*1024**3:raise RuntimeError('Less than 30 GiB free; stopped without deleting any files')
   update(state='running',car=car,key=key,parameters=p,completed={c:len(published(c)) for c in ['rb19','rb16b']},plannedPerCar=len(requests()))
   print('START',car,key,p,flush=True)
   if key.startswith(('drs-','steer-')):
    folder=ROOT/f'cfd/library/geometry/{car}/{key}'
    if not (folder/'pose.json').exists():subprocess.run(['node',str(ROOT/'web/scripts/export-flow-geometry.mjs'),car,key],check=True)
    if not (folder/'closed.json').exists():subprocess.run([python,str(ROOT/'cfd/library/scripts/close_pose.py'),car,key],check=True)
   subprocess.run([python,str(ROOT/'cfd/library/sweep/prepare.py'),car,key],check=True)
   case=ROOT/f'cfd/library/cases/{car}-sweep-{key}'
   subprocess.run(['/opt/homebrew/bin/orb','-m','aero-cfd','bash',str(ROOT/'cfd/library/scripts/run_anchor.sh'),str(case)],check=True,stdin=subprocess.DEVNULL)
   subprocess.run([python,str(ROOT/'cfd/library/sweep/pack.py'),str(case)],check=True)
   print('DONE',car,key,flush=True)
 update(state='complete',completed={c:len(published(c)) for c in ['rb19','rb16b']},plannedPerCar=len(requests()))
except Exception as e:
 update(state='failed',error=str(e));raise
