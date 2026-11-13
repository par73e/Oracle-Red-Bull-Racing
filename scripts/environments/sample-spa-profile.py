from pathlib import Path
import urllib.request,urllib.parse,json,numpy as np,concurrent.futures,time
root=Path('docs/research/spa-2026-11-12');reg=json.loads((root/'registered-centerline.json').read_text());points=np.array(reg['points']);selected=points[175:310:2,:2]
base='https://geoservices.wallonie.be/arcgis/rest/services/RELIEF/WALLONIE_MNT_2021_2022/MapServer/identify'
def fetch(coords,label):
 dest=root/(label+'.json')
 if dest.exists():return json.loads(dest.read_text())
 params={'f':'json','geometry':json.dumps({'points':np.round(coords,8).tolist(),'spatialReference':{'wkid':4326}},separators=(',',':')),'geometryType':'esriGeometryMultipoint','sr':4326,'mapExtent':'5.963,50.435,5.98,50.448','imageDisplay':'4096,4096,96','tolerance':0,'layers':'all:0','returnGeometry':'true'}
 encoded=urllib.parse.urlencode(params)
 for retry in range(3):
  try:
   # Small batches use standard GET, cached to avoid repeating source calls.
   d=json.load(urllib.request.urlopen(base+'?'+encoded,timeout=40));assert len(d.get('results',[]))==len(coords),(label,len(d.get('results',[])),len(coords),d)
   dest.write_text(json.dumps(d));return d
  except Exception:
   if retry==2:raise
   time.sleep(2)
d=fetch(selected[:45],'profile-a');d2=fetch(selected[45:],'profile-b');rows=d['results']+d2['results'];heights=[float(next(iter(r['attributes'].values()))) for r in rows]
out={'source':'SPW MNT 2021-2022 0.5 m LiDAR, sampled identify raw pixel values','indices':list(range(175,310,2)),'heightsM':heights,'lonLat':selected.tolist()};(root/'height-profile.json').write_text(json.dumps(out));print(list(zip(out['indices'][::5],np.round(heights[::5],3))))
