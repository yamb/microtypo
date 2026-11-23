import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';

import { microtypo } from '../src/index.js';

function post(html = '<p>Он сказал &quot;привет&quot;.</p>') {
  return {
    source: { title: '"Источник"', text: '"исходник"', options: { caption: '"raw"' } },
    title: '&quot;Заголовок&quot;',
    text: { html, introduction: { lines: [2, 3], marker: 'intro-123' } },
    preview: { html: '<p>&quot;Анонс&quot;</p>', introduction: null },
    cover: { url: '/raw--url.jpg', alt: '"raw" -- alt', caption: '&quot;Подпись&quot;', width: 100 }
  };
}

test('one reusable transformer typesets all HTML fields and preserves source, code and metadata', async () => {
  await using typo = microtypo();
  const value = post(
    '<p>Он сказал &quot;привет&quot; <a href="/raw--url" title="raw -- title">ссылка</a></p><code>"raw" -- x</code><pre>"raw" -- x\n</pre><hr data-yamb-intro="intro-123">'
  );
  const before = structuredClone(value);
  const out = await typo.transform(value);

  assert.equal(out.title, '«Заголовок»');
  assert.equal(out.cover.caption, '«Подпись»');
  assert.match(out.text.html, /«привет»/);
  assert.match(out.preview.html, /«Анонс»/);
  assert.match(out.text.html, /href="\/raw--url" title="raw\u00a0— title"/);
  assert.match(out.text.html, /<code>"raw" -- x<\/code><pre>"raw" -- x\n<\/pre>/);
  assert.match(out.text.html, /data-yamb-intro="intro-123"/);

  assert.deepEqual(out.text.introduction, value.text.introduction);
  assert.equal(out.cover.alt, '«raw»\u00a0— alt');
  assert.equal(out.cover.url, value.cover.url);
  assert.strictEqual(out.source, value.source);
  assert.deepEqual(value, before);

  assert.deepEqual(await typo.transform(value), out);
});

test('empty and absent optional fields stay distinct, Unicode and escaped literal tags survive', async () => {
  await using typo = microtypo();

  for (const preview of [undefined, { html: '', introduction: null }]) {
    const value = {
      source: {},
      title: '&lt;b&gt;😀&lt;/b&gt;',
      text: { html: '', introduction: null },
      cover: {}
    };

    if (preview !== undefined) {
      value.preview = preview;
    }

    const out = await typo.transform(value);

    assert.equal(out.title, '&lt;b&gt;😀&lt;/b&gt;');
    assert.equal(out.text.html, '');
    assert.deepEqual(out.cover, {});
    assert.equal(Object.hasOwn(out, 'preview'), preview !== undefined);

    if (preview) {
      assert.equal(out.preview.html, '');
    }
  }
});

test('native HTML attribute typography preserves technical attributes, URLs and protected code', async () => {
  await using typo = microtypo();
  const cases = [
    [
      `<img src="/raw--url?q=1000&x=2" alt='"Фото" - 1000 руб.' title="Он в доме">`,
      `<img src="/raw--url?q=1000&x=2" alt='«Фото»\u00a0— 1000\u00a0₽.' title="Он\u00a0в\u00a0доме">`
    ],
    [
      '<input placeholder="Он в саду" aria-label="Он в доме">',
      '<input placeholder="Он\u00a0в\u00a0саду" aria-label="Он\u00a0в\u00a0доме">'
    ],
    [
      `<meta name="description" content='"Описание" - 1000 руб.'>`,
      `<meta name="description" content='«Описание»\u00a0— 1000\u00a0₽.'>`
    ],
    ['<meta name="viewport" content="Он в доме">', '<meta name="viewport" content="Он в доме">'],
    [
      '<a href="/raw--url?q=1000&x=2" id="Он в доме" data-note="Он в доме">"Ссылка"</a>',
      '«<a href="/raw--url?q=1000&x=2" id="Он в доме" data-note="Он в доме">Ссылка</a>»'
    ],
    ['<code title="Он в доме">"x" -- a  b</code>', '<code title="Он в доме">"x" -- a  b</code>']
  ];

  for (const [source, expected] of cases) {
    const out = await typo.transform(post(source));
    assert.equal(out.text.html, expected);
  }
});

test('pending typography keeps a consistent field snapshot when its caller edits the input', async () => {
  await using typo = microtypo();
  const value = post();
  const pending = typo.transform(value);

  value.title = 'Edited';
  value.text.html = 'Edited';
  value.preview = undefined;
  value.cover.alt = 'Edited';
  value.cover.caption = undefined;

  const out = await pending;
  assert.equal(out.title, '«Заголовок»');
  assert.equal(out.text.html, '<p>Он\u00a0сказал «привет».</p>');
  assert.equal(out.preview.html, '<p>«Анонс»</p>');
  assert.equal(out.cover.alt, '«raw»\u00a0— alt');
  assert.equal(out.cover.caption, '«Подпись»');
});

