"""Read the ASCII legacy VTK exported by this OpenFOAM case."""
import numpy as np

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
