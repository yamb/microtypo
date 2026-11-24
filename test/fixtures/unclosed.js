import { execution } from '../../src/execution.js';

const owner = execution({}, new URL('./worker.js', import.meta.url));
console.log(await owner.run({ op: 'ready' }));
