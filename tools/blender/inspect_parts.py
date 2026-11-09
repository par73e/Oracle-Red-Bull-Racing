"""Record normalized component bounds before building the movable asset."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
car = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / f'assets/working/{car}/{car}-review.blend'), use_scripts=False)
rows = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or obj.name.startswith('AERO_'):
        continue
    if car == 'rb19':
        parent = list(range(len(obj.data.vertices)))
        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for edge in obj.data.edges:
            a, b = (find(i) for i in edge.vertices)
            parent[a] = b
        groups = {}
        for v in obj.data.vertices:
            groups.setdefault(find(v.index), []).append(v.index)
    else:
        groups = {0: list(range(len(obj.data.vertices)))}
    for part, indices in groups.items():
        pts = [obj.matrix_world @ obj.data.vertices[i].co for i in indices]
        lo = [min(v[i] for v in pts) for i in range(3)]
        hi = [max(v[i] for v in pts) for i in range(3)]
        rows.append(dict(object=obj.name, part=part, n=len(indices),
                         lo=lo, hi=hi, center=[(a+b)/2 for a,b in zip(lo,hi)],
                         mats=[s.material.name if s.material else None for s in obj.material_slots],
                         hidden=obj.hide_render))
path=ROOT / f'docs/research/{car}-parts.json'
path.write_text(json.dumps(rows,indent=2)+'\n')
print('PARTS_RECORDED',car,len(rows))
