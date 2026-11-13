from pathlib import Path
import numpy as np
ROOT=Path('/Users/louis/Suep/Project/AERO');folder=ROOT/'assets/source/environments/spa/mature-pine'
v=np.fromfile(folder/'foliage-positions.f32',dtype='<f4').reshape(-1,3);f=np.fromfile(folder/'foliage-indices.u32',dtype='<u4').reshape(-1,3)
inside=(v[:,0]>1.0)&(v[:,0]<3.3)&(v[:,1]>10.7)&(v[:,1]<12.8)&(v[:,2]>-.9)&(v[:,2]<1.2);faces=f[np.all(inside[f],axis=1)];used,inverse=np.unique(faces.ravel(),return_inverse=True);np.savez_compressed(folder/'branch.npz',vertices=v[used],faces=inverse.reshape(-1,3));print('Branch triangles',len(faces),'bounds',v[used].min(axis=0),v[used].max(axis=0))
centres={}
for name,pitch in [('near',1.0),('far',1.4)]:
 lo=v.min(axis=0)-pitch;shape=np.ceil((v.max(axis=0)-lo)/pitch).astype(int)+2;ij=np.floor((v-lo)/pitch).astype(int);flat=(ij[:,0]*shape[1]+ij[:,1])*shape[2]+ij[:,2];count=np.bincount(flat,minlength=int(np.prod(shape)));valid=count>30;means=np.column_stack([np.bincount(flat,weights=v[:,k],minlength=len(count))[valid]/count[valid] for k in range(3)]);centres[name]=np.round(means,4).tolist();print(name,'3D branch bundles',len(means))
import json
(ROOT/'web/public/environments/spa/pine-branch-centres.json').write_text(json.dumps(centres,separators=(',',':')))
