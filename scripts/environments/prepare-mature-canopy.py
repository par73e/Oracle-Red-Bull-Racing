"""Mature pine display canopy reconstructed from CC0 source needle positions.
This is a reduced 3D LOD of the source foliage distribution, not a photograph.
"""
from pathlib import Path
import numpy as np,json
from scipy.ndimage import gaussian_filter,binary_closing
from skimage.measure import marching_cubes
root=Path('/Users/louis/Suep/Project/AERO');folder=root/'assets/source/environments/spa/mature-pine'
p=np.fromfile(folder/'foliage-positions.f32',dtype='<f4').reshape(-1,3);pitch=.17;lo=p.min(axis=0)-pitch*3;shape=np.ceil((p.max(axis=0)-lo)/pitch).astype(int)+4;grid=np.zeros(shape,dtype=np.float32);index=np.floor((p-lo)/pitch).astype(int);np.add.at(grid,tuple(index.T),1)
# Normalize local occupancy instead of inventing a new crown contour.
grid=gaussian_filter((grid>0).astype(np.float32),.75);v,f,n,_=marching_cubes(grid,level=.18,spacing=(pitch,pitch,pitch));v+=lo
np.savez_compressed(folder/'canopy.npz',vertices=v.astype(np.float32),faces=f.astype(np.int32))
print('Source points',len(p),'canopy triangles',len(f),'bounds',p.min(axis=0),p.max(axis=0))
