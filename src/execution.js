import { addAbortListener } from 'node:events';
import { Worker } from 'node:worker_threads';

import { failure } from './limits.js';

function cleanup(job) {
  clearTimeout(job.timer);
  job.listener?.[Symbol.dispose]();
}

function closed() {
  return failure('YAMB_CONTENT_INPUT', 'MicroTypo owner is closed');
}

export function execution(
  options,
  workerURL = new URL('./worker.js', import.meta.url),
  deadline = 15000
) {
  let worker;
  let active;
  let closing;
  let stopping = Promise.resolve();
  const queue = [];

  function timeout() {
    return failure('YAMB_CONTENT_TIMEOUT', `MicroTypo wall time exceeded ${deadline} ms`);
  }

  function finish(job, error, value) {
    if (active !== job) {
      return;
    }

    active = undefined;
    cleanup(job);

    if (error === undefined) {
      job.resolve(value);
    } else {
      job.reject(error);
    }

    pump();
  }

  function stop() {
    stopping = worker?.terminate() ?? stopping;
    worker = undefined;

    return stopping;
  }

  function interrupt(job, reason) {
    if (active !== job || job.stopping) {
      return;
    }

    job.stopping = true;

    void (async () => {
      await stop();
      finish(job, reason);
    })();
  }

  function cancel(job, reason) {
    if (active === job) {
      interrupt(job, reason);
      return;
    }

    const index = queue.indexOf(job);

    if (index >= 0) {
      queue.splice(index, 1);
      cleanup(job);
      job.reject(reason);
    }
  }

  function startWorker() {
    const current = new Worker(workerURL, {
      execArgv: [],
      workerData: options,
      resourceLimits: {
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8
      }
    });

    function fail(what, cause) {
      if (worker === current && active) {
        interrupt(active, failure('YAMB_CONTENT_WORKER', `MicroTypo worker ${what}`, cause));
      }
    }

    current.on('message', (message) => {
      if (worker !== current || !active || active.stopping) {
        return;
      }

      if (message.ok) {
        finish(active, undefined, message.value);
        return;
      }

      const {
        code = 'YAMB_CONTENT_INPUT',
        message: text = 'MicroTypo operation failed',
        field
      } = message.error;
      const error = failure(code, text, message.error);

      if (field !== undefined) {
        error.field = field;
      }

      finish(active, error);
    });

    current.on('error', (cause) => fail('failed', cause));
    current.on('messageerror', (cause) => fail('message failed', cause));
    current.on('exit', (code) => {
      fail(`exited (${code})`);

      if (worker === current) {
        worker = undefined;
      }
    });

    // Must follow the listeners: adding a 'message' listener refs the worker again.
    current.unref();

    return current;
  }

  function pump() {
    if (active || queue.length === 0) {
      return;
    }

    const job = queue.shift();
    active = job;

    void (async () => {
      await stopping;

      if (job.stopping) {
        return;
      }

      try {
        worker ??= startWorker();
      } catch (cause) {
        finish(job, failure('YAMB_CONTENT_WORKER', 'MicroTypo worker could not start', cause));
        return;
      }

      try {
        worker.postMessage(job.payload);
      } catch (cause) {
        finish(job, failure('YAMB_CONTENT_INPUT', 'MicroTypo input cannot be transferred', cause));
      }
    })();
  }

  async function run(payload, { signal } = {}) {
    signal?.throwIfAborted();

    if (closing) {
      throw closed();
    }

    if (queue.length >= 8) {
      throw failure('YAMB_CONTENT_BUSY', 'MicroTypo queue is full');
    }

    const job = { ...Promise.withResolvers(), payload };
    job.timer = setTimeout(() => cancel(job, timeout()), deadline);

    if (signal) {
      job.listener = addAbortListener(signal, () => cancel(job, signal.reason));
    }

    queue.push(job);
    pump();

    return job.promise;
  }

  function close() {
    if (!closing) {
      const error = closed();

      for (const job of queue.splice(0)) {
        cleanup(job);
        job.reject(error);
      }

      if (active) {
        interrupt(active, error);
      }

      closing = (async () => {
        await stop();
      })();
    }

    return closing;
  }

  return { run, close };
}
