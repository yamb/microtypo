import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ op, payload }) => {
  if (op === 'crash') {
    throw new Error('worker crashed');
  }

  if (op === 'exit') {
    process.exit(1);
  }

  if (op === 'wait') {
    if (payload?.started) {
      const started = new Int32Array(payload.started);
      Atomics.store(started, 0, 1);
      Atomics.notify(started, 0);
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, payload?.ms ?? payload);
  }

  parentPort.postMessage({ ok: true, value: 'ready' });
});
