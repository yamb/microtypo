import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';

import { execution } from '../src/execution.js';

const fixture = new URL('./fixtures/worker.js', import.meta.url);

test('an owner admits one active and eight waiting jobs, queued abort affects only its job', async () => {
  const owner = execution({}, fixture);
  const controller = new AbortController();
  const reason = new Error('queued reader left');

  try {
    const active = owner.run('wait', 100);
    const cancelled = owner.run('ready', null, { signal: controller.signal });
    const rejected = assert.rejects(cancelled, (error) => error === reason);
    const queued = Array.from({ length: 7 }, () => owner.run('ready'));

    await assert.rejects(owner.run('ready'), { code: 'YAMB_CONTENT_BUSY' });

    controller.abort(reason);
    await rejected;

    const replacement = owner.run('ready');

    assert.equal(await active, 'ready');
    assert.deepEqual(await Promise.all([...queued, replacement]), Array(8).fill('ready'));
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    await owner.close();
  }
});

test('active abort waits for worker termination, then the owner processes queued work', async () => {
  const owner = execution({}, fixture);
  const controller = new AbortController();
  const reason = { message: 'cancelled by reader' };

  try {
    const started = new SharedArrayBuffer(4);
    const active = owner.run('wait', { ms: 60000, started }, { signal: controller.signal });
    const rejected = assert.rejects(active, (error) => error === reason);
    const next = owner.run('ready');

    await Atomics.waitAsync(new Int32Array(started), 0, 0).value;
    controller.abort(reason);
    await rejected;

    assert.equal(await next, 'ready');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    await owner.close();
  }
});

test('worker crash and transfer failure preserve causes and allow subsequent success', async () => {
  const owner = execution({}, fixture);
  try {
    await assert.rejects(
      owner.run('crash'),
      (error) => error.code === 'YAMB_CONTENT_WORKER' && error.cause.message === 'worker crashed'
    );
    assert.equal(await owner.run('ready'), 'ready');

    await assert.rejects(owner.run('exit'), { code: 'YAMB_CONTENT_WORKER' });
    assert.equal(await owner.run('ready'), 'ready');

    await assert.rejects(
      owner.run('ready', { fn() {} }),
      (error) => error.code === 'YAMB_CONTENT_INPUT' && error.cause.name === 'DataCloneError'
    );
    assert.equal(await owner.run('ready'), 'ready');
  } finally {
    await owner.close();
  }
});

test(
  'wall deadline includes waiting time and owner remains reusable after timeout',
  { timeout: 22000 },
  async () => {
    const owner = execution({}, fixture);

    try {
      const start = performance.now();
      const jobs = [owner.run('wait', 60000), owner.run('wait', 60000)];
      const results = await Promise.allSettled(jobs);

      assert.ok(
        results.every(
          (result) => result.status === 'rejected' && result.reason.code === 'YAMB_CONTENT_TIMEOUT'
        )
      );
      assert.ok(performance.now() - start < 19000);
      assert.equal(await owner.run('ready'), 'ready');
    } finally {
      await owner.close();
    }
  }
);

test('close is idempotent and releases active jobs, queue and signal listeners', async () => {
  const owner = execution({}, fixture);
  const controller = new AbortController();
  const started = new SharedArrayBuffer(4);
  const pending = [
    owner.run('wait', { ms: 60000, started }, { signal: controller.signal }),
    owner.run('ready', null, { signal: controller.signal })
  ];
  const results = Promise.allSettled(pending);

  await Atomics.waitAsync(new Int32Array(started), 0, 0).value;

  const closing = owner.close();
  assert.equal(owner.close(), closing);
  await closing;

  assert.ok(
    (await results).every(
      (result) => result.status === 'rejected' && result.reason.code === 'YAMB_CONTENT_INPUT'
    )
  );
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

  await assert.rejects(owner.run('ready'), { code: 'YAMB_CONTENT_INPUT' });
});
