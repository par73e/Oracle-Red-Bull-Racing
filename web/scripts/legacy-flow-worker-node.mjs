import { parentPort } from 'node:worker_threads';
globalThis.self={postMessage:(m,transfer)=>parentPort.postMessage(m,transfer)};
await import('./legacy-flow-worker.mjs');
parentPort.on('message',data=>self.onmessage({data}));
