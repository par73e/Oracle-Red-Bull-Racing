import fs from 'node:fs/promises';
export async function loadRollingFixture(flow,car){
 const base=new URL(`../public/flow/${car}/`,import.meta.url);
 const [legacy,rolling]=await Promise.all(['manifest.json','rolling/manifest.json'].map(async p=>JSON.parse(await fs.readFile(new URL(p,base)))));
 const manifest={...legacy,anchors:[...legacy.anchors,...rolling.anchors]};
 flow.data={};for(const a of manifest.anchors){const b=await fs.readFile(new URL(`../public${a.file}`,import.meta.url));const i=new Int16Array(b.buffer,b.byteOffset,b.length/2);flow.data[a.anchor]=Float32Array.from(i,v=>v*a.scale);}
 flow.spec=manifest.anchors[0].grid;flow.grid=new Float32Array(flow.data.base.length);flow.stats.ready=true;return manifest;
}
