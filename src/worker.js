import { parentPort, workerData } from 'node:worker_threads';

import { MicroTypo } from 'microtypo';

import { string } from './limits.js';

const engine = new MicroTypo(workerData);
let plain;

parentPort.on('message', ({ payload }) => {
  try {
    const value = {};

    for (const [field, text] of Object.entries(payload)) {
      let typo = engine;

      if (field === 'alt') {
        plain ??= new MicroTypo({ ...workerData, input: 'plain' });
        typo = plain;
      }

      value[field] = string(typo.process(text), field);
    }

    parentPort.postMessage({ ok: true, value });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: { code: error.code, message: error.message, field: error.field }
    });
  }
});
