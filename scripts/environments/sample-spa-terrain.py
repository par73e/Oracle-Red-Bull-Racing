exec(open('scripts/environments/sample-spa-profile.py').read().split("d=fetch(selected[:45]")[0])
from scipy.interpolate import PchipInterpolator
profile=json.loads((root/'height-profile.json').read_text());h=PchipInterpolator(profile['indices'],profile['heightsM'],extrapolate=True)
anchor=212;xy=points[:,2:4];f=(xy[anchor+2]-xy[anchor-2]);f/=np.linalg.norm(f);left=np.array([-f[1],f[0]])
R=np.array(reg['rotation']);translation=np.array(reg['translation']);meters=np.array(reg['metersPerDegree']);origin=np.array(reg['originLonLat']);p0=xy[anchor]
xs=np.linspace(-240,240,33);zs=np.linspace(-150,650,57)
queries=[]
for z in zs:
 for x in xs:
  source=p0+left*x+f*z;lonlat=(source@R.T+translation)/meters+origin;queries.append(lonlat)
queries=np.array(queries);batches=[(queries[i:i+45],f'terrain-{i//45:03d}') for i in range(0,len(queries),45)]
def get(batch):
 coords,label=batch;d=fetch(coords,label);return [float(next(iter(r['attributes'].values()))) for r in d['results']]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:heights=sum(list(pool.map(get,batches)),[])
# Actual source station spacing is approximately five metres. Keep sampled
# road geometry in metres and preserve satellite-extracted left/right widths.
road=[]
for i in range(175,310):
 d=xy[i]-p0;road.append([float(d@left),float(h(i)-h(anchor)),float(d@f),float(points[i,4]),float(points[i,5])])
out={'version':1,'anchorIndex':anchor,'units':'metres','road':road,'terrain':{'xs':xs.tolist(),'zs':zs.tolist(),'heights':[v-float(h(anchor)) for v in heights]},'source':{'plan':'TUMFTM racetrack-database Spa.csv, OSM-derived smoothed centreline and satellite widths','geographicRegistration':'Rigid ICP to bacinger/f1-circuits be-1925.geojson','registrationMedianM':reg['fitMedianM'],'elevation':'SPW Wallonie MNT 2021-2022 0.5 m LiDAR, raw Identify pixel values','roadHeightInterpolation':'shape-preserving cubic between 10 m source height samples','elevationOffsetM':float(h(anchor))}}
Path('web/public/environments/spa/terrain.json').write_text(json.dumps(out,separators=(',',':')))
(root/'terrain-provenance.json').write_text(json.dumps(out['source'],indent=2))
print('Saved',len(road),'road stations;',len(heights),'terrain samples; anchor elevation',h(anchor));print('road examples',road[::10])
