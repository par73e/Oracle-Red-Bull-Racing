"""Pack the three original 3D needle renders, without image synthesis."""
import struct,zlib,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def read(path):
 data=path.read_bytes();p=8;compressed=b''
 while p<len(data):
  n=struct.unpack('>I',data[p:p+4])[0];kind=data[p+4:p+8];chunk=data[p+8:p+8+n];p+=n+12
  if kind==b'IHDR':w,h,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',chunk);assert (depth,color,interlace)==(8,6,0)
  if kind==b'IDAT':compressed+=chunk
 raw=zlib.decompress(compressed);rows=[];prior=bytearray(w*4)
 for y in range(h):
  mode=raw[y*(w*4+1)];row=bytearray(raw[y*(w*4+1)+1:(y+1)*(w*4+1)])
  for i in range(len(row)):
   a=row[i-4] if i>=4 else 0;b=prior[i];c=prior[i-4] if i>=4 else 0
   if mode==1:value=a
   elif mode==2:value=b
   elif mode==3:value=(a+b)//2
   elif mode==4:
    q=a+b-c;pa,pb,pc=abs(q-a),abs(q-b),abs(q-c);value=a if pa<=pb and pa<=pc else b if pb<=pc else c
   else:value=0
   row[i]=(row[i]+value)&255
  rows.append(bytes(row));prior=row
 return w,h,rows
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
sources=[read(root/f'assets/source/environments/spa/mature-pine/branch-{i}.png') for i in range(3)];w,h,_=sources[0];pixels=b''.join(b'\0'+b''.join(s[2][y] for s in sources) for y in range(h));out=Path('/private/tmp/aero-pine-atlas.png');out.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w*3,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(pixels,9))+chunk(b'IEND',b''));subprocess.run(['/opt/homebrew/bin/cwebp','-lossless',str(out),'-o',str(root/'web/public/environments/spa/pine-branches.webp')],check=True)
