import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
for (const car of ['rb19','rb16b']) {
 const base=new URL(`../public/flow/${car}/underbody`,import.meta.url);
 const meta=JSON.parse(await readFile(new URL(base.href+'.json'),'utf8'));
 const raw=await readFile(new URL(base.href+'.bin'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),meta.sha256);
 assert.equal(raw.length,meta.shape.reduce((a,b)=>a*b,1)*8);
 assert.equal(meta.shape.join(','),'117,57,45');
 assert.match(meta.status,/only 180 km\/h/);
 let located=0,max=0;
 for(let i=0;i<raw.length;i+=8){const mask=raw.readInt16LE(i+6);assert.ok(mask===0||mask===1);if(!mask)continue;located++;const u=[0,2,4].map(o=>raw.readInt16LE(i+o)*meta.scale);max=Math.max(max,Math.hypot(...u));}
 assert.equal(located,meta.located);assert.ok(located>1000);assert.ok(max>1&&max<150);
 console.log(`${car}: ${located} located samples, maximum ${max.toFixed(2)} m/s, ${meta.case} @ ${meta.time}`);
}
