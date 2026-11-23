import assert from 'node:assert/strict';
import test from 'node:test';

import { microtypo } from '../src/index.js';

const cases = [
  {
    name: 'plain spacing',
    source: '<p>Он в доме и саду.</p>',
    expected: '<p>Он\u00a0в\u00a0доме и\u00a0саду.</p>'
  },
  {
    name: 'spacing across emphasis and links',
    source: '<p>Он в <em>доме</em> и <a href="/x">саду</a>.</p>',
    expected: '<p>Он\u00a0в\u00a0<em>доме</em> и\u00a0<a href="/x">саду</a>.</p>'
  },
  {
    name: 'quotes across emphasis and links',
    source: '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>',
    expected: '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>'
  },
  {
    name: 'following protected code',
    source: '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<p><code>"x" -- a  b</code></p>',
    expected: '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<p><code>"x" -- a  b</code></p>'
  },
  {
    name: 'independent figure caption',
    source: '<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>',
    expected: '<figure><img src="/x"><figcaption>«Подпись»</figcaption></figure>'
  },
  {
    name: 'following figure caption',
    source:
      '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n<figure><img src="/x"><figcaption>"Подпись"</figcaption></figure>',
    expected:
      '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>\n<figure><img src="/x"><figcaption>«Подпись»</figcaption></figure>'
  },
  {
    name: 'quotes move outside a complete link label',
    source: '<p><a href="#section-1">"Анонс"</a></p>',
    expected: '<p>«<a href="#section-1">Анонс</a>»</p>'
  },
  {
    name: 'link quotes with trailing newline',
    source: '<p><a href="#section-1">"Анонс"</a></p>\n',
    expected: '<p>«<a href="#section-1">Анонс</a>»</p>'
  },
  {
    name: 'paragraph quotes with trailing newline',
    source: '<p>"<em>слово</em> и <a href="/x">другое</a>"</p>\n',
    expected: '<p>«<em>слово</em> и <a href="/x">другое</a>»</p>'
  }
];

test('HTML context survives inline markup, following blocks and successive worker jobs', async () => {
  await using typo = microtypo();

  for (const { name, source, expected } of cases) {
    const value = {
      source: { text: source },
      title: '&quot;Заголовок&quot;',
      text: { html: source, introduction: null },
      preview: { html: source, introduction: null },
      cover: { caption: '&quot;Подпись&quot;' }
    };
    const result = await typo.transform(value);

    assert.equal(result.text.html, expected, name);
    assert.equal(result.preview.html, expected, name);
    assert.equal(result.title, '«Заголовок»', name);
    assert.equal(result.cover.caption, '«Подпись»', name);
    assert.strictEqual(result.source, value.source);
  }
});
