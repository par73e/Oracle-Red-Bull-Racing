import { parentPort } from 'node:worker_threads';
globalThis.self={postMessage:(m,transfer)=>parentPort.postMessage(m,transfer)};
await import('../src/flow-worker.js');
parentPort.on('message',data=>self.onmessage({data}));
