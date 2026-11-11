"""Scientific figures from solver-exported VTK; no invented streamlines."""
from pathlib import Path
import json,os
os.environ.setdefault('MPLCONFIGDIR',str(Path(__file__).resolve().parents[1]/'.mplcache'))
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.tri as mtri
ROOT=Path(__file__).resolve().parents[2];case=ROOT/'cfd/cases/rb19-50ms-coarse';out=ROOT/'cfd/results';out.mkdir(exist_ok=True)
def read_vtk(path):
 text=path.read_text();assert text.splitlines()[2]=='ASCII'
 t=text.split();i=t.index('POINTS');n=int(t[i+1]);i+=3
 points=np.array(t[i:i+3*n],float).reshape(n,3);i+=3*n;cells={}
 for kind in ['POLYGONS','LINES']:
  if kind not in t:continue
  j=t.index(kind);count=int(t[j+1]);j+=3;rows=[]
  for _ in range(count):
   length=int(t[j]);j+=1;rows.append(np.array(t[j:j+length],int));j+=length
  cells[kind]=rows
 arrays={}
 if 'FIELD' in t:
  j=t.index('FIELD');count=int(t[j+2]);j+=3
  for _ in range(count):
   name=t[j];components=int(t[j+1]);tuples=int(t[j+2]);j+=4
   arrays[name]=np.array(t[j:j+components*tuples],float).reshape(tuples,components);j+=components*tuples
 return points,cells,arrays
plt.rcParams.update({'font.family':'DejaVu Sans','axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'#f3f4f1','axes.facecolor':'#f3f4f1'})
paths=list((case/'postProcessing/slices').glob('*/centerPlane.vtk'));path=max(paths,key=lambda p:float(p.parent.name));step=path.parent.name
points,cells,data=read_vtk(path)
triangles=np.array([[c[0],c[j],c[j+1]] for c in cells['POLYGONS'] for j in range(1,len(c)-1)])
xz=points[:,[0,2]];v=xz[triangles]
area=np.abs((v[:,1,0]-v[:,0,0])*(v[:,2,1]-v[:,0,1])-(v[:,1,1]-v[:,0,1])*(v[:,2,0]-v[:,0,0]))
center=v.mean(axis=1)
triangles=triangles[(area>1e-12)&(center[:,0]>-4.5)&(center[:,0]<9.5)&(center[:,1]<2.5)]
tri=mtri.Triangulation(points[:,0],points[:,2],triangles)
speed=np.linalg.norm(data['U'],axis=1);cp=2*data['p'].ravel()/50**2
fig,axes=plt.subplots(2,1,figsize=(13,6.8),layout='constrained')
for ax,values,cmap,label,limits in [(axes[0],speed,'viridis','Speed (m/s)',(0,85)),(axes[1],cp,'coolwarm','Pressure coefficient Cp',(-1.5,1.0))]:
 image=ax.tripcolor(tri,facecolors=values[triangles].mean(axis=1),shading='flat',cmap=cmap,vmin=limits[0],vmax=limits[1],rasterized=True)
 ax.set(xlim=(-4,9),ylim=(0,2),ylabel='Height (m)',aspect='equal');fig.colorbar(image,ax=ax,pad=.01,label=label,shrink=.85)
 ax.annotate('FLOW  50 m/s',xy=(-3.25,1.65),xytext=(-3.9,1.65),arrowprops={'arrowstyle':'->'},fontsize=9)
axes[-1].set_xlabel('Downstream X (m)')
fig.suptitle(f'RB19 full-car CFD trial | 373,214 cells | iteration {step}',x=.06,ha='left',fontsize=17,weight='bold')
fig.text(.06,.005,'COARSE VOXEL PROXY  /  First-order RANS, no prism layers or mesh-independence study. Not validated RB19 performance.',fontsize=9,color='#8c3b26')
fig.savefig(out/'rb19-flow-slices.png',dpi=170,bbox_inches='tight');plt.close(fig)
force=np.loadtxt(ROOT/'cfd/reports/rb19-forces.csv',delimiter=',',skiprows=1)
fig,axes=plt.subplots(1,2,figsize=(12,4),layout='constrained')
visible=force[force[:,0]>=100]
axes[0].plot(visible[:,0],visible[:,1],label='Drag',color='#304a70');axes[0].plot(visible[:,0],-visible[:,3],label='Downforce',color='#b4482f')
axes[0].set(xlim=(100,float(step)),xlabel='Steady solver iteration',ylabel='Force on proxy (N)',title='Force history after initialisation');axes[0].legend(frameon=False)
summary=json.loads((ROOT/'cfd/reports/rb19-run-summary.json').read_text())
# Extract initial residuals from actual solver log, one value per iteration.
import re
records={};iteration=0
for line in (case/'log.foamRun').read_text().splitlines():
 m=re.match(r'Time = ([\d.]+)',line)
 if m:iteration=int(float(m[1]));records[iteration]={}
 m=re.search(r'Solving for (\w+), Initial residual = ([\deE+.-]+)',line)
 if m:records[iteration].setdefault(m[1],float(m[2]))
for field in ['Ux','Uy','Uz','p','k','omega']:
 rows=[(i,d[field]) for i,d in records.items() if field in d and i>0];arr=np.array(rows)
 axes[1].semilogy(arr[:,0],arr[:,1],label=field,linewidth=1)
axes[1].set(xlabel='Steady solver iteration',ylabel='Initial residual',title='Equation convergence');axes[1].legend(frameon=False,ncol=3)
fig.suptitle('RB19 numerical convergence | exploratory calculation',fontsize=15,weight='bold')
fig.savefig(out/'rb19-convergence.png',dpi=160,bbox_inches='tight');plt.close(fig)
# Preserve the actual integrated center-plane particle tracks for later web use.
tracks=list((case/'postProcessing/streamlinesCenter').glob('*/tracks.vtk'))
if tracks:
 p,c,d=read_vtk(max(tracks,key=lambda p:float(p.parent.name)))
 lines=[]
 for line in c['LINES']:
  take=line[::max(1,len(line)//250)]
  lines.append({'points':p[take].round(5).tolist(),'speedMps':np.linalg.norm(d['U'][take],axis=1).round(4).tolist()})
 (out/'rb19-streamlines.json').write_text(json.dumps({'coordinateSystem':'X downstream Y right Z up; metres','speedMps':50,'drs':0,'source':'OpenFOAM solved velocity field; integrated steady streamlines','validation':'coarse proxy only','lines':lines},separators=(',',':')))
print('Saved figures and actual solver streamlines',out)
