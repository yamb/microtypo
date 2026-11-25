import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ op, ms, started }) => {
  if (op === 'crash') {
    throw new Error('worker crashed');
  }

  if (op === 'exit') {
    process.exit(1);
  }

  if (op === 'wait') {
    if (started) {
      const flag = new Int32Array(started);
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }

  parentPort.postMessage({ ok: true, value: 'ready' });
});
