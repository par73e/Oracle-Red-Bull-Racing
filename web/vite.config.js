import { defineConfig } from 'vite';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const flowRoot=path.resolve(fileURLToPath(new URL('./public/flow/',import.meta.url)));
export default defineConfig({server:{watch:{usePolling:true,interval:800,ignored:['**/public/flow/**']}},plugins:[{
 name:'live-cfd-fields',
 configureServer(server){
  // The solver writes through OrbStack; these additions may not emit macOS
  // watcher events. Read live /flow files directly, rather than Vite's file set.
  server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/flow/'))return next();
   let file;try{file=path.resolve(flowRoot,decodeURIComponent(url.pathname.slice(6)));}catch{return next();}
   if(!file.startsWith(flowRoot+path.sep)&&file!==flowRoot)return next();
   try{const info=await stat(file);if(!info.isFile())return next();res.statusCode=200;res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Length',info.size);if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);}catch{res.statusCode=404;res.end('CFD field not available');}
  });
 }
}]});
