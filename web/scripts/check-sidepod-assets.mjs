import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
for(const car of ['rb19','rb16b']){
 const base=new URL(`../public/flow/${car}/sidepod`,import.meta.url),meta=JSON.parse(await readFile(new URL(base.href+'.json'),'utf8')),raw=await readFile(new URL(base.href+'.bin'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),meta.sha256);assert.equal(meta.shape.join(','),'105,105,47');assert.equal(raw.length,meta.shape.reduce((a,b)=>a*b,1)*8);assert.equal(meta.time,'1150');
 const manifest=JSON.parse(await readFile(new URL(`../public/flow/${car}/manifest.json`,import.meta.url),'utf8'));const anchor=manifest.anchors.find(a=>a.anchor==='base');assert.deepEqual(meta.proxySha256,anchor.proxySha256);
 let valid=0,max=0;for(let i=0;i<raw.length;i+=8){const mask=raw.readInt16LE(i+6);assert.ok(mask===0||mask===1);if(!mask)continue;valid++;max=Math.max(max,Math.hypot(...[0,2,4].map(j=>raw.readInt16LE(i+j)*meta.scale)));}
 assert.equal(valid,meta.located);assert.ok(valid>10000&&max>1&&max<150);assert.equal(meta.excludedNumericalSamples,0);console.log(`${car}: ${valid} valid samples, max ${max.toFixed(2)} m/s, source geometry hashes match`);
}
