"""Show wheel-plane and horizontal cuts from the existing 800-iteration result."""
from pathlib import Path
import os,json,hashlib
ROOT=Path(__file__).resolve().parents[2]
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'cfd/.mplcache'))
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.tri as mtri
from vtk_utils import read_vtk
plt.rcParams.update({'font.family':'DejaVu Sans','axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'#f3f4f1','axes.facecolor':'#e5e6e2'})
base=ROOT/'cfd/cases/rb19-50ms-coarse/postProcessing/slices/800'
fig,axes=plt.subplots(2,1,figsize=(13,7.2),layout='constrained')
for ax,file,dims,limits,label in [(axes[0],'frontWheelPlane.vtk',[0,2],(-3.3,7.5,0,1.4),'Wheel centre cut: Y = -0.796 m'),(axes[1],'horizontalPlane.vtk',[0,1],(-3.3,7.5,-1.5,1.5),'Horizontal cut: Z = 0.30 m')]:
 p,c,d=read_vtk(base/file);assert all(np.isfinite(a).all() for a in d.values())
 t=np.array([[cell[0],cell[j],cell[j+1]] for cell in c['POLYGONS'] for j in range(1,len(cell)-1)])
 uv=p[:,dims];v=uv[t];centers=v.mean(axis=1)
 area=np.abs((v[:,1,0]-v[:,0,0])*(v[:,2,1]-v[:,0,1])-(v[:,1,1]-v[:,0,1])*(v[:,2,0]-v[:,0,0]))
 a,b,y0,y1=limits
 t=t[(area>1e-12)&(centers[:,0]>a-.5)&(centers[:,0]<b+.5)&(centers[:,1]>y0-.5)&(centers[:,1]<y1+.5)]
 triangulation=mtri.Triangulation(uv[:,0],uv[:,1],t)
 speed=np.linalg.norm(d['U'],axis=1)
 image=ax.tripcolor(triangulation,facecolors=speed[t].mean(axis=1),cmap='viridis',vmin=0,vmax=85,shading='flat',rasterized=True)
 ax.set(xlim=(a,b),ylim=(y0,y1),aspect='equal',ylabel='Height Z (m)' if dims[1]==2 else 'Lateral Y (m)',title=label)
 fig.colorbar(image,ax=ax,pad=.012,label='Speed (m/s)',shrink=.85)
axes[0].annotate('FRONT TYRE',xy=(-1.47,.45),xytext=(-2.4,1.05),arrowprops={'arrowstyle':'->','color':'white'},color='white',weight='bold',fontsize=9)
axes[0].annotate('REAR TYRE',xy=(2.05,.45),xytext=(2.5,1.05),arrowprops={'arrowstyle':'->','color':'white'},color='white',weight='bold',fontsize=9)
axes[1].set_xlabel('Downstream X (m)  /  air flows left to right')
fig.suptitle('RB19 | wheels included in the 3D CFD calculation',x=.06,ha='left',fontsize=17,weight='bold')
fig.text(.06,-.035,'50 m/s / rotating-wall tyres + moving ground / coarse proxy, not validated tyre-wake detail',fontsize=9,color='#8c3b26')
out=ROOT/'cfd/results/rb19-wheel-flow.png';fig.savefig(out,dpi=160,bbox_inches='tight');plt.close(fig)
manifest_path=ROOT/'cfd/reports/result-manifest.json';manifest=json.loads(manifest_path.read_text())
manifest['files'][out.name]={'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print(out)
