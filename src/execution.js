import { Worker } from 'node:worker_threads';

import { failure } from './limits.js';

function cleanup(job) {
  clearTimeout(job.timer);
  job.signal?.removeEventListener('abort', job.abort);
}

function timeout() {
  return failure('YAMB_CONTENT_TIMEOUT', 'MicroTypo wall time exceeded 15000 ms');
}

export function execution(options, workerURL = new URL('./worker.js', import.meta.url)) {
  let worker;
  let active;
  let closed = false;
  let closing;
  let stopping = Promise.resolve();
  const queue = [];

  function finish(job, error, value) {
    if (active !== job) {
      return;
    }

    active = undefined;
    cleanup(job);

    if (error !== undefined) {
      job.reject(error);
    } else {
      job.resolve(value);
    }
  }

  function stop() {
    if (worker) {
      const previous = worker;
      worker = undefined;

      stopping = (async () => {
        try {
          await previous.terminate();
        } finally {
          previous.removeAllListeners();
        }
      })();
    }

    return stopping;
  }

  function interrupt(job, reason) {
    if (active !== job || job.stopping) {
      return;
    }

    job.stopping = true;
    job.reason = reason;
    cleanup(job);

    void (async () => {
      try {
        await stop();
      } catch (cause) {
        job.reason = failure('YAMB_CONTENT_WORKER', 'MicroTypo worker shutdown failed', cause);
      }

      finish(job, job.reason);
      pump();
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
    worker = current;

    current.on('message', (message) => {
      if (worker !== current || !active || active.stopping) {
        return;
      }

      if (performance.now() >= active.deadline) {
        interrupt(active, timeout());
        return;
      }

      let error;

      if (!message.ok) {
        const cause = message.error;
        error = failure(
          cause?.code ?? 'YAMB_CONTENT_INPUT',
          cause?.message ?? 'MicroTypo operation failed',
          cause
        );

        if (cause?.field !== undefined) {
          error.field = cause.field;
        }
      }

      finish(active, error, message.value);
      pump();
    });

    current.on('error', (cause) => {
      if (worker === current && active) {
        interrupt(active, failure('YAMB_CONTENT_WORKER', 'MicroTypo worker failed', cause));
      }
    });

    current.on('exit', (code) => {
      if (worker === current) {
        worker = undefined;

        if (active) {
          interrupt(active, failure('YAMB_CONTENT_WORKER', `MicroTypo worker exited (${code})`));
        }
      }
    });

    current.on('messageerror', (cause) => {
      if (worker === current && active) {
        interrupt(active, failure('YAMB_CONTENT_WORKER', 'MicroTypo worker message failed', cause));
      }
    });
  }

  function pump() {
    if (active || closed || queue.length === 0) {
      return;
    }

    const job = queue.shift();
    active = job;

    void (async () => {
      try {
        await stopping;

        if (closed || active !== job || job.stopping) {
          return;
        }

        if (performance.now() >= job.deadline) {
          interrupt(job, timeout());
          return;
        }

        if (!worker) {
          startWorker();
        }

        try {
          worker.postMessage({ op: job.op, payload: job.payload });
        } catch (cause) {
          interrupt(
            job,
            failure('YAMB_CONTENT_INPUT', 'MicroTypo input cannot be transferred', cause)
          );
        }
      } catch (cause) {
        interrupt(job, failure('YAMB_CONTENT_WORKER', 'MicroTypo worker could not start', cause));
      }
    })();
  }

  function run(op, payload, { signal } = {}) {
    signal?.throwIfAborted();

    if (closed) {
      return Promise.reject(failure('YAMB_CONTENT_INPUT', 'MicroTypo owner is closed'));
    }

    if (active && queue.length >= 8) {
      return Promise.reject(failure('YAMB_CONTENT_BUSY', 'MicroTypo queue is full'));
    }

    return new Promise((resolve, reject) => {
      const job = { op, payload, signal, resolve, reject, deadline: performance.now() + 15000 };

      job.abort = () => cancel(job, signal.reason);
      job.timer = setTimeout(() => cancel(job, timeout()), 15000);
      signal?.addEventListener('abort', job.abort, { once: true });

      queue.push(job);
      pump();
    });
  }

  function close() {
    if (!closing) {
      closed = true;
      const error = failure('YAMB_CONTENT_INPUT', 'MicroTypo owner is closed');

      for (const job of queue.splice(0)) {
        cleanup(job);
        job.reject(error);
      }

      const job = active;

      if (job) {
        if (!job.stopping) {
          job.reason = error;
        }

        job.stopping = true;
        cleanup(job);
      }

      closing = (async () => {
        try {
          await stop();
        } finally {
          if (job) {
            finish(job, job.reason);
          }
        }
      })();
    }

    return closing;
  }

  return { run, close };
}
