# @meritt/yamb-microtypo

[![npm version][npm-image]][npm-url] [![Build status][github-actions-image]][github-actions-url] [![Coverage status][coveralls-image]][coveralls-url] [![Dependency status][libraries-image]][libraries-url]

Apply native [MicroTypo](https://github.com/meritt/microtypo) typography between HTML conversion and cleanup in the [Yamb](https://github.com/yamb/yamb) preparation pipeline.

For GitHub Packages, route the `@yamb` scope to `https://npm.pkg.github.com` and install `@yamb/microtypo`.

## Quick start

Requires Node.js 26.13 or later. Install the standard preparation chain.

```bash
pnpm add yamb @meritt/yamb-markdown @meritt/yamb-microtypo
```

```js
import { markdown } from '@meritt/yamb-markdown';
import { microtypo } from '@meritt/yamb-microtypo';
import { prepare } from 'yamb/transform';

await using md = markdown();
await using typo = microtypo();

const stages = [md, md.html(), typo, md.clean()];

const source = {
  title: '"Заголовок"',
  text: '"Привет", мир.'
};

const prepared = await prepare(source, stages, {
  base: new URL('https://example.com/blog'),
  timeZone: 'UTC'
});

console.log(prepared.title);
console.log(prepared.text.html);
```

Reuse both owners across posts and close them after preparation completes.

## Reference

### Transformer

`microtypo(options?)` returns `{ name, version, transform, close, [Symbol.asyncDispose] }`. The version identifies both the adapter and the engine. `transform(value, ctx?)` accepts the [HtmlPost](https://github.com/yamb/markdown#reference) produced by `md.html()` and an optional `ctx.signal`.

Typography applies to `title`, `text.html`, existing `preview.html` and `cover.caption` as HTML, and to `cover.alt` as plain text. It protects code and typesets HTML attributes `alt`, `title`, `aria-label`, `placeholder` and descriptive `meta[content]`. URLs, IDs, `data-*`, existing character references in attributes, source fields and introduction metadata stay intact. Missing and empty previews retain their original presence.

`transform` returns new post, content and cover objects. Run `md.clean()` afterward to sanitize HTML.

### Native options

The factory accepts a plain object with `presets`, `rules` and `render`. Construction clones and validates the settings.

| Option | Native behavior |
| --- | --- |
| `presets` | Boolean; defaults to `true`. `false` omits built-in rule groups. |
| `rules` | Native group, bundle and rule-selector switches, such as `{ quote: false }` or `{ 'quote.nested': false }`. |
| `render` | Native settings are validated, but `html: false` skips text layout/link rules (`paragraphs`, `autolink`, `breakline`) and disables wrappers (`nowrap`, `hanging`, `prefix`); these settings do not affect the adapter's output. |

```js
import { microtypo } from '@meritt/yamb-microtypo';

await using typo = microtypo({
  rules: {
    quote: false
  }
});
```

See [MicroTypo](https://github.com/meritt/microtypo) for native rule selectors. The adapter fixes the following settings and rejects them as options.

| Setting           | Fixed value                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `input`           | `'html'` for HTML fields; `'plain'` for separate cover alt                  |
| `html`            | `false` — no generated typography markup, including hanging/nowrap wrappers |
| `entities`        | `false` — Unicode output                                                    |
| `maxInputLength`  | `5000000` UTF-16 units                                                      |
| `maxProcessingMs` | `10000` ms cooperative budget per native `process` call                     |

### Limits and lifecycle

Each owner starts one worker on demand and reuses it across posts.

| Resource | Maximum |
| --- | --- |
| Each input/output string | 5000000 UTF-16 units; overflow rejects without chunking |
| Per owner | One active job and eight waiting jobs |
| Wall deadline per job | 15000 ms from enqueue, including queue time and all fields |
| Worker V8 budgets | Old generation 512 MiB, young generation 32 MiB, stack 8 MiB; not a process RSS cap |

Queued cancellation removes the request. Active cancellation or timeout terminates the worker before releasing its slot. `close()` and `Symbol.asyncDispose` reject pending work and await shutdown. Closure is idempotent, and later calls to `transform` reject. A request already stopping keeps its failure reason. Abort reasons retain identity.

### Errors

Factory failures are synchronous: an invalid options container or unsupported top-level key throws `YAMB_CONTENT_INPUT`; uncloneable values can throw native `DataCloneError`; invalid native settings throw MicroTypo's constructor error unchanged, including `ERR_MICROTYPO_CONFIG`.

| Job error code | Cause |
| --- | --- |
| `YAMB_CONTENT_INPUT` | Invalid HtmlPost/stage, transfer failure, closed owner or native failure without a code |
| `YAMB_CONTENT_LIMIT` | Input/output string budget exceeded; includes `field` |
| `YAMB_CONTENT_BUSY` | Queue full |
| `YAMB_CONTENT_TIMEOUT` | Wall deadline exceeded |
| `YAMB_CONTENT_WORKER` | Worker start, crash, exit, message or shutdown failure |
| Native code, such as `ERR_MICROTYPO_BUDGET` | Native `process` failure; code/message are retained with the worker's error record as `cause` |

The core executor wraps stage failures with stage/cause and preserves cancellation. Failed jobs return no partial post.

## Author

[Alexey Simonenko](https://simonenko.xyz)

## License

MIT. See `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/@meritt/yamb-microtypo?style=flat
[npm-url]: https://www.npmjs.com/package/@meritt/yamb-microtypo
[github-actions-image]: https://github.com/yamb/microtypo/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/yamb/microtypo/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/yamb/microtypo/badge.svg
[coveralls-url]: https://coveralls.io/github/yamb/microtypo
[libraries-image]: https://img.shields.io/librariesio/release/npm/%40meritt%2Fyamb-microtypo?style=flat
[libraries-url]: https://libraries.io/npm/%40meritt%2Fyamb-microtypo