test('plain cover alt gains native typography while literal markup and entity spellings stay text', async () => {
  await using typo = microtypo();
  const value = post();
  value.cover.alt = '<b>"Фото"</b> - 1000 руб. &lt;b&gt; &amp; &amp;quot;';
  const before = structuredClone(value);
  const out = await typo.transform(value);

  assert.equal(out.cover.alt, '<b>«Фото»</b>\u00a0— 1000\u00a0₽ &lt;b&gt; &amp; &amp;quot;');
  assert.deepEqual(value, before);
  assert.strictEqual(out.source, value.source);
});

test('a source-sized cover alt may expand within the derived field budget', async () => {
  await using typo = microtypo();
  const value = post();
  value.cover.alt = 'т.е. '.repeat(1000);
  const out = await typo.transform(value);

  assert.equal(value.cover.alt.length, 5000);
  assert.equal(out.cover.alt, 'т.\u00a0е. '.repeat(1000).trim());
});

test('native rules are validated, copied and used; stage-owned settings cannot be overridden', async () => {
  const options = { rules: { quote: false } };
  await using typo = microtypo(options);
  options.rules.quote = true;

  assert.equal((await typo.transform(post())).title, '"Заголовок"');

  for (const invalid of [
    { unknown: true },
    { input: 'text' },
    { html: false },
    { entities: false },
    { maxInputLength: 1 },
    { maxProcessingMs: 0 },
    { rules: { invented: true } },
    { render: { invented: true } },
    null,
    []
  ]) {
    assert.throws(() => microtypo(invalid));
  }
});

test('wrong stage and oversized input fail explicitly, then the owner recovers', async () => {
  await using typo = microtypo();
  for (const value of ['text', { source: {}, title: 'T', text: { tokens: [] }, cover: {} }]) {
    await assert.rejects(typo.transform(value), { code: 'YAMB_CONTENT_INPUT' });
  }

  for (const field of ['title', 'text', 'preview', 'caption', 'alt']) {
    const value = post();

    if (field === 'text' || field === 'preview') {
      value[field].html = 'x'.repeat(5000001);
    } else if (field === 'caption' || field === 'alt') {
      value.cover[field] = 'x'.repeat(5000001);
    } else {
      value.title = 'x'.repeat(5000001);
    }

    await assert.rejects(typo.transform(value), { code: 'YAMB_CONTENT_LIMIT' });
  }

  assert.equal((await typo.transform(post())).title, '«Заголовок»');
});

test('prepared and partially prepared content cannot retain stale projections beside new HTML', async () => {
  await using typo = microtypo();
  for (const field of ['text', 'preview']) {
    for (const projection of [
      { tree: { type: 'root', children: [{ type: 'text', value: '"Привет"' }] } },
      { plain: '"Привет"' },
      { feedHtml: '<p>"Привет"</p>' }
    ]) {
      const value = post();
      Object.assign(value[field], projection);
      const before = structuredClone(value);

      await assert.rejects(typo.transform(value), { code: 'YAMB_CONTENT_INPUT' });
      assert.deepEqual(value, before);
    }
  }

  const value = post();
  value.text.metadata = { author: 'reader' };
  const result = await typo.transform(value);

  assert.equal(result.title, '«Заголовок»');
  assert.deepEqual(result.text.metadata, value.text.metadata);
});

test(
  'the exact HTML ceiling is accepted without chunking or a main-thread regex',
  { timeout: 20000 },
  async () => {
    await using typo = microtypo({ presets: false });
    const value = post('x'.repeat(5000000));
    assert.equal((await typo.transform(value)).text.html.length, 5000000);
  }
);

test('public pathological work is actively cancelled and the owner recovers with queued work', async () => {
  await using typo = microtypo();
  await typo.transform(post());

  const controller = new AbortController();
  const reason = Symbol('reader left');
  const value = post('a.'.repeat(500000));
  const active = typo.transform(value, { signal: controller.signal });
  const rejected = assert.rejects(active, (error) => error === reason);
  const next = typo.transform(post());

  setTimeout(() => controller.abort(reason), 100);
  await rejected;

  assert.equal((await next).title, '«Заголовок»');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('public queue saturation, isolated queued cancellation, close and every native reason', async () => {
  for (const reason of [null, false, 0, '', NaN, Symbol('stop'), { why: 'left' }]) {
    const typo = microtypo();
    const controller = new AbortController();
    const active = typo.transform(post('a.'.repeat(500000)), { signal: controller.signal });
    const rejected = assert.rejects(active, (error) => Object.is(error, reason));

    controller.abort(reason);

    const closing = typo.close();
    assert.strictEqual(typo.close(), closing);
    await Promise.all([rejected, closing]);

    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await assert.rejects(typo.transform(post()), { code: 'YAMB_CONTENT_INPUT' });
  }

  await using typo = microtypo();
  const controller = new AbortController();
  const active = typo.transform(post());
  const cancelled = typo.transform(post(), { signal: controller.signal });
  const rejected = assert.rejects(cancelled, (error) => error === false);
  const rest = Array.from({ length: 7 }, () => typo.transform(post()));

  await assert.rejects(typo.transform(post()), { code: 'YAMB_CONTENT_BUSY' });

  controller.abort(false);
  const replacement = typo.transform(post());
  await rejected;

  assert.ok(
    (await Promise.all([active, ...rest, replacement])).every(
      (value) => value.title === '«Заголовок»'
    )
  );
});
