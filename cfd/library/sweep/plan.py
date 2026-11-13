"""One-factor-at-a-time CFD plan, as approved by Sir on 2026-11-12."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
AXES={'air':list(range(0,351,5)),'ground':list(range(0,351,5)),'drs':list(range(101)),'steer':list(range(-18,19))}
def parameters(axis,value):
 p={'airKmh':180,'groundKmh':180,'drsPercent':0,'steerDeg':0}
 p[{'air':'airKmh','ground':'groundKmh','drs':'drsPercent','steer':'steerDeg'}[axis]]=value
 return p
def key_for(p):
 if p==parameters('air',180):return 'base'
 for axis,field,default in [('air','airKmh',180),('ground','groundKmh',180),('drs','drsPercent',0),('steer','steerDeg',0)]:
  if p[field]!=default:return f'{axis}-'+('m' if p[field]<0 else '')+f'{abs(p[field]):03d}'
 raise ValueError(p)
def requests():
 result={}
 for axis,values in AXES.items():
  for v in values:
   p=parameters(axis,v);result[key_for(p)]=p
 return result
ALIASES={'base':('legacy','base'),'drs-100':('legacy','open'),'steer-m018':('legacy','left'),'steer-018':('legacy','right'),'air-000':('rolling','still-air'),'ground-000':('rolling','road-stop'),'ground-090':('rolling','road-slow')}
def published(car):
 result={}
 old=json.loads((ROOT/f'web/public/flow/{car}/manifest.json').read_text())['anchors']
 rolling=json.loads((ROOT/f'web/public/flow/{car}/rolling/manifest.json').read_text())['anchors']
 for key,(family,anchor) in ALIASES.items():
  a=next(a for a in (old if family=='legacy' else rolling) if a['anchor']==anchor)
  result[key]={**a,'key':key,'parameters':requests()[key],'reused':True}
 for path in sorted((ROOT/'cfd/library/reports').glob(car+'-sweep-*.json')):
  a=json.loads(path.read_text());result[a['anchor']]={**a,'key':a['anchor'],'parameters':a['parameters']}
 return result
def write_manifest(car):
 records=published(car);axes={axis:[{'value':v,'key':key_for(parameters(axis,v))} for v in values] for axis,values in AXES.items()}
 data={'car':car,'strategy':'one-factor-at-a-time; multi-factor combinations approximate','baseline':parameters('air',180),'axes':axes,'plannedUnique':len(requests()),'completedUnique':len(records),'complete':len(records)==len(requests()),'fields':list(records.values())}
 folder=ROOT/f'web/public/flow/{car}/sweep';folder.mkdir(exist_ok=True);p=folder/'manifest.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.replace(p)
 return data
if __name__=='__main__':
 for car in ['rb19','rb16b']:print(car,write_manifest(car)['completedUnique'],'/',len(requests()))
