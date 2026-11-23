import assert from 'node:assert/strict';

import pkg from './package.json' with { type: 'json' };

const { microtypo } = await import(pkg.name);

await using typo = microtypo();
const value = await typo.transform({
  source: {},
  title: '&quot;Заголовок&quot;',
  text: { html: '<p>&quot;Текст&quot;</p>', introduction: null },
  cover: {}
});

assert.equal(value.title, '«Заголовок»');
assert.match(value.text.html, /«Текст»/);
